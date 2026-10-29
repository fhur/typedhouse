---
title: has
description: Test whether an array contains a value.
sidebar:
  order: 44
---

`array.has(value)` returns a non-nullable Bool expression. The value must match the array's element type.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const articles = table(
  'articles',
  {
    id: col.UInt32,
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
const query = from(articles)
  .where((article) => article.tags.has('typescript'))
  .map((article) => ({
    id: article.id,
    tags: article.tags,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tags`
FROM
  `articles`
WHERE
  has(`tags`, {p0:String})
```

Parameters:

```json
{
  "p0": "typescript"
}
```

<!-- generated-sql:end -->

This checks whole elements, not string substrings. For overlap with multiple candidate values, use [hasAny](/docs/functions/has-any/). NULL is treated as an element value for arrays with nullable elements.
