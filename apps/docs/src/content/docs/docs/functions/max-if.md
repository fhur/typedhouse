---
title: maxIf
description: Select the largest value satisfying a Bool predicate.
sidebar:
  order: 60
---

`maxIf(value, predicate)` finds the largest non-NULL value among rows with a true Bool predicate. False and NULL predicates exclude rows. The result preserves the value operand's type and nullability; it does not inherit nullability from the predicate.

The catalog accepts any value descriptor, subject to ClickHouse support for the operation. Do not assume an unmatched non-null aggregate returns NULL: ClickHouse uses its default aggregate result. `State`/`Merge` execution is unsupported.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, maxIf, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
    largestPaidAmount: maxIf(group.amount, group.paid),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`customer` AS `customer`,
  maxIf (`__chql_input`.`amount`, `__chql_input`.`paid`) AS `largestPaidAmount`
FROM
  `orders` AS `__chql_input`
GROUP BY
  `__chql_input`.`customer`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
