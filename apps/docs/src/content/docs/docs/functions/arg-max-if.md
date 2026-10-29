---
title: argMaxIf
description: Select the value with the greatest version among qualifying rows.
sidebar:
  order: 61
---

`argMaxIf(value, version, predicate)` selects the value associated with the greatest version among rows whose Bool predicate is true. False and NULL predicates exclude rows; NULL values are skipped.

Values may be integers, floats, String, or Bool, including nullable variants. Versions must be non-null integers or floats. The value's type is preserved. Equal maximal versions have no stable tie breaker, so use a unique numeric version when deterministic selection matters. Decimal, date, and tuple operands and binary `State`/`Merge` execution are not exposed.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { argMaxIf, col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
    latestApprovedStatus: argMaxIf(
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
  `__chql_input`.`customer` AS `customer`,
  argMaxIf (
    `__chql_input`.`status`,
    `__chql_input`.`version`,
    `__chql_input`.`approved`
  ) AS `latestApprovedStatus`
FROM
  `updates` AS `__chql_input`
GROUP BY
  `__chql_input`.`customer`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
