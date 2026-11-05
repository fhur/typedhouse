---
title: final
description: Request ClickHouse FINAL on a table scan.
sidebar:
  order: 7
---

`final()` requests ClickHouse `FINAL`. It is a scan-only modifier: apply it immediately after `from`, before `where`, `map`, or other general query operations, which drop scan-only methods. It can be combined with [`sample`](/docs/query-builder/sample/) and [`prewhere`](/docs/query-builder/prewhere/).

## Example

Request `FINAL` for a ReplacingMergeTree table. The engine performs its query-time merge behavior; the query retains the scan's row shape.

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
    engine: 'ReplacingMergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(events).final();

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `category`
FROM
  `events` FINAL
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Use `FINAL` only with an appropriate engine and actual table configuration. It can add execution cost and does not generally resolve tied versions deterministically.
