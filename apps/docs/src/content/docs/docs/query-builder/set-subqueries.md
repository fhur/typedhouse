---
title: in / notIn
description: Filter rows by membership in a one-column query result.
sidebar:
  order: 13
---

An expression's `.in(query)` tests membership in a query result without joining its rows into the output. The subquery must return exactly one compatible column, but may return any number of rows.

## Example

Keep events whose account ID belongs to an active account.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    accountId: col.UInt32,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
const accounts = table(
  'accounts',
  {
    id: col.UInt32,
    active: col.Bool,
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
const activeAccountIds = from(accounts)
  .where((a) => a.active.eq(true))
  .map((a) => ({ id: a.id }));
const query = from(events).where((e) =>
  e.accountId.in(activeAccountIds),
);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `accountId`
FROM
  `events`
WHERE
  in (
    `accountId`,
    (
      SELECT
        `id`
      FROM
        `accounts`
      WHERE
        `active` = {p0:Bool}
    )
  )
```

Parameters:

```json
{
  "p0": "1"
}
```

<!-- generated-sql:end -->

Repeated values in the subquery do not multiply outer rows. `.notIn(query)` uses the same one-column shape to test non-membership. Both methods also accept literal arrays, but the example keeps the set inside ClickHouse.

Subqueries are uncorrelated: build their predicates from their own callback rows, not an outer row. Supported membership descriptors are integers, floats, String, Bool, Date, and their nullable forms; container types and DateTime families are not supported. Nullable operands follow ClickHouse membership semantics, so do not treat NOT IN as a general substitute for explicit NULL handling.
