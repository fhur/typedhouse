---
title: map
description: Shape query output with map.
sidebar:
  order: 3
---

`map` selects expressions and names the output fields. Subsequent callbacks see only that projected shape. It is a relational projection, not a JavaScript array transformation.

## Example

This selects two columns, renames `id` to `eventId`, and drops `tenant`. The output row is `{ eventId: number; category: string }`.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
    category: col.String,
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
const query = from(events).map((e) => ({
  eventId: e.id,
  category: e.category,
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `eventId`,
  `category` AS `category`
FROM
  `events`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

A single named column expression can be returned directly and keeps its root name. Unnamed computed expressions need an object key; otherwise construction fails with `unnamed_expression`. Object values must be expressions, not arbitrary JavaScript values or nested objects.
