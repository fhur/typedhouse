---
title: empty
description: Test whether a string or array has no contents.
sidebar:
  order: 31
---

`value.empty()` returns a Bool expression testing for an empty string or an array with no elements.

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
  missingTitle: article.title.empty(),
  missingTags: article.tags.empty(),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id` AS `id`,
  empty(`__typedhouse_input`.`title`) AS `missingTitle`,
  empty(`__typedhouse_input`.`tags`) AS `missingTags`
FROM
  (
    SELECT
      `id`,
      `title`,
      `tags`
    FROM
      `articles`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Whitespace is not an empty string, and an array containing an empty string still has an element. NULL propagates; use [isNull](/docs/functions/is-null/) to test for NULL itself.
