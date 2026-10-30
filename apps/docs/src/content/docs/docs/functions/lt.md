---
title: lt
description: Test whether a value is less than another.
sidebar:
  order: 12
---

`value.lt(other)` is a strict less-than comparison. The boundary value is excluded.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const inventory = table(
  'inventory',
  {
    id: col.UInt32,
    stock: col.UInt32,
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
const query = from(inventory).where((item) =>
  item.stock.lt(10),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `stock`
FROM
  `inventory`
WHERE
  `stock` < {p0:UInt32}
```

Parameters:

```json
{
  "p0": "10"
}
```

<!-- generated-sql:end -->

Operands must have compatible value types. Nullable comparisons can produce NULL, which does not pass a `where` filter.
