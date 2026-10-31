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
| `@typedhouse/client` | `client.run(q)`, `client.stream(q)`, result decoding | `@typedhouse/compiler`, `@clickhouse/client` |

`@typedhouse/core` is dependency-free on purpose: a query built in a browser or a worker must not drag the compiler along.

Not in scope for this build: inserts, updates, deletes and DDL; dictionaries (`dictGet` goes through `sql`); window functions as an operator (through `sql` only); any dialect other than ClickHouse; join reordering; cost-based decisions of any kind. Each of these is a later milestone, and nothing in this spec should make them harder.

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

// 2. a raw expression; interpolated Exprs become column references, JS values become parameters
components.map(c => ({ depth: sql<number | null>`length(splitByChar('/', ${c.category}))` }))

// 3. a raw predicate
parts.where(p => sql<boolean>`match(${p.mpn}, '^GRM[0-9]')`)

// 4. a raw relation, which composes like any other query
const warned = sql.relation<{ entityId: string; warnings: bigint }>`
  SELECT entityId, countIf(notEmpty(stock_index_warnings)) AS warnings
  FROM metric_group_ots_component_indices FINAL
  WHERE tenantId = ${'acme'}
  GROUP BY entityId
`
join({ c: components, w: warned }).on(r => r.c.entityId.eq(r.w.entityId))
```

### ClickHouse hints

```ts
cIndices.final()               // FROM … FINAL: ReplacingMergeTree deduplication at read time
components.sample(0.1)         // SAMPLE 0.1; the fixture tables have no sampling key, so this one is asserted through toSQL() only
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

Include tables, views and materialized views (`t.engine` tells them apart; all three are queryable). Skip `default_kind = 'ALIAS'` columns only if `--skip-alias` is passed; by default they are included and marked. Columns whose name contains a dot are the flattened members of a `Nested(...)` column; keep them as-is under their dotted name.

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
| `Decimal(p, s)` | `Decimal<p, s>` = `string & { __p: p; __s: s }` | String on the wire; no arithmetic in TS, arithmetic stays in `Expr` |
| `Enum8/16` | a union of the names as string literals | String on the wire |
| `Nullable(T)` | `T` or `null` | JSON null |
| `LowCardinality(T)` | `T` | Transparent |
| `Array(T)` | `T[]` | JSON array, decode elements recursively |
| `Map(K, V)` | `Record<K, V>` when K is string-like, else `Array<[K, V]>` | `JSONEachRow` emits an object for maps |
| `Tuple(T1, T2)` unnamed | `readonly [T1, T2]` | JSON array |
| `Tuple(a T1, b T2)` named | `{ a: T1; b: T2 }` | JSON object (`output_format_json_named_tuples_as_objects`, on by default) |
| `JSON`, `Variant`, `Dynamic`, `Unknown` | `unknown` | Passed through |
| `AggregateFunction(f, ...)` | `AggregateState<'f'>` (opaque brand) | Cannot be selected raw; only `-Merge` functions accept it |
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
| `Filter` | `input: Rel`, `pred: Expr` | same as input |
| `Project` | `input: Rel`, `exprs: Record<string, Expr>` | keys of `exprs` |
| `Aggregate` | `input: Rel`, `keys: Record<string, Expr>`, `aggs: Record<string, AggExpr>` | keys then aggs |
| `Join` | `kind: 'inner' \| 'left' \| 'right' \| 'full' \| 'cross'`, `inputs: Record<alias, Rel>`, `on: Expr[]` | nested: `{ [alias]: input columns }` |
| `ArrayJoin` | `input: Rel`, `expr: Expr` (array-typed), `alias: string`, `left: boolean` | input columns plus `alias`, typed as the array's element |
| `Sort` | `input`, `keys: Array<{ expr: Expr; dir: 'asc' \| 'desc'; nulls?: 'first' \| 'last' }>` | same as input |
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
| Aggregates | `count`, `countIf`, `sum`, `sumIf`, `avg`, `avgIf`, `min`, `max`, `argMin`, `argMax`, `any`, `anyLast`, `uniq`, `uniqExact`, `groupArray`, `groupUniqArray`, `quantile(level)`; plus `<name>If`, `<name>State`, `<name>Merge` for each |

**Tier 2, known.** `typedhouse generate` also reads `system.functions` and writes `functions.ts`: `fn.<name>(...args: Expr<any>[]): Expr<unknown>` for every non-aggregate function and `agg.<name>(...)` returning `AggExpr<unknown>` for every aggregate, each entry carrying `deterministic` and `alias_to` from the table. The `deterministic` column is newer than the 24.3 minimum, so the generator first checks `system.columns` for it and, when it is absent, writes `deterministic: null`, which the live-capability computation treats as non-deterministic. The validator uses this file to reject names ClickHouse does not have and to compute the live capability. `.as(col.X)` declares the result type for inference and decoding and emits no CAST; `cast(x, col.X)` emits one. Nothing in this tier is hand-written, and it regenerates with the schema.

