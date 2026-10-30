---
title: Prune unused columns
description: Keep only columns required by outputs and intermediate operations.
sidebar:
  order: 7
---

The compiler works backward from the requested output to find required columns. It also retains columns used by predicates, sorting, joins, array expansion, aggregates, and expression subqueries. Shared inputs retain the union of all consumers' needs, in source declaration order.

## Example

The source descriptor includes `category`, but this query needs only `tenant` for filtering and `id` for output. The final SQL does not read `category`.

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
  .map((e) => ({ id: e.id }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`
FROM
  `events`
WHERE
  `tenant` = {p0:String}
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

When row multiplicity matters but no output column is needed, the planner retains a deterministic **carrier column** rather than discarding rows. Computed projections, aggregates, DISTINCT, UNION, materialization hints, and raw relations retain conservative complete interfaces. This is not a guarantee of the narrowest possible scan for every query.
