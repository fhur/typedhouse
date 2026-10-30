---
title: final / sample
description: Apply FINAL and SAMPLE directly to table scans.
sidebar:
  order: 7
---

`final` and `sample` are scan-only modifiers. Apply them immediately after `from`, before `where`, `map`, or other general query operations, which drop scan-only methods.

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

`sample(fraction)` requests ClickHouse sampling with a finite fraction in `(0, 1]`. Execution requires an actual table with a suitable sampling key; adding a descriptor does not configure one. SAMPLE is emitted after FINAL when both are requested, with the fraction inline rather than as an expression parameter.
