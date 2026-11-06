---
title: join / outer joins / crossJoin / asofJoin
description: Combine named inputs with an inner ALL join, a LEFT, RIGHT or FULL ALL join, a Cartesian product, or an ASOF join.
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

### Tuple columns on ClickHouse 26.10

The descriptors above were checked against 24.8, and 24.3 returns the same for a `Tuple`. On 26.10, `join_use_nulls = 1` also wraps a `Tuple` in `Nullable`: the server reports `Nullable(Tuple(a UInt8))` where the descriptor says `Tuple(a UInt8)`, and sends `NULL` rather than a tuple of defaults for an unmatched row. Measured with `leftJoin`, `rightJoin`, `fullJoin` and `asofLeftJoin`, named and unnamed tuples: a matched row still reads as usual, and **an unmatched row makes `run` throw a `QueryError` (`decode_invalid`)**, because the declared type has no `null`. `toSQL()` does not show this. `Array`, `Map` and `Nested` columns kept their type and default on 26.10; the other kinds in the list above were not measured there. `element` is not a way around it: on an unmatched row `r.q.tup.element('a')` returned `null` while its descriptor says `UInt8`, so the value contradicts its type. On 26.10, select a `Tuple` from an input that can go unmatched only when every row matches, or use an inner join.

## ASOF joins

