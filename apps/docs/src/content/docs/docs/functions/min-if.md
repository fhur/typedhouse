---
title: minIf
description: Select the smallest value satisfying a Bool predicate.
sidebar:
  order: 66
---

`minIf(value, predicate)` finds the smallest non-NULL value among rows with a true Bool predicate. False and NULL predicates exclude rows. The result preserves the value operand's type and nullability; it does not inherit nullability from the predicate. A nullable predicate is emitted as `ifNull(predicate, false)`, because ClickHouse 24.8 can otherwise count a row with a NULL predicate; a non-nullable predicate is emitted unchanged.

The catalog accepts any value descriptor, subject to ClickHouse support for the operation. Do not assume an unmatched non-null aggregate returns NULL: with no qualifying row ClickHouse returns the type's default (`0`, `''`, `1970-01-01`), and a nullable value returns NULL. An `Enum` with no zero member has no such default: with no qualifying row the server cannot format the result, and the query fails through the client.

Float NaN makes the result depend on block and read order, as [`min`](/docs/functions/min/) describes: a NaN in the first qualifying row makes the result NaN, and without `groupBy` a NaN in the first qualifying row of a later data block hides the rest of that block. Filter NaN out first when the result must be stable.

Stacked combinators such as `minStateIf` are not available.

## Example

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, minIf, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const orders = table(
  'orders',
  {
    customer: col.String,
    amount: col.UInt32,
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
    smallestPaidAmount: minIf(group.amount, group.paid),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`customer` AS `customer`,
  minIf (
    `__typedhouse_input`.`amount`,
    `__typedhouse_input`.`paid`
  ) AS `smallestPaidAmount`
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