**Tier 3, raw.** `sql` at expression, predicate and relation level, as in the examples.

**Extension by users.** The same `defineFunction` and `defineAggregate` as tier 1, in application code, with no registration step and no fork; the result is a typed free function that the compiler emits by its `name`:

```ts
// src/db/functions.ts
import { defineFunction, defineAggregate, col, stringLike } from '@typedhouse/core'

export const editDistance = defineFunction({
  name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true,
})
export const topK = defineAggregate({
  name: 'topK', params: [col.UInt64], args: [stringLike], returns: col.Array(col.String), linear: false,
})

parts.map(p => ({ mpn: p.mpn, distance: editDistance(p.mpn, 'GRM155R61A104KA01D') }))
parts.groupBy(p => p.partCategoryName).aggregate(g => ({ topManufacturers: topK(3)(g.manufacturerName) }))
```

Method syntax for a user function is opt-in and is declaration merging plus one call, which is also how the generated methods are attached, so there is one mechanism:

```ts
declare module '@typedhouse/core' {
  interface ExprMethods<T> {
    distanceTo(this: Expr<string>, other: Expr<string> | string): Expr<bigint>
  }
}
extendExpr({ distanceTo(other) { return editDistance(this, other) } })

parts.where(p => p.mpn.distanceTo('GRM155R61A104KA01D').le(2n))
```

A user-defined function that already exists in tier 1 is a validation error (`duplicate_function`), so the typed set can grow without silently shadowing application code.

## Part 3: compiler and execution

`compile(rel): CompiledQuery` runs five stages in a fixed order. Each stage is a pure function from IR to IR (or IR to SQL at the end), unit-tested on its own, so a wrong rewrite is found by the stage's test and not by a ClickHouse error three layers later.

1. **Validate and resolve.** Walk the graph once. Bind every `ColumnRef` to its node and fail on `unbound_column`. Assign a `CHType` to every `Expr` bottom-up from the catalog; assign `Param` types from the sibling operand (`amount > {p0}` gives `p0` the type of `amount`; two untyped params in one comparison is `param_untyped`). Reject `AggExpr` outside `Aggregate.aggs`, `Grouped` references outside an aggregate call, and `map` outputs that are not flat. Output: the same graph, fully typed, plus a parent-count map.
2. **Logical rewrites.** Apply the rules in the table below to a fixpoint. Merge and push-down rules run to a fixpoint, then PruneColumns runs once. Each merge or push-down strictly decreases a measure (node count, or the sum of Filter heights), so termination is by construction; still cap at 50 iterations and fail loudly.
3. **Block planning.** A block is one SELECT with its clause slots in SQL order: FROM (a scan, or derived tables joined left-deep, with at most one ARRAY JOIN), WHERE, GROUP BY, HAVING, the select list (optionally DISTINCT), ORDER BY, LIMIT/OFFSET. Walk each chain bottom-up. A node folds into the current block when its slot is empty and no slot later in that order is filled yet; otherwise the current block becomes a derived table and the node opens a new one. `Scan` opens a block. `Join` takes its inputs' blocks as FROM items (a bare scan stays a table, anything else is a derived table). `Filter` is WHERE while GROUP BY is empty and HAVING once it is filled. `Project` is the select list, substituting into one already there. `Aggregate` fills GROUP BY and the select list together. `Distinct` sets the DISTINCT flag. `Sort` and `Limit` fill their slots. `ArrayJoin` folds when the block has no ARRAY JOIN yet and its FROM is a single scan, since ClickHouse allows one ARRAY JOIN clause per SELECT. `Union`, `RawRel` and `Materialize` always open a block; any node with more than one parent becomes a CTE. So `groupBy().aggregate().where().orderBy().limit()` is one SELECT with GROUP BY, HAVING, ORDER BY and LIMIT, and a `where` after an `orderBy` starts a new one. Each block gets an alias `t0, t1, …` in emission order.
4. **Emit.** Render each block to a SELECT with named parameters `{p0:UInt64}`; wrap CTE blocks in `WITH t3 AS (...)`; append `SETTINGS`. Identifiers are always backtick-quoted. Every JS value in an expression is a parameter and `null` renders as `NULL`; `LIMIT`, `OFFSET` and `SAMPLE` values are node fields and render inline. Nothing a caller supplies is ever interpolated into the text, which closes the injection surface.
5. **Decode.** `CompiledQuery` carries `columns: Record<string, CHType>` for the final block; the client reads `JSONEachRow` and converts each cell with a decoder derived from the `CHType` (the table in Part 1). Decoders are built once per compiled query and reused across rows.

