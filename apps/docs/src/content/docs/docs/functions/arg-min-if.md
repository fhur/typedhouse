---
title: argMinIf
description: Select the value with the smallest version among qualifying rows.
sidebar:
  order: 68
---

`argMinIf(value, version, predicate)` selects the value associated with the smallest version among rows whose Bool predicate is true. False and NULL predicates exclude rows; NULL values are skipped.

Values may be integers, floats, String, or Bool, including nullable variants. Versions must be non-null integers, floats, `Date`, `Date32`, `DateTime` or `DateTime64` (precision 0–3). The value's type is preserved. With no qualifying row, a nullable value returns NULL and a non-null value returns its type's default. If the first qualifying version is a float NaN, the result is the value from that row, with or without `groupBy`. Equal minimal versions have no stable tie breaker, so use a unique version when deterministic selection matters. Date values, Decimal operands and tuple operands are not exposed.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  argMinIf,
  col,
  from,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const updates = table(
  'updates',
  {
    customer: col.String,
    status: col.String,
    version: col.UInt64,
    approved: col.Bool,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(updates)
  .groupBy((row) => row.customer)
  .aggregate((group) => ({
    firstApprovedStatus: argMinIf(
      group.status,
      group.version,
      group.approved,
    ),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  argMinIf (
    `__typedhouse_input`.`status`,
    `__typedhouse_input`.`version`,
    `__typedhouse_input`.`approved`
  ) AS `firstApprovedStatus`
FROM
  `updates` AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`customer`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
