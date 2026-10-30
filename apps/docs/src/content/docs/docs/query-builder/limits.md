---
title: limit
description: Bound results with limit and offset.
sidebar:
  order: 6
---

`limit(n, offset?)` returns at most `n` rows after skipping the optional offset. Both values must be non-negative safe integers. Invalid values fail compiler validation.

## Example

Skip twenty rows and return the next ten, ordered by ID. A deterministic page requires the ordering keys to uniquely identify rows in your data.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

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
  .orderBy((e) => e.id)
  .limit(10, 20);

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
  `id` ASC
LIMIT
  10 OFFSET 20
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

An unordered limit does not define which rows you get. Apply sorting before limiting when selecting an ordered page. Limits and offsets are emitted as validated integer literals rather than expression parameters. Offset pagination does not guarantee stable pages while the underlying data changes.
