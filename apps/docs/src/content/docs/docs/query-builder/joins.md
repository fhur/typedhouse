---
title: join / crossJoin
description: Combine named inputs with an inner ALL join or a Cartesian product.
sidebar:
  order: 8
---

`join` takes named query inputs, and `.on` supplies their matching predicate. Callbacks access each input through its alias. The result is an **inner ALL join**: unmatched rows disappear, and every matching pair is retained.

## Example

Match events to accounts, then project a flat result with explicit field names.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, join, table } from '@chql/core';
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
    name: col.String,
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
const query = join({
  event: from(events),
  account: from(accounts),
})
  .on((r) => r.event.accountId.eq(r.account.id))
  .map((r) => ({
    eventId: r.event.id,
    accountName: r.account.name,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `event`.`id` AS `eventId`,
  `account`.`name` AS `accountName`
FROM
  `events` AS `event`
  INNER ALL JOIN `accounts` AS `account` ON `event`.`accountId` = `account`.`id`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Inputs need not have unique join keys; duplicate keys can multiply rows. `.on` accepts a predicate or an array of predicates. Supported equality predicates form join conditions; other conjuncts become residual filters.

`crossJoin` takes the same named-input object but has no `.on` stage. It returns every combination of input rows, so output size can grow rapidly. Both forms require at least two inputs. These APIs do not provide outer joins or ANY join semantics.
