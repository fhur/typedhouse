---
title: cte
description: Represent an intermediate query with a named WITH clause.
sidebar:
  order: 12
---

`.cte()` asks the compiler to represent an intermediate query as a **common table expression**, using a named `WITH` clause.

## Example

Name the filtered events as a CTE before projecting their IDs.

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
const tenantEvents = from(events)
  .where((e) => e.tenant.eq('acme'))
  .cte();
const query = tenantEvents.map((e) => ({ id: e.id }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
WITH
  `t0` AS (
    SELECT
      `id`,
      `tenant`
    FROM
      `events`
    WHERE
      `tenant` = {p0:String}
  )
SELECT
  `t0`.`id`
FROM
  `t0`
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

The hint preserves the query's output shape. It does not create a temporary table, persist results, or guarantee a single evaluation. ClickHouse may inline the CTE and evaluate each use independently, so this is not a way to freeze volatile expressions or ensure less database work.

The compiler can also extract safe shared query objects automatically. That sharing depends on object identity, not merely equivalent query text; an explicit hint is useful when you want to name an intermediate even without multiple consumers.
