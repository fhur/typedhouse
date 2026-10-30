---
title: avgIf
description: Compute the mean of numeric values satisfying a Bool predicate.
sidebar:
  order: 62
---

`avgIf(value, predicate)` computes the mean of integer or float values for which a Bool predicate is true. False and NULL predicates exclude rows; NULL values are skipped. The condition applies only to this aggregate, not to the entire group.

The result is `Float64` (`number`), nullable when the value operand is nullable. Predicate nullability alone does not make the result nullable. Decimal operands are unsupported, unlike `sumIf`. With non-null values and no qualifying rows, the result is NaN. `State`/`Merge` execution is not exposed.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { avgIf, col, from, table } from '@typedhouse/core';
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
    meanSuccessfulDurationMs: avgIf(
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
  avgIf (
    `__typedhouse_input`.`durationMs`,
    `__typedhouse_input`.`successful`
  ) AS `meanSuccessfulDurationMs`
FROM
  `requests` AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`endpoint`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
