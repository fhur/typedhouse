---
title: Filter before array expansion
description: Avoid expanding rows that an independent filter will discard.
sidebar:
  order: 4
---

**`PushFilterArrayJoin`** moves a safe filter before `ARRAY JOIN` when it does not reference the expanded alias. This can avoid expanding rows that will be discarded.

## Example

Although `where` follows `arrayJoin`, the tenant filter runs on the input before tags are expanded.

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
    tags: col.Array(col.String),
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
  .arrayJoin((e) => e.tags, 'tag')
  .where((e) => e.tenant.eq('acme'));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id` AS `id`,
  `__typedhouse_input`.`tenant` AS `tenant`,
  `__typedhouse_input`.`tags` AS `tags`,
  `__typedhouse_element` AS `tag`
FROM
  (
    SELECT
      `id`,
      `tenant`,
      `tags`
    FROM
      `events`
    WHERE
      `tenant` = {p0:String}
  ) AS `__typedhouse_input`
  ARRAY JOIN `__typedhouse_input`.`tags` AS `__typedhouse_element`
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

The expanded expression must be a direct input column. The whole predicate must be independent of the expanded alias; a filter referencing `tag` cannot move before expansion under this rule.
