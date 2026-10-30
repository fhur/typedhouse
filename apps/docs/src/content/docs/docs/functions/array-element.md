---
title: arrayElement
description: Select an array element by its one-based index.
sidebar:
  order: 46
---

`array.arrayElement(index)` selects an element using ClickHouse indexing: positive indices start at **1**, and negative indices count backward from the end.

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
  firstTag: article.tags.arrayElement(1),
  lastTag: article.tags.arrayElement(-1),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id` AS `id`,
  arrayElement(`__typedhouse_input`.`tags`, {p0:Int64}) AS `firstTag`,
  arrayElement(`__typedhouse_input`.`tags`, {p1:Int64}) AS `lastTag`
FROM
  (
    SELECT
      `id`,
      `tags`
    FROM
      `articles`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{
  "p0": "1",
  "p1": "-1"
}
```

<!-- generated-sql:end -->

The result retains the array element descriptor, including element nullability. Out-of-range indices return the element type's default value, such as an empty string, rather than JavaScript `undefined`. Do not use zero as an index. For named tuple fields, use [element](/docs/functions/element/).
