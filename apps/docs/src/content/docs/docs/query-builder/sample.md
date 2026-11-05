---
title: sample
description: Request ClickHouse SAMPLE on a table scan.
sidebar:
  order: 7.25
---

`sample(fraction)` requests ClickHouse sampling with a finite fraction in `(0, 1]`. It is a scan-only modifier: apply it immediately after `from`, before `where`, `map`, or other general query operations, which drop scan-only methods. It can be combined with [`final`](/docs/query-builder/final/) and [`prewhere`](/docs/query-builder/prewhere/).

## Example

Read about a tenth of the table.

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
const query = from(events).sample(0.1);

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
SAMPLE
  0.1
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Execution requires an actual table with a suitable sampling key; adding a descriptor does not configure one. The fraction is emitted inline rather than as an expression parameter.

## With final

SAMPLE is emitted after FINAL when both are requested.

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
const query = from(events).final().sample(0.1);

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
SAMPLE
  0.1
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
