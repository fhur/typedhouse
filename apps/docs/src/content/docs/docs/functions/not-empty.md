---
title: notEmpty
description: Test whether a string or array has contents.
sidebar:
  order: 32
---

`value.notEmpty()` returns a Bool expression testing for a non-empty string or an array with at least one element.

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
  hasTitle: article.title.notEmpty(),
  hasTags: article.tags.notEmpty(),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  notEmpty(`title`) AS `hasTitle`,
  notEmpty(`tags`) AS `hasTags`
FROM
  `articles`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

This is the inverse of [empty](/docs/functions/empty/) for non-null inputs. Nullable string inputs produce nullable results; this is not a replacement for [isNotNull](/docs/functions/is-not-null/).
