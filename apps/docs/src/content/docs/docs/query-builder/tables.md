---
title: from
description: Describe existing ClickHouse tables and start typed queries.
sidebar:
  order: 1
---

`table` describes an existing ClickHouse table; `from` starts a typed query over it. A descriptor supplies column types and engine metadata. It does not create the table, check the live schema, or enforce authorization. Prefer generated descriptors for production.

## Example

This query selects the table's declared columns. UInt32 decodes to a JavaScript number; String decodes to a string.

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
const query = from(events);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tenant`,
  `category`
FROM
  `events`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Callbacks on this query receive typed expression proxies, not actual rows. Building and compiling a query does not connect to ClickHouse. To refresh descriptors from a real database, see [getting started](/docs/getting-started/#refresh-your-schema).
