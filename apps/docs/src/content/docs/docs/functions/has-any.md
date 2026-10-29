---
title: hasAny
description: Test whether arrays share an element.
sidebar:
  order: 45
---

`array.hasAny(other)` returns a non-nullable Bool expression when the arrays share at least one element. Supply a compatible array literal or array expression.

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
  .where((article) =>
    article.tags.hasAny(['typescript', 'clickhouse']),
  )
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
  hasAny(`tags`, {p0:Array(String)})
```

Parameters:

```json
{
  "p0": "['typescript','clickhouse']"
}
```

<!-- generated-sql:end -->

Element order does not matter. An empty candidate array has no overlap. Use [has](/docs/functions/has/) to check one value; this method does not require every candidate to be present.
