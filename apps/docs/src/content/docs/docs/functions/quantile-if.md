---
title: quantileIf
description: Estimate a numeric quantile among qualifying rows.
sidebar:
  order: 63
---

`quantileIf(level)(value, predicate)` estimates a quantile among rows whose Bool predicate is true. The API is curried: supply a finite level from 0 through 1 first, then the value and predicate. False or NULL predicates exclude rows, and NULL values are skipped.

Integer and float inputs produce `Float64` (`number`); nullable values retain nullable result descriptors. Decimal operands are unsupported. Reservoir sampling makes the result approximate and nondeterministic. Each application creates a fresh level parameter; reuse the resulting expression to share it. `State`/`Merge` execution is unsupported.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, quantileIf, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
    medianSuccessfulDurationMs: quantileIf(0.5)(
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
  `__chql_input`.`endpoint` AS `endpoint`,
  quantileIf ({p0:Float64}) (
    `__chql_input`.`durationMs`,
    `__chql_input`.`successful`
  ) AS `medianSuccessfulDurationMs`
FROM
  `requests` AS `__chql_input`
GROUP BY
  `__chql_input`.`endpoint`
```

Parameters:

```json
{
  "p0": "0.5"
}
```

<!-- generated-sql:end -->
