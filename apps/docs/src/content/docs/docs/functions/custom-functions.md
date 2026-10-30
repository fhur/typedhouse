---
title: Expression helpers
description: Reuse business rules and calculations as typed expression helpers.
sidebar:
  order: 1
---

Expression helpers give names to business rules you use across queries. They accept typed expressions and return an expression built from TypedHouse's methods. Import them like any other TypeScript function—no registration or database setup is required.

The helper runs when you build the query. ClickHouse evaluates the resulting SQL against the rows; it does not call your JavaScript function.

## Flag inventory that needs replenishment

Available stock is on-hand quantity minus reserved quantity. Encapsulate that rule so dashboards, exports, and alerts use the same definition of “needs reorder.” This example uses fractional quantities, such as kilograms or metres.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  table,
  type Infer,
  type Row,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const inventory = table(
  'inventory',
  {
    sku: col.String,
    onHand: col.Float64,
    reserved: col.Float64,
    reorderPoint: col.Float64,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['sku'],
    partitionKey: [],
  },
);
```

</details>

```ts
function needsReorder(item: Row<Infer<typeof inventory>>) {
  return item.onHand
    .minus(item.reserved)
    .lt(item.reorderPoint);
}

const query = from(inventory)
  .where(needsReorder)
  .map((item) => ({
    sku: item.sku,
    available: item.onHand.minus(item.reserved),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`sku` AS `sku`,
  `__typedhouse_input`.`onHand` - `__typedhouse_input`.`reserved` AS `available`
FROM
  (
    SELECT
      `sku`,
      `onHand`,
      `reserved`
    FROM
      `inventory`
    WHERE
      `onHand` - `reserved` < `reorderPoint`
  ) AS `__typedhouse_input`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

`Infer<typeof inventory>` derives the data shape from the table; `Row` turns its fields into typed query expressions. The helper accepts the entire callback row, so it can be passed directly to `where`. It uses each row's reorder point rather than hard-coding one threshold for every SKU. You can also project its boolean result instead of using it as a filter.

## Calculate gross margin consistently

Gross margin is `(revenue - cost) / revenue`, expressed as a percentage—not markup, which divides by cost. A shared helper keeps that distinction consistent across reporting queries.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  table,
  type Expr,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const sales = table(
  'sales',
  {
    product: col.String,
    revenue: col.Float64,
    cost: col.Float64,
  },
  {
    engine: 'MergeTree',
    sortingKey: ['product'],
    partitionKey: [],
  },
);
```

</details>

```ts
function grossMarginPercent(
  revenue: Expr<number, string>,
  cost: Expr<number, string>,
) {
  return revenue.minus(cost).divide(revenue).multiply(100);
}

const query = from(sales)
  .where((sale) => sale.revenue.gt(0))
  .map((sale) => ({
    product: sale.product,
    marginPercent: grossMarginPercent(
      sale.revenue,
      sale.cost,
    ),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`product` AS `product`,
  (
    `__typedhouse_input`.`revenue` - `__typedhouse_input`.`cost`
  ) / `__typedhouse_input`.`revenue` * {p0:Float64} AS `marginPercent`
FROM
  (
    SELECT
      `product`,
      `revenue`,
      `cost`
    FROM
      `sales`
    WHERE
      `revenue` > {p1:Float64}
  ) AS `__typedhouse_input`
```

Parameters:

```json
{
  "p0": "100",
  "p1": "0"
}
```

<!-- generated-sql:end -->

This query deliberately excludes zero and negative revenue. The helper itself does not protect against a zero denominator; callers must choose an appropriate policy. Revenue and cost must use the same currency and reporting basis. This example uses Float64 for analytical ratios, not exact monetary accounting.

## Compose a contactability rule from smaller helpers

A nullable email address needs an explicit policy. Here NULL and the empty string both mean “missing,” and an unsubscribed customer must be excluded even when an address exists.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  table,
  type Expr,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const customers = table(
  'customers',
  {
    id: col.UInt32,
    email: col.Nullable(col.String),
    unsubscribed: col.Bool,
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
function hasEmail(email: Expr<string | null, string>) {
  return email.ifNull('').notEmpty();
}

function isContactable(
  email: Expr<string | null, string>,
  unsubscribed: Expr<boolean, string>,
) {
  return hasEmail(email).and(unsubscribed.not());
}

const query = from(customers)
  .where((customer) =>
    isContactable(customer.email, customer.unsubscribed),
  )
  .map((customer) => ({
    id: customer.id,
    email: customer.email,
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `email`
FROM
  `customers`
WHERE
  notEmpty(ifNull(`email`, {p0:String}))
  AND not (`unsubscribed`)
```

Parameters:

```json
{
  "p0": ""
}
```

<!-- generated-sql:end -->

This checks presence and unsubscribe status, not email validity or permission to send a particular message. Whitespace-only strings are considered present. Filtering does not narrow the projected email's TypeScript type: it remains `string | null`.

## Writing your own helpers

- Accept expressions for column inputs. `Expr<number, string>` accepts named numeric expressions; use nullable value types when the column can contain NULL.
- Return expressions built with methods such as `.minus`, `.lt`, `.and`, and `.ifNull`. JavaScript `-`, `<`, `&&`, and `??` operate on the expression objects, not database values.
- Keep business assumptions explicit: currency, units, empty-value policy, and zero denominators are part of the rule.
- These helpers accept row-mode expressions. Grouped and aggregate expressions have different modes; do not use casts to force them into a row helper.
- Reusing a helper reuses its definition, not a cached database result. Its returned expression is included wherever the query uses it.
