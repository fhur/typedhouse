---
title: in
description: Test membership in a literal set.
sidebar:
  order: 17
---

`value.in(values)` tests membership in a literal array of compatible, non-null values.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
  e.category.in(['purchase', 'refund']),
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
  in (`category`, {p0:Array(String)})
```

Parameters:

```json
{
  "p0": "['purchase','refund']"
}
```

<!-- generated-sql:end -->

For a set stored in another query, see [set subqueries](/docs/query-builder/set-subqueries/). Membership supports integers, floats, String, Bool, and Date descriptors and their nullable forms, not arbitrary containers or DateTime families. Nullable operands follow ClickHouse membership semantics; use explicit NULL handling when needed.