### Rewrite rules

| Rule | Pattern | Result | Condition |
| --- | --- | --- | --- |
| MergeFilter | `Filter(Filter(x, a), b)` | `Filter(x, a AND b)` | always |
| MergeProject | `Project(Project(x, p), q)` | `Project(x, q[p])` (substitute) | `p` has no `Raw` or non-deterministic expr referenced twice in `q` |
| PushFilterProject | `Filter(Project(x, p), c)` | `Project(Filter(x, c[p]), p)` | `c[p]` only references columns of `x` |
| PushFilterJoin | `Filter(Join({a, b}), c)` | `Join({a: Filter(a, c)}, b)` | `c` references only one input; for `inner` and `cross` any input; for `left` only the first input; for `right` only the last; for `full` none; conjunctions are split first |
| PushFilterArrayJoin | `Filter(ArrayJoin(x, e, alias), c)` | `ArrayJoin(Filter(x, c), e, alias)` | `c` does not reference `alias` |
| PushFilterUnion | `Filter(Union(xs), c)` | `Union(xs.map(x => Filter(x, c)))` | always |
| PushFilterAggKey | `Filter(Aggregate(x, k, a), c)` | `Aggregate(Filter(x, c[k]), k, a)` | `c` references only key columns |
| LeftToInner | `Filter(LeftJoin({a, b}), c)` | `Filter(InnerJoin({a, b}), c)` | `c` is null-rejecting on a column of `b` (`b.x = …`, `b.x > …`, `b.x IS NOT NULL`) |
| PruneColumns | any node | insert `Project` under it selecting only columns its ancestors use, in the source's declared order; a shared node keeps the union of its parents' needs | once, top-down, after the others reach fixpoint |

Two rules deserve a word on ClickHouse. `PushFilterJoin` is the one that pays: ClickHouse builds the right side of a hash join fully in memory, so a filter that stays above the join means hashing rows that are thrown away a moment later. `PruneColumns` is the other: ClickHouse reads columns, not rows, and `SELECT *` on a wide MergeTree table is the most common performance mistake in hand-written queries. The compiler must never emit `*`; the naive emitter may.

Not in v1: pushing `Limit` into a `Sort` under a `Union`, join reordering, pulling filters into `PREWHERE` (ClickHouse moves them itself with `optimize_move_to_prewhere=1`, the default), and anything that needs table statistics.

### Emission details

- Join strictness is `ALL` and the kind is spelled in full: `INNER ALL JOIN`, `LEFT ALL JOIN`. `ANY` is not exposed in v1; CROSS JOIN carries no strictness word.
- When any `left`, `right` or `full` join is present, append `SETTINGS join_use_nulls = 1`. Without it ClickHouse fills the unmatched side with type defaults (`0`, `''`, `1970-01-01`), and the `Nullable<OrdersRow>` type would be a lie. This is the one place the compiler changes a server default; it is documented in the generated SQL as a trailing comment.
- Always append `date_time_output_format = 'iso'`, `output_format_json_quote_64bit_integers = 1` and `output_format_json_quote_denormals = 1` as query settings on execution (not in `toSQL()` output, which is for humans).
- `Scan.final` renders as `FROM t FINAL`; `Scan.sample` as `SAMPLE 0.1`. Both are per-scan and survive all rewrites unchanged.
- `Materialize` in v1 renders as an ordinary CTE and logs a warning that materialization is not yet implemented; the node exists so the API is stable. Real materialization (a `TEMPORARY TABLE` inside an HTTP session) is milestone 7.
- CTE naming: `WITH t3 AS (SELECT …)`. ClickHouse inlines CTEs, so a CTE is for readability and for deduplicating the graph, never for performance; the shared-node check still matters because without it the *IR* would be emitted twice.
- `GROUP BY` repeats the key expressions, never their aliases, because a key alias often shares its name with a source column (`category` in the `lowStockCategories` example) and the compiler should not depend on `prefer_column_name_to_alias` to pick the right one; a parameter inside a repeated expression keeps its name. `HAVING` and `ORDER BY` reference output aliases, which ClickHouse allows and which is unambiguous there under the default `prefer_column_name_to_alias = 0`. Never re-expand an aggregate expression in `HAVING` or `ORDER BY`.

