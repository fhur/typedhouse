---
title: Merge consecutive filters
description: Combine safe consecutive filters into one predicate.
sidebar:
  order: 1
---

**`MergeFilter`** combines consecutive safe filters with `AND`, removing a redundant relational step. Both predicates must be safe to combine: arbitrary expressions may change evaluation behavior or hide errors.

## Example

Both `where` calls below become predicates in a single SQL `WHERE` clause. Other compiler passes also fold the SELECT block.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
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
```

</details>

```ts
const query = from(events)
  .where((e) => e.tenant.eq('acme'))
  .where((e) => e.id.gt(100));

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
  `tenant` = {p0:String}
  AND `id` > {p1:UInt32}
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "100"
}
```

<!-- generated-sql:end -->

The rewrite recognizes a closed set of comparisons, boolean operators, and null checks over supported String, Bool, and integer operands. Raw SQL, volatile calls, casts, and other unsupported expression shapes prevent this rewrite; determinism alone is not enough.
