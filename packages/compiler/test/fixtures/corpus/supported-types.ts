// Bounded supported API corpus. Coverage and remaining contracts: test/types/corpus-coverage.json.
// No query result annotations: declaration snapshots must observe actual inference.
import { from, join, leftJoin, unionAll, val, col, max, argMax, avg, quantile, sum, scalar, count, countIf, uniqExact } from '@typedhouse/core';
import { db, components, cIndices, forTenant, isActive, latest, categoryRollup, lowStockCategories } from './low-stock.js';
import { stockHistory } from './stock-history.js';
const parts = from(db.entity_off_the_shelf_part);
const availability = from(db.metric_group_ots_component_market_availability);
const pIndices = from(db.metric_group_off_the_shelf_part_indices);
const prices = from(db.metric_group_off_the_shelf_part_market_price);
// Fixed construction clock; not a replacement for missing now()/dateDiff().
const until = new Date('2026-10-27T00:00:00Z');
const daysAgo = (n: number) => new Date(until.getTime() - n * 86_400_000);
export const filterTenantActive = components.where(forTenant('acme')).where(isActive);
export const filterCategory = components.where(c => c.category.startsWith('Passives/Capacitors'));
export const filterMatched = components.where(c => c.matched_part_ids.notEmpty());
export const filterPart = components.where(c => c.matched_part_ids.has('part_42'));
export const filterUpdated = components.where(c => c.updatedAt.gt(daysAgo(7)));
export const filterCount = components.where(c => c.countOfParts.gt(3n));
export const filterLifecycle = parts.where(p => p.lifecycleStatus.in(['NRND', 'EOL', 'Obsolete']));
export const filterOrigin = parts.where(p => p.countryOfOrigin.hasAny(['CN', 'TW']));
export const filterYteol = parts.where(p => p.lifecycleYteol.lt(2).and(p.lifecycleYteol.isNotNull()));
export const filterPath = parts.where(p => p.partCategoryPath.has(1042n));
export const filterWarnings = cIndices.where(i => i.stock_index_warnings.notEmpty());
export const filterMembership = components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => ({ id: i.entityId }))));
// Supported projection fragment only; full projection remains API-blocked.
export const projectionFragment = components.map(c => ({ ...c, category: c.category.ifNull('uncategorised'), matched: c.matched_part_ids.length(), mpns: c.part_specifications.element('mpn'), firstDesc: c.part_specifications.arrayElement(1).element('description'), source: val('clickhouse') }));
export const cleanIndices = cIndices.final();
export const latestIndices = latest(cleanIndices.where(forTenant('acme')));
export const latestAvailability = latest(availability.final().where(forTenant('acme')));
export const latestPartIndices = latest(pIndices.final().where(forTenant('acme')));
export const latestPrices = latest(prices.final().where(forTenant('acme')));
export const argMaxIndices = cleanIndices.where(forTenant('acme')).groupBy(i => ({ entityId: i.entityId })).aggregate(g => ({ version: max(g.version), stockIndex: argMax(g.stock_index, g.version), leadDays: argMax(g.lead_time_max_days, g.version) }));
export const weeklySeries = availability.final().where(forTenant('acme')).where(a => a.entityId.eq('cmp_7')).groupBy(a => ({ week: a.effectiveAt.toStartOfWeek() })).aggregate(g => ({ stock: avg(g.market_stock_total), leadDays: quantile(0.5)(g.market_lead_time_p50_days) })).orderBy(r => r.week.asc());
export const history = stockHistory(daysAgo(90), until);
export const scopedLatest = join({ c: filterTenantActive, a: latestAvailability }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ entityId: r.c.entityId, category: r.c.category, stock: r.a.market_stock_total }));
export const total = scopedLatest.aggregate(g => ({ stock: sum(g.stock) }));
// Nullable scalar output is recorded honestly, not narrowed to the spec shorthand.
export const stockShare = scopedLatest.map(r => ({ entityId: r.entityId, stock: r.stock, share: r.stock.divide(scalar(total)).multiply(100) }));
export const perCategory = scopedLatest.groupBy(r => ({ category: r.category.ifNull('uncategorised') })).aggregate(g => ({ stock: sum(g.stock) }));
export const categoryShare = join({ e: scopedLatest, t: perCategory }).on(r => r.e.category.ifNull('uncategorised').eq(r.t.category)).map(r => ({ entityId: r.e.entityId, share: r.e.stock.divide(r.t.stock).multiply(100) }));
export const categories = categoryRollup('acme');
export const manufacturers = join({ p: parts.where(forTenant('acme')), i: latestPartIndices }).on(r => r.p.entityId.eq(r.i.entityId)).groupBy(r => ({ manufacturerId: r.p.manufacturerId, manufacturerName: r.p.manufacturerName })).aggregate(g => ({ parts: count(), stockIndex: sum(g.i.stock_index), eol: countIf(g.p.lifecycleStatus.in(['EOL', 'Obsolete'])) })).where(r => r.parts.ge(5n)).orderBy(r => r.stockIndex.desc());
export const tenantTotals = components.where(forTenant('acme')).aggregate(g => ({ total: count(), unmatched: countIf(g.matched_part_ids.empty()), categories: uniqExact(g.category) }));
export const singleCategory = components.where(forTenant('acme')).groupBy(c => c.category).aggregate(() => count());
export const singleWeek = cIndices.final().groupBy(i => i.effectiveAt.toStartOfWeek()).aggregate(g => sum(g.stock_index));
export const singleManufacturer = parts.map(p => p.manufacturerId).distinct();
export const singleMembership = components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => i.entityId)));
export const singleShare = scopedLatest.map(r => r.stock.divide(scalar(scopedLatest.aggregate(g => sum(g.stock)))).multiply(100));
export const componentParts = components.where(forTenant('acme')).arrayJoin(c => c.matched_part_ids, 'partId');
export const withParts = join({ c: componentParts, p: parts }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId)]).map(r => ({ component: r.c.entityId, mpn: r.p.mpn, manufacturer: r.p.manufacturerName, lifecycle: r.p.lifecycleStatus }));
export const withPrice = join({ c: componentParts, p: parts, m: latestPrices }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId), r.p.entityId.eq(r.m.entityId)]).map(r => ({ component: r.c.entityId, mpn: r.p.mpn, price1k: r.m.market_unit_price_1k_p50 }));
export const sharedPart = join({ a: componentParts, b: componentParts }).on(r => [r.a.partId.eq(r.b.partId), r.a.entityId.lt(r.b.entityId)]).map(r => ({ a: r.a.entityId, b: r.b.entityId, partId: r.a.partId }));
export const leftArray = components.leftArrayJoin(c => c.matched_part_ids, 'partId');
export const lowStock = lowStockCategories('acme');
export const orderedComponents = components.orderBy(c => c.updatedAt.desc()).thenBy(c => c.entityId.asc()).limit(20, 40);
export const orderedNullable = parts.orderBy(p => p.lifecycleYteol.asc().nullsLast());
export const orderedBare = parts.orderBy(p => p.mpn);
export const distinctManufacturer = parts.map(p => ({ manufacturerId: p.manufacturerId })).distinct();
export const entityUnion = unionAll(components.map(c => ({ entityId: c.entityId, kind: val('component', col.String) })), parts.map(p => ({ entityId: p.entityId, kind: val('part', col.String) })));
export const sampleOnly = components.sample(0.1);
export const explicitCte = componentParts.cte();
// Descriptor preservation through approved helper: UInt32 sum is bigint; Float64 is number.
export const latestTotals = latestIndices.aggregate(g => ({ versions: sum(g.version), stock: sum(g.stock_index) }));
// Outer joins are binary, kind({ left }, { right }): record key order is not visible to the type system.
export const leftLatest = leftJoin({ c: components.where(forTenant('acme')) }, { a: latest(availability.final().where(forTenant('acme'))) }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ entityId: r.c.entityId, stock: r.a.market_stock_total.ifNull(0) }));
export const optionalSnapshot = leftJoin({ ca: leftJoin({ c: components.where(forTenant('acme')).where(isActive) }, { a: latestAvailability }).on(r => r.c.entityId.eq(r.a.entityId)) }, { i: latestIndices }).on(r => r.ca.c.entityId.eq(r.i.entityId)).map(r => ({ entityId: r.ca.c.entityId, category: r.ca.c.category, stockTotal: r.ca.a.market_stock_total, stockP50: r.ca.a.market_stock_p50, leadDays: r.ca.a.market_lead_time_p50_days, stockIndex: r.i.stock_index }));
