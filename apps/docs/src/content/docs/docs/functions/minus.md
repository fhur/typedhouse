---
title: minus
description: Subtract compatible numeric values.
sidebar:
  order: 23
---

`value.minus(other)` subtracts the operand from the receiver.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const orders = table(
  'orders',
  {
    id: col.UInt32,
    subtotal: col.Float64,
    discount: col.Float64,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(orders).map((order) => ({
  id: order.id,
  discountedTotal: order.subtotal.minus(order.discount),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`id` AS `id`,
  `__chql_input`.`subtotal` - `__chql_input`.`discount` AS `discountedTotal`
FROM
  (
    SELECT
      `id`,
      `subtotal`,
      `discount`
    FROM
      `orders`
  ) AS `__chql_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Integer subtraction resolves to a signed result and can widen the integer width. It does not clamp negative values to zero. Nullable operands propagate NULL.
