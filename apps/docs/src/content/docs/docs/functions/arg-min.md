---
title: argMin
description: Select the value associated with the smallest numeric or date version.
sidebar:
  order: 67
---

`argMin(value, version)` returns the value associated with the smallest version, preserving the value's type. The typed surface accepts integer, float, String, or Bool values (including nullable values) and a non-null integer, float, `Date`, `Date32`, `DateTime` or `DateTime64` (precision 0–3) version, so `argMin(row.value, row.date)` picks the earliest value. Date values, Decimal operands and tuple operands are outside this surface.

NULL values are skipped, so a NULL at the smallest version moves to the next one. Equal minimal versions have no stable tie breaker: use a unique version when deterministic selection matters. An empty or all-NULL nullable value returns NULL; an empty non-null value returns its type's default, not NULL. A float NaN in the first version does not compare as smallest. Without `groupBy`, the result is the value type's default; with `groupBy`, it is the value from that NaN row. On `('first',nan),('second',2),('third',1)` these give `''` and `'first'`, not `'third'`. Rollups use [`argMinState` and `argMinMerge`](/docs/functions/state-merge/). See [`argMax`](/docs/functions/arg-max/) for the greatest version.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { argMin, col, from, table } from '@typedhouse/core';
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
    firstStatus: argMin(group.status, group.version),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  argMin(
    `__typedhouse_input`.`status`,
    `__typedhouse_input`.`version`
  ) AS `firstStatus`
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
