---
title: avg
description: Compute the arithmetic mean of integer or float values.
sidebar:
  order: 54
---

`avg(value)` computes the arithmetic mean of integer or float values and returns `Float64` (`number`). NULL inputs are skipped; nullable operands produce a nullable result descriptor. Empty non-null input produces NaN.

Decimal operands are not supported by this typed surface, unlike `sum`. Aggregate `State`/`Merge` execution is not exposed for `avg`.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { avg, col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const requests = table(
  'requests',
  {
    endpoint: col.String,
    durationMs: col.Float64,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(requests)
  .groupBy((row) => row.endpoint)
  .aggregate((group) => ({
    meanDurationMs: avg(group.durationMs),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`endpoint` AS `endpoint`,
  avg(`__chql_input`.`durationMs`) AS `meanDurationMs`
FROM
  `requests` AS `__chql_input`
GROUP BY
  `__chql_input`.`endpoint`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
