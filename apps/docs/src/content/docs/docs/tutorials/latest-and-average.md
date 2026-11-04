---
title: Latest value and average
description: Join an entity table to per-entity stats from a fact table, showing each dog's latest temperature and 90-day average.
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
