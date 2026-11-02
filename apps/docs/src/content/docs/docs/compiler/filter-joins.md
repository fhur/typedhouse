---
title: Push filters into joins
description: Filter join inputs before joining, and turn outer joins whose null extension a filter rejects into inner joins.
sidebar:
  order: 3
---

**`PushFilterJoin`** splits safe conjunctions over a join and moves each single-input predicate into that input. This can reduce the rows entering the join. Predicates referencing both sides remain above it. Over an outer join, only a preserved input accepts predicates (see below). **`LeftToInner`** turns an outer join into an inner one when a filter above it rejects every null-extended row.

## Example

The filter is written after the join, but its tenant predicate applies only to events and its ID predicate only to accounts.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, join, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
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
  .on((r) => r.event.id.eq(r.account.id))
  .where((r) =>
    r.event.tenant.eq('acme').and(r.account.id.gt(100)),
  );

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `event`.`id` AS `__typedhouse_leaf_0`,
  `event`.`tenant` AS `__typedhouse_leaf_1`,
  `account`.`id` AS `__typedhouse_leaf_2`
FROM
  (
    SELECT
      `id`,
      `tenant`
    FROM
      `events`
    WHERE
      `tenant` = {p0:String}
  ) AS `event`
  INNER ALL JOIN (
    SELECT
      `id`
    FROM
      `accounts`
    WHERE
      `id` > {p1:UInt32}
  ) AS `account` ON `event`.`id` = `account`.`id`
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "100"
}
```

<!-- generated-sql:end -->

## Outer joins

Over a `leftJoin`, a predicate on the first (preserved) input moves into it, exactly as for an inner join: the rows it removes would have been removed after the join too. Over a `rightJoin` the preserved input is the second one; a `fullJoin` preserves neither, so nothing moves. A predicate on a null-extended input stays above the join and folds into the join block's `WHERE`, which ClickHouse evaluates over the joined, null-extended rows.

## `LeftToInner`

A filter conjunct is *null-rejecting* on an input when it is false or `NULL` on every row where that input is null-extended. Within the safe fragment that is a comparison (`eq`, `ne`, `lt`, `le`, `gt`, `ge`) with a `Nullable` column of that input as an operand, `isNotNull` of such a column, or an `and` containing one. Rows a null-rejecting conjunct removes are exactly the unmatched rows the outer join added, so the join can be inner:

- `leftJoin` with a null-rejecting conjunct on the second input becomes inner; `rightJoin` likewise on the first input;
- `fullJoin` becomes `leftJoin` or `rightJoin` when one input is rejected, and inner when both are.

`or`, `isNull`, `ifNull(…)`-wrapped operands, Param-only conjuncts and predicates on the preserved input alone are not null-rejecting. A predicate on a projected column counts after projection substitution: `map(r => ({ s: r.b.s })).where(r => r.s.eq('x'))` rejects `b`, while `ifNull(b.n, 0) > 1` does not. A column already `Nullable` in its table still qualifies, because ClickHouse comparisons with `NULL` are falsy in `WHERE`.

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

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
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
    plan: col.String,
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
const query = leftJoin(
  { event: from(events) },
  { account: from(accounts) },
)
  .on((r) => r.event.id.eq(r.account.id))
  .where((r) =>
    r.event.tenant.eq('acme').and(r.account.plan.eq('pro')),
  )
  .map((r) => ({ id: r.event.id, plan: r.account.plan }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `event`.`id` AS `id`,
  toNullable(`account`.`plan`) AS `plan`
FROM
  (
    SELECT
      `id`
    FROM
      `events`
    WHERE
      `tenant` = {p0:String}
  ) AS `event`
  INNER ALL JOIN `accounts` AS `account` ON `event`.`id` = `account`.`id`
WHERE
  (`account`.`plan` = {p1:String})
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "pro"
}
```

<!-- generated-sql:end -->

`account.plan = 'pro'` rejects the unmatched events, so the join is `INNER`; `event.tenant = 'acme'` then moves into the event input. With no outer join left, the SQL drops `SETTINGS join_use_nulls = 1`; it keeps the setting while any other outer join remains. In a left join nested inside another left join, a predicate on the inner join's extended input converts only the outer join for now.

Three details keep the rewrite exact:

- **Types do not change.** The row type and `columns` still say `plan: string | null` / `Nullable(String)`, as written. Where a formerly null-extended column reaches the output (select list, grouping keys, aggregate arguments), the compiler reads it through `toNullable(…)`, so the server returns exactly those descriptors. In `WHERE` and `ORDER BY` it reads the column bare, so the primary-key condition and `PREWHERE` work as in a hand-written inner join. The values are simply never `NULL`.
- **Its own predicates stay above.** A conjunct on the formerly null-extended input is not pushed into it, because its column types inside the input are narrower than in the join's output.
- **Fallible expressions fence it.** Neither `LeftToInner` nor `PushFilterJoin` fires on a join that sits under a filter with a conjunct outside the total fragment, or whose inputs compute such an expression anywhere below them: a cast, a division, a known or user function, a raw expression or a subquery, in a projection, an array expansion, a grouping key or aggregate, a filter or a sort key. ClickHouse 24.8 pushes a join's `WHERE` into any input of an inner join, below the input's projections and grouping, and copies it across `ON` equalities into the other input. Moving a guard or changing the join kind there would change which rows such an expression is computed on, so a query could fail where the unoptimized one returns rows, or the reverse. Both rules leave such joins as written.

The filter and join conditions must pass safety checks. This is not join reordering. Inner ALL join duplicates are preserved.
