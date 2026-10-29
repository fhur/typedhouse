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

## Example

Filtering, grouping, filtering groups, sorting, and limiting all fit into one SELECT here.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, count, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
  `__chql_input`.`category` AS `category`,
  count() AS `total`
FROM
  `events` AS `__chql_input`
WHERE
  `__chql_input`.`tenant` = {p0:String}
GROUP BY
  `__chql_input`.`category`
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

## Computed projections

A projection over a physical-table scan and its filters can fold into the same SELECT when its expressions are direct columns, parameters, or typed integer `plus`, `minus`, and `multiply` expressions (including nullable integers). For example, selecting `onHand - reserved AS available` after filtering on `onHand - reserved < reorderPoint` no longer needs a derived table.

Output aliases must not shadow a different physical source expression. This check includes source columns omitted by earlier selections, because ClickHouse alias substitution can also affect `WHERE` expressions. Casts, division, raw SQL, subqueries, and other unsupported computations retain their scopes.

This is not general computed-project merging: subsequent filters, sorting, limits, or projections retain a boundary around the folded computed projection. Computed projections over CTEs, joins, or aggregates are not covered by this scan optimization.

Folding respects operation order: filtering after a limit is not equivalent to filtering before it. Reversed or repeated clauses, projections after sort/limit, DISTINCT, UNION, unsafe expressions, and alias collisions can require derived tables. Reading directly from a CTE removes only the redundant reference wrapper; it does not merge operations into the CTE definition. Arbitrary expression substitution is not implemented.
