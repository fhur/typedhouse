---
title: plus
description: Add compatible numeric values.
sidebar:
  order: 22
---

`value.plus(other)` builds numeric addition. The operand can be a compatible literal or expression.

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
    shipping: col.Float64,
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
  total: order.subtotal.plus(order.shipping),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`id` AS `id`,
  `__chql_input`.`subtotal` + `__chql_input`.`shipping` AS `total`
FROM
  (
    SELECT
      `id`,
      `subtotal`,
      `shipping`
    FROM
      `orders`
  ) AS `__chql_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Integer arithmetic can widen the result descriptor, so the decoded result need not retain the input's JavaScript type. Nullable operands propagate NULL. This is not string concatenation.
