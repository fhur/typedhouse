---
title: argMax
description: Select the value associated with the greatest numeric version.
sidebar:
  order: 53
---

`argMax(value, version)` returns the value associated with the greatest version, preserving the value's type. The typed surface accepts integer, float, String, or Bool values (including nullable values) and a non-null integer or float version. Decimal, date, and tuple operands are outside this surface.

NULL values are skipped. Equal maximal versions have no stable tie breaker: use a unique numeric version when deterministic selection matters. Binary `State`/`Merge` execution is not exposed.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { argMax, col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const updates = table(
  'updates',
  {
    customer: col.String,
    status: col.String,
    version: col.UInt64,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(updates)
  .groupBy((row) => row.customer)
  .aggregate((group) => ({
    latestStatus: argMax(group.status, group.version),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`customer` AS `customer`,
  argMax(`__chql_input`.`status`, `__chql_input`.`version`) AS `latestStatus`
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
