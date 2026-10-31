---
title: join / outer joins / crossJoin
description: Combine named inputs with an inner ALL join, a LEFT, RIGHT or FULL ALL join, or a Cartesian product.
sidebar:
  order: 8
---

`join` takes named query inputs, and `.on` supplies their matching predicate. Callbacks access each input through its alias. The result is an **inner ALL join**: unmatched rows disappear, and every matching pair is retained.

## Example

Match events to accounts, then project a flat result with explicit field names.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, join, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    accountId: col.UInt32,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
const accounts = table(
  'accounts',
  {
    id: col.UInt32,
    name: col.String,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = join({
  event: from(events),
  account: from(accounts),
})
  .on((r) => r.event.accountId.eq(r.account.id))
  .map((r) => ({
    eventId: r.event.id,
    accountName: r.account.name,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `event`.`id` AS `eventId`,
  `account`.`name` AS `accountName`
FROM
  `events` AS `event`
  INNER ALL JOIN `accounts` AS `account` ON `event`.`accountId` = `account`.`id`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Inputs need not have unique join keys; duplicate keys can multiply rows. `.on` accepts a predicate or an array of predicates. Supported equality predicates form join conditions; other conjuncts become residual filters.

`crossJoin` takes the same named-input object but has no `.on` stage. It returns every combination of input rows, so output size can grow rapidly. Both forms require at least two inputs. ANY join semantics are not provided.

## Outer joins

`leftJoin`, `rightJoin` and `fullJoin` keep unmatched rows and fill the other side with `NULL`. They are binary: `leftJoin({ left }, { right }).on(…)` takes exactly two arguments, each a record with one aliased input. The row keeps the nested `{ left, right }` shape and your aliases. A TypeScript object type carries no key order, so the argument position, not a key, says which input is preserved. A three-way outer join nests one join in another, for example `leftJoin({ ab: join({ a, b }).on(…) }, { c }).on((r) => r.ab.b.id.eq(r.c.id))`. The inner join is a derived table on the preserved side.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  leftJoin,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const accounts = table(
  'accounts',
  {
    id: col.UInt32,
    name: col.String,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
const plans = table(
  'plans',
  {
    accountId: col.UInt32,
    tier: col.LowCardinality(col.String),
    seats: col.UInt32,
    features: col.Array(col.String),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['accountId'],
    partitionKey: [],
  },
);
```

</details>

```ts
// Every account, with its plan when there is one.
const query = leftJoin(
  { account: from(accounts) },
  { plan: from(plans) },
)
  .on((r) => r.account.id.eq(r.plan.accountId))
  .map((r) => ({
    name: r.account.name, // string
    tier: r.plan.tier, // string | null
    seats: r.plan.seats.ifNull(0), // number
    features: r.plan.features, // string[]: [] when unmatched
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`__typedhouse_leaf_1` AS `name`,
  `__typedhouse_input`.`__typedhouse_leaf_3` AS `tier`,
  ifNull(
    `__typedhouse_input`.`__typedhouse_leaf_4`,
    {p0:UInt32}
  ) AS `seats`,
  `__typedhouse_input`.`__typedhouse_leaf_5` AS `features`
FROM
  (
    SELECT
      `account`.`name` AS `__typedhouse_leaf_1`,
      `plan`.`tier` AS `__typedhouse_leaf_3`,
      `plan`.`seats` AS `__typedhouse_leaf_4`,
      `plan`.`features` AS `__typedhouse_leaf_5`
    FROM
      `accounts` AS `account`
      LEFT ALL JOIN `plans` AS `plan` ON `account`.`id` = `plan`.`accountId`
  ) AS `__typedhouse_input`
SETTINGS
  join_use_nulls = 1 /* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults */
```

Parameters:

```json
{
  "p0": "0"
}
```

<!-- generated-sql:end -->

The null-extended inputs (the second for `leftJoin`, the first for `rightJoin`, both for `fullJoin`) change type to match what ClickHouse returns under `join_use_nulls = 1`. A column that ClickHouse can make `Nullable` becomes `T | null` with a `Nullable(T)` descriptor, and `LowCardinality(T)` becomes `LowCardinality(Nullable(T))`. This applies to integers, floats, `Bool`, `String`, `FixedString`, `UUID`, `IPv4`/`IPv6`, dates and times, `Decimal`, `Enum` and `SimpleAggregateFunction` over such a type, which becomes `Nullable(SimpleAggregateFunction(…))`. A `SimpleAggregateFunction(f, LowCardinality(T))` column comes back as `LowCardinality(Nullable(T))`, because ClickHouse drops the aggregate wrapper there. ClickHouse cannot wrap `Array`, `Map`, `Tuple` (and `Nested`), `Variant`, `Dynamic`, `JSON` or `AggregateFunction` in `Nullable`. Those columns keep their declared type, and an unmatched row carries the **server default** instead of `NULL`: `[]`, `{}`, a tuple of defaults, an empty `JSON`. An already-`Nullable` column (including `LowCardinality(Nullable(T))` and a `SimpleAggregateFunction` over either) is unchanged. The value type follows the descriptor: `r.plan.seats` is an `Expr<number | null>`, so it does not compile where a `number` column is expected, for example as `seats` in a `Query<{ seats: number }>`. `r.plan.seats.ifNull(0)` is an `Expr<number>`.

The compiler appends `SETTINGS join_use_nulls = 1` (with a trailing comment) whenever any outer join is present, including one nested in a subquery. This is the one server default it changes. Queries with only inner and cross joins never carry it. The setting is query-global and has no effect on inner joins.

An outer join's `.on` takes only equalities between one column of each input. A conjunct that is not an `eq` (`lt`, `or`, `startsWith`, …) throws `join_condition_not_equi` when `.on` runs, because it would decide which rows are null-extended rather than which rows survive. An inner join moves such conditions above the join as a filter instead. An `eq` that passes the builder but is not a column-to-column equality across the two inputs fails later, at `compile`/`toSQL()`, with `join_condition_arity`. That covers a computed operand (`r.a.id.plus(1).eq(r.b.id)`), both columns from the same input, a constant (`r.a.id.eq(1)`), and an empty array of conditions. A `where` after an outer join filters the joined rows, `NULL`s included, so `where((r) => r.plan.seats.gt(0))` also drops unmatched accounts. The optimizer does not push filters into or below an outer join.
