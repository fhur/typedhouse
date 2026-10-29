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
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
  `__chql_input`.`id` AS `id`,
  notEmpty(`__chql_input`.`title`) AS `hasTitle`,
  notEmpty(`__chql_input`.`tags`) AS `hasTags`
FROM
  (
    SELECT
      `id`,
      `title`,
      `tags`
    FROM
      `articles`
  ) AS `__chql_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

This is the inverse of [empty](/docs/functions/empty/) for non-null inputs. Nullable string inputs produce nullable results; this is not a replacement for [isNotNull](/docs/functions/is-not-null/).
