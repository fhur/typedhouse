---
title: Extract shared inputs into CTEs
description: Represent safe shared relational objects with named WITH clauses.
sidebar:
  order: 8
---

When multiple consumers reuse the same safe relational object, the compiler can emit it once as a named `WITH` CTE. Repeated UNION slots and expression-subquery occurrences count as uses. Dependencies appear before consumers, with collision-free names.

## Example

Both UNION inputs reuse the exact same `shared` query object. The compiler extracts it into a CTE; `UNION ALL` still preserves the duplicate rows.

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
```

</details>

```ts
const shared = from(events).where((e) =>
  e.tenant.eq('acme'),
);
const query = unionAll(shared, shared);

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
  `__typedhouse_input`.`id` AS `id`,
  `__typedhouse_input`.`tenant` AS `tenant`
FROM
  (
    SELECT
      `t0`.`id`,
      `t0`.`tenant`
    FROM
      `t0`
  ) AS `__typedhouse_input`
UNION ALL
SELECT
  `__typedhouse_input`.`id` AS `id`,
  `__typedhouse_input`.`tenant` AS `tenant`
FROM
  (
    SELECT
      `t0`.`id`,
      `t0`.`tenant`
    FROM
      `t0`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

Same-name column selections and compatible filters, sorting, and limits can read directly from a CTE without an extra reference-wrapper SELECT. The CTE definition remains a separate scope; this does not push those operations into the definition. Other consumers, such as UNION branches, can still require wrappers.

Sharing uses **object identity**, not structural equality. Independently constructing equivalent queries does not make them one shared input. Raw, volatile, or otherwise unsafe graphs are not automatically extracted.

`cte()` is also an ordinary CTE hint, not real temporary-table materialization. Neither it nor automatic extraction promises cached results or one execution: ClickHouse may inline CTEs. This reduces repeated SQL text, not necessarily repeated database work.
