# ClickHouse Query Algebra: Implementation Spec

Oct 27, 2026 · @Fernando Hurtado Cardenas

This is the build spec for the library described in Doc. That document is background. This one is self-contained: the API examples section is the user-facing contract, and the parts after it say how to deliver it in three pieces: a code generator that turns a ClickHouse schema into typed table descriptors, a query builder whose values are a relational-algebra IR with full TypeScript inference, and a compiler that rewrites the IR and emits flat ClickHouse SQL. Every example in API examples must compile and run unchanged when this is done.

## Scope

Build one TypeScript monorepo, `typedhouse`, with four packages. ClickHouse 24.3 or newer is required, because the compiler relies on the new analyzer being the default (multiple joins per SELECT, correct alias scoping, `{name:Type}` query parameters everywhere).

| Package | Delivers | Depends on |
| --- | --- | --- |
| `@typedhouse/codegen` | CLI that reads a ClickHouse database and writes `schema.ts` and `functions.ts` | `@clickhouse/client` |
| `@typedhouse/core` | `Query`, `Expr`, `sql`, the IR node types, the function catalog | nothing at runtime |
| `@typedhouse/compiler` | IR validation, rewrite passes, ClickHouse SQL emission, `toSQL()` | `@typedhouse/core` |
| `@typedhouse/client` | `client.run(q)`, `client.stream(q)`, `client.execute(command)`, result decoding | `@typedhouse/compiler`, `@clickhouse/client` |

`@typedhouse/core` is dependency-free on purpose: a query built in a browser or a worker must not drag the compiler along.

Simple bulk inserts are an approved scope extension, specified under “Simple insert commands”; they do not reopen the SELECT compiler milestones. Not in scope for this build: updates, deletes and DDL; dictionaries (`dictGet` goes through `sql`); window functions as an operator (through `sql` only); any dialect other than ClickHouse; join reordering; cost-based decisions of any kind. Each of these is a later milestone, and nothing in this spec should make them harder.

Tooling: TypeScript 5.5+, strict, `exactOptionalPropertyTypes` on; vitest; `expect-type` for type tests; `fast-check` for property tests; testcontainers for a real ClickHouse in integration tests, pinned to the image clickhouse/clickhouse-server:24.8; tsup for builds. ESM only. CI runs the type tests on TypeScript 5.5 and on the current release.

## Milestones

Work in this order. Each milestone ends with its acceptance test green in CI; do not start the next one before that. Milestone 3 is the first point where the API examples run end to end; milestone 4 is where the compiler earns its name.

| # | Milestone | Acceptance test |
| --- | --- | --- |
| 1 | ClickHouse type parser + TS type mapping | Every type string in the fixture corpus (200+ real `system.columns` values) parses, round-trips through `print()`, and maps to the TS type in the mapping table |
| 2 | Codegen CLI | Against the testcontainers DDL fixture, `typedhouse generate` writes `schema.ts` and `functions.ts` that match the checked-in snapshots; `typedhouse check` exits non-zero when a snapshot is stale |
| 3 | Builder, IR, naive emitter | The six type checks under Testing are green: every API example type-checks with `toEqualTypeOf`, every What-fails-to-compile case fails with the expected diagnostic, the type/runtime snapshots agree, and the compile-performance bench is under its budget. Each query runs on ClickHouse through a one-subquery-per-node emitter and returns correctly decoded rows. The eight constraints in Part 4 are in place |
| 4 | Rewrite passes + flat emitter | Differential test: 500 generated queries give identical results under naive and optimized emission; `lowStockCategories('acme')` emits exactly the SQL shown in API examples; EXPLAIN snapshots show no `Subquery` node that is not under a fence |
| 5 | Client: run, stream, errors | Streaming 10M rows holds under 200 MB heap; a ClickHouse error surfaces with the emitted SQL and the IR path of the offending node |
| 6 | Hardening | Property test: any random IR tree either compiles or fails validation with a message naming the node; never a thrown TypeError from the compiler |
| 7 | Materialize (later) | `Materialize` creates a `TEMPORARY TABLE` inside an HTTP session; differential test unchanged |
| 8 | Incremental engine (later) | The engine is a third `Backend` plugin; the differential test passes with it against `clickhouse` on a stream of inserts and deletes |

Milestone 3 ships the naive emitter as a product feature, not scaffolding: it stays in the codebase as `emitNaive()` because milestone 4's differential test needs it forever.

## API examples

This section is the user-facing contract. Every snippet type-checks and runs against the fixture schema below; milestone 3's acceptance test is exactly that. The fixture schema is the current storage model (entities, versioned metric groups, rollups), so the corpus and the differential test exercise the queries the category 360 page actually runs.

### Fixture schema

What `typedhouse generate` writes for the test database. Shown factored for brevity; the generator writes every table in full. Representative metric columns only; every metric has a `<metric>_warnings Array(String)` beside it.

```ts
// src/generated/schema.ts
import { table, col, type Infer } from '@typedhouse/core'

const partSpecification = col.Tuple({
  id:           col.String,
  mpn:          col.Nullable(col.String),
  manufacturer: col.Nullable(col.String),
  description:  col.Nullable(col.String),
  package:      col.Nullable(col.String),
  part_type:    col.Nullable(col.String),
})

// metric groups are wide, versioned time series
const metricMeta = {
  tenantId:    col.String,
  entityId:    col.String,
  version:     col.UInt32,
  effectiveAt: col.DateTime64(3),
  insertedAt:  col.DateTime64(3),
}
const metricTable = { engine: 'ReplacingMergeTree', sortingKey: ['tenantId', 'entityId', 'version', 'effectiveAt'], partitionKey: [] }

export const db = {
  // internal component / IPN
  entity_ots_component: table('entity_ots_component', {
    tenantId:            col.String,
    entityId:            col.String,
    category:            col.Nullable(col.String),      // category path
    state:               col.String,
    part_specifications: col.Array(partSpecification),
    matched_part_ids:    col.Array(col.String),
    countOfParts:        col.UInt64,
    updatedAt:           col.DateTime64(3),
  }, { engine: 'MergeTree', sortingKey: ['tenantId', 'entityId'], partitionKey: [] }),

  // manufacturer part
  entity_off_the_shelf_part: table('entity_off_the_shelf_part', {
    tenantId:         col.String,
    entityId:         col.String,
    manufacturerId:   col.String,
    manufacturerName: col.String,
    mpn:              col.String,
    partCategoryId:   col.Nullable(col.Int64),
    partCategoryName: col.Nullable(col.String),
    partCategoryPath: col.Array(col.Int64),
    lifecycleStatus:  col.Nullable(col.String),
    lifecycleYteol:   col.Nullable(col.Float64),
    countryOfOrigin:  col.Array(col.String),
    ipns:             col.Array(col.String),
    supplier_ids:     col.Array(col.String),
    updatedAt:        col.DateTime64(3),
  }, { engine: 'MergeTree', sortingKey: ['tenantId', 'entityId'], partitionKey: [] }),

  metric_group_ots_component_market_availability: table('metric_group_ots_component_market_availability', {
    ...metricMeta,
    market_stock_total:                 col.Float64,
    market_stock_total_warnings:        col.Array(col.String),
    market_stock_p50:                   col.Float64,
    market_stock_p50_warnings:          col.Array(col.String),
    market_lead_time_p50_days:          col.Float64,
    market_lead_time_p50_days_warnings: col.Array(col.String),
  }, metricTable),

  metric_group_ots_component_indices: table('metric_group_ots_component_indices', {
    ...metricMeta,
    price_change_log_sum:       col.Float64,
    price_change_count:         col.Float64,
    stock_index:                col.Float64,
    stock_index_warnings:       col.Array(col.String),
    lead_time_index_part_days:  col.Float64,
    lead_time_index_part_count: col.Float64,
    lead_time_max_days:         col.Nullable(col.Float64),
  }, metricTable),

  metric_group_off_the_shelf_part_indices: table('metric_group_off_the_shelf_part_indices', {
    ...metricMeta,
    price_change_log_sum:  col.Float64,
    price_change_count:    col.Float64,
    stock_index:           col.Float64,
    lead_time_index_days:  col.Float64,
    lead_time_index_count: col.Float64,
  }, metricTable),

  metric_group_off_the_shelf_part_market_price: table('metric_group_off_the_shelf_part_market_price', {
    ...metricMeta,
    market_unit_price_1k_p50:          col.Float64,
    market_unit_price_1k_p50_warnings: col.Array(col.String),
  }, metricTable),
} as const

export type ComponentRow        = Infer<typeof db.entity_ots_component>
// { tenantId: string; entityId: string; category: string | null; state: string;
//   part_specifications: Array<{ id: string; mpn: string | null; manufacturer: string | null; description: string | null; package: string | null; part_type: string | null }>;
//   matched_part_ids: string[]; countOfParts: bigint; updatedAt: Date }
export type PartRow             = Infer<typeof db.entity_off_the_shelf_part>
export type ComponentIndicesRow = Infer<typeof db.metric_group_ots_component_indices>
```

Seed (`test/fixtures/seed.sql`): two tenants. For tenant `acme`: 2,000 components, of which 300 have `category` NULL, 120 are not `active`, 400 have an empty `matched_part_ids` and 50 share a matched part with another component; 3,000 parts across 40 manufacturers, 200 with `lifecycleStatus` NULL. Each metric table has 1 to 4 versions per entity, `effectiveAt` weekly over 26 weeks, 10% of rows duplicated with a later `insertedAt` (the ReplacingMergeTree case), warnings non-empty on 5% of rows. A deterministic script with a fixed seed, so EXPLAIN snapshots and differential runs are reproducible.

### Helpers used below

User-land code, not library code. They are in the corpus so the examples compile as written. Everything is tenant-scoped, so the first helper is a predicate that works on any table with a `tenantId`.

```ts
const daysAgo   = (n: number) => new Date(Date.now() - n * 86_400_000)      // a plain Date, fixed when the query is built
const forTenant = (tenantId: string) =>
  <R extends { tenantId: string }>(r: Row<R>) => r.tenantId.eq(tenantId)    // one predicate for every table
const isActive   = (c: Row<ComponentRow>) => c.state.eq('active')
const inCategory = (path: string) => (c: Row<ComponentRow>) => c.category.startsWith(path)  // Nullable in, Expr<boolean | null> out

const components   = from(db.entity_ots_component)
const parts        = from(db.entity_off_the_shelf_part)
const availability = from(db.metric_group_ots_component_market_availability)
const cIndices     = from(db.metric_group_ots_component_indices)
const pIndices     = from(db.metric_group_off_the_shelf_part_indices)
const prices       = from(db.metric_group_off_the_shelf_part_market_price)
```

### Filtering

```ts
components.where(forTenant('acme')).where(isActive)                        // consecutive wheres AND together
components.where(inCategory('Passives/Capacitors'))                        // a NULL category is neither true nor false: the row is dropped, as in SQL
components.where(c => c.matched_part_ids.notEmpty())                       // unmatched components: .empty()
components.where(c => c.matched_part_ids.has('part_42'))
components.where(c => c.updatedAt.gt(daysAgo(7)))                          // Date becomes a typed DateTime64 parameter
components.where(c => c.countOfParts.gt(3n))                               // UInt64 is bigint in TypeScript
parts.where(p => p.lifecycleStatus.in(['NRND', 'EOL', 'Obsolete']))
parts.where(p => p.countryOfOrigin.hasAny(['CN', 'TW']))
parts.where(p => p.lifecycleYteol.lt(2).and(p.lifecycleYteol.isNotNull())) // boolean algebra is explicit: and, or, not
parts.where(p => p.partCategoryPath.has(1042n))
cIndices.where(i => i.stock_index_warnings.notEmpty())
// IN (subquery): a semi-join; the inner query must have exactly one column
components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => ({ id: i.entityId }))))
```

### Projection

```ts
components.map(c => ({
  ...c,                                                                     // spread keeps every column; a later key overrides
  category:  c.category.ifNull('uncategorised'),                            // string | null → string
  matched:   c.matched_part_ids.length(),
  mpns:      c.part_specifications.element('mpn'),                          // tupleElement on Array(Tuple): (string | null)[]
  firstDesc: c.part_specifications.arrayElement(1).element('description'),  // ClickHouse arrays are 1-based
  age:       dateDiff('day', c.updatedAt, now()),                           // now() is non-deterministic: fine here, blocks .live() later
  tier:      multiIf([c.countOfParts.eq(0n), 'none'], [c.countOfParts.lt(3n), 'few'], 'many'),
  source:    val('clickhouse'),                                             // a JS string with no sibling defaults to String; val(x, col.X) overrides
}))
// ^? Query<ComponentRow & { category: string; matched: bigint; mpns: (string | null)[]; firstDesc: string | null; age: bigint; tier: string; source: string }>
```

