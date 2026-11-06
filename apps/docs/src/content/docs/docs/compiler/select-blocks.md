---
title: Fold SELECT blocks
description: Emit compatible relational operations together in one SELECT.
sidebar:
  order: 9
---

The compiler avoids a derived table for every relational step when SQL clause order can express the same meaning:

- **Scan blocks:** compatible filters, direct selections, sorting, `LIMIT BY`, and limits become one SELECT. Direct renames and safe integer arithmetic projections can also fold over a scan and its filters. Consecutive filters share one `WHERE` (or `HAVING`) only when every predicate is in the total fragment that `MergeFilter` merges; a filter outside it (a cast, a known function or SQL snippet, a Float comparison) that follows other filters keeps its own SELECT over them, and so does a total filter that follows it, because the server evaluates the conjuncts of one clause in its own order (`PREWHERE`, push-down below a join) and a failing predicate must only ever see the rows the earlier filters pass. The first filter of a block always folds. One server-side caveat is outside the compiler's control: ClickHouse itself may lift a `WHERE` that does not depend on an `ARRAY JOIN` alias above the expansion step (`query_plan_lift_up_array_join`), so under the default settings a fallible filter written after an expansion is evaluated before it in both the compiled and the nested form.
- **CTE references:** same-name column selections, filters, sorting, and limits can read directly from a CTE without wrapping its reference in an extra SELECT. The CTE definition remains a separate scope.
- **Aggregate blocks:** eligible source filters, grouping, group-result filters, ordering, `LIMIT BY`, and limits become `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT ... BY`, and `LIMIT`/`OFFSET`.
- **Join-backed blocks:** supported inner, cross and binary outer joins can appear directly in SELECT or aggregate blocks. Join conditions in this envelope use direct column equalities; aggregate aliases that could capture input columns retain a separate scope. An [ASOF join](/docs/query-builder/joins/#asof-joins) folds the same way when its equalities and its inequality are direct columns, with the inequality last in `ON`; a computed operand keeps its inputs in a nested SELECT. A `where` folded over it stays a `WHERE` above the join, because ClickHouse 24.3, 24.8 and 26.10 push neither input's conjunct below `ASOF`, and because a right-side filter would change the match.
- **DISTINCT:** `distinct()` sets the `DISTINCT` flag of the current block when the block has no `ORDER BY` or `LIMIT` yet, including aggregate blocks (`SELECT DISTINCT category, count() … GROUP BY category`). Sorting and limiting after it fold into the same block, and so does a selection of the whole row (every column under its own name, in any order); a filter, a narrower or computed selection, or an aggregation after it opens a new one, because `WHERE` precedes `DISTINCT` in SQL. The select list of a distinct block is always the full input row.
- **LIMIT BY:** `limitBy(...).take(...)` folds between `ORDER BY` and `LIMIT`, the only clause order ClickHouse accepts, over scan, join, expanded, CTE-reference and aggregate blocks, and after a `DISTINCT`, whose select list stays the full input row. Anything out of that order opens a new SELECT: `limit` then `limitBy`, `limitBy` then `orderBy`, two `limitBy` calls, and `limitBy` then `where` or `distinct`. No rewrite rule moves a filter across it, because a filter on a retained row is not a filter on the input. Over a computed or renamed selection it reads a derived table, since `v % 2 AS k ... LIMIT 1 BY k` binds the alias. Over an aggregate a key must be a plain output column, otherwise it nests too.
- **PREWHERE:** the compiler emits `PREWHERE` only for an explicit [`prewhere()`](/docs/query-builder/prewhere/). It never turns a `where` into one, never moves one, and never merges, splits or reorders its predicate. It belongs to its physical-table scan, so it stays in that scan's SELECT, after `FINAL`, `SAMPLE` and `ARRAY JOIN` and before `WHERE`, whatever folds on top. A join input with `prewhere()` is a derived table, and so is a CTE definition that holds one. A `Scan` shared with other consumers can become a CTE, but `PREWHERE` always reads the table itself, because ClickHouse rejects it over a subquery or a CTE (code 182). The predicate is written with a qualified column, and a computed alias or an expansion alias equal to a column it reads keeps its own SELECT. A predicate outside the total fragment fences the join rewrites above it. No rewrite rule crosses the node.
- **ARRAY JOIN:** one `arrayJoin`/`leftArrayJoin` folds directly after a physical-table `FROM` (after `FINAL` and `SAMPLE`) as `ARRAY JOIN expr AS alias`, with the alias usable as a plain column by the rest of the block. It folds when the block has no expansion, selection, aggregate or `DISTINCT` yet and every earlier filter is a safe predicate, or the expansion is `LEFT` and every earlier filter is deterministic (no raw SQL, volatile call or subquery): an inner `ARRAY JOIN` drops empty-array rows before `WHERE`, so a filter that could fail keeps its own scope under it, and a volatile filter is never re-evaluated per expanded row. An aggregate over the expanded block folds too (`SELECT partId, count() FROM t ARRAY JOIN ids AS partId WHERE … GROUP BY partId`); that block is written without an input alias so the expansion alias and the source columns resolve alike. ClickHouse allows one `ARRAY JOIN` per `SELECT`; a second expansion, a CTE reference or a derived table keeps a derived table.

Consecutive filters share a `WHERE` only when both predicates belong to the compiler's closed total fragment and the subtree below them has no fallible computation. A single `where(a => safe(a).and(fallible(a)))` is different: the rewriter keeps that entire predicate together rather than pushing its safe conjunct below a boundary and suppressing a possible failure in the residual. Conjunct pushdowns remain available for predicates wholly within the total fragment, subject to each boundary's existing checks. Otherwise they retain separate SELECT scopes, in either order: combining them with `AND` can let ClickHouse evaluate a cast or division on rows an earlier filter removed. This applies to scan, join and expanded blocks; unsafe group-result filters also retain their boundary above aggregation. The compiler does not add PREWHERE or change server optimizer settings to enforce this. Native regression coverage targets ClickHouse 24.8 with the default analyzer; a derived table is not a general materialization guarantee.

The optimizing path has a **results-only error contract**: if naive execution succeeds, optimized execution must return identical rows and types without failing. If naive execution fails, optimized execution may fail or return the guard-first oracle's rows (evaluate fallible expressions only on rows passing the guards, in IR order). Server filter ordering and pruning make errors plan-dependent. The conservative fences above remain; historical error-equivalence regressions are stronger checks of those particular cases, not a general promise to reproduce every naive failure.

One exception is named: under a limit you set with [`settings`](/docs/query-builder/settings/), codes 158, 159, 241, 307 and 396 are outside this contract, because the two paths read and allocate different amounts. Either path can raise one when the other does not. When a query succeeds, its rows and types still follow the contract.

## Example

Filtering, grouping, filtering groups, sorting, and limiting all fit into one SELECT here.

<details>
<summary>Setup: imports and table definitions</summary>

```ts
import { col, count, from, table } from '@typedhouse/core';
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
  .where((e) => e.tenant.eq('acme'))
  .groupBy((e) => ({ category: e.category }))
  .aggregate(() => ({ total: count() }))
  .where((e) => e.total.gt(10n))
  .orderBy((e) => e.category)
  .limit(10);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT
  `__typedhouse_input`.`category` AS `category`,
  count() AS `total`
FROM
  `events` AS `__typedhouse_input`
WHERE
  `__typedhouse_input`.`tenant` = {p0:String}
GROUP BY
  `__typedhouse_input`.`category`
HAVING
  `total` > {p1:UInt64}
ORDER BY
  `category` ASC
LIMIT
  10
```

Parameters:

```json
{
  "p0": "acme",
  "p1": "10"
}
```

<!-- generated-sql:end -->

## Expansion and DISTINCT

A filtered expansion, a distinct selection and the ordering fold into one block: the safe tenant filter is pushed below the expansion, the expansion follows the `FROM` item and `DISTINCT` applies to the full expanded row.

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
    tags: col.Array(col.String),
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
  .leftArrayJoin((e) => e.tags, 'tag')
  .where((e) => e.tenant.eq('acme'))
  .distinct()
  .orderBy((e) => e.tag)
  .limit(20);

export default compile(query.ir);
```

<!-- generated-sql:start -->

Final SQL:

```sql
SELECT DISTINCT
  `id`,
  `tenant`,
  `tags`,
  `tag`
FROM
  `events`
  LEFT ARRAY JOIN `tags` AS `tag`
WHERE
  `tenant` = {p0:String}
ORDER BY
  `tag` ASC
LIMIT
  20
```

Parameters:

```json
{
  "p0": "acme"
}
```

<!-- generated-sql:end -->

## Computed projections

Any projection over a physical-table scan and its filters folds into the same SELECT: direct columns, parameters, arithmetic, casts, division, known functions and SQL snippets, even volatile calls such as `now()`. The select list is evaluated on exactly the rows `WHERE` passes in both forms, so a failing expression fails the same way whether or not it is folded. A parameter without an explicit type takes the type of its sibling operand, exactly as the resolver assigns it. For example, selecting `onHand - reserved AS available` after filtering on `onHand - reserved < reorderPoint` needs no derived table.

Output aliases must not shadow a source column that the same block reads: under ClickHouse's default `prefer_column_name_to_alias = 0` an alias replaces that name in every other expression of the SELECT, so a computed alias equal to a column named by a `WHERE` clause, the `ARRAY JOIN` expression or another select item keeps its own derived table (an expression may still read the column it is itself aliased as). Redefining the expansion alias is always a boundary. The source columns include a descriptor's `hiddenColumns` (columns the server resolves although the descriptor does not declare them), for this check, the aggregate-alias check and the join-aggregate check alike. An aggregate that folds onto a table block (through filters, an `ARRAY JOIN` and plain column selections such as `map(r => ({ id: r.id }))`) checks its aliases against every column that table resolves, not only the columns the selection kept. Subqueries in a projection keep their own scope inside the folded select list.

A subsequent `limit()` (including an offset) can fold over a scan projection when every projected expression and preceding filter belongs to the existing closed total fragment: direct columns/parameters and supported total operations such as integer arithmetic, comparisons and same-family `ifNull`. This requires no alias substitution. The projection must already pass the physical-column alias checks (including `hiddenColumns`), and the consumer must retain its full demanded interface. Casts, division, opaque SQL snippets and volatile expressions retain the boundary, as do expansions, projected DISTINCT, grouping, CTE definitions and repeated limits. These conservative fences avoid moving fallible or opaque computations across the cap; they do not extend the compiler's results-only contract into a general promise about errors or evaluation counts.

Sorting, aggregation, subsequent filters and further projections still retain their existing boundaries around a folded computed projection unless a rewrite rule moves them below it. In particular, sorting or grouping by a projected alias needs a separate scope/substitution proof; this LIMIT fold does not supply one. Over joins, a direct selection folds into the join block together with its filters; computed selections over joins, CTEs or aggregates keep a derived table. Shared projections remain ordinary deduplicated CTEs, not cached results; explicit `.cte()` fences remain intact.

Folding respects operation order: filtering after a limit or a `LIMIT BY` is not equivalent to filtering before it. Reversed or repeated clauses, projections after sort/limit, filters after DISTINCT, UNION, unsafe expressions, and alias collisions can require derived tables. Reading directly from a CTE removes only the redundant reference wrapper; it does not merge operations into the CTE definition. Arbitrary expression substitution is not implemented.