Join inputs and ARRAY JOIN: an input that is a bare `Scan` renders as `table AS alias` (both quoted); anything else renders as a derived table, `(SELECT …) AS alias`. Column pruning puts a `Project` under nearly every scan that feeds a join, so nearly every join input is a derived table; that is intended, and it is what the `lowStockCategories` SQL in API examples shows. A `Join` with more than two inputs (an inner join) renders as a left-deep chain in input order, `FROM a JOIN b ON … JOIN c ON …`, with the kind repeated on every clause; each `on` condition is attached to the first clause at which both of its inputs are in scope. User join aliases are used as written; one that collides with a CTE name (`t0`, `t1`, …) gets an underscore appended. An `ArrayJoin` renders as `ARRAY JOIN expr AS alias` (or `LEFT ARRAY JOIN`) directly after the `FROM` item, after `FINAL` and `SAMPLE`, and the alias is a plain column for the rest of the block. Inside one block the topmost `Project` is the select list; a pruning `Project` sitting directly on the block's own `FROM` scan is not emitted (ClickHouse reads only the columns the block references), it only limits what the block may reference. A `scalar()` subquery renders inline as `(SELECT …)`; ClickHouse evaluates it once per query. A select item that is a bare column under its own name emits no `AS`; everything else is aliased. Parameters are numbered `p0, p1, …` in order of first appearance in the emitted text; two `Param` nodes with equal values are two parameters; a `Param` referenced from two places keeps one name.

### Execution

`client.run(q)` compiles, executes with `@clickhouse/client`'s `query()` using `format: 'JSONEachRow'` and `query_params`, decodes, and returns `Promise<R[]>`. `client.stream(q)` returns an `AsyncIterable<R>` over the streamed response and never buffers more than one HTTP chunk. Compilation is memoized on the `Rel` object identity, so a query built once and run in a loop is compiled once.

Errors: a ClickHouse error is wrapped in `QueryError { sql, params, cause, node? }`. When the server's message names a column or alias, the compiler's alias map is used to point `node` at the IR node that produced it; this is best-effort and must never throw while building the error.

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

The compiler is the risky part, and its correctness is defined by one property: for every IR tree, the optimized SQL and the naive SQL return the same rows. Everything else is ordinary unit testing.

**Differential testing (milestone 4 onward).** A `fast-check` arbitrary generates random IR trees over the fixture schema from API examples (six tables, seeded deterministically with nulls, duplicate versions, empty arrays and orphan ids). Each tree is emitted twice, run against testcontainers ClickHouse, and the row sets are compared after sorting on all columns. A failure shrinks to the smallest tree that disagrees and prints both SQLs. Run 500 cases in CI, 10k nightly. This test also covers the decoders, because both paths go through them.

**EXPLAIN snapshots.** For the \~30 hand-written queries in the corpus (every example in API examples plus one per rewrite rule), snapshot `EXPLAIN PLAN` output and assert structurally: no `Subquery`-type step unless its child is a fence; no `ReadFromMergeTree` that reads more columns than the IR's pruned set. Snapshots of the SQL text itself are kept too, but only the `lowStockCategories` one is asserted byte-for-byte; the rest are review aids.

**Type tests.** Six checks, all under `tsc --noEmit` in CI, on TypeScript 5.5 and the current release; type code of this kind breaks across minor versions.