### Versioned metrics

Metric groups are `ReplacingMergeTree(insertedAt)` keyed on `(tenantId, entityId, version, effectiveAt)`. Two patterns cover nearly every read: the newest version per entity, and a time series for one entity.

```ts
// FINAL collapses rows that share the sorting key, keeping the latest insertedAt
const cleanIndices = cIndices.final()

// newest version per entity, as a generic helper over any metric table.
// q is used twice, so the compiler emits it once (WITH t0 AS …)
type Versioned = { tenantId: string; entityId: string; version: number }
const latest = <R extends Versioned>(q: Query<R>) => {
  const newest = q
    .groupBy(m => ({ tenantId: m.tenantId, entityId: m.entityId }))
    .aggregate(g => ({ version: max(g.version) }))
  return join({ m: q, v: newest })
    .on(r => [r.m.tenantId.eq(r.v.tenantId), r.m.entityId.eq(r.v.entityId), r.m.version.eq(r.v.version)])
    .map(r => ({ ...r.m }))
}
const latestIndices = latest(cleanIndices.where(forTenant('acme')))
// ^? Query<ComponentIndicesRow>

// the same without a self-join: argMax picks each metric from the newest version
cleanIndices.where(forTenant('acme'))
  .groupBy(i => ({ entityId: i.entityId }))
  .aggregate(g => ({
    version:    max(g.version),
    stockIndex: argMax(g.stock_index, g.version),
    leadDays:   argMax(g.lead_time_max_days, g.version),   // Nullable in, Nullable out
  }))

// a weekly series for one component
availability.final()
  .where(forTenant('acme')).where(a => a.entityId.eq('cmp_7'))
  .groupBy(a => ({ week: a.effectiveAt.toStartOfWeek() }))
  .aggregate(g => ({ stock: avg(g.market_stock_total), leadDays: quantile(0.5)(g.market_lead_time_p50_days) }))
  .orderBy(r => r.week.asc())
```

### Entities with metrics: the three shapes

Almost every read on the category 360 page is one of these three. Each starts from an entity query filtered by a predicate and attaches metric rows to it.

```ts
// 1. Entity with latest metrics: entity E filtered by P, joined with the last snapshot of several metric groups.
//    Each group has its own latest version, so each is a separate latest(...) and a separate join side.
const latestAvailability = latest(availability.final().where(forTenant('acme')))
const latestIndices      = latest(cIndices.final().where(forTenant('acme')))

const componentsLatest = join({
    c: components.where(forTenant('acme')).where(isActive).where(inCategory('Passives')),
    a: latestAvailability,
    i: latestIndices,
  })
  .on(r => [r.c.entityId.eq(r.a.entityId), r.c.entityId.eq(r.i.entityId)])   // both sides are already one tenant
  .map(r => ({
    entityId:   r.c.entityId,
    category:   r.c.category,
    stockTotal: r.a.market_stock_total,
    stockP50:   r.a.market_stock_p50,
    leadDays:   r.a.market_lead_time_p50_days,
    stockIndex: r.i.stock_index,
    asOf:       greatest(r.a.effectiveAt, r.i.effectiveAt),                 // snapshots of different groups need not align
  }))
// entities that may have no snapshot yet: leftJoin instead, and the metric columns become number | null

// 2. Entity with history: entity E filtered by P, joined with every snapshot of one metric group inside a window T
const since = daysAgo(90)
const stockHistory = join({
    c: components.where(forTenant('acme')).where(inCategory('Passives/Capacitors')),
    a: availability.final().where(forTenant('acme')).where(a => a.effectiveAt.between(since, new Date())),
  })
  .on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ entityId: r.c.entityId, at: r.a.effectiveAt, version: r.a.version, stock: r.a.market_stock_total }))
  .orderBy(r => r.entityId.asc()).thenBy(r => r.at.asc()).thenBy(r => r.version.asc())
// every version inside the window is a row; for one row per effectiveAt, groupBy (entityId, at) and argMax(stock, version)

// 3. Relative (%) calculations: the latest snapshot of one metric per entity, relative to the total over the same set
const scopedLatest = join({
    c: components.where(forTenant('acme')).where(isActive),
    a: latestAvailability,
  })
  .on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ entityId: r.c.entityId, category: r.c.category, stock: r.a.market_stock_total }))

const total = scopedLatest.aggregate(g => ({ stock: sum(g.stock) }))        // one row, one column

const stockShare = scopedLatest.map(r => ({
  entityId: r.entityId,
  stock:    r.stock,
  share:    r.stock.divide(scalar(total)).multiply(100),                    // scalar(): a one-row, one-column Query as an Expr
}))
// scopedLatest feeds both total and the map, so it is emitted once (WITH t0 AS …); ClickHouse evaluates the scalar subquery once

// share within a group rather than the whole set: aggregate per group and join the total back in
const perCategory = scopedLatest
  .groupBy(r => ({ category: r.category.ifNull('uncategorised') }))
  .aggregate(g => ({ stock: sum(g.stock) }))
join({ e: scopedLatest, t: perCategory })
  .on(r => r.e.category.ifNull('uncategorised').eq(r.t.category))           // NULL never equals NULL: normalise the key on both sides
  .map(r => ({ entityId: r.e.entityId, share: r.e.stock.divide(r.t.stock).multiply(100) }))
```

### Rollups

Manufacturers, categories and libraries are rollup scopes over the entity tables, not stored entities. Ratios of sums are written inline: `AggExpr` carries the arithmetic methods.

```ts
// category rollup for a tenant: stock index is a sum, lead-time index is a ratio of sums,
// price index compounds the mean weekly log change (the weekly compounding itself is user-land)
const categoryRollup = (tenantId: string) =>
  join({ c: components.where(forTenant(tenantId)).where(isActive), i: latest(cIndices.final().where(forTenant(tenantId))) })
    .on(r => r.c.entityId.eq(r.i.entityId))
    .groupBy(r => ({ category: r.c.category.ifNull('uncategorised') }))
    .aggregate(g => ({
      components:    uniq(g.c.entityId),
      stockIndex:    sum(g.i.stock_index),
      leadTimeIndex: sum(g.i.lead_time_index_part_days).divide(sum(g.i.lead_time_index_part_count)),
      priceIndex:    exp(sum(g.i.price_change_log_sum).divide(sum(g.i.price_change_count))),
      warned:        countIf(g.i.stock_index_warnings.notEmpty()),
    }))
// ^? Query<{ category: string; components: bigint; stockIndex: number; leadTimeIndex: number; priceIndex: number; warned: bigint }>

// manufacturer rollup from parts; HAVING is a where after aggregate
join({ p: parts.where(forTenant('acme')), i: latest(pIndices.final().where(forTenant('acme'))) })
  .on(r => r.p.entityId.eq(r.i.entityId))
  .groupBy(r => ({ manufacturerId: r.p.manufacturerId, manufacturerName: r.p.manufacturerName }))
  .aggregate(g => ({
    parts:      count(),
    stockIndex: sum(g.i.stock_index),
    eol:        countIf(g.p.lifecycleStatus.in(['EOL', 'Obsolete'])),   // g.p.lifecycleStatus is Grouped; its methods return Grouped
  }))
  .where(r => r.parts.ge(5n))
  .orderBy(r => r.stockIndex.desc())

// no key: one row for the tenant
components.where(forTenant('acme')).aggregate(g => ({
  total:      count(),
  unmatched:  countIf(g.matched_part_ids.empty()),
  categories: uniqExact(g.category),
}))
```

### Single-expression forms

`groupBy`, `aggregate` and `map` accept one expression instead of an object. The output column is named by the Polars rule: the root column's name, or the function's name when there is no column. Use the object form to pick any other name.

```ts
// one key, one aggregate
components.where(forTenant('acme')).groupBy(c => c.category).aggregate(g => count())
// ^? Query<{ category: string | null; count: bigint }>

// an expression keeps its root column's name
cIndices.final().groupBy(i => i.effectiveAt.toStartOfWeek()).aggregate(g => sum(g.stock_index))
// ^? Query<{ effectiveAt: Date; stock_index: number }>

// a one-column projection, which is what in() and scalar() want
parts.map(p => p.manufacturerId).distinct()
components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => i.entityId)))
scopedLatest.map(r => r.stock.divide(scalar(scopedLatest.aggregate(g => sum(g.stock)))).multiply(100))
// ^? Query<{ stock: number }>   — the root column of the whole expression is stock
```

### Joins

ClickHouse joins on equality only, so a relationship stored as an id array is unnested first. `tenantId` belongs in every join key.

```ts
// components to their matched parts: ARRAY JOIN the id array, then an equi-join
const componentParts = components.where(forTenant('acme'))
  .arrayJoin(c => c.matched_part_ids, 'partId')
// ^? Query<ComponentRow & { partId: string }>

const withParts = join({ c: componentParts, p: parts })
  .on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId)])
  .map(r => ({ component: r.c.entityId, mpn: r.p.mpn, manufacturer: r.p.manufacturerName, lifecycle: r.p.lifecycleStatus }))

// left join: components with no availability row keep NULLs on the right
leftJoin({ c: components.where(forTenant('acme')) }, { a: latest(availability.final().where(forTenant('acme'))) })
  .on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ entityId: r.c.entityId, stock: r.a.market_stock_total.ifNull(0) }))
// ^? Query<{ entityId: string; stock: number }>

// three-way: component, part, part price
join({ c: componentParts, p: parts, m: latest(prices.final().where(forTenant('acme'))) })
  .on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId), r.p.entityId.eq(r.m.entityId)])
  .map(r => ({ component: r.c.entityId, mpn: r.p.mpn, price1k: r.m.market_unit_price_1k_p50 }))

// self join through the unnested ids: components that share a matched part
join({ a: componentParts, b: componentParts })
  .on(r => [r.a.partId.eq(r.b.partId), r.a.entityId.lt(r.b.entityId)])
  .map(r => ({ a: r.a.entityId, b: r.b.entityId, partId: r.a.partId }))

// a left ARRAY JOIN keeps components whose array is empty, with partId = ''
components.leftArrayJoin(c => c.matched_part_ids, 'partId')
```

### Composition and reuse

A named query is a `const`, a reusable predicate is a function over `Row<R>`, a parameterised query is a function that returns a `Query`. `latest` and `categoryRollup` above are already that; the extension below lives in another module and changes nothing above it.

```ts
const lowStockCategories = (tenantId: string) =>
  categoryRollup(tenantId)
    .where(r => r.components.gt(10n))
    .orderBy(r => r.stockIndex.asc())
    .limit(50)
```

### Ordering, limits, set operations

```ts
components.orderBy(c => c.updatedAt.desc()).thenBy(c => c.entityId.asc()).limit(20, 40)   // LIMIT 20 OFFSET 40
parts.orderBy(p => p.lifecycleYteol.asc().nullsLast())                                     // Nullable keys say where NULLs go
parts.orderBy(p => p.mpn)                                                                  // a bare column means ascending
// thenBy exists only on the value orderBy returns; after any other operator it is gone (see What fails to compile)
events.orderBy(e => e.at.desc()).thenBy(e => e.id).limitBy(e => e.category).take(10)      // LIMIT 10 BY category: the first 10 of each category
events.orderBy(e => e.at.desc()).thenBy(e => e.id).limitBy(e => [e.tenant, e.category]).take(10).offset(20)  // LIMIT 10 OFFSET 20 BY tenant, category
// limitBy(…) is not a query until take(…); offset exists only on the value take returns. Sort first, or which rows survive is unspecified.
components.where(isActive).limit(100).settings({ max_threads: 2, max_execution_time: 1.5, log_comment: 'report' })  // trailing SETTINGS; ends the query: only run, stream and toSQL remain

parts.map(p => ({ manufacturerId: p.manufacturerId })).distinct()
unionAll(                                                                                  // same row type on both sides
  components.map(c => ({ entityId: c.entityId, kind: val('component', col.String) })),
  parts.map(p => ({ entityId: p.entityId, kind: val('part', col.String) })),
)
```

### Escape hatches, from mildest to rawest

