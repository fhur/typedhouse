---
title: quantileExactIf
description: Compute an exact quantile among qualifying rows.
sidebar:
  order: 70
---

`quantileExactIf(level)(value, predicate)` computes an exact quantile among rows whose Bool predicate is true. The API is curried: supply a finite level from 0 through 1 first, then the value and predicate. False or NULL predicates exclude rows, and NULL and NaN values are skipped.

The result is an element of the input in the input type, never interpolated, and nullable values keep nullable result descriptors. With no qualifying row, a nullable value returns NULL, a non-null integer returns `0` and a non-null float returns NaN. Decimal operands are unsupported. It holds every qualifying value in memory; [`quantileIf`](/docs/functions/quantile-if/) is the approximate alternative. Each application creates a fresh level parameter; reuse the resulting expression to share it. Stacked combinators such as `quantileExactStateIf` are not available.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  quantileExactIf,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const requests = table(
  'requests',
  {
    endpoint: col.String,
    durationMs: col.Float64,
    successful: col.Bool,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(requests)
  .groupBy((row) => row.endpoint)
  .aggregate((group) => ({
    medianSuccessfulDurationMs: quantileExactIf(0.5)(
      group.durationMs,
      group.successful,
    ),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`endpoint` AS `endpoint`,
  quantileExactIf ({p0:Float64}) (
    `__typedhouse_input`.`durationMs`,
    `__typedhouse_input`.`successful`
  ) AS `medianSuccessfulDurationMs`
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
