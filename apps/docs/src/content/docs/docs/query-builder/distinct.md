---
title: distinct
description: Remove duplicates across the current query output.
sidebar:
  order: 11
---

`.distinct()` removes duplicate rows using every field in the current output. Project first when uniqueness should depend on only a subset of the source columns.

## Example

Return each tenant once, regardless of how many events belong to it.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
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
const query = from(events)
  .map((e) => ({ tenant: e.tenant }))
  .distinct();

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT DISTINCT
  `tenant`
FROM
  `events`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Keeping `id` in this projection would make uniqueness depend on both `id` and `tenant`. This is not DISTINCT ON and does not choose a representative full row per key. Use grouping and aggregates for that kind of reduction.

Distinct does not sort the result. Add `.orderBy()` if you need a defined order, and place `.limit()` after distinct when you want to limit unique rows rather than the input being deduplicated.
