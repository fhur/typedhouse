---
title: gt
description: Test whether a value is greater than another.
sidebar:
  order: 14
---

`value.gt(other)` is a strict greater-than comparison. The boundary value is excluded.

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
  order.total.gt(100),
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
  `total` > {p0:Float64}
```

Parameters:

```json
{
  "p0": "100"
}
```

<!-- generated-sql:end -->

Use compatible operands; this is not a JavaScript coercing comparison. NULL results do not pass a `where` filter.