1. *Positive cases.* `expect-type` assertions for every example in API examples, using `toEqualTypeOf` (never `toMatchTypeOf`, which lets extra properties through) and `.not.toBeAny()` on every result. Generic helpers get their own assertions that they instantiate to concrete types: `expectTypeOf(latestIndices).toEqualTypeOf<Query<ComponentIndicesRow>>()`, `expectTypeOf(forTenant('acme'))` accepted by `where` on every fixture table.
2. *Negative cases, precisely.* `@ts-expect-error` alone is not enough: it passes on any error on the line, including the wrong one. The cases under What fails to compile live one per statement in `test/types/negative/*.ts`, each annotated `// expect: TS2339 Property 'thenBy' does not exist`, and a small harness over the TypeScript compiler API (`ts.createProgram`, collect diagnostics, match code and message substring per annotated line) fails on a missing, extra or different error. Where the design makes a method absent, the direct form is used as well: `expectTypeOf<keyof typeof q>().not.toMatchTypeOf<'thenBy'>()`.
3. *Type and runtime agree.* For every corpus query, a script derives the TS type from the query's runtime `columns` map (the Part 1 mapping applied in reverse) and writes it to `test/types/snapshots/<name>.d.ts`; the test asserts `expectTypeOf<Infer<typeof q>>().toEqualTypeOf<Snapshot>()`. This is the one test that ties the phantom `R` to the decoder: a method whose declared return disagrees with its catalog `returns`, or a decoder that disagrees with the mapping table, fails here.
4. *Compile performance.* `test/types/bench/` holds 200 corpus-shaped queries plus two pathological ones: a 25-step `map`/`join` chain and a 10-way join. `tsc --extendedDiagnostics` on it has a budget, instantiations and wall time, checked in CI and failing when exceeded; the initial budget is set at milestone 3 from the first measurement with 50% headroom and is lowered, never raised, without a note in the PR. One method surface generic over three phantoms, a name on every call and promotion-by-conditional-type are exactly the shape that becomes "excessively deep" or a 40-second build once a codebase has a few hundred queries, and this is where it is caught.
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
| 64-bit integers | `bigint`, always; no `number` option, and no implicit `number` literals against them |
| Decimals | `col.Decimal(p, s)` canonical, as `system.columns` prints it; `col.Decimal32/64/128/256(s)` are sugar; branded `string` in TS, arithmetic in `Expr` only |
| `Expr` | one class, three phantoms (`T`, name `N`, mode `M`); `Grouped` and `AggExpr` are modes, not classes; methods are generated from the catalog, use method syntax, and are gated by `this` parameters |
| Join row shape | nested `{ u, o }`; `...r.u` to flatten in `map` |
| Joins | `join`, `crossJoin` over two or more inputs, one kind each, left-deep emission; outer joins binary, `leftJoin`/`rightJoin`/`fullJoin(left, right).on(…)` with one aliased input per record (user ruling, M4 slice 4a: TS object types carry no key order, so a record cannot name the preserved input), three-way outer joins by nesting; `on` is equality only, extra inner-join conditions become a filter above, an outer join's `join_condition_not_equi` |
| Outer join nulls | `join_use_nulls = 1` emitted whenever an outer join is present |
| Outer join row types | Descriptor-faithful (M4 slice 4a, lead decision, checked against 24.8 `meta` per column kind): a null-extended input's column becomes `T \| null` / `Nullable(T)` only when ClickHouse can wrap it (scalars, `FixedString`, dates/times, `Decimal`, `Enum`, `UUID`, IPs, `SimpleAggregateFunction` over those); `LowCardinality(T)` and `SimpleAggregateFunction(f, LowCardinality(T))` → `LowCardinality(Nullable(T))` (the server drops that SAF wrapper); `Nullable`, `LowCardinality(Nullable(T))`, `Array`, `Map`, `Tuple`/`Nested`, `Variant`, `Dynamic`, `JSON`, `AggregateFunction` keep their type and the server default when unmatched. `Nullable<R>` above is the rule for wrappable columns only |
| Join strictness | `ALL`, written explicitly |
| Parameters | server-side `{p:Type}`; never inlined; typed from the sibling operand, else by JS primitive default (`String`, `Bool`, `Float64`, `Int64`, `DateTime64(3)`); serialised by the library; numbered by first appearance; equal values are still separate parameters |
| `GROUP BY` | key expressions repeated; `HAVING` and `ORDER BY` by alias |
| Shared subqueries | by object identity; CTE named `tN` |
| `SELECT *` | never emitted by the optimizing path |
| Minimum ClickHouse | 24.3 |
| Function names | comparisons short (`eq`, `ne`, `lt`, `le`, `gt`, `ge`), booleans `and`, `or`, `not`, everything else the ClickHouse name |
| Two-stage calls | `groupBy(…).aggregate(…)` and `orderBy(…).thenBy(…)`; `from(…)` with `final()`/`sample()`; the intermediate has its one extra method and nothing else |
| Single-expression forms | `groupBy`, `aggregate`, `map` take one expression; named by the Polars rule (root column, else function name); unnamed or colliding names are errors that point to the object form |
| `ARRAY JOIN` | the `arrayJoin` and `leftArrayJoin` operators, in v1; one per SELECT block |
| Window functions, `LIMIT BY` | `sql` only in v1 |
| Incremental engine | A TypeScript DBSP implementation over the same IR, later; not the Rust `dbsp` crate. The eight constraints in Part 4 are part of milestone 3 |

Still open, to decide during milestone 3 when the code makes the trade-off concrete:

- [ ] Whether `Query` exposes `.ir` publicly or behind a `Symbol`. Public is simpler for the compiler; a symbol keeps autocompletion clean for users.
- [ ] Whether `map` should allow one level of nesting (`{ part: { id, mpn }, total }`) in v1. The validator rejects it today; the decode path could support it cheaply via named `Tuple`.
