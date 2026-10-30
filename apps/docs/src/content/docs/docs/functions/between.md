---
title: between
description: Test an inclusive range.
sidebar:
  order: 16
---

`value.between(lower, upper)` includes both boundaries. Bounds may be compatible literals or expressions.

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
  order.total.between(50, 100),
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
  (
    (`total`) BETWEEN ({p0:Float64}) AND ({p1:Float64})
  )
```

Parameters:

```json
{
  "p0": "50",
  "p1": "100"
}
```

<!-- generated-sql:end -->

The typed range API supports integers, floats, String, FixedString, Date, and DateTime64 with precision 0–3, including supported nullable wrappers. It does not accept Decimal, Date32, DateTime, or higher-precision timestamps. NULL operands can produce NULL; bounds are not automatically reordered.
