---
title: Push filters through selections
description: Move filters before direct column selections and renames.
sidebar:
  order: 2
---

**`PushFilterProject`** moves a safe filter through a direct column selection or rename, rebinding references to the original input columns. This exposes filtering closer to the source.

## Example

The query filters the renamed `eventId`; the final SQL filters the source `id` column.

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
  .map((e) => ({ eventId: e.id }))
  .where((e) => e.eventId.gt(100));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `eventId`
FROM
  `events`
WHERE
  `id` > {p0:UInt32}
```

Parameters:

```json
{
  "p0": "100"
}
```

<!-- generated-sql:end -->

For this filter-pushdown rule, every projected expression must be a direct input-column reference. General computed projections are not substituted or merged. Unsupported predicates retain their boundary. Separately, [SELECT-block folding](/docs/compiler/select-blocks/) can combine a safe integer arithmetic projection with an underlying scan and its filters; that does not move filters through computed projections.
