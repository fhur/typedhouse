---
title: le
description: Test whether a value is less than or equal to another.
sidebar:
  order: 13
---

`value.le(other)` includes values equal to the upper boundary.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
  item.stock.le(10),
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
  `stock` <= {p0:UInt32}
```

Parameters:

```json
{
  "p0": "10"
}
```

<!-- generated-sql:end -->

Use [`lt`](/docs/functions/lt/) to exclude the boundary. Nullable comparisons can produce NULL rather than a non-null boolean.
