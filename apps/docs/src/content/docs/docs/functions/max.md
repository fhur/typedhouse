---
title: max
description: Select the largest value in an aggregate group.
sidebar:
  order: 52
---

`max(value)` selects the largest value in each group, skipping NULL. It preserves the input value type, including nullability, rather than widening integers like `sum`. The catalog accepts any descriptor; the underlying ClickHouse type must support the operation.

An empty non-null input returns the type's default, not NULL. An `Enum` with no zero member has no such default: on empty input without `groupBy` the server cannot format the result, and the query fails through the client. With `groupBy`, empty input returns no rows, because no group exists.

Float NaN makes the result depend on block and read order. A NaN in the first row of the input or of a group makes the result NaN. Without `groupBy`, a NaN at the start of a later data block also hides the rest of that block: inserting `(1),(2)` and then `(nan),(9)` gives `2` with `max_threads=1`. Filter NaN out first when the result must be stable.

Use `argMax` instead when you want a different column from the row with the largest value, and [`min`](/docs/functions/min/) for the smallest value. Rollups use [`maxState` and `maxMerge`](/docs/functions/state-merge/).

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, max, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const orders = table(
  'orders',
  {
    customer: col.String,
    amount: col.UInt32,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(orders)
  .groupBy((row) => row.customer)
  .aggregate((group) => ({
    largestAmount: max(group.amount),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  max(`__typedhouse_input`.`amount`) AS `largestAmount`
FROM
  `orders` AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`customer`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