`asofJoin` and `asofLeftJoin` match each left row with the closest right row: the equalities pick the candidates, and one inequality picks the closest of them. They are binary, with one aliased input per argument, as for `leftJoin`. The row keeps the nested shape. `.on` takes the equalities and returns a value whose only method is `.asof`, so nothing can run until the inequality is given. `.on` needs at least one equality, and `.asof` takes exactly one `ge`, `gt`, `le` or `lt`, with one input on each side, in either order.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  asofLeftJoin,
  col,
  from,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const trades = table(
  'trades',
  {
    id: col.UInt32,
    symbol: col.String,
    ts: col.DateTime('UTC'),
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
const quotes = table(
  'quotes',
  {
    symbol: col.String,
    ts: col.DateTime('UTC'),
    bid: col.Float64,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['symbol', 'ts'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = asofLeftJoin(
  { trade: from(trades) },
  { quote: from(quotes) },
)
  .on((r) => r.trade.symbol.eq(r.quote.symbol))
  .asof((r) => r.trade.ts.ge(r.quote.ts))
  .map((r) => ({
    id: r.trade.id,
    bid: r.quote.bid,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `trade`.`id` AS `id`,
  `quote`.`bid` AS `bid`
FROM
  `trades` AS `trade` ASOF
  LEFT JOIN `quotes` AS `quote` ON `trade`.`symbol` = `quote`.`symbol`
  AND `trade`.`ts` >= `quote`.`ts`
SETTINGS
  join_use_nulls = 1 /* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults */
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

`asofLeftJoin` keeps a left row with no match, with the same null extension as `leftJoin`, including [its limit on `Tuple` under 26.10](#tuple-columns-on-clickhouse-2610), and appends `join_use_nulls = 1`: here `bid` is `number | null`. A `NULL` in an equality or in the inequality, on either side, never matches. Without `join_use_nulls = 1` such a row carries type defaults, which is why the setting is always present.

Both `.on` and `.asof` accept computed operands and parameters, for example `r.t.id.plus(5).ge(r.q.id.plus(1))`. Each operand must read exactly one input, and a condition on one input alone is refused (`join_condition_arity` in `.on`, `invalid_asof_condition` in `.asof`). A date or time offset has no typed method; write it with a SQL snippet in the operand, such as ``sql`${r.t.ts} - ${5}`.as(col.DateTime('UTC'))``. The builder has no way to express a single-input condition in `ON`, because ClickHouse treats it as a filter before matching, which is neither a `where` above the join nor one on the input you might have meant.

### Filtering the right input changes the match

A `where` on the right input, written after the join, keeps a join that already picked its row. Filtering the input first changes which row gets picked. The compiler never moves a right-side `where` below an ASOF join, also on `asofJoin`, and never turns `asofLeftJoin` into an inner join. A left-side `where` does move into its input, because it gives the same rows.

With these rows:

| `trades.id` | `symbol` | `ts`       |     | `quotes.symbol` | `ts`       | `flag` | `v` |
| ----------- | -------- | ---------- | --- | --------------- | ---------- | ------ | --- |
| 1           | A        | `00:00:10` |     | A               | `00:00:05` | 1      | 10  |
| 2           | A        | `00:00:30` |     | A               | `00:00:20` | 0      | 20  |

Trade 2 matches the quote at `00:00:20`, whose `flag` is 0. Measured on ClickHouse 24.3, 24.8 and 26.10:

| Form                                                                        | Rows (`id`, `v`)     |
| --------------------------------------------------------------------------- | -------------------- |
| `asofJoin({ t }, { q }).on(…).asof(…).where((r) => r.q.flag.eq(1))`         | (1, 10)              |
| `asofJoin({ t }, { q: from(quotes).where((r) => r.flag.eq(1)) }).on(…).asof(…)` | (1, 10), (2, 10) |

Decide which one you mean, and write that one.

### Ties are not repeatable

Which row wins among right rows tied on the equalities and the inequality value is unspecified. In a probe over 3 parts with 3 tied rows per key and 200 left rows, the same SQL run twice returned different rows on 24.3, 24.8 and 26.10. Changing the columns of the right input, its nesting, or [`settings({ max_threads })`](/docs/query-builder/settings/) changed them too. The row count did not change. `max_threads: 1` gave the same rows on all three versions in that probe, once each, which is not evidence that it is repeatable. Make the key unique if the choice matters. The compiler also prunes columns of the right input, so your query and the same query written by hand can differ here.

### Inequality types

These work on 24.3, 24.8 and 26.10, also `Nullable`: `Int*`, `UInt*`, `Float*`, `Decimal`, `Date`, `Date32`, `DateTime`, `DateTime64`, `Bool` and `Enum`.

`LowCardinality` works on one side only, and only where such a column can exist. `LowCardinality(Decimal)`, `LowCardinality(DateTime64)` and `LowCardinality(Enum)` cannot be created (code 43), and a `LowCardinality` of an integer, float, `Bool`, `Date`, `Date32` or `DateTime` needs `allow_suspicious_low_cardinality_types` to be created (code 455 without it).

`compile` refuses the rest with `invalid_asof_type`, and those fail on the server too: `String`, `FixedString`, `UUID`, `IPv4`, `IPv6`, `Array`, `Tuple`, `Map`, and `LowCardinality` on both sides raise code 169 against their own type. The check reads the operand's declared type. A function over a `LowCardinality` column can stay `LowCardinality` on the server without saying so here (`toUInt8(lc)` did), and then the code 169 surfaces as a `QueryError`.

Mixed types are partial. ASOF agreed with a plain comparison of the same columns on every temporal pair and operator tried: `Date`, `Date32`, `DateTime` across zones and `DateTime64` across precisions. That is the server's own sense of comparison, so a `Date` against a zoned column reads as midnight in that zone: `2024-01-02` equals `2024-01-02 00:00:00` in `DateTime('Asia/Tokyo')`. `Int32` against `UInt8`, `Decimal` against `UInt32` and `Float32` against `Float64` matched on the rows tried, as did `UInt32` against `Float64`.

`Decimal` across scales matches a plain comparison too, and that includes where the plain comparison is wrong. When the common scale overflows there is no error and the answer is the opposite of the numbers: `Decimal(18, 0)` holding `1e17` against `Decimal(38, 30)` holding `1` has no match on `>=` and matches on `<=`, on all three versions, and a small value such as `5` against the same `1` is right. These compile, and raise code 386 as a `QueryError`, on the optimized and the naive form alike: `UInt64` against `Int64`, `UInt64` against `Float64`, `Decimal` against `Float64`. A computed operand can reach this too: `r.t.id.plus(1).ge(r.q.id.minus(1))` compares `UInt64` with `Int64`. A date or time against a number does not compile, with `incompatible_operands`, as anywhere else; the server raises 386, or 43 for `Date`.

`NaN` does not behave as a comparison. `1 >= NaN` and `NaN >= 1` each matched a row on all three versions. It is not filtered out for you, as with `min` and `max`.

### Join algorithms

`join_algorithm` is not in the [`settings`](/docs/query-builder/settings/) allowlist, but a client or a profile can set it. A value ASOF does not support surfaces as a `QueryError` with code 48, with no compiler check:

| `join_algorithm`                        | 24.3     | 24.8    | 26.10   |
| --------------------------------------- | -------- | ------- | ------- |
| `hash`, `parallel_hash`, `auto`         | works    | works   | works   |
| `full_sorting_merge`                    | code 48  | works   | works   |
| `partial_merge`, `grace_hash`, `direct` | code 48  | code 48 | code 48 |
