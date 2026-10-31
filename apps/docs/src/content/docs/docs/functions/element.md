---
title: element
description: Select a named tuple field.
sidebar:
  order: 47
---

`tuple.element('field')` selects a named tuple field and emits ClickHouse `tupleElement`. The selector must be a known field name supplied as a primitive string literal, not a query expression.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const users = table(
  'users',
  {
    id: col.UInt32,
    profile: col.Tuple({
      name: col.String,
      age: col.UInt8,
    }),
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
  name: user.profile.element('name'),
  age: user.profile.element('age'),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  tupleElement(`profile`, {p0:String}) AS `name`,
  tupleElement(`profile`, {p1:String}) AS `age`
FROM
  `users`
```

Parameters:

```json
{
  "p0": "name",
  "p1": "age"
}
```

<!-- generated-sql:end -->

The result preserves the selected field's descriptor. The same method projects a field from an array of named tuples, producing an array of that field's values. Unnamed tuple positions are not supported by this API; array indexing uses [arrayElement](/docs/functions/array-element/) instead.
