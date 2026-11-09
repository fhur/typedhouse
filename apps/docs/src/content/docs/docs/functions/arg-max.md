---
title: argMax
description: Select the value associated with the greatest numeric or date version.
sidebar:
  order: 53
---

`argMax(value, version)` returns the value associated with the greatest version, preserving the value's type. The typed surface accepts integer, float, String, or Bool values (including nullable values) and a non-null integer, float, `Date`, `Date32`, `DateTime` or `DateTime64` (precision 0–3) version, so `argMax(row.value, row.date)` picks the latest value. Date values, Decimal operands and tuple operands are outside this surface.

NULL values are skipped. Equal maximal versions have no stable tie breaker: use a unique version when deterministic selection matters. Rollups use [`argMaxState` and `argMaxMerge`](/docs/functions/state-merge/). See [`argMin`](/docs/functions/arg-min/) for the smallest version.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { argMax, col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

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
  `__typedhouse_input`.`customer` AS `customer`,
  argMax(
    `__typedhouse_input`.`status`,
    `__typedhouse_input`.`version`
  ) AS `latestStatus`
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
