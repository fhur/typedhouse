---
title: final / sample / prewhere
description: Apply FINAL, SAMPLE and PREWHERE directly to table scans.
sidebar:
  order: 7
---

`final`, `sample` and `prewhere` are scan-only modifiers. Apply them immediately after `from`, before `where`, `map`, or other general query operations, which drop scan-only methods. `prewhere` comes last, because it returns an ordinary query.

## Example

Request `FINAL` for a ReplacingMergeTree table. The engine performs its query-time merge behavior; the query retains the scan's row shape.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    category: col.String,
  },
  {
    engine: 'ReplacingMergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(events).final();

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `category`
FROM
  `events` FINAL
```

Parameters:

```json
{}
```

<!-- generated-sql:end -->

Use `FINAL` only with an appropriate engine and actual table configuration. It can add execution cost and does not generally resolve tied versions deterministically.

`sample(fraction)` requests ClickHouse sampling with a finite fraction in `(0, 1]`. Execution requires an actual table with a suitable sampling key; adding a descriptor does not configure one. SAMPLE is emitted after FINAL when both are requested, with the fraction inline rather than as an expression parameter.

## Filter early with prewhere

`prewhere(predicate)` emits ClickHouse `PREWHERE`, which reads the predicate's columns first and skips the rest of a filtered row. It takes the same predicate as `where`. It is explicit: the compiler never turns a `where` into one, and never moves, splits, reorders or drops one. ClickHouse can still move a `where` into its own `PREWHERE` step when `optimize_move_to_prewhere` allows it, so add this only when you want that choice to be yours.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    tenant: col.String,
    category: col.String,
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
const query = from(events)
  .prewhere((e) => e.tenant.eq('acme'))
  .where((e) => e.category.eq('sale'));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`,
  `tenant`,
  `category`
FROM
  `events` AS `__typedhouse_input`
PREWHERE
  `__typedhouse_input`.`tenant` = {p0:String}
WHERE
  `category` = {p1:String}
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "sale"
}
```

<!-- generated-sql:end -->

:::caution[`final().prewhere()` filters before merging]
Under `final()`, `PREWHERE` runs before the merge and `WHERE` runs after it. A predicate on a non-key column can therefore return a stale row version that the merge would have replaced.

Take a `ReplacingMergeTree` table `r` ordered by `id`, with `ver` as its version column and these unmerged rows:

| `id` | `ver` | `status` |
| --- | --- | --- |
| 1 | 1 | `open` |
| 1 | 2 | `closed` |
| 2 | 1 | `open` |

The latest version of `id` 1 is `closed`, so only `id` 2 is currently open.

| Query | Rows returned |
| --- | --- |
| `from(r).final().where((x) => x.status.eq('open'))` | `(2, 1, 'open')` |
| `from(r).final().prewhere((x) => x.status.eq('open'))` | `(1, 1, 'open')`, `(2, 1, 'open')` |

The stale `(1, 1, 'open')` comes back because `PREWHERE` removed the row that would have replaced it. Use `where()` to filter after merging. The compiler allows this form and raises no error. In our tests on ClickHouse 24.8, predicates that read only sorting-key columns matched `where()`.
:::

Under `final()` and `sample()` the clauses print as `FROM t FINAL SAMPLE f PREWHERE p WHERE q`, with any `ARRAY JOIN` before `PREWHERE`.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';

const events = table(
  'events',
  {
    id: col.UInt32,
    category: col.String,
  },
  {
    engine: 'ReplacingMergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  },
);
```

</details>

```ts
const query = from(events)
  .final()
  .sample(0.1)
  .prewhere((e) => e.id.gt(100))
  .map((e) => ({ id: e.id }));

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `id`
FROM
  `events` AS `__typedhouse_input` FINAL
SAMPLE
  0.1
PREWHERE
  `__typedhouse_input`.`id` > {p0:UInt32}
```

Parameters:

```json
{
  "p0": "100"
}
```

<!-- generated-sql:end -->

### Rules

- **Where it attaches.** Only directly on a table: after `from`, `final` or `sample`. It is a type error after `where`, `map` or any other operator, on a join or union, and a second time. To filter one side of a join, use `join({ a: from(t).prewhere(p), b: from(u) })`, which renders that side as a derived table.
- **Engines.** The compiler does not check them. On ClickHouse 24.8 it worked on the MergeTree family, Merge, Distributed, Buffer and a materialized view with `TO`. Memory, Log, View and `numbers()` reject it with code 182 (`ILLEGAL_PREWHERE`), which surfaces as a `QueryError`.
- **Failing expressions.** The clause runs on the table's rows before anything else in its SELECT. In our tests on 24.8, a guard in `prewhere` protected a cast in a later `where`, select item, grouping key or aggregate, and a cast in `prewhere` failed even under a guard in `where`. Inside one predicate, order mattered when both conjuncts read the same column: `s != 'bad' AND toUInt32(s) > 0` passed and the reverse failed. A guard on a different column was not reliable, in either order: with the same rows, `id < 13 AND toUInt32(s) > 0` returned rows or failed with code 6 depending on how the rows were split into parts and on `index_granularity`, even though `id < 13` excludes every failing row. A guard in `prewhere` with the cast in `where` passed on every shape we tried. These are observations on 24.8, not a server guarantee.
- **Live queries.** A query with `prewhere` is not live.
