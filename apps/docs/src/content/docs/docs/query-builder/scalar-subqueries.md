---
title: scalar
description: Use a one-column global aggregate as a scalar expression.
sidebar:
  order: 14
---

`scalar` embeds a query result as an expression. The supported form is a **direct, one-column global aggregate**: no grouping keys and exactly one aggregate output.

## Example

Keep events whose ID matches the maximum ID in a separate reference table.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, max, scalar, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
const referenceEvents = table(
  'reference_events',
  {
    id: col.UInt32,
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
const maximumId = scalar(
  from(referenceEvents).aggregate((e) => ({
    id: max(e.id),
  })),
);
const query = from(events).where((e) => e.id.eq(maximumId));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tenant`
FROM
  `events`
WHERE
  `id` = (
    SELECT
      max(`__chql_input`.`id`) AS `id`
    FROM
      (
        SELECT
          `id`
        FROM
          `reference_events`
      ) AS `__chql_input`
  )
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Filtering the aggregate's input is allowed, but wrapping the aggregate result in a projection, filter, limit, or CTE hint no longer meets the direct-aggregate requirement. An arbitrary query with `.limit(1)` is not supported as a scalar subquery.

The scalar expression conservatively retains nullable output, even for a global aggregate; do not assume it is always non-null. Supported result descriptors are integers, floats, String, Bool, Date, and their nullable forms. Container types and DateTime families are not supported. Subqueries must be uncorrelated and cannot capture an outer callback row.
