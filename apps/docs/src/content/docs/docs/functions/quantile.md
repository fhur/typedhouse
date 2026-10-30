---
title: quantile
description: Estimate a numeric quantile using reservoir sampling.
sidebar:
  order: 55
---

`quantile(level)(value)` estimates a quantile using reservoir sampling; `0.5` estimates the median. The curried level must be a finite number from 0 through 1. It is emitted as a function parameter, not a data argument.

Integer and float operands return `Float64` (`number`); NULL values are skipped and nullable input retains a nullable result descriptor. Decimal operands are unsupported. Results are approximate and nondeterministic, not exact percentiles. Each application creates a fresh level parameter; reusing the resulting expression shares that parameter. `State`/`Merge` execution is unsupported.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  quantile,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

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
    medianDurationMs: quantile(0.5)(group.durationMs),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`endpoint` AS `endpoint`,
  quantile({p0:Float64}) (`__typedhouse_input`.`durationMs`) AS `medianDurationMs`
FROM
  `requests` AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`endpoint`
```

Parameters:

```json
{
  "p0": "0.5"
}
```

<!-- generated-sql:end -->
