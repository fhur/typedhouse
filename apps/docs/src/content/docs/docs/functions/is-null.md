---
title: isNull
description: Test whether an expression is NULL.
sidebar:
  order: 27
---

`value.isNull()` returns a non-nullable Bool expression. Use it instead of comparing a value to NULL with `eq`.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
const query = from(users).map((user) => ({
  id: user.id,
  missingNickname: user.nickname.isNull(),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`id` AS `id`,
  isNull(`__chql_input`.`nickname`) AS `missingNickname`
FROM
  (
    SELECT
      `id`,
      `nickname`
    FROM
      `users`
  ) AS `__chql_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

An empty string is not NULL. To test empty strings or arrays, use [empty](/docs/functions/empty/).
