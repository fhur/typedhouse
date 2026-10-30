---
title: multiply
description: Multiply compatible numeric values.
sidebar:
  order: 24
---

`value.multiply(other)` multiplies the receiver by a compatible literal or expression.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const products = table(
  'products',
  {
    id: col.UInt32,
    price: col.Float64,
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
const query = from(products).map((product) => ({
  id: product.id,
  priceWithTax: product.price.multiply(1.2),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id` AS `id`,
  `__typedhouse_input`.`price` * {p0:Float64} AS `priceWithTax`
FROM
  (
    SELECT
      `id`,
      `price`
    FROM
      `products`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{
  "p0": "1.2"
}
```

<!-- generated-sql:end -->

Numeric promotion may change the result descriptor. Decimal multiplication adds operand scales; Float64 arithmetic is approximate, not exact decimal money arithmetic. Nullable operands propagate NULL.