```ts
// 1. a ClickHouse function the typed catalog lacks: the known-function tier (every name in system.functions).
//    .as() declares the type for inference and decoding; it emits no CAST
components.map(c => ({ h: fn.cityHash64(c.entityId).as(col.UInt64) }))

// 2. a trusted scalar snippet; row Exprs bind references, JS values become parameters.
//    .as() declares the runtime result descriptor; it neither casts nor verifies the result.
components.map(c => ({ categoryLength: sql`length(${c.category})`.as(col.Nullable(col.UInt64)) }))

// 3. a predicate uses the same scalar-snippet API
parts.where(p => sql`match(${p.mpn}, ${'^GRM[0-9]'})`.as(col.Bool))

// No public sql<T> or sql.relation API. Compose relations with the query builder.
```

### ClickHouse hints

```ts
cIndices.final()               // FROM … FINAL: ReplacingMergeTree deduplication at read time
components.sample(0.1)         // SAMPLE 0.1; the fixture tables have no sampling key, so this one is asserted through toSQL() only
components.prewhere(c => c.tenantId.eq('acme'))  // PREWHERE, explicit only; last of the scan modifiers. Under final() a non-key predicate can return a stale row version
componentParts.materialize()   // a CTE in v1; a TEMPORARY TABLE in milestone 7
```

### Compiling and running

```ts
const q = lowStockCategories('acme')
const { sql, params } = q.toSQL()
const rows = await client.run(q)
// ^? { category: string; components: bigint; stockIndex: number; leadTimeIndex: number; priceIndex: number; warned: bigint }[]
for await (const row of client.stream(componentParts)) { /* one row at a time */ }
```

`q.toSQL().sql` is exactly this, byte for byte, and milestone 4 asserts it. What to notice: the shared `latest` input is one CTE; tenant and state filters are pushed into both join inputs; every select list is pruned to the columns used downstream, in the table's declared order; `ALL` strictness is spelled out; `GROUP BY` repeats the key expression while `HAVING` and `ORDER BY` use the output aliases; identifiers are quoted; values are typed parameters numbered in order of first appearance, and `p1` keeps its name where the key expression is repeated:

```sql
WITH `t0` AS (SELECT `tenantId`, `entityId`, `version`, `price_change_log_sum`, `price_change_count`, `stock_index`, `stock_index_warnings`, `lead_time_index_part_days`, `lead_time_index_part_count` FROM `metric_group_ots_component_indices` FINAL WHERE `tenantId` = {p0:String})
SELECT ifNull(`c`.`category`, {p1:String}) AS `category`, uniq(`c`.`entityId`) AS `components`, sum(`i`.`stock_index`) AS `stockIndex`, sum(`i`.`lead_time_index_part_days`) / sum(`i`.`lead_time_index_part_count`) AS `leadTimeIndex`, exp(sum(`i`.`price_change_log_sum`) / sum(`i`.`price_change_count`)) AS `priceIndex`, countIf(notEmpty(`i`.`stock_index_warnings`)) AS `warned`
FROM (SELECT `entityId`, `category` FROM `entity_ots_component` WHERE `tenantId` = {p2:String} AND `state` = {p3:String}) AS `c`
INNER ALL JOIN (SELECT `m`.`entityId` AS `entityId`, `m`.`price_change_log_sum` AS `price_change_log_sum`, `m`.`price_change_count` AS `price_change_count`, `m`.`stock_index` AS `stock_index`, `m`.`stock_index_warnings` AS `stock_index_warnings`, `m`.`lead_time_index_part_days` AS `lead_time_index_part_days`, `m`.`lead_time_index_part_count` AS `lead_time_index_part_count` FROM `t0` AS `m` INNER ALL JOIN (SELECT `tenantId`, `entityId`, max(`version`) AS `version` FROM `t0` GROUP BY `tenantId`, `entityId`) AS `v` ON `m`.`tenantId` = `v`.`tenantId` AND `m`.`entityId` = `v`.`entityId` AND `m`.`version` = `v`.`version`) AS `i` ON `c`.`entityId` = `i`.`entityId`
GROUP BY ifNull(`c`.`category`, {p1:String})
HAVING `components` > {p4:UInt64}
ORDER BY `stockIndex` ASC
LIMIT 50
```

with `params` equal to `{ p0: 'acme', p1: 'uncategorised', p2: 'acme', p3: 'active', p4: '10' }`. The tenant appears twice because two `forTenant` calls made two `Param` nodes; the compiler does not merge parameters by value. `bigint` and `Decimal` values are sent as strings, because ClickHouse parses those parameter types from text.

### What fails to compile

```ts
components.where(c => c.mpn.eq('x'))                      // 'mpn' is not on Row<ComponentRow>
parts.where(isActive)                                     // Row<PartRow> is not Row<ComponentRow>
components.groupBy(c => ({ category: c.category })).aggregate(g => ({ state: g.state }))
                                                          // Grouped<string> is not Expr<string>; wrap it in an aggregate (any, uniq, …)
components.map(c => ({ nested: { id: c.entityId } }))     // a nested object is not an Expr (nested_projection)
components.where(c => c.countOfParts.gt(3))               // UInt64 is bigint: write 3n
components.where(isActive).thenBy(c => c.entityId.asc()) // thenBy is not on Query, only on what orderBy returns
components.limitBy(c => c.category).where(isActive)       // limitBy is not a query until take
components.limitBy(c => c.category).take(1).where(isActive).offset(1) // offset exists only directly after take
components.limit(1).settings({ max_threads: 1 }).where(isActive) // settings() is terminal: no builder method, and no join, union or subquery input
components.settings({ limit: 2 })                         // only the allowlist: limit changes the rows
components.where(isActive).final()                        // final() is not on Query, only on what from() returns
components.groupBy(c => val(1, col.UInt8))                // no root column, so no name: use the object form (unnamed_expression)
components.groupBy(c => c.countOfParts).aggregate(g => sum(g.countOfParts))
                                                          // key and aggregate both named countOfParts (duplicate_column)
leftJoin({ c: components }, { a: availability }).on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ stock: r.a.market_stock_total.toFixed(2) }))  // toFixed is not on Expr<number | null>: the left side is Nullable; ifNull first
```

Every line above fails under `tsc`; the validator names the same errors for a graph built without the types (`unbound_column`, `nested_projection`, `unnamed_expression`, `duplicate_column`, `join_condition_arity`, `join_condition_not_equi`, `param_untyped`, `duplicate_function`).

### Reserved for later

`q.live()` and `q.changes()` are not declared in v1; see Part 4 for what today's code keeps in place for them.

## Part 1: codegen

The generator reads a live database and writes two files. It never reads DDL text: ClickHouse's own `system.columns` is the parsed, canonical form, and running a throwaway ClickHouse in testcontainers from a DDL fixture is how CI gets one without a cluster.

### Introspection

One query, through `@clickhouse/client` over HTTP:

```sql
SELECT c.table, c.name, c.type, c.position, c.default_kind, c.comment,
       t.engine, t.sorting_key, t.partition_key, t.primary_key
FROM system.columns AS c
JOIN system.tables AS t ON t.database = c.database AND t.name = c.table
WHERE c.database = {db:String}
ORDER BY c.table, c.position
```

Include tables, views and materialized views (`t.engine` tells them apart; all three are queryable). Skip `default_kind = 'ALIAS'` columns only if `--skip-alias` is passed; by default they are included and marked. Skipped names are still emitted, as the descriptor's shadow-only `hiddenColumns` (see "Descriptor completeness" below). Columns whose name contains a dot are the flattened members of a `Nested(...)` column; keep them as-is under their dotted name.

### Type grammar

ClickHouse type strings are a small recursive language. Write a real parser (recursive descent, \~150 lines), not regexes, producing this AST, and a `print()` that round-trips it exactly. The AST ships in `@typedhouse/core` because the compiler needs it at runtime for query parameters.

```ts
type CHType =
  | { kind: 'scalar'; name: 'UInt8' | 'UInt16' | 'UInt32' | 'UInt64' | 'UInt128' | 'UInt256'
                           | 'Int8' | 'Int16' | 'Int32' | 'Int64' | 'Int128' | 'Int256'
                           | 'Float32' | 'Float64' | 'Bool' | 'String' | 'UUID'
                           | 'Date' | 'Date32' | 'DateTime' | 'IPv4' | 'IPv6' | 'JSON' | 'Nothing' }
  | { kind: 'FixedString'; n: number }
  | { kind: 'DateTime'; tz?: string }
  | { kind: 'DateTime64'; precision: number; tz?: string }
  | { kind: 'Decimal'; precision: number; scale: number }   // Decimal32/64/128/256 normalize to this
  | { kind: 'Enum'; bits: 8 | 16; values: Array<{ name: string; value: number }> }
  | { kind: 'Nullable'; inner: CHType }
  | { kind: 'LowCardinality'; inner: CHType }
  | { kind: 'Array'; inner: CHType }
  | { kind: 'Map'; key: CHType; value: CHType }
  | { kind: 'Tuple'; items: Array<{ name?: string; type: CHType }> }
  | { kind: 'Variant'; items: CHType[] }
  | { kind: 'Dynamic' }
  | { kind: 'AggregateFunction'; fn: string; args: CHType[] }
  | { kind: 'SimpleAggregateFunction'; fn: string; inner: CHType }
  | { kind: 'Unknown'; raw: string }                         // never throws on a new type; maps to unknown
```

Parsing details that bite: string literals inside `Enum8('a b' = 1)` and `DateTime('Europe/Amsterdam')` can contain commas, parentheses and escaped quotes; `Tuple(a String, b UInt8)` has optional names; `Decimal(18, 4)` and `Decimal64(4)` are the same type (32, 64, 128, 256 stand for precision 9, 18, 38, 76); the AST keeps the long form, system.columns prints the long form, and col.Decimal64(s) exists only as sugar for col.Decimal(18, s); `Nested(...)` never appears in `system.columns` output and need not parse.

### Type mapping

| ClickHouse | TypeScript | Wire and decode |
| --- | --- | --- |
| `UInt8..32`, `Int8..32`, `Float32/64` | `number` | JSON number; `NaN` and `±Infinity` arrive as the strings `"nan"`, `"inf"`, `"-inf"` because execution sets `output_format_json_quote_denormals = 1` (the default turns them into `null`, which would make a non-null column null) |
| `UInt64`, `Int64`, 128, 256 | `bigint` | String on the wire (`output_format_json_quote_64bit_integers=1`); `BigInt()` on decode |
| `Bool` | `boolean` | JSON bool |
| `String`, `FixedString(n)` | `string` | As is |
| `UUID`, `IPv4`, `IPv6` | `string` (branded: `UUID & string`) | As is |
| `Date`, `Date32`, `DateTime` | `Date` | Execution sets `date_time_output_format = 'iso'`, so a DateTime arrives as `2026-10-27T12:00:00Z` and decodes with `new Date(s)`; a Date arrives as `2026-10-27` and decodes the same way, as UTC midnight |
| `DateTime64(p)` | `Date` when p <= 3, else `string` | ISO with fractional seconds, `new Date(s)`; precision above milliseconds cannot survive `Date`, and the generated comment says so |
| `Decimal(p, s)` | `Decimal<p, s>` = `string & { __p: p; __s: s }` | String on the wire (`output_format_json_quote_decimals=1`; the server default sends a bare number that `JSON.parse` rounds); no arithmetic in TS, arithmetic stays in `Expr` |
| `Enum8/16` | a union of the names as string literals | String on the wire |
| `Nullable(T)` | `T` or `null` | JSON null |
| `LowCardinality(T)` | `T` | Transparent |
| `Array(T)` | `T[]` | JSON array, decode elements recursively |
| `Map(K, V)` | `Record<string, unknown>` | Preserve the driver's parsed object, including nested wire values; no recursive bigint/Date conversion inside Maps or entry-array reshaping |
| `Tuple(T1, T2)` unnamed | `readonly [T1, T2]` | JSON array |
| `Tuple(a T1, b T2)` named | `{ a: T1; b: T2 }` | JSON object (`output_format_json_named_tuples_as_objects`, on by default) |
| `JSON`, `Variant`, `Dynamic`, `Unknown` | `unknown` | Passed through, except a state in `Variant` or `Unknown` (see Aggregate states); a state in `Dynamic` is not detectable |
| `AggregateFunction(f, ...)` | `AggregateState<'f'>` (opaque brand) | Passes through intermediate nodes (subqueries, CTEs, `UNION ALL`, join inputs); only the query result and a `Subquery` result are rejected. Typed code reads it only through the same function's `-Merge` |
| `SimpleAggregateFunction(f, T)` | same as `T` | Same as `T` |

### Generated output

Two files, deterministic, with a header comment carrying the generator version and a content hash. `schema.ts` is sorted by table then column position. No name conversion: a column `order_id` is `order_id` in TypeScript; a column that is not a valid identifier becomes a quoted property key. Table metadata is kept because the compiler and the reader both want it. The fixture schema in API examples is what this output looks like for the test database; the shape of one entry:

```ts
// generated by @typedhouse/codegen 0.1.0 — do not edit — hash: 3f9a…
import { table, col, type Infer } from '@typedhouse/core'

export const db = {
  entity_ots_component: table('entity_ots_component', {
    tenantId:         col.String,
    entityId:         col.String,
    category:         col.Nullable(col.String),
    state:            col.String,
    matched_part_ids: col.Array(col.String),
    countOfParts:     col.UInt64,
    updatedAt:        col.DateTime64(3),
  }, { engine: 'MergeTree', sortingKey: ['tenantId', 'entityId'], partitionKey: [] }),
  // …one entry per table, view and materialized view
} as const

export type ComponentRow = Infer<typeof db.entity_ots_component>
```

`col.*` are value-level constructors that produce `CHType` and carry the TS type as a phantom, so `table()` infers the row type with no separate interface. The generated file is the only input the rest of the system needs; nothing else talks to `system.*`.

The same run reads `system.functions` (`SELECT name, is_aggregate, deterministic, alias_to FROM system.functions ORDER BY name`) and writes `functions.ts` beside `schema.ts`: the known-function tier described in Part 2, one untyped entry per ClickHouse function with its `deterministic` flag.

CLI: `typedhouse generate --url http://… --database analytics --out-dir src/generated` writes `schema.ts` and `functions.ts`; `typedhouse check` with the same flags regenerates to memory and diffs against both. Credentials come from `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` when flags are absent.

## Part 2: builder and IR

A `Query<R>` is a thin immutable wrapper around a `Rel` node. The methods on it build new nodes; they do no validation beyond what the types enforce, and they never touch SQL. Everything the compiler needs is in the node graph.

### IR nodes

Every node has a unique `id` (a counter, assigned at construction) and a `columns: Record<string, CHType>` describing its output row at the ClickHouse level. The TS row type is a phantom on `Query`; the `columns` map is the runtime twin and must agree with it.

| Node | Fields | Output columns |
| --- | --- | --- |
| `Scan` | `table: TableDef`, `final?: boolean`, `sample?: number` | the table's columns |
| `RawRel` | `parts: string[]`, `args: Expr[]`, `columns` as declared by the caller | declared |
| `Prewhere` | `input: Scan`, `pred: Expr` | same as input |
| `Filter` | `input: Rel`, `pred: Expr` | same as input |
| `Project` | `input: Rel`, `exprs: Record<string, Expr>` | keys of `exprs` |
| `Aggregate` | `input: Rel`, `keys: Record<string, Expr>`, `aggs: Record<string, AggExpr>` | keys then aggs |
| `Join` | `kind: 'inner' \| 'left' \| 'right' \| 'full' \| 'cross'`, `inputs: Record<alias, Rel>`, `on: Expr[]`, `strictness?: 'asof'` (inequality last in `on`) | nested: `{ [alias]: input columns }` |
| `ArrayJoin` | `input: Rel`, `expr: Expr` (array-typed), `alias: string`, `left: boolean` | input columns plus `alias`, typed as the array's element |
| `Sort` | `input`, `keys: Array<{ expr: Expr; dir: 'asc' \| 'desc'; nulls?: 'first' \| 'last' }>` | same as input |
| `LimitBy` | `input`, `n: number`, `offset?: number`, `keys: Expr[]` (at least one; each reads a column of the row) | same as input |
| `Limit` | `input`, `n: number`, `offset?: number` | same as input |
| `Distinct` | `input` | same as input |
| `Union` | `inputs: Rel[]`, `all: boolean` | same as first input |
| `Materialize` | `input` | same as input; a hint, see Part 3 |

`Expr` nodes: `ColumnRef { rel: nodeId, path: string[] }` (path has two segments under a join: `['u', 'id']`), `Literal { value, type: CHType }`, `Param { value, type: CHType \| null }`, `Call { fn, args }`, `Agg { fn, args, combinators: ('If' \| 'Merge' \| 'State')[] }`, `Raw { parts, args }`, `Case`, `Cast { expr, to }`, Subquery { rel } for a single-column relation used by in (any number of rows) and scalar (exactly one row). Every `Expr` carries `type: CHType` once resolved; `Param.type` is `null` until the compiler infers it from a sibling.

### How column references bind

The callback a user writes receives a row proxy built from the node it runs against. `rowOf(node)` returns a frozen object with one `Expr` per column, each a `ColumnRef { rel: node.id, path }`. For a join the proxy is `{ u: rowOf(inputU), o: rowOf(inputO) }`. Because the reference names the node, not a SQL alias, the same `Expr` stays valid no matter how the compiler later nests or flattens the query; aliases are the compiler's business.

Using a proxy from one node inside a callback for another (`orders.where(u => users_row.email.eq(...))`) is a type error when the row types differ and a validation error (`unbound_column`, naming both nodes) when they do not. The validator catches it by walking every `Expr` and checking that each `ColumnRef.rel` is reachable from the node it sits on.

Sharing is by object identity. If `registeredUsers.ir` is the `input` of two nodes, the compiler sees one node with two parents, and that is the signal for CTE extraction. No structural hashing in v1.

### Type-level machinery

These types do the work; keep them in one file, `types.ts`, with the type tests beside them.

```ts
type Mode = 'row' | 'grouped' | 'agg'
declare class Expr<T, N extends string = never, M extends Mode = 'row'> { /* generated methods */ }
type Grouped<T, N extends string = never> = Expr<T, N, 'grouped'>   // a column inside an aggregate callback
type AggExpr<T, N extends string = never> = Expr<T, N, 'agg'>       // what an aggregate function returns

type Row<R>        = { readonly [K in keyof R]: Expr<R[K], K & string> }            // homomorphic on purpose: inference and spreads work
type GroupedRow<R> = { readonly [K in keyof R]: Expr<R[K], K & string, 'grouped'> }
type Infer<O> =
  O extends TableDef<infer R> ? R :                                          // Infer<typeof db.x>
  O extends Expr<infer T, infer N, any> ? { [K in N]: T } :                  // single-expression form
  { [K in keyof O]: O[K] extends Expr<infer T, any, any> ? T : never }
type Nullable<R>   = { [K in keyof R]: R[K] | null }
```

`Expr` is one class with a private brand and three phantoms: the value type `T`, the root column name `N`, and the mode `M`. `Grouped` and `AggExpr` are the same class in another mode, so the generated method surface exists once, generic over `M`. Every method returns its receiver's mode; a binary method's other operand must be of the same mode or a constant (a JS value, `val`). Methods that only make sense for some `T` are declared with a `this` parameter (`gt(this: Expr<number | bigint | Date | Decimal, any, any>, …)`), so they are listed but not callable elsewhere, which is what the negative tests assert. Methods use method syntax, never property-function syntax, on purpose: method parameters are bivariant, and that is what lets a generic helper such as `latest` compare `Expr<R['version']>` with `Expr<number>` without a cast; do not "fix" it to strict function types. Nullable columns keep their methods: `Expr<string | null>` has `like`, returning `Expr<boolean | null>`, and `where` accepts `Expr<boolean | null>` because ClickHouse treats NULL as false there. Raw `sql` fragments are `'row'` mode, so they cannot be used inside an aggregate callback in v1.

Aggregation is a two-stage call that builds one node. `q.groupBy(key)` returns a `GroupedQuery<R, K>`: not a `Query`, no `where` or `map`, one method, `aggregate(f)`, which returns `Query<Infer<K> & Infer<A>>` and creates the `Aggregate` node. `q.aggregate(f)` is the same with no key and yields one row. `f` receives `GroupedRow<R>`, whose columns are in mode `'grouped'`, so `g.status.eq('paid')` is `Grouped<boolean>`. Aggregate functions are standalone and are the only things that accept `'grouped'`; they return `'agg'`: `sum(g.stock_index)` is `AggExpr<number>`. `'agg'` keeps the full method set, so a ratio of sums is `sum(a).divide(sum(b))`, and free functions such as `exp` take any mode and return the same one; mixing `'agg'` with `'grouped'` in one expression is a mode mismatch at compile time. `map` and `where` accept `'row'`, `aggregate` requires `'agg'`; that is the whole trick that makes the non-aggregated-column error compile-time. `count()` takes no argument; the full aggregate set is in the catalog table below. Combinators are the suffix, matching ClickHouse's naming.

Ordering uses the same two-stage pattern. `q.orderBy(f)` returns `OrderedQuery<R>`, which is a `Query<R>` plus one extra method, `thenBy(f)`; every other operator returns a plain `Query<R>`, so `thenBy` after `where`, `map` or `limit` is a type error, not a runtime one. `f` returns an `Ordering` (`r.x.asc()`, `r.x.desc()`, optionally `.nullsFirst()` or `.nullsLast()`) or a bare `Expr`, which means ascending. `thenBy` builds a new `Sort` node with the previous keys plus the new one; it never nests one `Sort` in another. `orderBy` on an `OrderedQuery` starts a fresh ordering.

`LIMIT BY` is also two-stage. `q.limitBy(f)` returns an intermediate whose only method is `take(n)`: it is not a `Query`, builds no node and cannot be compiled. `take(n)` builds the `LimitBy` node and returns `LimitByQuery<R>`, a `Query<R>` plus one extra method, `offset(m)`, which builds a new `LimitBy` with the same input and keys (never a nested one) and returns a plain `Query<R>`. `f` returns one row `Expr` or an array of them; an `Ordering` is rejected.

`from()` returns `TableQuery<R>`: a `Query<R>` plus `final()` and `sample(fraction)`, both of which return `TableQuery<R>` so they chain, while every other operator drops back to `Query<R>`, so `.where(…).final()` is a type error. Joins are the free functions `join`, `leftJoin`, `rightJoin`, `fullJoin` and `crossJoin`. `join` and `crossJoin` take a record of two or more inputs and apply one kind to all of them. The outer joins are binary, `leftJoin({ c }, { a })`: exactly two arguments, each a record with one aliased input, because a TypeScript object type carries no key order and so cannot say which input is preserved. A three-way outer join is one outer join nested in another, and mixed kinds are written the same way. Which inputs become `Nullable` in the row: for `leftJoin` the second, for `rightJoin` the first, for `fullJoin` both (descriptor-faithful, see Decided), for `join` and `crossJoin` none. Each `on` condition must be an `eq` between columns of two different inputs (`join_condition_arity` otherwise); for an inner join any further condition is accepted and moved above the join as a `Filter`, which gives the same rows; for an outer join a non-equality condition is `join_condition_not_equi`.

`groupBy`, `aggregate` and `map` each take either an object (`r => ({ userId: r.user_id })`) or a single expression (`r => r.user_id`). The single form is named by the Polars rule: an expression keeps the name of its root column, so `o.placed_at.toStartOfMonth()` is `placed_at` and `sum(g.stock_index)` is `stock_index`; a function with no column argument is named after itself, so `count()` is `count`; `argMax(g.id, g.amount)` takes the name of its first argument. The name is the phantom `N` on `Expr` and `Grouped`, set by `Row<R>` and propagated by every generated method and free function. An expression with no root column (`val(1, col.UInt8)`, a `sql` fragment) has `N = never` and is rejected in single form with `unnamed_expression`; a key and an aggregate that resolve to the same name are rejected with `duplicate_column`. Both say to use the object form, which is always available and is the only way to choose a different name. The phantom shows in hover text as `Expr<number, "stock_index">`; that is accepted.

Spreading a join side into a projection works because `Row<R>` is a plain object: `map(r => ({ ...r.c, partId: r.p.entityId }))` infers `ComponentRow & { partId: string }`. Nested objects in `map` output are not supported in v1; the validator rejects them with `nested_projection`, and the types reject them first because a nested object is not an `Expr`.

Parameters: a plain JS value where an `Expr` is expected (`c.countOfParts.gt(3n)`, `p.lifecycleStatus.in(['EOL'])`) becomes `Param { type: null }`, and the compiler assigns its type from the sibling operand (`in` lists get `Array(<sibling type without Nullable>)`). With no typed sibling, which happens in `multiIf` branches and in `val(x)`, a JS primitive takes a default: `string` → `String`, `boolean` → `Bool`, `number` → `Float64`, `bigint` → `Int64`, `Date` → `DateTime64(3)`, an array → `Array(<default of its first element>)`. `val(x, col.X)` overrides the default; `null`, an empty array, or an object with no typed sibling is `param_untyped`. The builder never inlines a value into SQL text. The library, not the driver, serialises parameter values: `bigint` and `Decimal` as decimal strings, `Date` as `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD HH:MM:SS.mmm` in UTC depending on the target type, arrays as ClickHouse array literals, so precision never depends on the driver's formatter.

