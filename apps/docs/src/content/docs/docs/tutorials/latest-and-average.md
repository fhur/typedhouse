---
title: Latest value and average
description: Join an entity table to per-entity stats from a fact table, then add pagination, sorting, and filtering behind one endpoint.
sidebar:
  order: 3
---

A common report joins an entity table to a summary of a fact table. Here the entities
are animals and the facts are temperature readings:
**for each dog with a recent reading, what is its current temperature and its average
over the past 90 days?**

One result row means one dog. Each input is built on its own, then the two are joined.

## Tables and predicates

`animals` has one row per animal, and `temperatures` has one row per reading.
Naming each predicate keeps the query readable and lets other queries reuse it.

```ts
import {
  argMax,
  avg,
  col,
  from,
  join,
  table,
} from '@typedhouse/core';
import type { Infer, Row } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const db = {
  animals: table(
    'animals',
    {
      id: col.UInt32,
      kind: col.LowCardinality(col.String),
      name: col.String,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['id'],
      partitionKey: [],
    },
  ),
  temperatures: table(
    'temperatures',
    {
      animalId: col.UInt32,
      value: col.Float64,
      date: col.Date,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['animalId', 'date'],
      partitionKey: [],
    },
  ),
};

// Fixed so this page's output is stable. Real code computes
// it from the current date.
const ninetyDaysAgo = new Date('2026-08-06');

function isRecentTemperature(
  t: Row<Infer<typeof db.temperatures>>,
) {
  return t.date.ge(ninetyDaysAgo);
}

function isDog(a: Row<Infer<typeof db.animals>>) {
  return a.kind.eq('dog');
}
```

## The query

`tempStats` reduces the readings to one row per animal, so the join cannot multiply
dogs. `argMax(agg.value, agg.date)` picks the value from the newest date.

```ts
const tempStats = from(db.temperatures)
  .where(isRecentTemperature)
  .groupBy((t) => t.animalId)
  .aggregate((agg) => ({
    current: argMax(agg.value, agg.date),
    avg90d: avg(agg.value),
  }));

const dogs = from(db.animals).where(isDog);

const animalsWithTemp = join({ dogs, tempStats })
  .on((r) => r.dogs.id.eq(r.tempStats.animalId))
  .map((r) => ({
    name: r.dogs.name,
    currentTemperature: r.tempStats.current,
    avgTemperature90d: r.tempStats.avg90d,
  }));

export default compile(animalsWithTemp.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `dogs`.`name` AS `name`,
  `tempStats`.`current` AS `currentTemperature`,
  `tempStats`.`avg90d` AS `avgTemperature90d`
FROM
  (
    SELECT
      `id`,
      `name`
    FROM
      `animals`
    WHERE
      `kind` = {p0:String}
  ) AS `dogs`
  INNER ALL JOIN (
    SELECT
      `__typedhouse_input`.`animalId` AS `animalId`,
      argMax(
        `__typedhouse_input`.`value`,
        `__typedhouse_input`.`date`
      ) AS `current`,
      avg(`__typedhouse_input`.`value`) AS `avg90d`
    FROM
      `temperatures` AS `__typedhouse_input`
    WHERE
      `__typedhouse_input`.`date` >= {p1:Date}
    GROUP BY
      `__typedhouse_input`.`animalId`
  ) AS `tempStats` ON `dogs`.`id` = `tempStats`.`animalId`
```

Parameters:

```json
{
  "p0": "dog",
  "p1": "2026-08-06"
}
```

<!-- generated-sql:end -->

Each filter stays with its own input in the SQL, and the date filter compares the
`date` column directly, so ClickHouse can use the sorting key.

## Which rows come back

| Dog | Readings | Result |
| --- | --- | --- |
| Rex | 39 on Nov 4, 38 on Oct 25, 37 on Aug 6, 10 on Aug 5 | current 39, average 38 |
| Fido | 40 on Oct 30, 38.5 on Nov 3 | current 38.5, average 39.25 |
| Stale | 36 on Apr 18 | no row |
| Silent | none | no row |

Rex's reading from Aug 5 is outside the window, so it does not affect the average.
Fido's current temperature is the newest reading, not the highest.

Two choices in this query decide those results:

- **`.where` applies to both aggregates.** "Current" means the newest reading inside
  the window. To report an older reading as current, remove the `.where` and use
  `avgIf(agg.value, agg.date.ge(ninetyDaysAgo))` for the average.
