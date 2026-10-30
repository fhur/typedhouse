---
title: isNotNull
description: Test whether an expression is not NULL.
sidebar:
  order: 28
---

`value.isNotNull()` returns a non-nullable Bool expression. Unlike `ne`, it explicitly tests NULL presence rather than comparing two values.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const users = table(
  'users',
  {
    id: col.UInt32,
    nickname: col.Nullable(col.String),
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
const query = from(users)
  .where((user) => user.nickname.isNotNull())
  .map((user) => ({
    id: user.id,
    nickname: user.nickname,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `nickname`
FROM
  `users`
WHERE
  isNotNull(`nickname`)
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Filtering out NULL rows does not narrow the column's TypeScript descriptor. Use [ifNull](/docs/functions/if-null/) when you need an expression with a non-null fallback.
