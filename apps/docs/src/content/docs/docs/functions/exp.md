---
title: exp
description: Compute the natural exponential of a numeric expression.
sidebar:
  order: 26
---

`value.exp()` computes e raised to the value. The free `exp(value)` export from `@typedhouse/core` builds the same function; both forms return a Float64 expression.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, exp, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const scores = table(
  'scores',
  {
    id: col.UInt32,
    logWeight: col.Float64,
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
const query = from(scores).map((score) => ({
  id: score.id,
  methodWeight: score.logWeight.exp(),
  functionWeight: exp(score.logWeight),
}));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id` AS `id`,
  exp(`logWeight`) AS `methodWeight`,
  exp(`logWeight`) AS `functionWeight`
FROM
  `scores`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Supported inputs are Int/UInt 8, 16, 32, or 64 and Float32/64, optionally Nullable. Decimal, 128/256-bit integers, and LowCardinality wrappers are not supported. NULL stays NULL; large inputs can overflow the floating-point result.
