---
title: State and Merge
description: Build opaque aggregate states and finalize them with -Merge.
sidebar:
  order: 71
---

Every typed aggregate has a pair. `<name>State` builds an opaque state in place of the finished value, and `<name>Merge` combines states and finalizes them. [Rollups and materialized views](/docs/query-builder/rollups/) shows how they fit together.

| State | Merge | Merged result |
| --- | --- | --- |
| `countState()` | `countMerge(s)` | `UInt64` |
| `sumState(x)` | `sumMerge(s)` | As [`sum`](/docs/functions/sum/): widened, nullable with the input |
| `maxState(x)` | `maxMerge(s)` | The value's type, without `LowCardinality` |
| `minState(x)` | `minMerge(s)` | The value's type, without `LowCardinality` |
| `argMaxState(v, w)` | `argMaxMerge(s)` | The type of `v` |
| `argMinState(v, w)` | `argMinMerge(s)` | The type of `v` |
| `avgState(x)` | `avgMerge(s)` | `Float64`, nullable with the input |
| `uniqState(x)` | `uniqMerge(s)` | `UInt64` |
| `uniqExactState(x)` | `uniqExactMerge(s)` | `UInt64` |
| `quantileState(level)(x)` | `quantileMerge(level)(s)` | `Float64`, nullable with the input |
| `quantileExactState(level)(x)` | `quantileExactMerge(level)(s)` | The input type |

Each state accepts the same operands as its base function, so `uniqState` builds over String only, but `countMerge`, `uniqMerge` and `uniqExactMerge` read a rollup column with any stored arguments the server allows, such as `AggregateFunction(uniq, UInt64)`, as long as TypedHouse can model its type. `AggregateFunction(uniq, Point)` raises `invalid_merge_state` and needs [`agg.uniqMerge` from the known tier](/docs/query-builder/rollups/#rules). Every other merge requires stored arguments its base function accepts, and its descriptor is the server's: `sumState` over `UInt32` is `AggregateFunction(sum, UInt32)`, and `quantileState(0.9)` over `Float64` is `AggregateFunction(quantile(0.9), Float64)`. `LowCardinality` is dropped from a state's type at every depth.

The two quantile merges require a level, and **the merge level decides the result**, not the level stored in the state. A nullable state accepts only its stored level, and anything else raises `invalid_merge_state`.

A state cannot be selected, only merged. A query or subquery returning one raises `aggregate_state_selection`, and an expression, sort key, `limitBy` key, group key or nested `distinct` reading one raises `aggregate_state_operand`. `sumStateIf`, `sumMergeIf` and other two-combinator forms are not available. `finalizeAggregation` works row by row, before merging; see the [rules](/docs/query-builder/rollups/#rules).

## Example

Build a state per customer in one step, then merge across customers.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  quantileExactMerge,
  quantileExactState,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const orders = table(
  'orders',
  {
    customerId: col.String,
    amount: col.UInt64,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['customerId'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(orders)
  .groupBy((row) => row.customerId)
  .aggregate((group) => ({
    amounts: quantileExactState(0.5)(group.amount),
  }))
  .aggregate((group) => ({
    medianAmount: quantileExactMerge(0.5)(group.amounts),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  quantileExactMerge ({p0:Float64}) (`__typedhouse_input`.`amounts`) AS `medianAmount`
FROM
  (
    SELECT
      `__typedhouse_input`.`customerId` AS `customerId`,
      quantileExactState ({p1:Float64}) (`__typedhouse_input`.`amount`) AS `amounts`
    FROM
      `orders` AS `__typedhouse_input`
    GROUP BY
      `__typedhouse_input`.`customerId`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{
  "p0": "0.5",
  "p1": "0.5"
}
```

<!-- generated-sql:end -->
