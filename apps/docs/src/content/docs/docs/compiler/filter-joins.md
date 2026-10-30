---
title: Push filters into joins
description: Filter individual inner or cross join inputs before joining.
sidebar:
  order: 3
---

**`PushFilterJoin`** splits safe conjunctions over inner and cross joins and moves each single-input predicate into that input. This can reduce the rows entering the join. Predicates referencing both sides remain above it.

## Example

The filter is written after the join, but its tenant predicate applies only to events and its ID predicate only to accounts.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, join, table } from '@typedhouse/core';
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
const accounts = table(
  'accounts',
  {
    id: col.UInt32,
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
  .on((r) => r.event.id.eq(r.account.id))
  .where((r) =>
    r.event.tenant.eq('acme').and(r.account.id.gt(100)),
  );

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `event`.`id` AS `__typedhouse_leaf_0`,
  `event`.`tenant` AS `__typedhouse_leaf_1`,
  `account`.`id` AS `__typedhouse_leaf_2`
FROM
  (
    SELECT
      `id`,
      `tenant`
    FROM
      `events`
    WHERE
      `tenant` = {p0:String}
  ) AS `event`
  INNER ALL JOIN (
    SELECT
      `id`
    FROM
      `accounts`
    WHERE
      `id` > {p1:UInt32}
  ) AS `account` ON `event`.`id` = `account`.`id`
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "100"
}
```

<!-- generated-sql:end -->

The filter and join conditions must pass safety checks. This is not join reordering or an outer-join rewrite. Inner ALL join duplicates are preserved.
