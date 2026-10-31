---
title: Fold SELECT blocks
description: Emit compatible relational operations together in one SELECT.
sidebar:
  order: 9
---

The compiler avoids a derived table for every relational step when SQL clause order can express the same meaning:

- **Scan blocks:** compatible filters, direct selections, sorting, and limits become one SELECT. Direct renames and safe integer arithmetic projections can also fold over a scan and its filters. Consecutive filters share one `WHERE` (or `HAVING`) only when every predicate is in the total fragment that `MergeFilter` merges; a filter outside it (a cast, a known or user function, a Float comparison) that follows other filters keeps its own SELECT over them, and so does a total filter that follows it, because the server evaluates the conjuncts of one clause in its own order (`PREWHERE`, push-down below a join) and a failing predicate must only ever see the rows the earlier filters pass. The first filter of a block always folds. One server-side caveat is outside the compiler's control: ClickHouse itself may lift a `WHERE` that does not depend on an `ARRAY JOIN` alias above the expansion step (`query_plan_lift_up_array_join`), so under the default settings a fallible filter written after an expansion is evaluated before it in both the compiled and the nested form.
- **CTE references:** same-name column selections, filters, sorting, and limits can read directly from a CTE without wrapping its reference in an extra SELECT. The CTE definition remains a separate scope.
- **Aggregate blocks:** eligible source filters, grouping, group-result filters, ordering, and limits become `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, and `LIMIT`/`OFFSET`.
- **Join-backed blocks:** supported inner/cross joins can appear directly in SELECT or aggregate blocks. Inner join conditions in this envelope use direct column equalities.
- **DISTINCT:** `distinct()` sets the `DISTINCT` flag of the current block when the block has no `ORDER BY` or `LIMIT` yet, including aggregate blocks (`SELECT DISTINCT category, count() … GROUP BY category`). Sorting and limiting after it fold into the same block, and so does a selection of the whole row (every column under its own name, in any order); a filter, a narrower or computed selection, or an aggregation after it opens a new one, because `WHERE` precedes `DISTINCT` in SQL. The select list of a distinct block is always the full input row.
- **ARRAY JOIN:** one `arrayJoin`/`leftArrayJoin` folds directly after a physical-table `FROM` (after `FINAL` and `SAMPLE`) as `ARRAY JOIN expr AS alias`, with the alias usable as a plain column by the rest of the block. It folds when the block has no expansion, selection, aggregate or `DISTINCT` yet and every earlier filter is a safe predicate, or the expansion is `LEFT` and every earlier filter is deterministic (no raw SQL, volatile call or subquery): an inner `ARRAY JOIN` drops empty-array rows before `WHERE`, so a filter that could fail keeps its own scope under it, and a volatile filter is never re-evaluated per expanded row. An aggregate over the expanded block folds too (`SELECT partId, count() FROM t ARRAY JOIN ids AS partId WHERE … GROUP BY partId`); that block is written without an input alias so the expansion alias and the source columns resolve alike. ClickHouse allows one `ARRAY JOIN` per `SELECT`; a second expansion, a CTE reference or a derived table keeps a derived table.

## Example

Filtering, grouping, filtering groups, sorting, and limiting all fit into one SELECT here.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, count, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
    category: col.String,
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
const query = from(events)
  .where((e) => e.tenant.eq('acme'))
  .groupBy((e) => ({ category: e.category }))
  .aggregate(() => ({ total: count() }))
  .where((e) => e.total.gt(10n))
  .orderBy((e) => e.category)
  .limit(10);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`category` AS `category`,
  count() AS `total`
FROM
  `events` AS `__typedhouse_input`
WHERE
  `__typedhouse_input`.`tenant` = {p0:String}
GROUP BY
  `__typedhouse_input`.`category`
HAVING
  `total` > {p1:UInt64}
ORDER BY
  `category` ASC
LIMIT
  10
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "10"
}
```

<!-- generated-sql:end -->

## Expansion and DISTINCT

A filtered expansion, a distinct selection and the ordering fold into one block: the safe tenant filter is pushed below the expansion, the expansion follows the `FROM` item and `DISTINCT` applies to the full expanded row.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
    tags: col.Array(col.String),
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
const query = from(events)
  .leftArrayJoin((e) => e.tags, 'tag')
  .where((e) => e.tenant.eq('acme'))
  .distinct()
  .orderBy((e) => e.tag)
  .limit(20);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT DISTINCT
  `id`,
  `tenant`,
  `tags`,
  `tag`
FROM
  `events`
  LEFT ARRAY JOIN `tags` AS `tag`
WHERE
  `tenant` = {p0:String}
ORDER BY
  `tag` ASC
LIMIT
  20
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

## Computed projections

Any projection over a physical-table scan and its filters folds into the same SELECT: direct columns, parameters, arithmetic, casts, division, known and user functions, even volatile calls such as `now()`. The select list is evaluated on exactly the rows `WHERE` passes in both forms, so a failing expression fails the same way whether or not it is folded. A parameter without an explicit type takes the type of its sibling operand, exactly as the resolver assigns it. For example, selecting `onHand - reserved AS available` after filtering on `onHand - reserved < reorderPoint` needs no derived table.

Output aliases must not shadow a source column that the same block reads: under ClickHouse's default `prefer_column_name_to_alias = 0` an alias replaces that name in every other expression of the SELECT, so a computed alias equal to a column named by a `WHERE` clause, the `ARRAY JOIN` expression or another select item keeps its own derived table (an expression may still read the column it is itself aliased as). Redefining the expansion alias is always a boundary. Subqueries in a projection keep their own scope inside the folded select list.

Subsequent filters, sorting, limits, or projections still open a boundary around a folded computed projection unless a rewrite rule moves them below it. Over joins, a direct selection folds into the join block together with its filters; computed selections over joins, CTEs or aggregates keep a derived table.

Folding respects operation order: filtering after a limit is not equivalent to filtering before it. Reversed or repeated clauses, projections after sort/limit, filters after DISTINCT, UNION, unsafe expressions, and alias collisions can require derived tables. Reading directly from a CTE removes only the redundant reference wrapper; it does not merge operations into the CTE definition. Arbitrary expression substitution is not implemented.
