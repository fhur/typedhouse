---
title: count
description: Count rows in an aggregate group.
sidebar:
  order: 50
---

`count()` counts all rows in each group, including rows whose columns contain NULL. It takes no column argument and returns ClickHouse `UInt64`, decoded as `bigint`. An ungrouped count over empty input returns `0n`.

The example counts orders per customer. Although core exports state helpers, the compiler does not support `State` or `Merge` execution.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, count, from, table } from '@chql/core';
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
  .aggregate(() => ({ orders: count() }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`customer` AS `customer`,
  count() AS `orders`
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
