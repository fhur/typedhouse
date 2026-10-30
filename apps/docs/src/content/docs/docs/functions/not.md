---
title: not
description: Negate a boolean expression.
sidebar:
  order: 21
---

`predicate.not()` negates a boolean expression. JavaScript `!` would negate the expression object instead of building SQL.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const accounts = table(
  'accounts',
  {
    id: col.UInt32,
    suspended: col.Bool,
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
const query = from(accounts).where((account) =>
  account.suspended.not(),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `suspended`
FROM
  `accounts`
WHERE
  not (`suspended`)
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Negating NULL still yields NULL. To replace a nullable boolean with a default, use [`ifNull`](/docs/functions/if-null/) explicitly.
