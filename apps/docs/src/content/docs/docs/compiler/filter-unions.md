---
title: Push filters into UNION branches
description: Apply safe predicates within each compatible UNION branch.
sidebar:
  order: 6
---

**`PushFilterUnion`** copies a safe filter into every UNION branch and rebinds its references to that branch. Existing boundaries inside each branch still apply.

## Example

One tenant filter after `unionAll` becomes a filter inside each input. The same parameter object is reused rather than creating separate tenant bindings.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table, unionAll } from '@chql/core';
import { compile } from '@chql/compiler';

const current = table(
  'current_events',
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
const archived = table(
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
const query = unionAll(from(current), from(archived)).where(
  (e) => e.tenant.eq('acme'),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`id` AS `id`,
  `__chql_input`.`tenant` AS `tenant`
FROM
  (
    SELECT
      `id`,
      `tenant`
    FROM
      `current_events`
    WHERE
      `tenant` = {p0:String}
  ) AS `__chql_input`
UNION ALL
SELECT
  `__chql_input`.`id` AS `id`,
  `__chql_input`.`tenant` AS `tenant`
FROM
  (
    SELECT
      `id`,
      `tenant`
    FROM
      `archived_events`
    WHERE
      `tenant` = {p0:String}
  ) AS `__chql_input`
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

Branches must have identical output paths and ClickHouse types. The rule preserves whether the UNION retains or removes duplicates. It does not push limits or top-k operations through UNION.