### Function catalog

Three tiers. Adding a function is one entry in tier 1, or nothing at all in tier 2, and never a change to `Expr` itself.

**Tier 1, typed.** Hand-written entries in `packages/core/src/catalog/<category>.ts`:

```ts
export const toStartOfMonth = defineFunction({
  name: 'toStartOfMonth',        // the ClickHouse name; what is emitted unless sqlName is set
  args: [dateLike],              // matchers: a col.* type, or anyType | numeric | stringLike | dateLike | arrayOf(T) | mapOf(K, V)
  returns: col.Date,             // a type, 'arg0' (same as the first argument), promote (numeric promotion),
                                 // or (args: CHType[]) => CHType for structural functions: arrayElement, element, get, arrayDistinct
  nullable: 'propagate',         // 'propagate' (any null argument makes the result nullable; default) or 'never' (coalesce, isNull)
  deterministic: true,
})

export const sum = defineAggregate({ name: 'sum', args: [numeric], returns: promoteSum, linear: true })
export const quantile = defineAggregate({ name: 'quantile', params: [col.Float64], args: [numeric], returns: col.Float64, linear: false })
```

`defineAggregate` adds `linear` and optional `params` (parametric aggregates: `quantile(0.95)(x)`); the `If`, `State` and `Merge` combinators are derived from every aggregate entry, not listed. `js` is a reserved optional slot on both, always absent in v1.

`Expr` methods are generated, never hand-written: `scripts/gen-expr-methods.ts` reads every tier-1 entry and writes `expr-methods.generated.ts` (runtime) and `expr-methods.generated.d.ts` (overloads, numeric promotion, nullable propagation), once, generic over the mode `M`, so one surface serves `Expr`, `Grouped` and `AggExpr`. The TS return type of an entry whose `returns` is a function is written by hand in the entry as a type-level counterpart (`tsReturns`), because the generator cannot derive it from a runtime function; the type/runtime snapshot test in Testing catches the two drifting apart. Functions that read badly as methods are exported as free functions only (`multiIf`, `concat`, `ifElse`, every aggregate). Naming: comparisons are short (`eq`, `ne`, `lt`, `le`, `gt`, `ge`), booleans are `and`, `or`, `not`, and everything else keeps the ClickHouse name (`plus`, `multiply`, `toStartOfMonth`, `ifNull`); `sqlName` on the entry records the ClickHouse spelling when they differ (`get` → `arrayElement`, `contains` → `mapContains`).

The v1 typed set:

