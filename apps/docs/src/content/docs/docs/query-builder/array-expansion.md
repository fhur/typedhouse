---
title: arrayJoin / leftArrayJoin
description: Expand array elements into rows with arrayJoin or leftArrayJoin.
sidebar:
  order: 10
---

`.arrayJoin` turns each array element into a separate row, repeating the other input fields. The alias becomes a new field available to subsequent callbacks.

## Example

Produce one event/tag pair per tag, keeping duplicate tags as separate rows.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
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
  .map((e) => ({ id: e.id, tag: e.tag }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`id` AS `id`,
  `__chql_input`.`tag` AS `tag`
FROM
  (
    SELECT
      `__chql_input`.`id` AS `id`,
      `__chql_element` AS `tag`
    FROM
      (
        SELECT
          `id`,
          `tags`
        FROM
          `events`
      ) AS `__chql_input`
      ARRAY JOIN `__chql_input`.`tags` AS `__chql_element`
  ) AS `__chql_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

An empty array produces no rows with `.arrayJoin`. `.leftArrayJoin` takes the same callback and alias but preserves an empty-array input as one row with the element type's default value: for String, an empty string, not automatically NULL.

The callback must return an array expression, and the alias must not collide with an existing output field. Expansion changes row counts before later aggregates or limits. Chaining expansions multiplies combinations; it does not zip arrays together.