- **`join` is an inner join.** Dogs without a recent reading disappear. To keep them, use
  [`leftJoin`](/docs/query-builder/joins/#outer-joins), which makes both temperature
  columns `number | null`.

If two readings share the newest date, `argMax` has no stable winner. Use a more
precise column such as `DateTime64` when that matters.

## Build a table of every animal

Now let's build the backend for a table with four columns:

| Kind | Name | Avg temp | Current temp |
| --- | --- | --- | --- |

The table shows every kind of animal, not only dogs, and users can page through it, sort
it, and filter it. Each section below adds one of those features, and the last one
combines them into a single endpoint.

The first step is a query for the rows. It reuses `tempStats` and drops the dog filter.

<details>
<summary>Setup: imports, tables, and <code>tempStats</code></summary>

```ts
import {
  argMax,
  avg,
  col,
  from,
  join,
  sql,
  table,
} from '@typedhouse/core';
import type { Infer, Row } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const db = {
  animals: table(
    'animals',
    {
      id: col.UInt32,
      kind: col.LowCardinality(col.String),
      name: col.String,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['id'],
      partitionKey: [],
    },
  ),
  temperatures: table(
    'temperatures',
    {
      animalId: col.UInt32,
      value: col.Float64,
      date: col.Date,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['animalId', 'date'],
      partitionKey: [],
    },
  ),
};

const ninetyDaysAgo = new Date('2026-08-06');

function isRecentTemperature(
  t: Row<Infer<typeof db.temperatures>>,
) {
  return t.date.ge(ninetyDaysAgo);
}

const tempStats = from(db.temperatures)
  .where(isRecentTemperature)
  .groupBy((t) => t.animalId)
  .aggregate((agg) => ({
    current: argMax(agg.value, agg.date),
    avg90d: avg(agg.value),
  }));
```

</details>

```ts
const animalRows = join({
  animal: from(db.animals),
  stats: tempStats,
})
  .on((r) => r.animal.id.eq(r.stats.animalId))
  .map((r) => ({
    id: r.animal.id,
    kind: r.animal.kind,
    name: r.animal.name,
    avgTemp: r.stats.avg90d,
    currentTemp: r.stats.current,
  }));

export default compile(animalRows.ir);
```

<details>
<summary>Final SQL and parameters</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `animal`.`id` AS `id`,
  `animal`.`kind` AS `kind`,
  `animal`.`name` AS `name`,
  `stats`.`avg90d` AS `avgTemp`,
  `stats`.`current` AS `currentTemp`
FROM
  `animals` AS `animal`
  INNER ALL JOIN (
    SELECT
      `__typedhouse_input`.`animalId` AS `animalId`,
      argMax(
        `__typedhouse_input`.`value`,
        `__typedhouse_input`.`date`
      ) AS `current`,
      avg(`__typedhouse_input`.`value`) AS `avg90d`
    FROM
      `temperatures` AS `__typedhouse_input`
    WHERE
      `__typedhouse_input`.`date` >= {p0:Date}
    GROUP BY
      `__typedhouse_input`.`animalId`
  ) AS `stats` ON `animal`.`id` = `stats`.`animalId`
```

Parameters:

```json
{
  "p0": "2026-08-06"
}
```

<!-- generated-sql:end -->

</details>

`id` is not a visible column, but the next sections use it to keep the row order stable.

## Add pagination

A page needs a defined order, so sort by `id` for now. `limit(count, offset)` then
selects the page's rows.

<details>
<summary>Setup: everything so far</summary>

```ts
import {
  argMax,
  avg,
  col,
  from,
  join,
  sql,
  table,
} from '@typedhouse/core';
import type { Infer, Row } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const db = {
  animals: table(
    'animals',
    {
      id: col.UInt32,
      kind: col.LowCardinality(col.String),
      name: col.String,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['id'],
      partitionKey: [],
    },
  ),
  temperatures: table(
    'temperatures',
    {
      animalId: col.UInt32,
      value: col.Float64,
      date: col.Date,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['animalId', 'date'],
      partitionKey: [],
    },
  ),
};

const ninetyDaysAgo = new Date('2026-08-06');

function isRecentTemperature(
  t: Row<Infer<typeof db.temperatures>>,
) {
  return t.date.ge(ninetyDaysAgo);
}

const tempStats = from(db.temperatures)
  .where(isRecentTemperature)
  .groupBy((t) => t.animalId)
  .aggregate((agg) => ({
    current: argMax(agg.value, agg.date),
    avg90d: avg(agg.value),
  }));

const animalRows = join({
  animal: from(db.animals),
  stats: tempStats,
})
  .on((r) => r.animal.id.eq(r.stats.animalId))
  .map((r) => ({
    id: r.animal.id,
    kind: r.animal.kind,
    name: r.animal.name,
    avgTemp: r.stats.avg90d,
    currentTemp: r.stats.current,
  }));
```

</details>

```ts
type Page = { number: number; size: number }; // number starts at 1

function pageOfAnimals(page: Page) {
  return animalRows
    .orderBy((r) => r.id)
    .limit(page.size, (page.number - 1) * page.size);
}

// The UI also needs the total to render its page controls.
const total = animalRows.count();

export default compile(
  pageOfAnimals({ number: 2, size: 20 }).ir,
);
```

<details>
<summary>Final SQL and parameters</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id`,
  `__typedhouse_input`.`kind`,
  `__typedhouse_input`.`name`,
  `__typedhouse_input`.`avgTemp`,
  `__typedhouse_input`.`currentTemp`
FROM
  (
    SELECT
      `animal`.`id` AS `id`,
      `animal`.`kind` AS `kind`,
      `animal`.`name` AS `name`,
      `stats`.`avg90d` AS `avgTemp`,
      `stats`.`current` AS `currentTemp`
    FROM
      `animals` AS `animal`
      INNER ALL JOIN (
        SELECT
          `__typedhouse_input`.`animalId` AS `animalId`,
          argMax(
            `__typedhouse_input`.`value`,
            `__typedhouse_input`.`date`
          ) AS `current`,
          avg(`__typedhouse_input`.`value`) AS `avg90d`
        FROM
          `temperatures` AS `__typedhouse_input`
        WHERE
          `__typedhouse_input`.`date` >= {p0:Date}
        GROUP BY
          `__typedhouse_input`.`animalId`
      ) AS `stats` ON `animal`.`id` = `stats`.`animalId`
  ) AS `__typedhouse_input`
ORDER BY
  `__typedhouse_input`.`id` ASC
LIMIT
  20 OFFSET 20
```

Parameters:

```json
{
  "p0": "2026-08-06"
}
```

<!-- generated-sql:end -->

</details>

## Add sorting

The request now names a column and a direction. Both are checked against the columns
of `animalRows`, so sorting by a column that does not exist is a compile error.

<details>
<summary>Setup: everything so far</summary>

```ts
import {
  argMax,
  avg,
  col,
  from,
  join,
  sql,
  table,
} from '@typedhouse/core';
import type { Infer, Row } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const db = {
  animals: table(
    'animals',
    {
      id: col.UInt32,
      kind: col.LowCardinality(col.String),
      name: col.String,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['id'],
      partitionKey: [],
    },
  ),
  temperatures: table(
    'temperatures',
    {
      animalId: col.UInt32,
      value: col.Float64,
      date: col.Date,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['animalId', 'date'],
      partitionKey: [],
    },
  ),
};

const ninetyDaysAgo = new Date('2026-08-06');

function isRecentTemperature(
  t: Row<Infer<typeof db.temperatures>>,
) {
  return t.date.ge(ninetyDaysAgo);
}

const tempStats = from(db.temperatures)
  .where(isRecentTemperature)
  .groupBy((t) => t.animalId)
  .aggregate((agg) => ({
    current: argMax(agg.value, agg.date),
    avg90d: avg(agg.value),
  }));

const animalRows = join({
  animal: from(db.animals),
  stats: tempStats,
})
  .on((r) => r.animal.id.eq(r.stats.animalId))
  .map((r) => ({
    id: r.animal.id,
    kind: r.animal.kind,
    name: r.animal.name,
    avgTemp: r.stats.avg90d,
    currentTemp: r.stats.current,
  }));
```

</details>

```ts
type Page = { number: number; size: number }; // number starts at 1

type Sort = {
  column: 'kind' | 'name' | 'avgTemp' | 'currentTemp';
  direction: 'asc' | 'desc';
};

function pageOfAnimals(page: Page, sort: Sort) {
  return animalRows
    .orderBy((r) => r[sort.column][sort.direction]())
    .thenBy((r) => r.id)
    .limit(page.size, (page.number - 1) * page.size);
}

export default compile(
  pageOfAnimals(
    { number: 2, size: 20 },
    { column: 'avgTemp', direction: 'desc' },
  ).ir,
);
```

<details>
<summary>Final SQL and parameters</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id`,
  `__typedhouse_input`.`kind`,
  `__typedhouse_input`.`name`,
  `__typedhouse_input`.`avgTemp`,
  `__typedhouse_input`.`currentTemp`
FROM
  (
    SELECT
      `animal`.`id` AS `id`,
      `animal`.`kind` AS `kind`,
      `animal`.`name` AS `name`,
      `stats`.`avg90d` AS `avgTemp`,
      `stats`.`current` AS `currentTemp`
    FROM
      `animals` AS `animal`
      INNER ALL JOIN (
        SELECT
          `__typedhouse_input`.`animalId` AS `animalId`,
          argMax(
            `__typedhouse_input`.`value`,
            `__typedhouse_input`.`date`
          ) AS `current`,
          avg(`__typedhouse_input`.`value`) AS `avg90d`
        FROM
          `temperatures` AS `__typedhouse_input`
        WHERE
          `__typedhouse_input`.`date` >= {p0:Date}
        GROUP BY
          `__typedhouse_input`.`animalId`
      ) AS `stats` ON `animal`.`id` = `stats`.`animalId`
  ) AS `__typedhouse_input`
ORDER BY
  `__typedhouse_input`.`avgTemp` DESC,
  `__typedhouse_input`.`id` ASC
LIMIT
  20 OFFSET 20
```

Parameters:

```json
{
  "p0": "2026-08-06"
}
```

<!-- generated-sql:end -->

</details>

`thenBy` keeps the order the same between requests. Many animals share a kind, and
without a tiebreaker a row could appear on two pages or on none.

## Add filtering

Each filter is optional, so `filterAnimals` adds a `where` only for the filters that are
present. Because these filters run on `animalRows`, `avgTempGt` compares against the
finished average. Readings below the threshold still count toward it.

`pageOfAnimals` now takes the rows as an argument, because the rows depend on the filters.

<details>
<summary>Setup: everything so far</summary>

```ts
import {
  argMax,
  avg,
  col,
  from,
  join,
  sql,
  table,
} from '@typedhouse/core';
import type { Infer, Row } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const db = {
  animals: table(
    'animals',
    {
      id: col.UInt32,
      kind: col.LowCardinality(col.String),
      name: col.String,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['id'],
      partitionKey: [],
    },
  ),
  temperatures: table(
    'temperatures',
    {
      animalId: col.UInt32,
      value: col.Float64,
      date: col.Date,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['animalId', 'date'],
      partitionKey: [],
    },
  ),
};

const ninetyDaysAgo = new Date('2026-08-06');

function isRecentTemperature(
  t: Row<Infer<typeof db.temperatures>>,
) {
  return t.date.ge(ninetyDaysAgo);
}

const tempStats = from(db.temperatures)
  .where(isRecentTemperature)
  .groupBy((t) => t.animalId)
  .aggregate((agg) => ({
    current: argMax(agg.value, agg.date),
    avg90d: avg(agg.value),
  }));

const animalRows = join({
  animal: from(db.animals),
  stats: tempStats,
})
  .on((r) => r.animal.id.eq(r.stats.animalId))
  .map((r) => ({
    id: r.animal.id,
    kind: r.animal.kind,
    name: r.animal.name,
    avgTemp: r.stats.avg90d,
    currentTemp: r.stats.current,
  }));

type Page = { number: number; size: number }; // number starts at 1

type Sort = {
  column: 'kind' | 'name' | 'avgTemp' | 'currentTemp';
  direction: 'asc' | 'desc';
};

function pageOfAnimals(
  rows: typeof animalRows,
  page: Page,
  sort: Sort,
) {
  return rows
    .orderBy((r) => r[sort.column][sort.direction]())
    .thenBy((r) => r.id)
    .limit(page.size, (page.number - 1) * page.size);
}
```

</details>

```ts
type Filters = {
  nameContains?: string;
  kindIn?: string[];
  avgTempGt?: number;
  tempGt?: number;
};

function filterAnimals({
  nameContains,
  kindIn,
  avgTempGt,
  tempGt,
}: Filters) {
  let rows = animalRows;
  if (nameContains !== undefined) {
    rows = rows.where((r) =>
      sql`positionCaseInsensitiveUTF8(${r.name}, ${nameContains}) > 0`.as(
        col.Bool,
      ),
    );
  }
  if (kindIn !== undefined) {
    rows = rows.where((r) => r.kind.in(kindIn));
  }
  if (avgTempGt !== undefined) {
    rows = rows.where((r) => r.avgTemp.gt(avgTempGt));
  }
  if (tempGt !== undefined) {
    rows = rows.where((r) => r.currentTemp.gt(tempGt));
  }
  return rows;
}

export default compile(
  pageOfAnimals(
    filterAnimals({ kindIn: ['dog', 'cat'], tempGt: 38 }),
    { number: 1, size: 20 },
    { column: 'name', direction: 'asc' },
  ).ir,
);
```

<details>
<summary>Final SQL and parameters</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id`,
  `__typedhouse_input`.`kind`,
  `__typedhouse_input`.`name`,
  `__typedhouse_input`.`avgTemp`,
  `__typedhouse_input`.`currentTemp`
FROM
  (
    SELECT
      `__typedhouse_input`.`id`,
      `__typedhouse_input`.`kind`,
      `__typedhouse_input`.`name`,
      `__typedhouse_input`.`avgTemp`,
      `__typedhouse_input`.`currentTemp`
    FROM
      (
        SELECT
          `animal`.`id` AS `id`,
          `animal`.`kind` AS `kind`,
          `animal`.`name` AS `name`,
          `stats`.`avg90d` AS `avgTemp`,
          `stats`.`current` AS `currentTemp`
        FROM
          `animals` AS `animal`
          INNER ALL JOIN (
            SELECT
              `__typedhouse_input`.`animalId` AS `animalId`,
              argMax(
                `__typedhouse_input`.`value`,
                `__typedhouse_input`.`date`
              ) AS `current`,
              avg(`__typedhouse_input`.`value`) AS `avg90d`
            FROM
              `temperatures` AS `__typedhouse_input`
            WHERE
              `__typedhouse_input`.`date` >= {p0:Date}
            GROUP BY
              `__typedhouse_input`.`animalId`
          ) AS `stats` ON `animal`.`id` = `stats`.`animalId`
      ) AS `__typedhouse_input`
    WHERE
      in (`__typedhouse_input`.`kind`, {p1:Array(String)})
  ) AS `__typedhouse_input`
WHERE
  `__typedhouse_input`.`currentTemp` > {p2:Float64}
ORDER BY
  `__typedhouse_input`.`name` ASC,
  `__typedhouse_input`.`id` ASC
LIMIT
  20 OFFSET 0
```

Parameters:

```json
{
  "p0": "2026-08-06",
  "p1": "['dog','cat']",
  "p2": "38"
}
```

<!-- generated-sql:end -->

</details>

The builder has no case-insensitive "contains" method, so `nameContains` uses a `sql`
expression. Its value is still sent as a parameter. Each `where` becomes its own subquery in the SQL.

## Put it behind one endpoint

The endpoint takes the page, filters, and sort from one request, and runs two queries:
one for the page's rows and one for the total. Both use the same filters.

<details>
<summary>Setup: everything so far</summary>

```ts
import {
  argMax,
  avg,
  col,
  from,
  join,
  sql,
  table,
} from '@typedhouse/core';
import type { Infer, Row } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import type { createClient } from '@typedhouse/client';

const db = {
  animals: table(
    'animals',
    {
      id: col.UInt32,
      kind: col.LowCardinality(col.String),
      name: col.String,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['id'],
      partitionKey: [],
    },
  ),
  temperatures: table(
    'temperatures',
    {
      animalId: col.UInt32,
      value: col.Float64,
      date: col.Date,
    },
    {
      engine: 'MergeTree',
      sortingKey: ['animalId', 'date'],
      partitionKey: [],
    },
  ),
};

const ninetyDaysAgo = new Date('2026-08-06');

function isRecentTemperature(
  t: Row<Infer<typeof db.temperatures>>,
) {
  return t.date.ge(ninetyDaysAgo);
}

const tempStats = from(db.temperatures)
  .where(isRecentTemperature)
  .groupBy((t) => t.animalId)
  .aggregate((agg) => ({
    current: argMax(agg.value, agg.date),
    avg90d: avg(agg.value),
  }));

const animalRows = join({
  animal: from(db.animals),
  stats: tempStats,
})
  .on((r) => r.animal.id.eq(r.stats.animalId))
  .map((r) => ({
    id: r.animal.id,
    kind: r.animal.kind,
    name: r.animal.name,
    avgTemp: r.stats.avg90d,
    currentTemp: r.stats.current,
  }));

type Page = { number: number; size: number }; // number starts at 1

type Sort = {
  column: 'kind' | 'name' | 'avgTemp' | 'currentTemp';
  direction: 'asc' | 'desc';
};

function pageOfAnimals(
  rows: typeof animalRows,
  page: Page,
  sort: Sort,
) {
  return rows
    .orderBy((r) => r[sort.column][sort.direction]())
    .thenBy((r) => r.id)
    .limit(page.size, (page.number - 1) * page.size);
}

type Filters = {
  nameContains?: string;
  kindIn?: string[];
  avgTempGt?: number;
  tempGt?: number;
};

function filterAnimals({
  nameContains,
  kindIn,
  avgTempGt,
  tempGt,
}: Filters) {
  let rows = animalRows;
  if (nameContains !== undefined) {
    rows = rows.where((r) =>
      sql`positionCaseInsensitiveUTF8(${r.name}, ${nameContains}) > 0`.as(
        col.Bool,
      ),
    );
  }
  if (kindIn !== undefined) {
    rows = rows.where((r) => r.kind.in(kindIn));
  }
  if (avgTempGt !== undefined) {
    rows = rows.where((r) => r.avgTemp.gt(avgTempGt));
  }
  if (tempGt !== undefined) {
    rows = rows.where((r) => r.currentTemp.gt(tempGt));
  }
  return rows;
}
```

</details>

```ts
export type AnimalTableRequest = {
  page: Page;
  filters: Filters;
  sort: Sort;
};

export async function getAnimalTable(
  client: ReturnType<typeof createClient>,
  { page, filters, sort }: AnimalTableRequest,
) {
  const rows = filterAnimals(filters);
  const [pageRows, [total]] = await Promise.all([
    client.run(pageOfAnimals(rows, page, sort)),
    client.run(rows.count()),
  ]);
  // count() is a bigint, which JSON.stringify rejects.
  return {
    rows: pageRows,
    total: Number(total?.count ?? 0),
  };
}

const request: AnimalTableRequest = {
  page: { number: 2, size: 20 },
  filters: { nameContains: 'rex', avgTempGt: 38 },
  sort: { column: 'avgTemp', direction: 'desc' },
};

export default compile(
  pageOfAnimals(
    filterAnimals(request.filters),
    request.page,
    request.sort,
  ).ir,
);
```

<details>
<summary>Final SQL and parameters for the page query</summary>

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`id`,
  `__typedhouse_input`.`kind`,
  `__typedhouse_input`.`name`,
  `__typedhouse_input`.`avgTemp`,
  `__typedhouse_input`.`currentTemp`
FROM
  (
    SELECT
      `__typedhouse_input`.`id`,
      `__typedhouse_input`.`kind`,
      `__typedhouse_input`.`name`,
      `__typedhouse_input`.`avgTemp`,
      `__typedhouse_input`.`currentTemp`
    FROM
      (
        SELECT
          `animal`.`id` AS `id`,
          `animal`.`kind` AS `kind`,
          `animal`.`name` AS `name`,
          `stats`.`avg90d` AS `avgTemp`,
          `stats`.`current` AS `currentTemp`
        FROM
          `animals` AS `animal`
          INNER ALL JOIN (
            SELECT
              `__typedhouse_input`.`animalId` AS `animalId`,
              argMax(
                `__typedhouse_input`.`value`,
                `__typedhouse_input`.`date`
              ) AS `current`,
              avg(`__typedhouse_input`.`value`) AS `avg90d`
            FROM
              `temperatures` AS `__typedhouse_input`
            WHERE
              `__typedhouse_input`.`date` >= {p0:Date}
            GROUP BY
              `__typedhouse_input`.`animalId`
          ) AS `stats` ON `animal`.`id` = `stats`.`animalId`
      ) AS `__typedhouse_input`
    WHERE
      (
        positionCaseInsensitiveUTF8((`__typedhouse_input`.`name`), ({p1:String})) > 0
      )
  ) AS `__typedhouse_input`
WHERE
  `__typedhouse_input`.`avgTemp` > {p2:Float64}
ORDER BY
  `__typedhouse_input`.`avgTemp` DESC,
  `__typedhouse_input`.`id` ASC
LIMIT
  20 OFFSET 20
```

Parameters:

```json
{
  "p0": "2026-08-06",
  "p1": "rex",
  "p2": "38"
}
```

<!-- generated-sql:end -->

</details>
