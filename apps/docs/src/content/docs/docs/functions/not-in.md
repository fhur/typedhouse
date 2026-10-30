---
title: notIn
description: Exclude values belonging to a literal set.
sidebar:
  order: 18
---

`value.notIn(values)` tests non-membership in a literal array of compatible, non-null values.

## Example

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
const query = from(events).where((e) =>
  e.category.notIn(['debug', 'heartbeat']),
);

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
WHERE
  notIn(`category`, {p0:Array(String)})
```

Parameters:

```json
{
  "p0": "['debug','heartbeat']"
}
```

<!-- generated-sql:end -->

A one-column query is also accepted: see [set subqueries](/docs/query-builder/set-subqueries/). The supported membership descriptors are integers, floats, String, Bool, Date, and their nullable forms. Do not use non-membership as a substitute for an explicit NULL check.
