// EXPLAIN corpus (spec "Testing", M4): every supported API example plus one minimal query per rewrite rule.
// Ids reuse test/types/corpus-coverage.json. `fences` lists the kinds that justify every SELECT boundary the
// planned emission opens (empty = one SELECT).
import { asofJoin, asofLeftJoin, cast, col, count, from, join, leftJoin, unionAll, type Rel } from '@typedhouse/core';
import * as s from './supported-types.js';
import { componentsLatest } from './components-latest.js';
import { projectionEnrichment } from './projection-enrichment.js';
import { knownHash, knownUnique } from './known-functions.js';
import { snippetDistance } from './sql-snippets.js';
import { components, db, forTenant } from './low-stock.js';

/** `Filter`: a filter outside the total fragment keeps its own SELECT over earlier filters (slice 3b), and so does a total one over it. */
export type FenceKind = 'Prewhere' | 'Aggregate' | 'Sort' | 'LimitBy' | 'Limit' | 'Distinct' | 'Union' | 'Join' | 'ArrayJoin' | 'CTE' | 'Subquery' | 'RawRel' | 'Materialize' | 'Filter';
export type CorpusRule = 'MergeFilter' | 'MergeProject' | 'PushFilterProject' | 'LeftToInner' | 'PushFilterJoin' | 'PushFilterArrayJoin' | 'PushFilterUnion' | 'PushFilterAggKey' | 'PruneColumns';
export interface CorpusEntry {
  readonly id: string;
  readonly query: { readonly ir: Rel };
  /** `false` when the fixture cannot execute it (SAMPLE without a sampling key). */
  readonly run?: boolean;
  readonly fences: readonly FenceKind[];
  /** The minimal query for this rule: its hit count is non-zero and no other rule fires (MergeFilter excepted). */
  readonly rule?: CorpusRule;
}
const fresh = () => from(db.entity_ots_component);
const prewhereEntries: readonly CorpusEntry[] = [
  // PREWHERE is part of its scan block: every clause folds, and it opens a boundary only for an alias equal to a column it reads.
  { id: 'prewhere/bare', query: components.prewhere(forTenant('acme')), fences: [] },
  { id: 'prewhere/where-sort-limit', query: components.prewhere(forTenant('acme')).where(c => c.state.eq('active')).orderBy(c => c.entityId).limit(5), fences: [] },
  { id: 'prewhere/aggregate', query: components.prewhere(forTenant('acme')).groupBy(c => ({ state: c.state })).aggregate(() => ({ n: count() })), fences: [] },
  { id: 'prewhere/unselected-column', query: components.prewhere(forTenant('acme')).map(c => ({ entityId: c.entityId })), fences: [] },
  { id: 'prewhere/alias-shadow', query: components.prewhere(forTenant('acme')).map(c => ({ tenantId: c.entityId, state: c.state })), fences: ['Prewhere'] },
  { id: 'prewhere/array-join', query: components.prewhere(forTenant('acme')).arrayJoin(c => c.matched_part_ids, 'partId'), fences: [] },
  { id: 'prewhere/limit-by', query: components.prewhere(forTenant('acme')).orderBy(c => c.entityId).limitBy(c => c.category).take(1), fences: [] },
  { id: 'prewhere/join-side', query: join({ a: from(db.entity_ots_component).prewhere(forTenant('acme')), b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).map(r => ({ entityId: r.a.entityId })), fences: ['Join'] },
  { id: 'prewhere/final', query: from(db.metric_group_ots_component_indices).final().prewhere(forTenant('acme')), fences: [] },
];
const limitByEntries: readonly CorpusEntry[] = [
  // LIMIT BY: every clause folds into one SELECT in the only legal order, and anything out of rank is a LimitBy fence.
  { id: 'limit-by/fold', query: components.where(forTenant('acme')).orderBy(c => c.entityId).limitBy(c => c.category).take(2).offset(1).limit(5), fences: [] },
  { id: 'limit-by/unselected-key', query: components.orderBy(c => c.entityId).limitBy(c => c.category).take(1).map(c => ({ entityId: c.entityId })), fences: ['LimitBy'] },
  { id: 'limit-by/filter-above', query: components.limitBy(c => c.category).take(1).where(c => c.countOfParts.gt(1n)), fences: ['LimitBy'] },
  { id: 'limit-by/twice', query: components.limitBy(c => c.category).take(2).limitBy(c => c.state).take(1), fences: ['LimitBy'] },
  { id: 'limit-by/over-limit', query: components.limit(5).limitBy(c => c.category).take(1), fences: ['LimitBy'] },
  { id: 'limit-by/over-computed-map', query: components.map(c => ({ entityId: c.entityId, more: c.countOfParts.plus(1n) })).limitBy(c => c.more).take(1), fences: ['LimitBy'] },
  { id: 'limit-by/aggregate', query: components.groupBy(c => ({ tenantId: c.tenantId, state: c.state })).aggregate(() => ({ n: count() })).orderBy(r => r.n).limitBy(r => r.tenantId).take(1), fences: [] },
  { id: 'limit-by/under-aggregate', query: components.limitBy(c => c.category).take(1).aggregate(() => ({ n: count() })), fences: ['Aggregate'] },
  { id: 'limit-by/join', query: join({ a: components, b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).orderBy(r => r.a.entityId).limitBy(r => r.b.state).take(1).map(r => ({ entityId: r.a.entityId })), fences: ['LimitBy', 'Join'] },
  // run: false: on 24.8 an IN set outside WHERE is a CreatingSet with its own read in the main plan (a Sort key and a select item behave the same; a WHERE does not),
  // and the read-set clause counts main scans only. prewhere-adversarial.integration.ts pins that comparison, and limit-by-adversarial runs this shape.
  { id: 'limit-by/subquery-key', run: false, query: components.limitBy(c => c.entityId.in(fresh().map(x => x.entityId))).take(1), fences: ['Subquery'] },
  { id: 'limit-by/union-input', query: unionAll(fresh(), fresh()).limitBy(c => c.category).take(1), fences: ['Union'] },
];
const asofEntries: readonly CorpusEntry[] = [
  { id: 'asof/right-filter-above', query: asofJoin({ a: fresh() }, { b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).asof(r => r.a.updatedAt.ge(r.b.updatedAt)).where(r => r.b.state.eq('active')).map(r => ({ entityId: r.a.entityId })), fences: ['Join'] },
  { id: 'asof/left-filter-below', query: asofJoin({ a: fresh() }, { b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).asof(r => r.a.updatedAt.ge(r.b.updatedAt)).where(r => r.a.state.eq('active')).map(r => ({ entityId: r.a.entityId })), fences: ['Join'] },
  { id: 'asof/left-null-filter-above', query: asofLeftJoin({ a: fresh() }, { b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).asof(r => r.a.updatedAt.ge(r.b.updatedAt)).where(r => r.b.state.isNull()).map(r => ({ entityId: r.a.entityId })), fences: ['Join'] },
];
export const entries: readonly CorpusEntry[] = [
  ...asofEntries,
  { id: 'filtering/tenant-active', query: s.filterTenantActive, fences: [] },
  { id: 'filtering/category', query: s.filterCategory, fences: [] },
  { id: 'filtering/not-empty', query: s.filterMatched, fences: [] },
  { id: 'filtering/has', query: s.filterPart, fences: [] },
  { id: 'filtering/updated', query: s.filterUpdated, fences: [] },
  { id: 'filtering/count', query: s.filterCount, fences: [] },
  { id: 'filtering/lifecycle', query: s.filterLifecycle, fences: [] },
  { id: 'filtering/origin', query: s.filterOrigin, fences: [] },
  { id: 'filtering/yteol', query: s.filterYteol, fences: [] },
  { id: 'filtering/path', query: s.filterPath, fences: [] },
  { id: 'filtering/warnings', query: s.filterWarnings, fences: [] },
  { id: 'filtering/subquery', query: s.filterMembership, fences: ['Subquery'] },
  { id: 'projection/spread-tuple-conditional', query: s.projectionFragment, fences: [] },
  { id: 'projection/enrichment', query: projectionEnrichment, fences: [] },
  { id: 'versioned/final', query: s.cleanIndices, fences: [] },
  { id: 'versioned/latest-helper', query: s.latestIndices, fences: ['CTE', 'Join'] },
  { id: 'versioned/latest-totals', query: s.latestTotals, fences: ['CTE', 'Join', 'Aggregate'] },
  { id: 'versioned/argMax', query: s.argMaxIndices, fences: ['Aggregate'] },
  { id: 'versioned/weekly', query: s.weeklySeries, fences: [] },
  // `startsWith` (known-origin) and `between` over DateTime64 are outside the total fragment: each keeps its own SELECT over the tenant filter.
  { id: 'entities/componentsLatest', query: componentsLatest, fences: ['CTE', 'Join', 'Filter'] },
  { id: 'entities/history', query: s.history, fences: ['Join', 'Sort', 'Filter'] },
  { id: 'entities/scopedLatest', query: s.scopedLatest, fences: ['CTE', 'Join'] },
  { id: 'entities/total', query: s.total, fences: ['CTE', 'Join', 'Aggregate'] },
  { id: 'entities/stockShare', query: s.stockShare, fences: ['CTE', 'Join', 'Subquery'] },
  { id: 'entities/perCategory', query: s.perCategory, fences: ['CTE', 'Join', 'Aggregate'] },
  { id: 'entities/categoryShare', query: s.categoryShare, fences: ['CTE', 'Join'] },
  { id: 'rollups/category', query: s.categories, fences: ['CTE', 'Join'] },
  { id: 'rollups/manufacturer', query: s.manufacturers, fences: ['CTE', 'Join'] },
  { id: 'rollups/keyless', query: s.tenantTotals, fences: [] },
  { id: 'single/category', query: s.singleCategory, fences: [] },
  { id: 'single/week', query: s.singleWeek, fences: ['Aggregate'] },
  { id: 'single/manufacturer', query: s.singleManufacturer, fences: [] },
  { id: 'single/membership', query: s.singleMembership, fences: ['Subquery'] },
  { id: 'single/share', query: s.singleShare, fences: ['CTE', 'Join', 'Subquery'] },
  { id: 'joins/componentParts', query: s.componentParts, fences: [] },
  { id: 'joins/withParts', query: s.withParts, fences: ['Join'] },
  { id: 'joins/three-way', query: s.withPrice, fences: ['CTE', 'Join'] },
  { id: 'joins/self', query: s.sharedPart, fences: ['CTE'] },
  { id: 'joins/left-array', query: s.leftArray, fences: [] },
  { id: 'joins/left', query: s.leftLatest, fences: ['CTE', 'Join'] },
  { id: 'entities/optional-snapshot', query: s.optionalSnapshot, fences: ['CTE', 'Join'] },
  { id: 'composition/lowStock', query: s.lowStock, fences: ['CTE', 'Join'] },
  { id: 'ordering/page', query: s.orderedComponents, fences: [] },
  { id: 'ordering/nulls', query: s.orderedNullable, fences: [] },
  { id: 'ordering/bare', query: s.orderedBare, fences: [] },
  { id: 'sets/distinct', query: s.distinctManufacturer, fences: [] },
  { id: 'sets/union', query: s.entityUnion, fences: ['Union'] },
  { id: 'escape/known-function', query: knownHash, fences: [] },
  { id: 'escape/known-aggregate', query: knownUnique, fences: [] },
  { id: 'hints/final', query: s.cleanIndices, fences: [] },
  { id: 'hints/sample', query: s.sampleOnly, run: false, fences: [] },
  { id: 'hints/materialize', query: s.explicitCte, fences: ['CTE'] },
  { id: 'escape/sql-snippet', query: snippetDistance, fences: [] },
  ...limitByEntries,
  ...prewhereEntries,
  // One minimal query per rewrite rule over the fixture tables.
  { id: 'rule/merge-filter', rule: 'MergeFilter', query: components.where(forTenant('acme')).where(c => c.countOfParts.gt(1n)), fences: [] },
  { id: 'rule/merge-project', rule: 'MergeProject', query: components.map(c => ({ entityId: c.entityId, parts: c.countOfParts })).map(r => ({ id: r.entityId, parts: r.parts })), fences: [] },
  { id: 'rule/push-filter-project', rule: 'PushFilterProject', query: components.map(c => ({ id: c.entityId, parts: c.countOfParts.plus(1n) })).where(r => r.parts.gt(3n)), fences: [] },
  { id: 'rule/push-filter-join', rule: 'PushFilterJoin', query: join({ a: components, b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).where(r => r.a.state.eq('active')).map(r => ({ entityId: r.a.entityId, category: r.b.category })), fences: ['Join'] },
  // Slice 4b: b.state = 'active' rejects b's NULL extension, so the LEFT join plans as INNER (EXPLAIN: Join, Type: INNER).
  { id: 'rule/left-to-inner', rule: 'LeftToInner', query: leftJoin({ a: components }, { b: fresh() }).on(r => r.a.entityId.eq(r.b.entityId)).where(r => r.b.state.eq('active')).map(r => ({ entityId: r.a.entityId, category: r.b.category })), fences: ['Join'] },
  { id: 'rule/push-filter-array-join', rule: 'PushFilterArrayJoin', query: components.arrayJoin(c => c.matched_part_ids, 'partId').where(r => r.tenantId.eq('acme')), fences: [] },
  { id: 'rule/push-filter-union', rule: 'PushFilterUnion', query: unionAll(fresh(), fresh()).where(c => c.state.eq('active')), fences: ['Union'] },
  { id: 'rule/push-filter-agg-key', rule: 'PushFilterAggKey', query: components.groupBy(c => ({ tenantId: c.tenantId })).aggregate(() => ({ n: count() })).where(r => r.tenantId.eq('acme')), fences: [] },
  { id: 'rule/prune-columns', rule: 'PruneColumns', query: components.map(c => ({ entityId: c.entityId })), fences: [] },
];
/** Negative control: a selection whose fallible output is filtered above it keeps a boundary no fence justifies. */
export const unfencedControl = components.map(c => ({ entityId: c.entityId, parts: cast(c.countOfParts, col.String) })).where(r => r.parts.eq('1'));
