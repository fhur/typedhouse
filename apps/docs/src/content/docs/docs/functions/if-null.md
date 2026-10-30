---
title: ifNull
description: Replace NULL with a typed fallback.
sidebar:
  order: 29
---

`value.ifNull(fallback)` returns the original value when it is not NULL, otherwise the fallback. The fallback can be a compatible literal or expression.

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
const query = from(users).map((user) => ({
  id: user.id,
  displayName: user.nickname.ifNull('Anonymous'),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id` AS `id`,
  ifNull(`__typedhouse_input`.`nickname`, {p0:String}) AS `displayName`
FROM
  (
    SELECT
      `id`,
      `nickname`
    FROM
      `users`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{
  "p0": "Anonymous"
}
```

<!-- generated-sql:end -->

A non-null fallback removes nullability from this result. A nullable fallback can still produce NULL. Empty strings are retained, not replaced.
