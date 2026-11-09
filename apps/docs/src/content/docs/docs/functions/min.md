---
title: min
description: Select the smallest value in an aggregate group.
sidebar:
  order: 65
---

`min(value)` selects the smallest value in each group, skipping NULL. It preserves the input value type, including nullability, rather than widening integers like `sum`. The catalog accepts any descriptor; the underlying ClickHouse type must support the operation.

An empty or all-NULL nullable input returns NULL. An empty non-null input returns the type's default (`0`, `''`, `1970-01-01`), not NULL. An `Enum` with no zero member has no such default: on empty input without `groupBy` the server cannot format the result, and the query fails through the client. With `groupBy`, empty input returns no rows, because no group exists.

Float NaN makes the result depend on block and read order. A NaN in the first row of the input or of a group makes the result NaN. Without `groupBy`, a NaN at the start of a later data block also hides the rest of that block: inserting `(5),(4)` and then `(nan),(1)` gives `4` with `max_threads=1`, and on a multi-part MergeTree table the result can change with the thread count (`2` or NaN when the true minimum is `1`). Filter NaN out first when the result must be stable.

Use [`argMin`](/docs/functions/arg-min/) instead when you want a different column from the row with the smallest value, and [`max`](/docs/functions/max/) for the largest value. Rollups use [`minState` and `minMerge`](/docs/functions/state-merge/).

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, min, table } from '@typedhouse/core';
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
    smallestAmount: min(group.amount),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  min(`__typedhouse_input`.`amount`) AS `smallestAmount`
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
