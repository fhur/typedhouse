---
title: ne
description: Compare values for inequality.
sidebar:
  order: 11
---

`value.ne(other)` tests whether two compatible values differ.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
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
const query = from(events).where((e) =>
  e.category.ne('debug'),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `category`
FROM
  `events`
WHERE
  `category` != {p0:String}
```

Parameters:

```json
{
  "p0": "debug"
}
```

<!-- generated-sql:end -->

This does not automatically include NULL values. Use [`isNotNull`](/docs/functions/is-not-null/) for a NULL check rather than `.ne(null)`.
