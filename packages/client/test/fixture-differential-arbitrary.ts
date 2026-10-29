import fc from 'fast-check';
import { from, join, unionAll, sum, count, uniq, scalar } from '@chql/core';
import { db, latest, forTenant } from '../../compiler/test/fixtures/corpus/low-stock.js';

export const seed = 20261201;
export type Metric = 'availability' | 'componentIndices' | 'partIndices' | 'price';
export interface Scope { tenant: string; start: number; week: number }
export type Tree =
  | { op: 'metric'; metric: Metric; latest: boolean; attached: boolean; cross: boolean }
  | { op: 'filter' | 'project' | 'distinct' | 'in' | 'cte'; input: Tree }
  | { op: 'union'; left: Tree; right: Tree; repeat: boolean };
export interface Recipe { scope: Scope; tree: Tree; end: 'bag' | 'limit' | 'rollup' | 'share' }
const leaf: fc.Arbitrary<Tree> = fc.record({ op: fc.constant('metric'), metric: fc.constantFrom('availability', 'componentIndices', 'partIndices', 'price'), latest: fc.boolean(), attached: fc.boolean(), cross: fc.boolean() });
function trees(depth: number): fc.Arbitrary<Tree> {
  if (!depth) return leaf;
  const input = trees(depth - 1);
  return fc.oneof({ withCrossShrink: true }, leaf,
    fc.record({ op: fc.constantFrom('filter', 'project', 'distinct', 'in', 'cte'), input }),
    fc.record({ op: fc.constant('union'), left: input, right: input, repeat: fc.boolean() }));
}
// Full seed stays loaded. Each leaf reads four explicit entities and two weeks;
// depth 3 allows eight leaves, at most 4*4*2*8=256 metric rows before joins.
// Cross-family expansion may duplicate matched ids; no random case is discarded.
export const recipes: fc.Arbitrary<Recipe> = fc.record({
  scope: fc.record({ tenant: fc.constantFrom('acme', 'other'), start: fc.constantFrom(0, 8, 120, 298, 398, 448), week: fc.integer({ min: 0, max: 24 }) }),
  tree: trees(3), end: fc.constantFrom('bag', 'limit', 'rollup', 'share'),
});
export function dates(scope: Scope) {
  return [new Date(Date.UTC(2026, 3, 27) + scope.week * 604800000), new Date(Date.UTC(2026, 3, 27) + (scope.week + 1) * 604800000)];
}
export function ids(scope: Scope, part: boolean) { return Array.from({ length: 4 }, (_, i) => `${part ? 'part' : 'cmp'}_${scope.start + i}`); }
export function componentSource(s: Scope) { return from(db.entity_ots_component).where(forTenant(s.tenant)).where(r => r.entityId.in(ids(s, false))); }
export function partSource(s: Scope) { return from(db.entity_off_the_shelf_part).where(forTenant(s.tenant)).where(r => r.entityId.in(ids(s, true))); }
export function availability(s: Scope) { return from(db.metric_group_ots_component_market_availability).final().where(forTenant(s.tenant)).where(r => r.entityId.in(ids(s, false))).where(r => r.effectiveAt.between(dates(s)[0]!, dates(s)[1]!)); }
export function componentIndices(s: Scope) { return from(db.metric_group_ots_component_indices).final().where(forTenant(s.tenant)).where(r => r.entityId.in(ids(s, false))).where(r => r.effectiveAt.between(dates(s)[0]!, dates(s)[1]!)); }
export function partIndices(s: Scope) { return from(db.metric_group_off_the_shelf_part_indices).final().where(forTenant(s.tenant)).where(r => r.entityId.in(ids(s, true))).where(r => r.effectiveAt.between(dates(s)[0]!, dates(s)[1]!)); }
export function price(s: Scope) { return from(db.metric_group_off_the_shelf_part_market_price).final().where(forTenant(s.tenant)).where(r => r.entityId.in(ids(s, true))).where(r => r.effectiveAt.between(dates(s)[0]!, dates(s)[1]!)); }
export function metricSource(m: Metric, s: Scope, newest: boolean) {
  switch (m) {
    case 'availability': { const q = availability(s); return (newest ? latest(q) : q).map(r => ({ tenant: r.tenantId, id: r.entityId, at: r.effectiveAt, version: r.version, value: r.market_stock_total })); }
    case 'componentIndices': { const q = componentIndices(s); return (newest ? latest(q) : q).map(r => ({ tenant: r.tenantId, id: r.entityId, at: r.effectiveAt, version: r.version, value: r.stock_index })); }
    case 'partIndices': { const q = partIndices(s); return (newest ? latest(q) : q).map(r => ({ tenant: r.tenantId, id: r.entityId, at: r.effectiveAt, version: r.version, value: r.stock_index })); }
    case 'price': { const q = price(s); return (newest ? latest(q) : q).map(r => ({ tenant: r.tenantId, id: r.entityId, at: r.effectiveAt, version: r.version, value: r.market_unit_price_1k_p50 })); }
  }
}
export function buildTree(t: Tree, s: Scope): ReturnType<typeof metricSource> {
  if (t.op === 'union') { const left = buildTree(t.left, s); return unionAll(left, t.repeat ? left : buildTree(t.right, s)).map(r => ({ tenant: r.tenant, id: r.id, at: r.at, version: r.version, value: r.value })); }
  if (t.op !== 'metric') {
    const q = buildTree(t.input, s);
    switch (t.op) {
      case 'filter': return q.where(r => r.value.gt(500));
      case 'project': return q.map(r => ({ tenant: r.tenant, id: r.id, at: r.at, version: r.version, value: r.value }));
      case 'distinct': return q.distinct();
      case 'cte': return q.cte();
      case 'in': return q.where(r => r.id.in(q.where(x => x.value.gt(500)).map(x => ({ id: x.id }))));
    }
  }
  const q = metricSource(t.metric, s, t.latest);
  const part = t.metric === 'partIndices' || t.metric === 'price';
  if (t.cross) {
    const c = componentSource(s).arrayJoin(r => r.matched_part_ids, 'partId');
    const p = from(db.entity_off_the_shelf_part).where(forTenant(s.tenant));
    return join({ c, p, m: q }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId), r.c.tenantId.eq(r.m.tenant), (part ? r.p.entityId : r.c.entityId).eq(r.m.id)])
      .map(r => ({ tenant: r.m.tenant, id: r.m.id, at: r.m.at, version: r.m.version, value: r.m.value }));
  }
  if (t.attached) {
    const e = part ? partSource(s).map(r => ({ tenant: r.tenantId, id: r.entityId })) : componentSource(s).map(r => ({ tenant: r.tenantId, id: r.entityId }));
    return join({ e, m: q }).on(r => [r.e.tenant.eq(r.m.tenant), r.e.id.eq(r.m.id)]).map(r => ({ tenant: r.m.tenant, id: r.m.id, at: r.m.at, version: r.m.version, value: r.m.value }));
  }
  return q;
}
export function ordered(q: ReturnType<typeof metricSource>) { return q.orderBy(r => r.value); }
// Fix Float64 addition order, rather than accepting tolerance across plans.
export function rollup(input: ReturnType<typeof metricSource>) { const q = ordered(input); return q.groupBy(r => ({ tenant: r.tenant })).aggregate(g => ({ rows: count(), entities: uniq(g.id), total: sum(g.value) })); }
export function share(input: ReturnType<typeof metricSource>) { const q = ordered(input); const total = q.aggregate(g => ({ value: sum(g.value) })); return q.map(r => ({ tenant: r.tenant, id: r.id, at: r.at, version: r.version, value: r.value, share: r.value.divide(scalar(total)) })); }
export function limited(q: ReturnType<typeof metricSource>) { return q.orderBy(x => x.tenant).thenBy(x => x.id).thenBy(x => x.at).thenBy(x => x.version).thenBy(x => x.value).limit(7, 1); }
export function build(r: Recipe): ReturnType<typeof metricSource> | ReturnType<typeof rollup> | ReturnType<typeof share> | ReturnType<typeof limited> {
  const q = buildTree(r.tree, r.scope);
  switch (r.end) {
    case 'rollup': return rollup(q);
    case 'share': return share(q);
    // All output fields are sorted: UNION across sources can differ only in value.
    case 'limit': return limited(q);
    case 'bag': return q;
  }
}
export function componentPayload(s: Scope) { return componentSource(s).map(r => ({ id: r.entityId, category: r.category, parts: r.part_specifications, ids: r.matched_part_ids, count: r.countOfParts, at: r.updatedAt })); }
export function partPayload(s: Scope) { return partSource(s).map(r => ({ id: r.entityId, category: r.partCategoryId, path: r.partCategoryPath, lifecycle: r.lifecycleStatus, years: r.lifecycleYteol, at: r.updatedAt })); }
export function metricDetails(s: Scope) { return latest(componentIndices(s)).map(r => ({ id: r.entityId, at: r.effectiveAt, warnings: r.stock_index_warnings, lead: r.lead_time_max_days })); }
export function nonfinite(s: Scope) { return componentIndices(s).map(r => ({ nan: r.stock_index.minus(r.stock_index).divide(r.stock_index.minus(r.stock_index)), inf: r.stock_index.divide(r.stock_index.minus(r.stock_index)) })); }
export function latestAvailabilityTotals(s: Scope) { return latest(availability(s)).aggregate(g => ({ version: sum(g.version), value: sum(g.market_stock_total) })); }
export function latestComponentTotals(s: Scope) { return latest(componentIndices(s)).aggregate(g => ({ version: sum(g.version), value: sum(g.stock_index) })); }
export function latestPartTotals(s: Scope) { return latest(partIndices(s)).aggregate(g => ({ version: sum(g.version), value: sum(g.stock_index) })); }
export function latestPriceTotals(s: Scope) { return latest(price(s)).aggregate(g => ({ version: sum(g.version), value: sum(g.market_unit_price_1k_p50) })); }
export function shape(t: Tree): string {
  if (t.op === 'union') return `union:${t.repeat ? 'shared' : 'independent'}(${shape(t.left)},${shape(t.repeat ? t.left : t.right)})`;
  if (t.op !== 'metric') return `${t.op}(${shape(t.input)})`;
  return `${t.metric}:${t.latest ? 'latest' : 'history'}:${t.cross ? 'cross' : t.attached ? 'entity' : 'scan'}`;
}
