import { col, table, from, join, max, sum, uniq, exp, countIf, type Query, type Infer, type Projection, type ProjectionRow, type Row } from '@typedhouse/core';

const partSpecification = col.Tuple({ id: col.String, mpn: col.Nullable(col.String), manufacturer: col.Nullable(col.String), description: col.Nullable(col.String), package: col.Nullable(col.String), part_type: col.Nullable(col.String) });
const metricMeta = { tenantId: col.String, entityId: col.String, version: col.UInt32, effectiveAt: col.DateTime64(3), insertedAt: col.DateTime64(3) };
const metricTable = { engine: 'ReplacingMergeTree', sortingKey: ['tenantId', 'entityId', 'version', 'effectiveAt'], partitionKey: [] };
export const db = {
  entity_ots_component: table('entity_ots_component', {
    tenantId: col.String, entityId: col.String, category: col.Nullable(col.String), state: col.String,
    part_specifications: col.Array(partSpecification), matched_part_ids: col.Array(col.String), countOfParts: col.UInt64, updatedAt: col.DateTime64(3),
  }, { engine: 'MergeTree', sortingKey: ['tenantId', 'entityId'], partitionKey: [] }),
  entity_off_the_shelf_part: table('entity_off_the_shelf_part', {
    tenantId: col.String, entityId: col.String, manufacturerId: col.String, manufacturerName: col.String, mpn: col.String,
    partCategoryId: col.Nullable(col.Int64), partCategoryName: col.Nullable(col.String), partCategoryPath: col.Array(col.Int64),
    lifecycleStatus: col.Nullable(col.String), lifecycleYteol: col.Nullable(col.Float64), countryOfOrigin: col.Array(col.String), ipns: col.Array(col.String), supplier_ids: col.Array(col.String), updatedAt: col.DateTime64(3),
  }, { engine: 'MergeTree', sortingKey: ['tenantId', 'entityId'], partitionKey: [] }),
  metric_group_ots_component_market_availability: table('metric_group_ots_component_market_availability', {
    ...metricMeta, market_stock_total: col.Float64, market_stock_total_warnings: col.Array(col.String), market_stock_p50: col.Float64,
    market_stock_p50_warnings: col.Array(col.String), market_lead_time_p50_days: col.Float64, market_lead_time_p50_days_warnings: col.Array(col.String),
  }, metricTable),
  metric_group_ots_component_indices: table('metric_group_ots_component_indices', {
    ...metricMeta, price_change_log_sum: col.Float64, price_change_count: col.Float64, stock_index: col.Float64, stock_index_warnings: col.Array(col.String),
    lead_time_index_part_days: col.Float64, lead_time_index_part_count: col.Float64, lead_time_max_days: col.Nullable(col.Float64),
  }, metricTable),
  metric_group_off_the_shelf_part_indices: table('metric_group_off_the_shelf_part_indices', {
    ...metricMeta, price_change_log_sum: col.Float64, price_change_count: col.Float64, stock_index: col.Float64, lead_time_index_days: col.Float64, lead_time_index_count: col.Float64,
  }, metricTable),
  metric_group_off_the_shelf_part_market_price: table('metric_group_off_the_shelf_part_market_price', {
    ...metricMeta, market_unit_price_1k_p50: col.Float64, market_unit_price_1k_p50_warnings: col.Array(col.String),
  }, metricTable),
};
export type ComponentRow = Infer<typeof db.entity_ots_component>;
export type ComponentIndicesRow = Infer<typeof db.metric_group_ots_component_indices>;
export const forTenant = (tenantId: string) =>
  <R extends { tenantId: string }>(r: Row<R>) => r.tenantId.eq(tenantId);
