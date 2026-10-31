---
title: length
description: Count string bytes or array elements.
sidebar:
  order: 30
---

`value.length()` returns a UInt64 expression for a string or array. Strings are measured in bytes, not Unicode characters; arrays are measured in elements.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const articles = table(
  'articles',
  {
    id: col.UInt32,
    title: col.String,
    tags: col.Array(col.String),
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
const query = from(articles).map((article) => ({
  id: article.id,
  titleBytes: article.title.length(),
  tagCount: article.tags.length(),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  length(`title`) AS `titleBytes`,
  length(`tags`) AS `tagCount`
FROM
  `articles`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Nullable string inputs produce nullable results. String operations accept String and FixedString descriptors, not every type that decodes to a JavaScript string, such as Enum or UUID.
