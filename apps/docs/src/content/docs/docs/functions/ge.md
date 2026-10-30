---
title: ge
description: Test whether a value is greater than or equal to another.
sidebar:
  order: 15
---

`value.ge(other)` includes values equal to the lower boundary.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const orders = table(
  'orders',
  {
    id: col.UInt32,
    total: col.Float64,
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
const query = from(orders).where((order) =>
  order.total.ge(100),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `total`
FROM
  `orders`
WHERE
  `total` >= {p0:Float64}
```

Parameters:

```json
{
  "p0": "100"
}
```

<!-- generated-sql:end -->

Use [`gt`](/docs/functions/gt/) to exclude the boundary. A nullable operand can make the comparison result nullable.
