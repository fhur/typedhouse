---
title: Simple example
description: Build a tenant report and category dashboard from one immutable query, and reason about output shapes and aggregation.
sidebar:
  order: 1
---

**Goal:** build two views of tenant activity: a bounded event report and a category dashboard. Allow about 15 minutes. This is guide **2 of 3**; start with [Getting started](/docs/getting-started/) if descriptors and expression callbacks are new.

The central idea is **reuse the rule, not the result**. A tenant-scoped query is a value you can pass to other functions and extend. It is not a fetched array or a cached database response.

## 1. Start from a reusable rule

For this guide, imagine these rows (you do not need to insert them to compile):

| tenant | category | id |
| --- | --- | --- |
| acme | purchase | 1 |
| acme | view | 2 |
| acme | purchase | 3 |
| other | purchase | 4 |

We will scope to `acme`, then branch into two independent queries. IDs are unique within a tenant; descending IDs mean **highest IDs**, not necessarily newest events.

Each checkpoint is a complete module: expand its setup and copy it together with the query. Setup repeats so you can run either checkpoint independently.

## 2. Build the report

The report needs event IDs and categories, with purchases first and deterministic ordering within each category.

<details>
<summary>Setup: imports and the events descriptor</summary>

```ts
import { col, table, from } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    tenant: col.String,
    category: col.String,
    id: col.UInt32,
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
const tenantEvents = from(events).where((e) =>
  e.tenant.eq('acme'),
);

const query = tenantEvents
  .map((e) => ({ eventId: e.id, category: e.category }))
  .orderBy((e) => e.category)
  .thenBy((e) => e.eventId.desc())
  .limit(100);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`eventId`,
  `__chql_input`.`category`
FROM
  (
    SELECT
      `id` AS `eventId`,
      `category` AS `category`
    FROM
      `events`
    WHERE
      `tenant` = {p0:String}
  ) AS `__chql_input`
ORDER BY
  `__chql_input`.`category` ASC,
  `__chql_input`.`eventId` DESC
LIMIT
  100
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

The output type is `{ eventId: number; category: string }`. With the sample data, the order is **3, 1, 2**: `purchase` sorts before `view`, then IDs descend inside each category. Tenant `other` never enters this query.

Notice two changes in the chain:

- `map` defines the **next row shape**. After renaming `id` to `eventId`, use `e.eventId`; `e.id` no longer exists.
- `thenBy` adds a tie breaker. Calling `orderBy` again on an ordered stage replaces its sort keys instead. Use `thenBy` immediately after ordering; another kind of operation ends that ordered stage.

`tenantEvents` still has all three original columns and no ordering or limit. You could derive a purchase drill-down from it with `.where(e => e.category.eq('purchase'))` without changing this report.

:::tip[Predict before you change it]
What happens if you change `.limit(100)` to `.limit(2)` and then append `.where(e => e.category.eq('view'))`?

**No rows** for this fixture: the first two report rows are purchases. To request up to two views, apply the category filter to `tenantEvents` **before** ordering and limiting.
:::

## 3. Build the dashboard

The report keeps **one row per event**. The dashboard needs **one row per category**. This change in what a row represents is often called its *grain*.

Grouping has two stages: choose the keys, then compute aggregates for each group. The keys are carried into the output automatically; give aggregate fields different names.

<details>
<summary>Setup: imports and the same events descriptor</summary>

```ts
import { col, table, from, count } from '@chql/core';
import { compile } from '@chql/compiler';

const events = table(
  'events',
  {
    tenant: col.String,
    category: col.String,
    id: col.UInt32,
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
const tenantEvents = from(events).where((e) =>
  e.tenant.eq('acme'),
);

const query = tenantEvents
  .groupBy((e) => ({ category: e.category }))
  .aggregate(() => ({ total: count() }))
  .where((e) => e.total.gt(1n))
  .orderBy((e) => e.total.desc())
  .thenBy((e) => e.category)
  .limit(10);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__chql_input`.`category` AS `category`,
  count() AS `total`
FROM
  `events` AS `__chql_input`
WHERE
  `__chql_input`.`tenant` = {p0:String}
GROUP BY
  `__chql_input`.`category`
HAVING
  `total` > {p1:UInt64}
ORDER BY
  `total` DESC,
  `category` ASC
LIMIT
  10
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "1"
}
```

<!-- generated-sql:end -->

The output type is `{ category: string; total: bigint }`. For the sample data:

1. The tenant filter leaves three events.
2. Grouping produces `purchase: 2n` and `view: 1n`.
3. The aggregate filter keeps only `{ category: 'purchase', total: 2n }`.

`1n` is a JavaScript bigint literal. `count()` produces a ClickHouse UInt64, so its decoded value is a bigint too. This avoids silently losing precision in large counts; convert or serialize deliberately at your application boundary.

Compare the two filters: the first removes **input events**; the second removes **completed groups**. The compiler can express the latter as SQL `HAVING`, but you do not need a separate query-builder method for it.

A grouped stage only exposes `aggregate`: finish it before filtering or sorting. Aggregate callbacks receive grouped expressions, not arbitrary individual rows. Use supported aggregate functions rather than selecting an ungrouped field. Empty input produces no category groups, not one row with a zero count.

:::tip[Try one change]
Change the threshold to `0n`. Predict the output before compiling.

Both categories now qualify: purchase with `2n`, then view with `1n`. Next, remove `groupBy` and aggregate directly over `tenantEvents` to request one overall count instead of per-category counts. Remove any later references to `category`: it is no longer an output field.
:::

## 4. Reuse without hidden behavior

In an application, define `tenantEvents` once and derive both queries from it. Repeating its definition here only makes the checkpoints independently runnable.

- **Immutable composition:** a new `where`, `map`, or `limit` does not mutate its input query. Pass queries across application boundaries instead of concatenating SQL fragments.
- **No automatic result sharing:** running the report and dashboard executes two queries. Shared TypeScript structure is not a database cache.
- **No automatic authorization:** a tenant-scoped base protects only the inputs that actually use it. When you add another table, scope that input too.
- **No hidden JavaScript filtering:** callbacks build expressions; ClickHouse performs the work when the client executes the query.

To inspect either checkpoint in the [playground](/playground/), keep its core imports and setup, remove the compiler import, and finish with `export default query`. For server execution, use `client.run(query)` as in [Getting started](/docs/getting-started/#execute-on-a-server).

## What you now know

You can reuse a query, follow its changing row shape, distinguish row filters from group filters, and explain why moving a limit can change the answer. Those skills matter more than memorizing method names.

**Next:** [Advanced example →](/docs/tutorials/advanced-example/) Combine current and archived events with account metadata, and track exactly what each output row counts.

For individual operations, use the [Query Builder reference](/docs/query-builder/overview/) and [Functions reference](/docs/functions/overview/).
