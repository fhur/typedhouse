---
title: map
description: Shape query output with map.
sidebar:
  order: 3
---

`map` selects expressions and names the output fields. Subsequent callbacks see only that projected shape. It is a relational projection, not a JavaScript array transformation.

## Example

This selects two columns, renames `id` to `eventId`, and drops `tenant`. The output row is `{ eventId: number; category: string }`.

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
const query = from(events).map((e) => ({
  eventId: e.id,
  category: e.category,
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `eventId`,
  `category` AS `category`
FROM
  `events`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

## Server-clock enrichment

The standalone catalog functions `now`, `dateDiff`, and `multiIf` can enrich projections. `now()` is a non-deterministic server-clock expression with a `DateTime` descriptor (no invented timezone); it is not a JavaScript construction-time date. Its presence disables runtime live capability and keeps volatile projection boundaries intact.

**Owner-approved day contract:** `dateDiff('day', start, end)` counts **UTC calendar-day boundaries**, independent of the session timezone. It is not elapsed 24-hour periods. The compiler emits an internal, validated fourth `UTC` argument while preserving the three-argument public syntax. Operands must be non-null, descriptor-backed Date, DateTime, or DateTime64 with precision 0–3 and compatible modes. The result is Int64, decoded as `bigint`.

`multiIf([condition, 'first'], [otherCondition, 'second'], 'fallback')` supports one or more fixed readonly pairs and a final fallback. Conditions are Bool/Nullable(Bool) expressions; NULL conditions are skipped. Branches are JavaScript strings or non-null String-described expressions. The output is non-null String. Non-constant expression modes must agree; constants are mode-neutral. Dynamic, optional and union argument tuples are deliberately unsupported.

Broader date units/timezone overloads, other conditional branch families, and DateTime parameter serialization remain backlog. Scalar/structured DateTime results decode ISO UTC/offset timestamps recursively through Nullable and Array; the existing DateTime64 UTC parameter-wire/CAST pipeline is unchanged.

A single named column expression can be returned directly and keeps its root name. Unnamed computed expressions need an object key; otherwise construction fails with `unnamed_expression`. Object values must be expressions, not arbitrary JavaScript values or nested objects.
