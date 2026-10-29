---
title: max
description: Select the largest value in an aggregate group.
sidebar:
  order: 52
---

`max(value)` selects the largest value in each group, skipping NULL. It preserves the input value type, including nullability, rather than widening integers like `sum`. The catalog accepts any descriptor; the underlying ClickHouse type must support the operation.

Use `argMax` instead when you want a different column from the row with the largest value. `State` and `Merge` execution is not supported by the compiler.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, max, table } from '@chql/core';
import { compile } from '@chql/compiler';

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
  `__chql_input`.`customer` AS `customer`,
  max(`__chql_input`.`amount`) AS `largestAmount`
FROM
  `orders` AS `__chql_input`
GROUP BY
  `__chql_input`.`customer`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->
