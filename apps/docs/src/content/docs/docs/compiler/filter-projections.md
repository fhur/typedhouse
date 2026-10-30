---
title: Push filters through selections
description: Move filters below selections by substituting the projected expressions into the predicate.
sidebar:
  order: 2
---

**`PushFilterProject`** moves a safe filter below a selection. Each conjunct of the predicate is rewritten by substituting the projected expressions for the output names it references; the rewritten conjunct moves below the `map` when it stays inside the compiler's closed total fragment, and the remaining conjuncts stay above the selection as a residual filter. Filtering happens closer to the source, where it can combine with other filters and fold into the scan's `WHERE`.

## Renames

The query filters the renamed `eventId`; the final SQL filters the source `id` column.

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
  .map((e) => ({ eventId: e.id }))
  .where((e) => e.eventId.gt(100));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `eventId`
FROM
  `events`
WHERE
  `id` > {p0:UInt32}
```

Parameters:

```json
{
  "p0": "100"
}
```

<!-- generated-sql:end -->

## Computed selections

The filter references a computed output. The predicate is rewritten over the source expression, so `WHERE` compares `id + {p0}` against the source column before the selection runs. The parameter inside the projected expression keeps its identity: it is one `{p0}` in both places. The pushed filter and the computed selection then [fold into one SELECT](/docs/compiler/select-blocks/).

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
  .map((e) => ({ eventId: e.id.plus(1) }))
  .where((e) => e.eventId.gt(100n));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` + {p0:UInt32} AS `eventId`
FROM
  `events`
WHERE
  `id` + {p0:UInt32} > {p1:UInt64}
```

Parameters:

```json
{
  "p0": "1",
  "p1": "100"
}
```

<!-- generated-sql:end -->

## Conditions

A conjunct moves below the selection only when all of the following hold:

- After substitution it still references only the selection's input.
- The substituted predicate is inside the closed total fragment: comparisons, boolean operators and null checks over supported String, Bool and integer operands, typed integer `plus`/`minus`/`multiply`, and `ifNull` between operands of the same family. Raw SQL, casts, division, volatile calls such as `now()`, known or user-defined functions and subqueries keep the filter above the selection, so an expression that could fail or change value is never copied into `WHERE`.
- Every projected expression the conjunct does **not** copy is total as well. After the move the selection is evaluated on fewer rows; an expression that could fail must keep its original evaluation set, so a selection with an unused `cast` or division stays a fence even for a conjunct that never touches it.

Determinism alone is not enough for any of these checks; the fragment is checked by resolution against the catalog. When a projected alias shadows a physical column of the scan (`map(r => ({ stock: r.stock.plus(1) })).where(r => r.stock.gt(0))`), the pushed filter still moves below the selection, but [SELECT-block folding](/docs/compiler/select-blocks/) keeps the selection in its own derived table so ClickHouse cannot resolve the `WHERE` against the alias. Consecutive selections are collapsed first by [merging stacked selections](/docs/compiler/merge-projections/).
