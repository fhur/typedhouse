---
title: unionAll
description: Append compatible query results without removing duplicates.
sidebar:
  order: 9
---

`unionAll` combines two or more queries into one result. It preserves all rows, including duplicates within an input and across inputs.

## Example

Append archived events to current events with the same output schema.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  table,
  unionAll,
} from '@typedhouse/core';
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
const archivedEvents = table(
  'archived_events',
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
const query = unionAll(from(events), from(archivedEvents));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id` AS `id`,
  `__typedhouse_input`.`tenant` AS `tenant`
FROM
  (
    SELECT
      `id`,
      `tenant`
    FROM
      `events`
  ) AS `__typedhouse_input`
UNION ALL
SELECT
  `__typedhouse_input`.`id` AS `id`,
  `__typedhouse_input`.`tenant` AS `tenant`
FROM
  (
    SELECT
      `id`,
      `tenant`
    FROM
      `archived_events`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Inputs must have matching row shapes and identical ClickHouse descriptors for each field path. Matching decoded TypeScript types alone is insufficient: UInt32 and UInt64 are not interchangeable. Fields are aligned by path, rather than relying on their declaration order; implicit common-type coercion is not supported.

Apply `.distinct()` after the union if you want duplicate result rows removed. Use `.orderBy()` on the combined query when result order matters; UNION ALL does not promise input order.
