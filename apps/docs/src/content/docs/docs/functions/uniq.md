---
title: uniq
description: Estimate the number of distinct non-null strings.
sidebar:
  order: 57
---

`uniq(value)` estimates the number of distinct non-NULL strings. Its `UInt64` result decodes to `bigint`, but that integer is an approximate cardinality, not an exact count. Use `uniqExact` when exactness matters. Empty or all-NULL input returns `0n`.

The current typed surface is String-only: `String` and `Nullable(String)` are supported, not numeric values or LowCardinality wrappers. This function emits `uniq`, not `countDistinct`. `State`/`Merge` execution is unsupported.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table, uniq } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const visits = table(
  'visits',
  {
    campaign: col.String,
    visitor: col.String,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(visits)
  .groupBy((row) => row.campaign)
  .aggregate((group) => ({
    estimatedVisitors: uniq(group.visitor),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`campaign` AS `campaign`,
  uniq(`__typedhouse_input`.`visitor`) AS `estimatedVisitors`
FROM
  `visits` AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`campaign`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
