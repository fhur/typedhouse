---
title: orderBy / thenBy
description: Sort query results with orderBy and thenBy.
sidebar:
  order: 5
---

`orderBy` starts an ordering; `thenBy` adds another key. Expressions sort ascending by default. Use `.desc()` for descending order and `.nullsFirst()` or `.nullsLast()` for explicit null placement.

## Example

Sort categories ascending, then IDs descending within each category.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    category: col.String,
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
  .orderBy((e) => e.category)
  .thenBy((e) => e.id.desc());

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `category`
FROM
  `events`
ORDER BY
  `category` ASC,
  `id` DESC
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Only ordered stages expose `thenBy`. A new `orderBy` on that stage replaces its keys instead of extending them. Equal keys do not imply stable row order; add a unique tie breaker when deterministic results matter. Sorting after a limit sorts only the selected subset.