| Category | Functions |
| --- | --- |
| Comparison | `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `between`, `in` (array or single-column `Query`), `notIn`, `isNull`, `isNotNull` |
| Boolean | `and`, `or`, `not` |
| Ordering | `asc`, `desc` (return `Ordering`, not `Expr`); `Ordering.nullsFirst()`, `.nullsLast()` |
| Arithmetic (promoting) | `plus`, `minus`, `multiply`, `divide`, `intDiv`, `modulo`, `negate`, `abs`, `round`, `floor`, `ceil`, `greatest`, `least`, `exp`, `log` |
| Null handling (`nullable: 'never'`) | `coalesce`, `ifNull`, `nullIf`, `assumeNotNull`, `toNullable` |
| Conditional | `ifElse` (ClickHouse `if`), `multiIf` |
| Subquery | `scalar(q)`: a one-row, one-column `Query` as an `Expr`; `in(q)` above |
| String | `length`, `empty`, `notEmpty`, `lower`, `upper`, `concat`, `substring`, `trim`, `trimLeft`, `trimRight`, `startsWith`, `endsWith`, `like`, `notLike`, `ilike`, `position`, `replaceAll`, `replaceRegexpAll`, `splitByChar`, `toString` |
| Date and time | `now`, `today` (both non-deterministic), `toDate`, `toDateTime`, `toStartOfDay`, `toStartOfWeek`, `toStartOfMonth`, `toStartOfQuarter`, `toStartOfYear`, `toYear`, `toMonth`, `toDayOfMonth`, `toDayOfWeek`, `toHour`, `toYYYYMM`, `dateDiff`, `dateAdd`, `dateSub`, `addDays`, `subtractDays`, `addMonths`, `formatDateTime`, `toUnixTimestamp` |
| Conversion | `toInt32`, `toInt64`, `toUInt64`, `toFloat64`, `toDecimal64`, `toString`, `cast` |
| Array | `length`, `empty`, `notEmpty`, `has`, `hasAny`, `hasAll`, `arrayElement`, `indexOf`, `arrayDistinct`, `arraySort`, `arraySum`, `arrayConcat`, `arrayStringConcat` |
| Tuple | `element` (`tupleElement`); on `Array(Tuple)` it is elementwise and returns an array |
| Map | `get` (`arrayElement`), `contains` (`mapContains`), `mapKeys`, `mapValues` |
| Hash | `cityHash64`, `sipHash64` |
| Aggregates | `count`, `countIf`, `sum`, `sumIf`, `avg`, `avgIf`, `min`, `max`, `argMin`, `argMax`, `any`, `anyLast`, `uniq`, `uniqExact`, `groupArray`, `groupUniqArray`, `quantile(level)`, `quantileExact(level)`; plus `<name>If`, `<name>State`, `<name>Merge` for each. Shipped: all three forms of `count`, `sum`, `avg`, `min`, `max`, `argMin`, `argMax`, `uniqExact`, `quantile`, `quantileExact`; `uniq` has `State` and `Merge` but no `uniqIf`. `any`, `anyLast`, `groupArray` and `groupUniqArray` are not in the catalog yet. `quantileState(level)`, `quantileMerge(level)` and the `quantileExact` pair take a level |

**Tier 2, known.** `typedhouse generate` also reads `system.functions` and writes `functions.ts`: `fn.<name>(...args: Expr<any>[]): Expr<unknown>` for every non-aggregate function and `agg.<name>(...)` returning `AggExpr<unknown>` for every aggregate, each entry carrying `deterministic` and `alias_to` from the table. The `deterministic` column is newer than the 24.3 minimum, so the generator first checks `system.columns` for it and, when it is absent, writes `deterministic: null`, which the live-capability computation treats as non-deterministic. The validator uses this file to reject names ClickHouse does not have and to compute the live capability. `.as(col.X)` declares the result type for inference and decoding and emits no CAST; `cast(x, col.X)` emits one. Nothing in this tier is hand-written, and it regenerates with the schema.

**Tier 3, trusted scalar SQL.** Finish a `sql` tagged template with `.as(descriptor)` before using it as an expression or predicate. The descriptor supplies inference and runtime conversion metadata; it neither emits a CAST nor verifies the server's result. Template text is trusted SQL, not parsed or sanitized. Interpolations occupy expression positions: supported JS values become parameters and row expressions bind references. They cannot supply identifiers, keywords or SQL fragments; grouped and aggregate operands are rejected. Snippets are opaque and remove live capability. There is no public generic `sql<T>` or `sql.relation` API.

**User extension scope.** Public `defineFunction`, `defineAggregate`, `extendExpr` and declaration-merging extension hooks were removed by owner decision. Catalog definitions above are internal implementation machinery, not an application extension API. Use generated known functions or trusted scalar snippets for functions outside the typed catalog; relational composition stays in the query builder.

## Part 3: compiler and execution

`compile(rel): CompiledQuery` runs five stages in a fixed order. Each stage is a pure function from IR to IR (or IR to SQL at the end), unit-tested on its own, so a wrong rewrite is found by the stage's test and not by a ClickHouse error three layers later.

1. **Validate and resolve.** Walk the graph once. Bind every `ColumnRef` to its node and fail on `unbound_column`. Assign a `CHType` to every `Expr` bottom-up from the catalog; assign `Param` types from the sibling operand (`amount > {p0}` gives `p0` the type of `amount`; two untyped params in one comparison is `param_untyped`). Reject `AggExpr` outside `Aggregate.aggs`, `Grouped` references outside an aggregate call, and `map` outputs that are not flat. Output: the same graph, fully typed, plus a parent-count map.
2. **Logical rewrites.** Apply the rules in the table below to a fixpoint. Merge and push-down rules run to a fixpoint, then PruneColumns runs once. Each merge or push-down strictly decreases a measure (node count, or the sum of Filter heights), so termination is by construction; still cap at 50 iterations and fail loudly.
3. **Block planning.** A block is one SELECT with its clause slots in SQL order: FROM (a scan, or derived tables joined left-deep, with at most one ARRAY JOIN), WHERE, GROUP BY, HAVING, the select list (optionally DISTINCT), ORDER BY, LIMIT BY, LIMIT/OFFSET. Walk each chain bottom-up. A node folds into the current block when its slot is empty and no slot later in that order is filled yet; otherwise the current block becomes a derived table and the node opens a new one. `Scan` opens a block. `Join` takes its inputs' blocks as FROM items (a bare scan stays a table, anything else is a derived table). `Prewhere` stays on its `Scan`, as part of FROM after any ARRAY JOIN and before WHERE, and an aggregate or any other node folding on top keeps it. `Filter` is WHERE while GROUP BY is empty and HAVING once it is filled. `Project` is the select list, substituting into one already there. `Aggregate` fills GROUP BY and the select list together. `Distinct` sets the DISTINCT flag. `Sort`, `LimitBy` and `Limit` fill their slots; `LimitBy` folds over a projection only when it is a selection of columns under their own names, since `v % 2 AS k … LIMIT 1 BY k` binds the alias. `ArrayJoin` folds when the block has no ARRAY JOIN yet and its FROM is a single scan, since ClickHouse allows one ARRAY JOIN clause per SELECT. `Union`, `RawRel` and `Materialize` always open a block; any node with more than one parent becomes a CTE. So `groupBy().aggregate().where().orderBy().limit()` is one SELECT with GROUP BY, HAVING, ORDER BY and LIMIT, and a `where` after an `orderBy` starts a new one. Each block gets an alias `t0, t1, …` in emission order.
4. **Emit.** Render each block to a SELECT with named parameters `{p0:UInt64}`; wrap CTE blocks in `WITH t3 AS (...)`; append `SETTINGS`. Identifiers are always backtick-quoted. Every JS value in an expression is a parameter and `null` renders as `NULL`; `LIMIT`, `OFFSET` and `SAMPLE` values are node fields and render inline, as do validated `settings()` values, because `SETTINGS x = {p:UInt32}` is a syntax error. Interpolated values never become SQL text. Trusted scalar snippets are the explicit exception for caller-authored literal SQL: their template text is not sanitized, and untrusted input must go through parameter holes.
5. **Adapt driver values.** `CompiledQuery` carries result-column descriptors. The official ClickHouse client owns response parsing and streaming; a small descriptor-based adapter preserves supported bigint and Date conversions, recursively within supported arrays/tuples, plus non-finite-float compatibility handling. Decimal strings and Map objects retain their driver representations as specified in Part 1. Conversion plans are built once per compiled plan and reused across rows. A general decoder, exhaustive value validation and Map reshaping are outside the owner-approved scope; declared types must still match actual returned representations.

### Rewrite rules

The patterns below are subject to semantic safety guards, not unconditional rewrite permissions. Preserve existing fallible/opaque/volatile-expression fences and alias-capture checks. Predicate pushdown and conjunct splitting require the whole predicate to satisfy the admitted total fragment; merging filters must also preserve fallible input computations and evaluation boundaries. The results-only contract does not authorize removing these guards. A rule's “always” means no additional shape-specific condition, not an exception to these safety requirements.

| Rule | Pattern | Result | Condition |
| --- | --- | --- | --- |
| MergeFilter | `Filter(Filter(x, a), b)` | `Filter(x, a AND b)` | always |
| MergeProject | `Project(Project(x, p), q)` | `Project(x, q[p])` (substitute) | `p` has no `Raw` or non-deterministic expr referenced twice in `q` |
| PushFilterProject | `Filter(Project(x, p), c)` | `Project(Filter(x, c[p]), p)` | `c[p]` only references columns of `x` |
| PushFilterJoin | `Filter(Join({a, b}), c)` | `Join({a: Filter(a, c)}, b)` | `c` references only one input; for `inner` and `cross` any input; for `left` only the first input; for `right` only the last; for `full` none; for `asof`, inner or left, only the first input; conjunctions are split first |
| PushFilterArrayJoin | `Filter(ArrayJoin(x, e, alias), c)` | `ArrayJoin(Filter(x, c), e, alias)` | `c` does not reference `alias` |
| PushFilterUnion | `Filter(Union(xs), c)` | `Union(xs.map(x => Filter(x, c)))` | always |
| PushFilterAggKey | `Filter(Aggregate(x, k, a), c)` | `Aggregate(Filter(x, c[k]), k, a)` | `c` references only key columns |
| LeftToInner | `Filter(LeftJoin({a, b}), c)` | `Filter(InnerJoin({a, b}), c)` | `c` is null-rejecting on a column of `b` (`b.x = …`, `b.x > …`, `b.x IS NOT NULL`); never for `asof` |
| PruneColumns | any node | insert `Project` under it selecting only columns its ancestors use, in the source's declared order; a shared node keeps the union of its parents' needs | once, top-down, after the others reach fixpoint |

Two rules deserve a word on ClickHouse. `PushFilterJoin` is the one that pays: ClickHouse builds the right side of a hash join fully in memory, so a filter that stays above the join means hashing rows that are thrown away a moment later. `PruneColumns` is the other: ClickHouse reads columns, not rows, and `SELECT *` on a wide MergeTree table is the most common performance mistake in hand-written queries. The compiler must never emit `*`; the naive emitter may.

Not in v1: pushing `Limit` into a `Sort` under a `Union`, join reordering, pulling filters into `PREWHERE` (ClickHouse moves them itself with `optimize_move_to_prewhere=1`, the default), and anything that needs table statistics.

### Emission details

- Join strictness is `ALL` and the kind is spelled in full: `INNER ALL JOIN`, `LEFT ALL JOIN`. `ANY` is not exposed in v1; CROSS JOIN carries no strictness word. `Join.strictness: 'asof'` prints `ASOF INNER JOIN` or `ASOF LEFT JOIN`, with the inequality last in `ON`.
- When any `left`, `right` or `full` join is present (`ASOF LEFT` included), append `SETTINGS join_use_nulls = 1`. Without it ClickHouse fills the unmatched side with type defaults (`0`, `''`, `1970-01-01`), and the `Nullable<OrdersRow>` type would be a lie. This is the one place the compiler changes a server default; it is documented in the generated SQL as a trailing comment.
- Always append `date_time_output_format = 'iso'`, `output_format_json_quote_64bit_integers = 1`, `output_format_json_quote_decimals = 1`, `output_format_json_quote_denormals = 1` and `http_write_exception_in_output_format = 0` as query settings on execution (not in `toSQL()` output, which is for humans). The last makes a server before 25.11 end a failed response as plain text instead of a final `{"exception": ...}` line, which cannot be told from a row of a real `exception` column. `@clickhouse/client` 1.13 is the floor: 1.11 does not export `parseError`, so the client fails to load, and 1.12 does not read the tagged error framing of newer servers.
- A root `Settings` node appends its settings to the tail, in the caller's order and before the compiler's own: `… SETTINGS max_threads = 2, join_use_nulls = 1 /* join_use_nulls = 1: … */`. `compile` and `emitNaive` peel it before validation, so the input is the query root for every check (`from(rollup).settings(…)` still raises `aggregate_state_selection` at `root`) and `columns` and `columnPaths` come from the input. Below the root it raises `invalid_settings_placement`. A tail `SETTINGS` covers subqueries, CTEs and every `UNION ALL` branch in the shape the compiler emits; only a parenthesized union ignores it, which the compiler does not emit. SQL `SETTINGS` also overrides HTTP parameters, and the keys never collide because compiler-owned keys are not settable.
- `Scan.final` renders as `FROM t FINAL`; `Scan.sample` as `SAMPLE 0.1`. Both are per-scan and survive all rewrites unchanged.
- `Prewhere` renders as `FROM t AS alias FINAL SAMPLE 0.1 [ARRAY JOIN …] PREWHERE p WHERE q`, with `p` qualified by that alias and parameters numbered in that textual order. The naive form is one SELECT with its `Scan`. A `WHERE` before `PREWHERE` is a syntax error.
- `Materialize` in v1 renders as an ordinary CTE and logs a warning that materialization is not yet implemented; the node exists so the API is stable. Real materialization (a `TEMPORARY TABLE` inside an HTTP session) is milestone 7.
- CTE naming: `WITH t3 AS (SELECT …)`. ClickHouse inlines CTEs, so a CTE is for readability and for deduplicating the graph, never for performance; the shared-node check still matters because without it the *IR* would be emitted twice.
- `GROUP BY` repeats the key expressions, never their aliases, because a key alias often shares its name with a source column (`category` in the `lowStockCategories` example) and the compiler should not depend on `prefer_column_name_to_alias` to pick the right one; a parameter inside a repeated expression keeps its name. `HAVING` and `ORDER BY` reference output aliases, which ClickHouse allows and which is unambiguous there under the default `prefer_column_name_to_alias = 0`. Never re-expand an aggregate expression in `HAVING` or `ORDER BY`.

Join inputs and ARRAY JOIN: an input that is a bare `Scan` renders as `table AS alias` (both quoted); anything else renders as a derived table, `(SELECT …) AS alias`. Column pruning puts a `Project` under nearly every scan that feeds a join, so nearly every join input is a derived table; that is intended, and it is what the `lowStockCategories` SQL in API examples shows. A `Join` with more than two inputs (an inner join) renders as a left-deep chain in input order, `FROM a JOIN b ON … JOIN c ON …`, with the kind repeated on every clause; each `on` condition is attached to the first clause at which both of its inputs are in scope. User join aliases are used as written; one that collides with a CTE name (`t0`, `t1`, …) gets an underscore appended. An `ArrayJoin` renders as `ARRAY JOIN expr AS alias` (or `LEFT ARRAY JOIN`) directly after the `FROM` item, after `FINAL` and `SAMPLE`, and the alias is a plain column for the rest of the block. Inside one block the topmost `Project` is the select list; a pruning `Project` sitting directly on the block's own `FROM` scan is not emitted (ClickHouse reads only the columns the block references), it only limits what the block may reference. A `scalar()` subquery renders inline as `(SELECT …)`; ClickHouse evaluates it once per query. A select item that is a bare column under its own name emits no `AS`; everything else is aliased. Parameters are numbered `p0, p1, …` in order of first appearance in the emitted text; two `Param` nodes with equal values are two parameters; a `Param` referenced from two places keeps one name.

### Simple insert commands

Approved scope extension: build a type-safe bulk insert from a table descriptor and execute it explicitly. This is not an ORM or a general mutation API.

```ts
const command = from(foo).insertMany(rows)
await client.execute(command) // Promise<void>
```

**Builder and typing.** `insertMany` accepts a readonly array of row objects inferred from the table descriptor and returns an `InsertCommand`, not a `Query`. Building a command performs no I/O. Export `InsertRow<typeof foo>` for callers who want to annotate reusable input arrays. Writable columns without a declared `DEFAULT` are required; `Nullable` permits `null`, not omission. Columns with a declared `DEFAULT` may be omitted. `ALIAS`, `MATERIALIZED`, hidden and unknown columns are not writable. Preserve literal column metadata through `table()` and codegen so the type-level rules match runtime behavior. Widened metadata must not silently make required columns optional.

`insertMany` is available only on the direct result of `from(table)`, not after `final()`, `sample()`, filters, projections, joins or other read operators. Existing SELECT chaining remains compatible. An insert command has no read operators, relational IR or `toSQL()` method. `run` and `stream` reject insert commands at compile time; `execute` rejects SELECT queries at compile time. Reject extra input properties even for inferred row variables, not just fresh object literals; runtime validation also checks column eligibility and required fields for JavaScript callers.

**Values and defaults.** Reuse the existing JavaScript value model: `bigint` for wide integers, `Date` for supported date/time descriptors, branded strings for decimals, and recursive arrays/tuples. Do not stringify arbitrary objects or silently coerce incompatible values. Omission invokes a declared server default; explicit `null` remains null and explicit `undefined` is invalid. Rows in one command may omit different defaulted columns, and supplied values must never be replaced by defaults. The transport must preserve these semantics explicitly rather than depend on the driver's or server's default settings. Types without a supported insert encoder must be rejected before any network request, not accepted merely because their read type is `unknown`. The implemented descriptor matrix is:

- Signed/unsigned integers of 8/16/32 bits accept integral, range-checked `number`; 64/128/256 bits accept range-checked `bigint`, encoded as decimal strings. `Float32`/`Float64` accept finite numbers (`Float32` also checks its finite magnitude bound), `Bool` accepts boolean, `String` accepts string, `UUID` accepts canonical hyphenated hexadecimal strings, and Enum8/16 accept only declared string labels.
- `Date` and `Date32` accept valid `Date` objects at exactly UTC midnight, encoded as `YYYY-MM-DD`. `Date` ranges from epoch day 0 through 65535; `Date32` ranges from 1900-01-01 through 2299-12-31. `DateTime` (including timezone descriptors) accepts whole-second instants from epoch second 0 through 4294967295 and encodes epoch seconds. `DateTime64(p)` supports only `p = 0..3`, with instants in [1900-01-01, 2300-01-01) exactly aligned to that precision, encoded as UTC ISO strings with `date_time_input_format=best_effort`. No rounding, truncation, local-time reinterpretation or high-precision string input is performed.
- `Decimal(p,s)` accepts the existing branded string value type; runtime validation requires plain signed decimal notation (no exponent or plus sign), at most `s` fractional digits and at most `p-s` significant integer digits. Precision is 1..76 and scale 0..p. Strings are preserved, never routed through floating point or rounded.
- `Nullable`, `LowCardinality` and `Array` recurse through supported descriptors. Positional tuples require exact-length arrays; fully named tuples require exact-key plain records. Mixed named/unnamed tuples are unsupported.
- `FixedString`, IPv4/IPv6, JSON, Nothing, Map, Nested, Variant, Dynamic, aggregate-function descriptors, Unknown and `DateTime64` precision above 3 are unsupported, including inside wrappers/containers even for `null` or empty arrays. Erased/widened descriptors fail closed for supplied values. An unsupported column with a definite `DEFAULT` may still be omitted; a required unsupported column prevents non-empty inserts. Empty batches remain no-ops.

The native-tested ClickHouse 24.8 workaround for dependent defaults in mixed-presence blocks is `max_insert_block_size=1`, alongside explicit omitted-field/default settings; without it, defaults can ignore supplied sibling values. It retains one request but forces one-row parser blocks, with substantial bulk-throughput cost. Apply it only when rows have different sets of supplied columns (independent of object key order). Homogeneous omissions use normal block sizes; native MergeTree tests cover supplied dependencies, transitive defaults, and batches crossing parser boundaries. Mixed-presence inserts remain correctness-first and can be substantially slower.

**Execution.** `client.execute(command): Promise<void>` uses the official ClickHouse driver's bulk `insert()` API, not the SELECT compiler or interpolated SQL values. Table and column identifiers are safely quoted; row values travel as data in the insert payload. The existing `{p:Type}` parameter rule continues to apply to SELECT expressions, not bulk-insert payloads. An empty row array is a successful no-op with no network request. Validate and encode the entire batch before sending any of it. Snapshot input values when constructing the command so later mutation of caller-owned rows, arrays or dates cannot change an execution.

Keep the read-only `Backend` contract compatible: add an optional write capability for `execute`, rather than require every backend to implement inserts. `createClientFromBackend` exposes `execute` and reports a clear unsupported-operation error for non-empty inserts when the backend lacks that capability. The standard ClickHouse backend supports it independently of its SELECT compilation mode.

No library-managed retries, transactions, exactly-once guarantee or automatic deduplication. Re-executing a command issues another insert. A transport failure can leave the write outcome unknown; callers must not assume retrying is safe. Wrap driver failures in an insert-specific error retaining the cause and target table, without logging row payloads or inventing a SELECT IR node. The initial API has no returned rows, affected-row count, streaming inputs, insert-from-select, conflict handling, updates, deletes or DDL.

**Acceptance criteria.** Ship runtime unit tests, positive and negative type tests on the supported TypeScript matrix, declaration snapshots, and native ClickHouse integration tests. Cover required/default/generated/hidden columns, extra properties on variables, null versus omission versus undefined, heterogeneous default omissions, empty batches, immutable command inputs, supported scalar/container round trips, unsupported descriptors, quoted identifiers, backend write capability, and transport failures without retries. Native tests must verify stored values through SELECT and exercise server defaults that differ from type defaults. Record verification evidence in `TODO.md` when implemented; implementation and local verification do not imply that the feature has been published.

### Execution

`client.run(q)` compiles, executes with `@clickhouse/client`'s `query()` using `format: 'JSONEachRow'` and `query_params`, decodes, and returns `Promise<R[]>`. `client.stream(q)` returns an `AsyncIterable<R>` over the official driver's streamed batches. Parsing, buffering and backpressure are delegated to that driver; a separate one-HTTP-chunk buffering guarantee is outside the approved scope. The actual 10M-row/<200 MB heap acceptance test remains mandatory. Compilation is memoized on the `Rel` object identity, so a query built once and run in a loop is compiled once.

SELECT errors: a ClickHouse error is wrapped in `QueryError { sql, params, cause, node? }`, including one raised after output started, which arrives under HTTP 200 as the end of the body: a JSONEachRow line is always a JSON object, so a line that does not parse and starts `Code: N.` is that error, and `cause.code` is `N`. `client.stream` may yield rows before it throws. Server errors, `KILL QUERY` and server `SIGTERM` (both code 394), server `SIGKILL` and dropped connections (`ECONNRESET`) all surface as errors, measured on 24.8. A proxy that forwards part of the body and then ends the HTTP response cleanly cannot be detected: `run` and `stream` end normally with short rows and no error (measured with about 7,000 of 3M rows, cut mid-line or at a line end). When the server's message names a column or alias, the compiler's alias map is used to point `node` at the IR node that produced it; this is best-effort and must never throw while building the error.

## Part 4: incremental engine (reserved, not built now)

A DBSP-style incremental engine (Z-sets with integer weights; every operator keeps only the state its delta rule needs) is a later milestone. It is not built in this pass, and not the Rust `dbsp` crate when it is: that crate targets x86\_64 Linux only, depends on tokio and feldera-storage, and its maintainers do not support embedding. The plan is a TypeScript implementation of the paper's ten operators over the same IR, so it runs in the browser and in Node. What this pass owes that milestone is the eight constraints below. Each costs an hour or less in milestone 3 and would cost a rewrite if added after.

| Keep from milestone 3 | Why it matters later |
| --- | --- |
| Each catalog entry has its SQL rendering (`name`, `sqlName`), a `js` slot (optional, left empty in v1), `deterministic: boolean`, and for aggregates `linear: boolean` (`sum`, `count`, `avg` true; `min`, `max`, `argMax`, `uniqExact`, `groupArray` false). `now`, `rand`, `today` are `deterministic: false` | A Z-set engine interprets the same graph; nothing ClickHouse-shaped has to be undone |
| Each catalog entry has `its SQL rendering (name, sqlName), a js slot` (optional, left empty in v1), `deterministic: boolean`, and for aggregates `linear: boolean` (`sum`, `count`, `avg` true; `min`, `max`, `argMax`, `uniqExact`, `groupArray` false). `now`, `rand`, `today` are `deterministic: false` | `js` is what the engine evaluates; `linear` decides whether a group keeps an accumulator or its whole input; `deterministic` decides whether a query can be live at all |
| `Raw` nodes carry `opaque: true` and the validator records which nodes contain one | A `sql` escape hatch cannot be evaluated outside ClickHouse, so it removes the live capability |
| `Query<R, C extends Caps = Caps>` with `Caps = { live: boolean }`, computed from day one: `from(t)` is live iff `t.source` is set (never, in v1); `join` and `union` AND their inputs; `Raw` and non-deterministic calls make it false. `type IsLive<Q>` is exported. No method reads it yet; the names `live()` and `changes()` are reserved and not declared | `.live()` on a query that cannot be live becomes a compile error the day the method exists, with no migration |
| `table()` takes an optional `source?: ChangeSource`; `ChangeSource` is `{ readonly kind: string }` and codegen never sets it | Binding a Postgres slot, Kafka topic or WebSocket feed to a table later is a field, not a schema redesign |
| One value model. The decoded ClickHouse row (`bigint`, `Date`, `Decimal` as branded string, `null`) is the only row representation in the codebase. `canonicalKey(row, columns): string` lives in `@typedhouse/core` and the differential test uses it to compare row sets | The same key function is the Z-set key; the engine never needs a second encoding |
| `Backend` interface in `@typedhouse/client`: `{ name: string; compile(rel: Rel): Plan; run(plan: Plan): AsyncIterable<unknown[]> }`. V1 ships two implementations, `clickhouse` and `clickhouse-naive`, and the test harness takes backends as plugins | The incremental engine is a third plugin in the same harness, and its acceptance test is the differential test that already exists |
| `Param` stays its own node through compilation; it is never folded into `Literal` at build time | A parameter becomes a declared input stream under IVM (the paper's changing scalar); a literal cannot |

What that later milestone then contains, so its size is visible now: the Z-set engine (`filter`, `map`, `arrayJoin` as a flat map, `unionAll`, `join`, `groupBy`+`aggregate` with linear and non-linear aggregates, `distinct`, `sort`+`limit` as top-k), JS implementations for the catalog, source bindings and a transport, and `changes()` yielding per-step deltas plus `live()` as its integral. Estimated at two to three thousand lines of core code. Nothing in milestones 1 to 6 is reopened.

## Testing

The compiler is the risky part. Its correctness follows the results-only error contract under “Decided, and still open”, including its one named carve-out for resource limits: whenever naive SQL succeeds, optimized SQL must succeed with identical rows and types. If naive SQL fails, optimized SQL may fail or succeed; success must match an independent guard-first oracle in IR order. Existing stronger case-specific error checks and conservative fences remain.

**Differential testing (milestone 4 onward).** A `fast-check` arbitrary generates random IR trees over the fixture schema from API examples (six tables, seeded deterministically with nulls, duplicate versions, empty arrays and orphan ids). Each tree is emitted twice and run against testcontainers ClickHouse. For naive-success cases, compare result types and rows, preserving multiplicities (and order where the query specifies it). For naive-failure cases, apply the results-only contract above and check any optimized success against an independent guard-first oracle. Generated trees carry no user-set limits, so the carve-out for resource limits never excuses a failure here; a differential over `settings()` uses only performance settings, under which the same rows are expected. A failure shrinks to the smallest tree that violates the contract and prints both SQLs. Run 500 cases in CI, 10k nightly. Both paths exercise the client conversion adapter; independent native expectations remain necessary to catch shared conversion errors.

**EXPLAIN snapshots.** For the \~30 hand-written queries in the corpus (every example in API examples plus one per rewrite rule), snapshot `EXPLAIN PLAN` output and assert structurally: no `Subquery`-type step unless its child is a fence; no `ReadFromMergeTree` that reads more columns than the IR's pruned set. Snapshots of the SQL text itself are kept too, but only the `lowStockCategories` one is asserted byte-for-byte; the rest are review aids.

**Type tests.** Six checks, all under `tsc --noEmit` in CI, on TypeScript 5.5 and the current release; type code of this kind breaks across minor versions.

1. *Positive cases.* `expect-type` assertions for every example in API examples, using `toEqualTypeOf` (never `toMatchTypeOf`, which lets extra properties through) and `.not.toBeAny()` on every result. Generic helpers get their own assertions that they instantiate to concrete types: `expectTypeOf(latestIndices).toEqualTypeOf<Query<ComponentIndicesRow>>()`, `expectTypeOf(forTenant('acme'))` accepted by `where` on every fixture table.
2. *Negative cases, precisely.* `@ts-expect-error` alone is not enough: it passes on any error on the line, including the wrong one. The cases under What fails to compile live one per statement in `test/types/negative/*.ts`, each annotated `// expect: TS2339 Property 'thenBy' does not exist`, and a small harness over the TypeScript compiler API (`ts.createProgram`, collect diagnostics, match code and message substring per annotated line) fails on a missing, extra or different error. Where the design makes a method absent, the direct form is used as well: `expectTypeOf<keyof typeof q>().not.toMatchTypeOf<'thenBy'>()`.
3. *Type and runtime agree.* For every corpus query, a script derives the TS type from the query's runtime `columns` map (the Part 1 mapping applied in reverse) and writes it to `test/types/snapshots/<name>.d.ts`; the test asserts `expectTypeOf<Infer<typeof q>>().toEqualTypeOf<Snapshot>()`. This is the one test that ties the phantom `R` to the decoder: a method whose declared return disagrees with its catalog `returns`, or a decoder that disagrees with the mapping table, fails here.
4. *Compile performance.* `test/types/bench/` holds 200 corpus-shaped queries plus two pathological ones: a 25-step `map`/`join` chain and a 10-way join. `tsc --extendedDiagnostics` measures instantiations and wall time for source and built inputs. Instantiation ceilings are hard on every host and supported compiler; wall-time comparisons are advisory on every host class, including recorded reference hosts. Keep measurements and reference budgets, input-hash/policy checks, and hard failures for malformed metrics or compiler errors. Initial reference budgets use measured values with 50% headroom; changing a baseline or ceiling requires a note in the PR, not a silent rebaseline. One method surface generic over three phantoms, a name on every call and promotion-by-conditional-type are exactly the shape that becomes "excessively deep" or a 40-second build once a codebase has a few hundred queries, and this is where it is caught.
5. *Readable inferred types.* `tsc --declaration` on the corpus, snapshot the emitted `.d.ts`. A result type that degrades from a flat object into an `Infer<Row<…>>` chain in hover text fails the snapshot even though it is still correct.
6. *Generated surface.* The catalog-to-methods generator is deterministic (snapshot of `expr-methods.generated.d.ts`), and the generated declaration file compiles on its own, without the rest of the package.

**Codegen.** Snapshot of `schema.ts` from the DDL fixture; the type-parser corpus (`system.columns` output from a real cluster, checked in as JSON) parses and round-trips; a fuzz test feeds random strings to the parser and asserts it returns `Unknown` rather than throwing.

**Per-stage unit tests.** Each rewrite rule has a test with the pattern, the expected result, and the condition's negative case. Block planning has a table-driven test: IR shape in, block boundaries out. The emitter has string tests on small trees.

Fixtures live in `packages/compiler/test/fixtures/`: `schema.sql` (DDL), `seed.sql`, `columns.json` (the type corpus), and `corpus/*.ts` (the hand-written queries, each exporting `{ query, expectedSql?, run?: boolean }`, with `run: false` for the few the fixture cannot execute, such as `sample()` on a table with no sampling key).

## Decided, and still open

These are settled so the implementer does not relitigate them; change one only with a note in the PR saying why.

| Decision | Choice |
| --- | --- |
| Schema access | `db.<table>`, one database per generated file; no name conversion |
| Simple inserts (scope extension) | `from(table).insertMany(rows)` builds a separate command; `client.execute(command): Promise<void>` writes via the driver's bulk insert API. `run`/`stream` remain read-only. No automatic retries; see Simple insert commands |
| 64-bit integers | `bigint`, always; no `number` option, and no implicit `number` literals against them |
| Decimals | `col.Decimal(p, s)` canonical, as `system.columns` prints it; `col.Decimal32/64/128/256(s)` are sugar; exact branded `string` in TS with `output_format_json_quote_decimals = 1`, arithmetic in `Expr` only |
| Client conversion scope | Official-driver parsing/streaming plus the small compatibility adapter; supported bigint/Date conversions recurse through supported arrays/tuples, not Maps. Maps are driver objects typed `Record<string, unknown>`. No general decoder or separate one-HTTP-chunk proof; retain the actual 10M-row/<200 MB gate |
| User extensions and raw SQL | No public custom-function/declaration-merging extension API. Use the generated catalog and trusted scalar `sql` snippets completed with `.as(descriptor)`; no public `sql<T>` or `sql.relation` |
| Type-performance budgets | Instantiation ceilings hard everywhere; wall comparisons advisory on all host classes. Retain measurements/reference budgets and hard input-hash, policy, metric-validity and compiler checks |
| `Expr` | one class, three phantoms (`T`, name `N`, mode `M`); `Grouped` and `AggExpr` are modes, not classes; methods are generated from the catalog, use method syntax, and are gated by `this` parameters |
| Join row shape | nested `{ u, o }`; `...r.u` to flatten in `map` |
| Joins | `join`, `crossJoin` over two or more inputs, one kind each, left-deep emission; outer joins binary, `leftJoin`/`rightJoin`/`fullJoin(left, right).on(…)` with one aliased input per record (user ruling, M4 slice 4a: TS object types carry no key order, so a record cannot name the preserved input), three-way outer joins by nesting; `on` is equality only, extra inner-join conditions become a filter above, an outer join's `join_condition_not_equi` |
| Outer join nulls | `join_use_nulls = 1` emitted whenever an outer join is present |
| Outer join row types | Descriptor-faithful (M4 slice 4a, lead decision, checked against 24.8 `meta` per column kind): a null-extended input's column becomes `T \| null` / `Nullable(T)` only when ClickHouse can wrap it (scalars, `FixedString`, dates/times, `Decimal`, `Enum`, `UUID`, IPs, `SimpleAggregateFunction` over those); `LowCardinality(T)` and `SimpleAggregateFunction(f, LowCardinality(T))` → `LowCardinality(Nullable(T))` (the server drops that SAF wrapper); `Nullable`, `LowCardinality(Nullable(T))`, `Array`, `Map`, `Tuple`/`Nested`, `Variant`, `Dynamic`, `JSON`, `AggregateFunction` keep their type and the server default when unmatched. `Nullable<R>` above is the rule for wrappable columns only. Known limit, logged and not fixed: 26.10 returns `Nullable(Tuple(...))` and `NULL` for an unmatched `Tuple` under `join_use_nulls = 1`, against 24.3 and 24.8, so `leftJoin`, `rightJoin`, `fullJoin` and `asofLeftJoin` raise `decode_invalid` on such a row there. The descriptor stays the 24.8 one |
| Join strictness | `ALL`, written explicitly; `ASOF` through `asofJoin`/`asofLeftJoin` only; `ANY` not exposed |
| `ASOF JOIN` | (Track D) `asofJoin`/`asofLeftJoin(left, right).on(equalities).asof(inequality)`, one aliased input per argument, `{ live: false }`; `.on` returns a value whose only method is `.asof`. `Join.strictness?: 'asof'`, with the inequality the last element of `on`, so every walker needs no change and only the keyword and the rewrite fences read the field. `validate` on both emitters: `inner` or `left`, binary, last element a `ge`/`gt`/`le`/`lt` with one alias on each side (`invalid_asof_condition`), earlier elements equalities with one alias on each side (`join_condition_not_equi`, `join_condition_arity`), the kind's own output (`invalid_output`). `invalid_asof_type` refuses an operand outside integers, floats, `Bool`, `Decimal`, `Enum`, `Date`, `Date32`, `DateTime`, `DateTime64` and their `Nullable`, `LowCardinality` and `SimpleAggregateFunction` wrappers, and `LowCardinality` on both sides: each raises code 169, 386 or 43 on 24.3, 24.8 and 26.10. Other mixed pairs that raise 386 follow the engines rule and surface as `QueryError`. A right-side filter does not commute, also on `ASOF INNER`: `PushFilterJoin` admits only the left input, `LeftToInner` skips it, and no residual moves above the join, because a single-input `ON` condition filters before matching and the builder refuses it. An inequality between two direct columns does not fence `PushFilterJoin`, whatever its type. Ties are unspecified and not repeatable, and differential tests need unique right keys. `join_algorithm` stays out of the `settings` allowlist |
| Parameters | server-side `{p:Type}`; never inlined; typed from the sibling operand, else by JS primitive default (`String`, `Bool`, `Float64`, `Int64`, `DateTime64(3)`); serialised by the library; numbered by first appearance; equal values are still separate parameters |
| `GROUP BY` | key expressions repeated; `HAVING` and `ORDER BY` by alias |
| Shared subqueries | by object identity; CTE named `tN` |
| `SELECT *` | never emitted by the optimizing path |
| Minimum ClickHouse | 24.3 |
| Function names | comparisons short (`eq`, `ne`, `lt`, `le`, `gt`, `ge`), booleans `and`, `or`, `not`, everything else the ClickHouse name |
| Two-stage calls | `groupBy(…).aggregate(…)`, `orderBy(…).thenBy(…)` and `limitBy(…).take(…)` with optional `.offset(…)`; `from(…)` with `final()`/`sample()`/`prewhere()`; the intermediate has its one extra method and nothing else |
| Single-expression forms | `groupBy`, `aggregate`, `map` take one expression; named by the Polars rule (root column, else function name); unnamed or colliding names are errors that point to the object form |
| `ARRAY JOIN` | the `arrayJoin` and `leftArrayJoin` operators, in v1; one per SELECT block |
| Aggregate states | (Track D) `aggregate_state_selection` applies only to the query result and a `Subquery` result; a raw state returned to the client is binary in a JSON string and loses invalid UTF-8. Intermediate nodes carry states. A typed expression, sort key, `LIMIT BY` key, group key, nested `Distinct` or `UNION DISTINCT` reading one raises `aggregate_state_operand`, except a `-Merge` of the same function (another function or non-state raises `invalid_merge_state`, as do stored arguments the base function does not accept, except that `countMerge`, `uniqMerge` and `uniqExactMerge` read any stored arguments the server allows, because their result is always `UInt64`, as long as the type can be modelled: `AggregateFunction(uniq, Point)` raises `invalid_merge_state` and needs the known tier); known-tier calls and trusted `sql` snippets are exempt, because their result is the caller's declaration. State descriptors drop `LowCardinality` at every depth, as 24.8 does. Parametric states name their level in the type; the merge takes a level and that level decides the result, except that a state over a `Nullable` input accepts only its stored level (24.8 raises code 43 otherwise), and a stored `quantile(1)` or `quantile(0)` never equals the `Float64` merge parameter. A state nested in any container counts as a state for both rules, as does `Unknown` type text naming `AggregateFunction(`, ignoring Enum labels and quoted column names but not a quoted type name such as `"AggregateFunction"(sum, UInt64)` (fail closed, 24.8 returns binary otherwise). `Dynamic` is a declared pass-through: its type says nothing about its contents, so a state stored in one is not caught. Two-combinator forms stay rejected; any later `If` combination uses the `StateIf` order, because `sumIfState` does not feed `sumMerge` |
| Window functions | `sql` only in v1 |
| `LIMIT BY` | Builder operator, replacing the earlier "`sql` only" row, which raw queries could not honour (owner decision, feedback round 2026-11-05). `q.limitBy(by).take(n).offset(m)`, chosen by the owner over `limitBy(n, by, offset?)`: `limitBy` is not a query and builds nothing, `take` builds the `LimitBy` node, and `offset` is available only directly after `take`. Every key must read a column of the row (`invalid_limit_by_key`, in the builder and the compiler), because `LIMIT 1 BY 2` is positional on the server and so would name different columns in the naive and optimized select lists, and a constant makes one group. `n` and `offset` follow the `limit` rules and are inlined; the builder also rejects them early. The planner ranks it after `Sort` and before `Limit`, the only legal clause text; no rewrite rule crosses it. Not live |
| `PREWHERE` | Builder operator on `TableQuery` only (feedback round 2026-11-05): `from(t)[.final()][.sample(f)].prewhere(pred)` returns a plain `Query`, over an IR node `Prewhere { input: Scan, pred }` (a node, not a `Scan` field, because `hint()` gives a scan a new id on every call). Explicit only: a `Filter` is never promoted, a `Prewhere` never demoted, moved, merged, split or dropped, and its Scan edge never counts toward a CTE, because the server rejects PREWHERE over a subquery or CTE. Both emitters print it on the scan's SELECT, so they evaluate it on the same rows. `final().prewhere()` on a non-key column is allowed with no compile error (owner decision), and both emitters print the same `FINAL PREWHERE`, even though it can return a stale row version that `where()` would not; the docs carry the warning. The compiler does not check engines: the server's code 182 surfaces as `QueryError`. Not live |
| Error contract of the optimizing path | Results-only (user ruling, M4 slice 4d): whenever the naive emission succeeds, the optimized query returns identical rows and types and never fails; when naive fails, the optimized query may fail or succeed, and if it succeeds its rows equal a guard-first oracle (fallible expressions evaluated only on rows that pass the guards, in IR order). Reason: ClickHouse's filter order, PREWHERE and primary-key/part pruning make whether an error is raised plan-dependent (24.8 prunes the part holding a bad row from a guard above an isolated fallible WHERE), so naive's failures are partly an artifact of its nesting. Existing fences stay; relaxing them is a later decision. **Named carve-out (owner decision Q2, Track D):** under a user-set resource limit, codes 158 (`max_rows_to_read`), 159 (`max_execution_time`), 241 (`max_memory_usage`), 307 (`max_bytes_to_read`) and 396 (`max_result_rows`, `max_result_bytes`) are outside this contract, because the two paths read and allocate different amounts: either may raise one of these codes when the other succeeds. Whichever succeeds still returns the rows and types the contract requires. No other code and no other condition is excused. A limit reaches the client with its code, also after output started. Two client-side outcomes carry no server code and are not limit outcomes under this carve-out: the driver's `request_timeout` ending the query first, and, under `compression: { response: true }`, a damaged gzip body from 24.3 and 24.8 (`Z_DATA_ERROR`: 14 of 140 and 29 of 280 sweep cases, at limits as high as 999,999 rows; when it occurs is not established) or a reset connection from 26.10 (`ECONNRESET`: 17 of 140 sweep cases, repeatable, cause unknown). In those sweeps the query always failed or returned every row, never a short result |
| `SETTINGS` | (Track D, owner decision Q1) Terminal `q.settings({...})` over a root-only `Settings` `Rel` node; `{ live: false }`. The result has `ir`, `_rowType`, `caps` and `toSQL`, and is not a join, union or subquery input. The allowlist is exactly `max_threads`, `max_execution_time`, `max_memory_usage`, `max_rows_to_read`, `max_bytes_to_read`, `max_result_rows`, `max_result_bytes`, `max_block_size`, `max_bytes_before_external_group_by`, `max_bytes_before_external_sort`, `priority` and `log_comment`. Other keys raise `unknown_setting`, because open settings break the row contract (`limit`, `final`, `group_by_use_nulls`, the overflow modes set to `break`); `join_algorithm` stays out, because which algorithm works depends on the join shape and server version and the compiler does not check that (24.8: `direct` raises code 48 on joins between ordinary tables; `partial_merge` and `grace_hash` raise code 48 on `ASOF` but work on `INNER`, `LEFT`, `RIGHT` and `FULL`; 24.3 also rejects most values on `CROSS`). Compiler-owned and client-owned keys raise `compiler_owned_setting`. Values are validated literals, in the builder and again in the compiler for hand-built nodes: integer keys take a non-negative safe integer or a bigint up to `2^64 - 1`, `max_execution_time` takes `0` or `0.000001` to `9223372036854` seconds (truncated by the server to microseconds through binary floating point, so `1.001` reads back `1.000999`), and `log_comment` takes well-formed Unicode through the string escaper. A node keeps `Backend.compile(rel)` and the plan cache unchanged. `readonly = 1` raises code 164 for any change, which includes the client's output settings, so the client fails for such a user with or without `settings()`; `readonly = 2` accepts it. Resource limits follow the carve-out in the error contract. The promise that settings do not silently change rows covers deterministic results and assumes the server's default overflow modes: a client-level or profile `result_overflow_mode = 'break'` returns a partial result with no error, with an unpredictable row count (under `max_result_rows: 10`, 1000 rows on one fixture; on a 3M-row table 65,409 through a raw query and 16,384 through the client). `quantile`, float `sum`/`avg`, `any` and `argMax` ties vary with `max_threads`, and `quantile`, float `sum` and `any` between repeat runs with no settings; that comes from those functions. `count()` over a table ignores `max_rows_to_read` and `max_bytes_to_read` |
| Descriptor completeness | (M4 slice 4f) A table descriptor lists every column the server can resolve by name in a SELECT over that table (ALIAS and MATERIALIZED columns included), or names the ones it omits in the shadow-only `hiddenColumns` metadata option. Hidden names are never row fields or select items; the compiler's alias guards treat them as physical columns (an aggregate folded onto the table, also through filters, an ARRAY JOIN or plain column selections, checks its aliases against the table's full declared output plus `hiddenColumns`), because under `prefer_column_name_to_alias = 1` an output alias equal to a resolvable column binds that column (`HAVING hidden` → code 215 where the nested form succeeds). `typedhouse generate --skip-alias` writes the skipped ALIAS names there; `typedhouse check` warns when the live table has a column the existing descriptor neither declares nor hides. A descriptor that omits a resolvable column without declaring it is outside the results-only contract |
| Incremental engine | A TypeScript DBSP implementation over the same IR, later; not the Rust `dbsp` crate. The eight constraints in Part 4 are part of milestone 3 |

Still open, to decide during milestone 3 when the code makes the trade-off concrete:

- [ ] Whether `Query` exposes `.ir` publicly or behind a `Symbol`. Public is simpler for the compiler; a symbol keeps autocompletion clean for users.
- [ ] Whether `map` should allow one level of nesting (`{ part: { id, mpn }, total }`) in v1. The validator rejects it today; the decode path could support it cheaply via named `Tuple`.
