---
title: quantileExact
description: Compute an exact quantile by picking an input element.
sidebar:
  order: 69
---

`quantileExact(level)(value)` computes an exact quantile and returns an element of the input, in the input type; `0.5` selects the median element. It never interpolates: over `[1, 2, 3, 4]`, level `0.5` returns `3`, where [`quantile`](/docs/functions/quantile/) estimates `2.5`. The curried level must be a finite number from 0 through 1. It is emitted as a function parameter, not a data argument.

Integer and float operands keep their type, so a `UInt64` above 2^53 stays an exact `bigint`, and a nullable input keeps a nullable result. Decimal operands are unsupported. NULL and NaN values are skipped. Empty or all-NULL nullable input returns NULL; empty non-null input returns `0` for integers and NaN for floats, and all-NaN input returns NaN. The result does not depend on row order.

It holds every value in memory, so prefer `quantile` when an estimate is enough on large groups. Each application creates a fresh level parameter; reusing the resulting expression shares that parameter. Rollups use [`quantileExactState` and `quantileExactMerge`](/docs/functions/state-merge/).

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  quantileExact,
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
    medianDurationMs: quantileExact(0.5)(group.durationMs),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`endpoint` AS `endpoint`,
  quantileExact({p0:Float64}) (`__typedhouse_input`.`durationMs`) AS `medianDurationMs`
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
