---
title: Fold SELECT blocks
description: Emit compatible relational operations together in one SELECT.
sidebar:
  order: 9
---

The compiler avoids a derived table for every relational step when SQL clause order can express the same meaning:

- **Scan blocks:** compatible filters, direct selections, sorting, and limits become one SELECT. Direct renames and safe integer arithmetic projections can also fold over a scan and its filters.
- **CTE references:** same-name column selections, filters, sorting, and limits can read directly from a CTE without wrapping its reference in an extra SELECT. The CTE definition remains a separate scope.
- **Aggregate blocks:** eligible source filters, grouping, group-result filters, ordering, and limits become `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, and `LIMIT`/`OFFSET`.
- **Join-backed blocks:** supported inner/cross joins can appear directly in SELECT or aggregate blocks. Inner join conditions in this envelope use direct column equalities.
- **DISTINCT:** `distinct()` sets the `DISTINCT` flag of the current block when the block has no `ORDER BY` or `LIMIT` yet, including aggregate blocks (`SELECT DISTINCT category, count() … GROUP BY category`). Sorting and limiting after it fold into the same block; a filter, selection or aggregation after it opens a new one, because `WHERE` precedes `DISTINCT` in SQL. The select list of a distinct block is the full input row.
- **ARRAY JOIN:** one `arrayJoin`/`leftArrayJoin` folds directly after a physical-table `FROM` (after `FINAL` and `SAMPLE`) as `ARRAY JOIN expr AS alias`, with the alias usable as a plain column by the rest of the block. It folds when the block has no expansion, selection, aggregate or `DISTINCT` yet and every earlier filter is a safe predicate, or the expansion is `LEFT` and every earlier filter is deterministic (no raw SQL, volatile call or subquery): an inner `ARRAY JOIN` drops empty-array rows before `WHERE`, so a filter that could fail keeps its own scope under it, and a volatile filter is never re-evaluated per expanded row. ClickHouse allows one `ARRAY JOIN` per `SELECT`; a second expansion, a CTE reference, a derived table or an aggregate over the expansion keeps a derived table.

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

A projection over a physical-table scan and its filters can fold into the same SELECT when its expressions are direct columns, parameters, or integer `plus`, `minus`, and `multiply` expressions (including nullable integers). A parameter without an explicit type takes the type of its sibling operand, exactly as the resolver assigns it; it folds when that type is an integer, so `e.id.plus(1)` folds while `e.price.plus(1)` over a `Float64` column does not. For example, selecting `onHand - reserved AS available` after filtering on `onHand - reserved < reorderPoint` no longer needs a derived table.

Output aliases must not shadow a different physical source expression. This check includes source columns omitted by earlier selections, because ClickHouse alias substitution can also affect `WHERE` expressions. Casts, division, raw SQL, subqueries, and other unsupported computations retain their scopes.

This is not general computed-project merging: subsequent filters, sorting, limits, or projections retain a boundary around the folded computed projection. Computed projections over CTEs, joins, or aggregates are not covered by this scan optimization.

Folding respects operation order: filtering after a limit is not equivalent to filtering before it. Reversed or repeated clauses, projections after sort/limit, filters after DISTINCT, UNION, unsafe expressions, and alias collisions can require derived tables. Reading directly from a CTE removes only the redundant reference wrapper; it does not merge operations into the CTE definition. Arbitrary expression substitution is not implemented.
