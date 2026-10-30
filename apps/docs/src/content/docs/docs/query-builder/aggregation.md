---
title: groupBy / aggregate
description: Summarize rows with groupBy and aggregate.
sidebar:
  order: 4
---

`groupBy` defines grouping keys; `aggregate` computes a result per group. Keys appear before aggregate outputs. Call `aggregate` without `groupBy` for a global aggregate.

## Example

Count events per category and keep groups with more than ten events. The output is `{ category: string; total: bigint }`: ClickHouse's UInt64 count decodes to bigint.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, count, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
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
  .groupBy((e) => ({ category: e.category }))
  .aggregate(() => ({ total: count() }))
  .where((e) => e.total.gt(10n));

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
GROUP BY
  `__typedhouse_input`.`category`
HAVING
  `total` > {p0:UInt64}
```

Parameters:

```json
{
  "p0": "10"
}
```

<!-- generated-sql:end -->

A grouped stage exposes `aggregate`, not general query operations. Do not reuse a grouping-key name for an aggregate output. Aggregate callbacks require grouped expressions, not arbitrary row expressions. Integer sums decode to bigint, float sums to number; nullable aggregates need care, especially for all-null inputs. The full ClickHouse aggregate catalog and State/Merge execution are not supported.
