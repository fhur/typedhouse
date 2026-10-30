---
title: or
description: Combine boolean expressions with OR.
sidebar:
  order: 20
---

`predicate.or(other)` accepts rows for which either predicate holds. Use this method rather than JavaScript `||`.

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
    priority: col.Bool,
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
  order.priority.or(order.total.ge(1000)),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `priority`,
  `total`
FROM
  `orders`
WHERE
  `priority`
  OR `total` >= {p0:Float64}
```

Parameters:

```json
{
  "p0": "1000"
}
```

<!-- generated-sql:end -->

Both operands are boolean values or expressions. Nullable predicates use SQL three-valued logic, not JavaScript truthiness or short-circuit guarantees.
