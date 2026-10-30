---
title: Merge stacked selections
description: Collapse consecutive map calls into one selection by substitution.
sidebar:
  order: 2.5
---

**`MergeProject`** rewrites a selection over a selection, `Project(Project(x, p), q)`, into a single selection `Project(x, q[p])`: every reference to an output of the inner `map` is replaced by the inner expression itself. Composed queries build such stacks naturally (a reusable `map` followed by a caller's `map`); without the merge each level is a nested derived table.

## Example

The inner `map` renames `id` and `tenant`; the outer `map` computes on the renamed columns. The final SQL is a single `SELECT` over the scan: the intermediate `eventId`/`owner` level is gone, and the merged selection [folds into the scan block](/docs/compiler/select-blocks/).

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
  .map((e) => ({ eventId: e.id, owner: e.tenant }))
  .map((e) => ({
    nextId: e.eventId.plus(1),
    owner: e.owner,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` + {p0:UInt32} AS `nextId`,
  `tenant` AS `owner`
FROM
  `events`
```

Parameters:

```json
{
  "p0": "1"
}
```

<!-- generated-sql:end -->

## Conditions

The two selections merge only when all of the following hold:

- The inner selection has exactly one consumer. A selection used twice (by two joins sides, two union branches, or a scalar subquery and an outer `map`) is not merged into either consumer; it becomes a [shared CTE](/docs/compiler/shared-ctes/) instead, so it is still evaluated once.
- An inner output the outer selection references more than once contains no raw SQL and no volatile call. Substitution would copy the expression, and `now()` or raw SQL copied twice may differ between the copies.
- An inner output the outer selection never references is inside the closed total fragment: bare column reads and parameters of any type, typed integer `plus`/`minus`/`multiply`, comparisons, boolean operators, null checks and same-family `ifNull`. Dropping an unused `cast`, division, known or user-defined function call, or volatile call would remove an evaluation that could fail or that ClickHouse would otherwise perform, so such selections keep their boundary even though the output is unused.
- No inner output contains a subquery.

Parameters are never copied: a parameter referenced twice after substitution keeps one placeholder. The merged selection folds into the scan's `SELECT` list under the usual [SELECT-block rules](/docs/compiler/select-blocks/); a computed alias that shadows a physical column keeps its own derived table.
