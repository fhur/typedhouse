---
title: startsWith
description: Test a string prefix.
sidebar:
  order: 43
---

`value.startsWith(prefix)` returns a Bool expression testing whether the string starts with the supplied prefix. The prefix can be a string literal or compatible expression.

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
  .where((article) => article.title.startsWith('Guide:'))
  .map((article) => ({
    id: article.id,
    title: article.title,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `title`
FROM
  `articles`
WHERE
  startsWith(`title`, {p0:String})
```

Parameters:

```json
{
  "p0": "Guide:"
}
```

<!-- generated-sql:end -->

Matching is case-sensitive and byte-based, not a regular expression. String and FixedString descriptors are supported; NULL in either argument propagates to the result.
