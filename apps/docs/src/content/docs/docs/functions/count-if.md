---
title: countIf
description: Count rows satisfying a Bool predicate.
sidebar:
  order: 58
---

`countIf(predicate)` counts only rows where a Bool predicate is true. False and NULL predicates do not contribute. It returns non-null `UInt64` (`bigint`), with zero when no rows qualify.

Unlike filtering the query before grouping, the condition applies only to this aggregate: groups with no qualifying rows still exist if they have input rows. The compiler supports the `If` combinator, not `State`/`Merge` execution or stacked combinators.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, countIf, from, table } from '@chql/core';
import { compile } from '@chql/compiler';

const orders = table(
  'orders',
  {
    customer: col.String,
    paid: col.Bool,
  },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);
```

</details>

```ts
const query = from(orders)
  .groupBy((row) => row.customer)
  .aggregate((group) => ({
    paidOrders: countIf(group.paid),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`customer` AS `customer`,
  countIf (`__chql_input`.`paid`) AS `paidOrders`
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
