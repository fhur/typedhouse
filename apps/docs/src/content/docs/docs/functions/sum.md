---
title: sum
description: Sum numeric values in an aggregate group.
sidebar:
  order: 51
---

`sum(value)` adds numeric values, skipping NULL. Integers up to 64 bits produce `Int64` or `UInt64` (`bigint`); 128- and 256-bit integers retain their width. Floats produce `Float64` (`number`). Nullable input keeps a nullable result descriptor.

Decimal input is supported: the result preserves scale and uses precision 38, or 76 when input precision exceeds 38. Unlike `sum`, `avg` and `quantile` do not support Decimal operands. `State` and `Merge` execution is not supported by the compiler.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, sum, table } from '@typedhouse/core';
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
    totalAmount: sum(group.amount),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  sum(`__typedhouse_input`.`amount`) AS `totalAmount`
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
