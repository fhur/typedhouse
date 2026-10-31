---
title: divide
description: Divide compatible numeric values.
sidebar:
  order: 25
---

`value.divide(other)` divides the receiver by the operand. Non-Decimal division returns Float64 rather than an integer quotient.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    durationMs: col.Float64,
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
  id: e.id,
  durationSeconds: e.durationMs.divide(1000),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  `durationMs` / {p0:Float64} AS `durationSeconds`
FROM
  `events`
```

Parameters:

```json
{
  "p0": "1000"
}
```

<!-- generated-sql:end -->

This method does not guard against zero denominators or promise finite results. Decimal division follows a separate descriptor rule that preserves the numerator's scale. Nullable operands propagate NULL.
