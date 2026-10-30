---
title: eq
description: Compare values for equality.
sidebar:
  order: 10
---

`value.eq(other)` tests equality. Use a compatible literal or expression; it builds a SQL predicate rather than comparing JavaScript objects.

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
  e.category.eq('purchase'),
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
  `category` = {p0:String}
```

Parameters:

```json
{
  "p0": "purchase"
}
```

<!-- generated-sql:end -->

Nullable comparisons can produce NULL. To test whether a value is NULL, use [`isNull`](/docs/functions/is-null/), not `.eq(null)`.
