---
title: Rollups and materialized views
description: Read AggregatingMergeTree rollups and materialized views with -Merge functions.
sidebar:
  order: 15
---

A rollup table stores aggregate states, not finished values. It usually has a materialized view writing into it:

```sql
CREATE TABLE daily_totals (
  day Date,
  page String,
  views AggregateFunction(sum, UInt64),
  visitors AggregateFunction(uniq, String),
  latency AggregateFunction(quantile(0.9), Float64)
) ENGINE = AggregatingMergeTree ORDER BY (day, page);

CREATE MATERIALIZED VIEW daily_totals_mv TO daily_totals AS
SELECT
  toDate(at) AS day,
  page,
  sumState(toUInt64(1)) AS views,
  uniqState(visitor) AS visitors,
  quantileState(0.9)(latency_ms) AS latency
FROM page_views
GROUP BY day, page;
```

TypedHouse does not create these tables, but `typedhouse generate` describes them, and every column above becomes a `col.AggregateFunction(...)` descriptor. Read them with the matching [`-Merge` function](/docs/functions/state-merge/).

## Reading a rollup

Group again and merge. A part holds one row per key until a background merge combines them, so a rollup always needs its `GROUP BY`, even though the table is sorted by the same key.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  quantileMerge,
  sumMerge,
  table,
  uniqMerge,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const dailyTotals = table(
  'daily_totals',
  {
    day: col.Date,
    page: col.String,
    views: col.AggregateFunction('sum', col.UInt64),
    visitors: col.AggregateFunction('uniq', col.String),
    latency: col.AggregateFunction(
      'quantile(0.9)',
      col.Float64,
    ),
  },
  {
    engine: 'AggregatingMergeTree',
    sortingKey: ['day', 'page'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(dailyTotals)
  .where((row) => row.page.eq('/pricing'))
  .groupBy((row) => row.day)
  .aggregate((group) => ({
    views: sumMerge(group.views),
    visitors: uniqMerge(group.visitors),
    p90: quantileMerge(0.9)(group.latency),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`day` AS `day`,
  sumMerge (`__typedhouse_input`.`views`) AS `views`,
  uniqMerge (`__typedhouse_input`.`visitors`) AS `visitors`,
  quantileMerge ({p0:Float64}) (`__typedhouse_input`.`latency`) AS `p90`
FROM
  (
    SELECT
      `day`,
      `views`,
      `visitors`,
      `latency`
    FROM
      `daily_totals`
    WHERE
      `page` = {p1:String}
  ) AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`day`
```

Parameters:

```json
{
  "p0": "0.9",
  "p1": "/pricing"
}
```

<!-- generated-sql:end -->

The result is `{ day: Date; views: bigint; visitors: bigint; p90: number }`. `final()` and `prewhere()` work on a rollup as on any table, and the materialized view itself reads the same way as its `TO` table.

## The merge level decides

`quantileMerge` takes a level, and that level decides the result. The level stored in the state does not: a state built at `0.9` gives the 90th percentile from `quantileMerge(0.9)` and the 10th from `quantileMerge(0.1)`. ClickHouse's own `quantileMerge` with no level would silently give the median, which is why the level is required here.

The exception is a state over a `Nullable` input. The server wraps its function, then accepts only the stored level and raises code 43 for any other, so the compiler raises `invalid_merge_state` first. This means `AggregateFunction(quantile, Nullable(T))`, with no stored level, cannot be read through `quantileMerge`; use `agg` from a hand-written catalog, whose calls carry no level.

The comparison includes how the level is written. `quantileMerge` sends its level as a `Float64` parameter, which the server spells `1.`, so a nullable column declared `AggregateFunction(quantile(1), Nullable(Float64))` or `quantile(0)` raises `invalid_merge_state` at every level and has no merge through the typed API. A column declared `quantile(1.)` merges with `quantileMerge(1)`, and a non-nullable `quantile(1)` merges at any level. The same applies to `quantileExact`. `finalizeAggregation` still reads such a column, row by row.

## Computing states in a query

States can be built and merged within one query, or pass through any intermediate node: a map, a subquery, a CTE, `unionAll`, or a join input. An unmatched row of a `leftJoin` keeps the default state, which merges to `0`.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import {
  col,
  from,
  sumMerge,
  sumState,
  table,
  unionAll,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const rollup = table(
  'daily_totals',
  {
    page: col.String,
    views: col.AggregateFunction('sum', col.UInt64),
  },
  {
    engine: 'AggregatingMergeTree',
    sortingKey: ['page'],
    partitionKey: [],
  },
);

const pageViews = table(
  'page_views',
  { page: col.String, hits: col.UInt64 },
  {
    engine: 'MergeTree',
    sortingKey: ['page'],
    partitionKey: [],
  },
);
```

</details>

```ts
// History from the rollup, plus rows the view has not seen.
const fresh = from(pageViews)
  .groupBy((row) => row.page)
  .aggregate((group) => ({
    views: sumState(group.hits),
  }));

const query = unionAll(from(rollup), fresh)
  .groupBy((row) => row.page)
  .aggregate((group) => ({
    views: sumMerge(group.views),
  }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`page` AS `page`,
  sumMerge (`__typedhouse_input`.`views`) AS `views`
FROM
  (
    SELECT
      `__typedhouse_input`.`page` AS `page`,
      `__typedhouse_input`.`views` AS `views`
    FROM
      (
        SELECT
          `page`,
          `views`
        FROM
          `daily_totals`
      ) AS `__typedhouse_input`
    UNION ALL
    SELECT
      `__typedhouse_input`.`page` AS `page`,
      `__typedhouse_input`.`views` AS `views`
    FROM
      (
        SELECT
          `__typedhouse_input`.`page` AS `page`,
          sumState (`__typedhouse_input`.`hits`) AS `views`
        FROM
          `page_views` AS `__typedhouse_input`
        GROUP BY
          `__typedhouse_input`.`page`
      ) AS `__typedhouse_input`
  ) AS `__typedhouse_input`
GROUP BY
  `__typedhouse_input`.`page`
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

## Rules

- **A raw state cannot be selected.** A state returned to the client is binary in a JSON string, and invalid UTF-8 is lost. `from(rollup)` alone, a `sumState` at the top of a query, and a scalar or set subquery returning a state raise `aggregate_state_selection`. So does a state nested in an `Array`, `Tuple`, `Map` or other container, or in a type TypedHouse cannot model, such as `AggregateFunction(uniq, Point)`, and reading such a column raises `aggregate_state_operand`. A `Dynamic` column holding a state is not caught, because its type says nothing about its contents, and it returns binary. Read a plain column with `map`, or merge.
- **A state has no comparable value.** The server accepts `WHERE total = total`, `ORDER BY total`, `GROUP BY total`, `DISTINCT` over a state and `uniqExact(total)`, but their results depend on binary state contents. A typed expression, sort key, `limitBy` key, group key or nested `distinct` reading a state raises `aggregate_state_operand`.
- **Only the same function merges.** `maxMerge` of a `sum` state raises `invalid_merge_state`. So does a state whose stored arguments the typed function does not accept, such as `AggregateFunction(avg, Decimal(18, 2))`. `countMerge`, `uniqMerge` and `uniqExactMerge` are the exception: their result is always `UInt64`, so they read any stored arguments the server allows, including `AggregateFunction(uniq, UInt64)` and `AggregateFunction(uniq, String, UInt64)`. Known functions are exempt, because their result is the caller's declaration, and they are the only way to merge a state in a type TypedHouse cannot model: `agg.uniqMerge(row.col).as(col.UInt64)` from a hand-written catalog reads `AggregateFunction(uniq, Point)`.
- **`finalizeAggregation` is per row.** It finalizes each stored row before any merge, so a rollup with 3 parts' rows for 2 days gives 3 rows, not 2. Reach it through the `fn` of [known functions](/docs/functions/overview/) or a trusted `sql` snippet, and use it only when you mean that.
- **The result matches the base function.** `sumMerge` over `UInt32` gives `UInt64`, over `Nullable(UInt32)` gives `Nullable(UInt64)`, and over `Decimal(18, 2)` gives `Decimal(38, 2)`. On empty input, `sumMerge`, `countMerge` and `uniqMerge` give 0, `maxMerge` over a nullable state gives NULL, and `avgMerge` gives NaN.
- **`LowCardinality` is dropped.** `maxState` over `LowCardinality(String)` has the type `AggregateFunction(max, String)`, at every depth: `Array(LowCardinality(String))` is stored as `Array(String)`. The merged result follows.
- **`HAVING` on a merged column.** A rollup's merge usually reuses the column's name: `sumMerge(group.views)` under `views`. Under `prefer_column_name_to_alias = 1`, a `HAVING views > 0` written by hand raises code 43, because the name binds the state; the compiler opens a derived table for that filter.