export const isActive = (c: Row<ComponentRow>) => c.state.eq('active');
export const components = from(db.entity_ots_component);
export const cIndices = from(db.metric_group_ots_component_indices);
export type Versioned = { tenantId: string; entityId: string; version: number };
// Owner-approved signature adjustment only. The body is the spec helper.
// Its operations are all deterministic: runtime live is exactly q.caps.live.
export function latest<Q extends Query<Versioned> & { readonly row: Projection }>(q: Q): Query<Infer<Q['row']>, Q['caps'], ProjectionRow<Q['row']>>;
export function latest<R extends Versioned>(q: Query<R>) {
  const newest = q
    .groupBy(m => ({ tenantId: m.tenantId, entityId: m.entityId }))
    .aggregate(g => ({ version: max(g.version) }));
  return join({ m: q, v: newest })
    .on(r => [r.m.tenantId.eq(r.v.tenantId), r.m.entityId.eq(r.v.entityId), r.m.version.eq(r.v.version)])
    .map(r => ({ ...r.m }));
}
export const categoryRollup = (tenantId: string) =>
  join({ c: components.where(forTenant(tenantId)).where(isActive), i: latest(cIndices.final().where(forTenant(tenantId))) })
    .on(r => r.c.entityId.eq(r.i.entityId))
    .groupBy(r => ({ category: r.c.category.ifNull('uncategorised') }))
    .aggregate(g => ({
      components: uniq(g.c.entityId),
      stockIndex: sum(g.i.stock_index),
      leadTimeIndex: sum(g.i.lead_time_index_part_days).divide(sum(g.i.lead_time_index_part_count)),
      priceIndex: exp(sum(g.i.price_change_log_sum).divide(sum(g.i.price_change_count))),
      warned: countIf(g.i.stock_index_warnings.notEmpty()),
    }));
export const lowStockCategories = (tenantId: string) =>
  categoryRollup(tenantId)
    .where(r => r.components.gt(10n))
    .orderBy(r => r.stockIndex.asc())
    .limit(50);
export const query = lowStockCategories('acme');
export const expectedSql = "WITH `t0` AS (SELECT `tenantId`, `entityId`, `version`, `price_change_log_sum`, `price_change_count`, `stock_index`, `stock_index_warnings`, `lead_time_index_part_days`, `lead_time_index_part_count` FROM `metric_group_ots_component_indices` FINAL WHERE `tenantId` = {p0:String})\nSELECT ifNull(`c`.`category`, {p1:String}) AS `category`, uniq(`c`.`entityId`) AS `components`, sum(`i`.`stock_index`) AS `stockIndex`, sum(`i`.`lead_time_index_part_days`) / sum(`i`.`lead_time_index_part_count`) AS `leadTimeIndex`, exp(sum(`i`.`price_change_log_sum`) / sum(`i`.`price_change_count`)) AS `priceIndex`, countIf(notEmpty(`i`.`stock_index_warnings`)) AS `warned`\nFROM (SELECT `entityId`, `category` FROM `entity_ots_component` WHERE `tenantId` = {p2:String} AND `state` = {p3:String}) AS `c`\nINNER ALL JOIN (SELECT `m`.`entityId` AS `entityId`, `m`.`price_change_log_sum` AS `price_change_log_sum`, `m`.`price_change_count` AS `price_change_count`, `m`.`stock_index` AS `stock_index`, `m`.`stock_index_warnings` AS `stock_index_warnings`, `m`.`lead_time_index_part_days` AS `lead_time_index_part_days`, `m`.`lead_time_index_part_count` AS `lead_time_index_part_count` FROM `t0` AS `m` INNER ALL JOIN (SELECT `tenantId`, `entityId`, max(`version`) AS `version` FROM `t0` GROUP BY `tenantId`, `entityId`) AS `v` ON `m`.`tenantId` = `v`.`tenantId` AND `m`.`entityId` = `v`.`entityId` AND `m`.`version` = `v`.`version`) AS `i` ON `c`.`entityId` = `i`.`entityId`\nGROUP BY ifNull(`c`.`category`, {p1:String})\nHAVING `components` > {p4:UInt64}\nORDER BY `stockIndex` ASC\nLIMIT 50";
export const expectedParams = { p0: 'acme', p1: 'uncategorised', p2: 'acme', p3: 'active', p4: '10' };
