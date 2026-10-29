---
title: and
description: Combine boolean expressions with AND.
sidebar:
  order: 19
---

`predicate.and(other)` requires both predicates to hold. Chain expression methods instead of using JavaScript `&&`.

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
    paid: col.Bool,
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
  order.paid.and(order.total.ge(100)),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `paid`,
  `total`
FROM
  `orders`
WHERE
  `paid`
  AND `total` >= {p0:Float64}
```

Parameters:

```json
{
  "p0": "100"
}
```

<!-- generated-sql:end -->

The receiver and operand must be boolean expressions or compatible boolean values, not numeric truthiness checks. Nullable predicates use SQL three-valued logic; do not rely on JavaScript short-circuit evaluation.
