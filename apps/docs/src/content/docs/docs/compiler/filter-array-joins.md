---
title: Filter before array expansion
description: Avoid expanding rows that an independent filter will discard.
sidebar:
  order: 4
---

**`PushFilterArrayJoin`** moves the safe conjuncts of a filter before `ARRAY JOIN` when they do not reference the expanded alias. This can avoid expanding rows that will be discarded; the remaining conjuncts stay above the expansion.

## Example

Although `where` follows `arrayJoin`, the tenant filter runs on the input before tags are expanded. The expansion then [folds into the scan's SELECT block](/docs/compiler/select-blocks/), so the whole query is one `SELECT` with the expanded element aliased as `tag`.

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
  `id`,
  `tenant`,
  `tags`,
  `tag`
FROM
  `events`
  ARRAY JOIN `tags` AS `tag`
WHERE
  `tenant` = {p0:String}
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

## Conditions

The filter is split into conjuncts. A conjunct moves below the expansion when all of the following hold:

- It does not reference the expanded alias. A conjunct on `tag` stays above the expansion, where it is evaluated once per expanded row; the other conjuncts of the same `where` can still move.
- It is a safe predicate: comparisons, boolean operators and null checks over String, Bool and integer operands. An inner `ARRAY JOIN` drops rows whose array is empty before any later `WHERE` sees them, so a conjunct that moves below it is evaluated on rows it never saw; only a predicate that cannot fail may move.
- The expanded expression is total: a column, a parameter, or a tuple field extracted with `element` from an array of named tuples. The expansion is evaluated on fewer rows after the move, so an expression that could fail keeps its original evaluation set.
