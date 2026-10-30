---
title: sumIf
description: Sum numeric values satisfying a Bool predicate.
sidebar:
  order: 59
---

`sumIf(value, predicate)` adds numeric values only where the Bool predicate is true. False or NULL predicates exclude a row, and NULL values are skipped. The condition affects this aggregate rather than removing groups.

Result widening matches `sum`: small integers become 64-bit integers (`bigint`), 128/256-bit integers retain their width, and floats become `Float64`. Decimal input preserves scale with precision 38 or 76. Nullable values retain nullable result descriptors; predicate nullability alone does not make the result nullable. `State`/`Merge` execution is unsupported.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, sumIf, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const orders = table(
  'orders',
  {
    customer: col.String,
    amount: col.UInt32,
    paid: col.Bool,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(orders)
  .groupBy((row) => row.customer)
  .aggregate((group) => ({
    paidAmount: sumIf(group.amount, group.paid),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  sumIf (
    `__typedhouse_input`.`amount`,
    `__typedhouse_input`.`paid`
  ) AS `paidAmount`
FROM
  `orders` AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`customer`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
