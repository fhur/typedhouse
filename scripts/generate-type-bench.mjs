import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Twenty domain-specific input shapes, ten relational compositions each. No literal permutations.
const roots = [
  ['componentPayload', "components.where(forTenant('acme')).map(c => ({ entityId: c.entityId, category: c.category, parts: c.part_specifications, count: c.countOfParts }))"],
  ['partPayload', "parts.where(forTenant('acme')).map(p => ({ entityId: p.entityId, category: p.partCategoryId, path: p.partCategoryPath, years: p.lifecycleYteol }))"],
  ['tupleExtraction', "components.map(c => ({ entityId: c.entityId, mpns: c.part_specifications.element('mpn'), first: c.part_specifications.arrayElement(1).element('description') }))"],
  ['matchedParts', "components.arrayJoin(c => c.matched_part_ids, 'partId').map(c => ({ entityId: c.entityId, partId: c.partId }))"],
  ['leftMatchedParts', "components.leftArrayJoin(c => c.matched_part_ids, 'partId').map(c => ({ entityId: c.entityId, partId: c.partId, count: c.countOfParts }))"],
  ['componentPartJoin', "join({ c: components.arrayJoin(c => c.matched_part_ids, 'partId'), p: parts }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId)]).map(r => ({ entityId: r.c.entityId, mpn: r.p.mpn, lifecycle: r.p.lifecycleStatus }))"],
  ['priceJoin', "join({ c: components.arrayJoin(c => c.matched_part_ids, 'partId'), p: parts, m: latest(prices.final()) }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId), r.p.tenantId.eq(r.m.tenantId), r.p.entityId.eq(r.m.entityId)]).map(r => ({ entityId: r.c.entityId, price: r.m.market_unit_price_1k_p50 }))"],
  ['history', "join({ c: components, a: availability.final().where(a => a.effectiveAt.between(new Date('2026-01-01'), new Date('2026-10-27'))) }).on(r => [r.c.tenantId.eq(r.a.tenantId), r.c.entityId.eq(r.a.entityId)]).map(r => ({ entityId: r.c.entityId, at: r.a.effectiveAt, stock: r.a.market_stock_total }))"],
  ['availabilityLatest', "latest(availability.final()).map(r => ({ entityId: r.entityId, stock: r.market_stock_total, warnings: r.market_stock_total_warnings }))"],
  ['componentLatest', "latest(cIndices.final()).map(r => ({ entityId: r.entityId, stock: r.stock_index, lead: r.lead_time_max_days }))"],
  ['partLatest', "latest(pIndices.final()).map(r => ({ entityId: r.entityId, stock: r.stock_index, lead: r.lead_time_index_days.divide(r.lead_time_index_count) }))"],
  ['priceLatest', "latest(prices.final()).map(r => ({ entityId: r.entityId, price: r.market_unit_price_1k_p50, warnings: r.market_unit_price_1k_p50_warnings }))"],
  ['argMaxLatest', "cIndices.final().groupBy(r => ({ entityId: r.entityId })).aggregate(g => ({ stock: argMax(g.stock_index, g.version), lead: argMax(g.lead_time_max_days, g.version) }))"],
  ['weekly', "availability.final().groupBy(r => ({ entityId: r.entityId, week: r.effectiveAt.toStartOfWeek() })).aggregate(g => ({ mean: avg(g.market_stock_total), median: quantile(0.5)(g.market_lead_time_p50_days) }))"],
  ['versionTotals', "cIndices.final().groupBy(r => ({ entityId: r.entityId })).aggregate(g => ({ versions: sum(g.version), stock: sum(g.stock_index), warned: countIf(g.stock_index_warnings.notEmpty()) }))"],
  ['scalarShare', "availability.map(r => ({ entityId: r.entityId, share: r.market_stock_total.divide(scalar(availability.aggregate(g => sum(g.market_stock_total)))) }))"],
  ['membership', "components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => i.entityId))).map(c => ({ entityId: c.entityId, count: c.countOfParts }))"],
  ['entityUnion', "unionAll(components.map(c => ({ entityId: c.entityId, category: c.category })), parts.map(p => ({ entityId: p.entityId, category: p.partCategoryName })))"],
  ['manufacturerStock', "join({ p: parts, i: latest(pIndices.final()) }).on(r => [r.p.tenantId.eq(r.i.tenantId), r.p.entityId.eq(r.i.entityId)]).groupBy(r => ({ entityId: r.p.manufacturerId })).aggregate(g => ({ stock: sum(g.i.stock_index), parts: count(), eol: countIf(g.p.lifecycleStatus.in(['EOL', 'Obsolete'])) }))"],
  ['categoryStock', "join({ c: components, i: latest(cIndices.final()) }).on(r => [r.c.tenantId.eq(r.i.tenantId), r.c.entityId.eq(r.i.entityId)]).groupBy(r => ({ entityId: r.c.category.ifNull('uncategorised') })).aggregate(g => ({ stock: sum(g.i.stock_index), entities: uniq(g.c.entityId), price: exp(sum(g.i.price_change_log_sum).divide(sum(g.i.price_change_count))) }))"],
];
const tails = [
  ['project', q => `${q}.map(r => ({ ...r, labelled: r.entityId.startsWith('cmp_') }))`],
  ['distinctFilter', q => `${q}.where(r => r.entityId.notEmpty()).distinct()`],
  ['orderedPage', q => `${q}.orderBy(r => r.entityId.asc()).limit(20, 40)`],
  ['groupCount', q => `${q}.groupBy(r => ({ entityId: r.entityId })).aggregate(() => ({ occurrences: count() })).where(r => r.occurrences.gt(1n))`],
  ['semiJoin', q => `${q}.where(r => r.entityId.in(components.where(c => c.state.eq('active')).map(c => c.entityId)))`],
  ['repeatedUnion', q => `unionAll(${q}, ${q}.where(r => r.entityId.startsWith('cmp_'))).distinct()`],
  ['sharedCte', q => `join({ a: ${q}.cte(), b: ${q} }).on(r => r.a.entityId.eq(r.b.entityId)).map(r => ({ ...r.a }))`],
  ['entityEnrichment', q => `join({ a: ${q}, c: components }).on(r => r.a.entityId.eq(r.c.entityId)).map(r => ({ ...r.a, matched: r.c.matched_part_ids.length(), updatedAt: r.c.updatedAt }))`],
  ['arrayEnrichment', q => `join({ a: ${q}, c: components.arrayJoin(c => c.matched_part_ids, 'partId') }).on(r => r.a.entityId.eq(r.c.entityId)).map(r => ({ ...r.a, partId: r.c.partId }))`],
  ['rollupShare', q => `${q}.groupBy(r => ({ entityId: r.entityId })).aggregate(() => ({ occurrences: count() })).map(r => ({ entityId: r.entityId, occurrences: r.occurrences, proportion: r.occurrences.divide(scalar(${q}.aggregate(() => count()))) }))`],
];
let text = `// Generated by scripts/generate-type-bench.mjs; no annotated intermediates.\nimport { from, join, unionAll, argMax, avg, quantile, sum, scalar, count, countIf, uniq, exp } from '@chql/core';\nimport { db, components, cIndices, forTenant, latest } from '../../../packages/compiler/test/fixtures/corpus/low-stock.js';\nconst parts = from(db.entity_off_the_shelf_part);\nconst availability = from(db.metric_group_ots_component_market_availability);\nconst pIndices = from(db.metric_group_off_the_shelf_part_indices);\nconst prices = from(db.metric_group_off_the_shelf_part_market_price);\n`;
const queries = [];
for (const [root, expression] of roots) {
  // Each root is inferred once, then composed independently (as in real application reuse).
  text += `const ${root} = ${expression};\n`;
  for (const [topology, compose] of tails) {
    const name = `${root}_${topology}`;
    text += `export const ${name} = ${compose(root)};\n`;
    queries.push({ name, root, topology });
  }
}
assert.equal(queries.length, 200);
assert.equal(new Set(queries.map(q => q.name)).size, 200);
const manifest = { description: '20 domain input shapes x 10 nonliteral relational compositions; bounded supported corpus, not all spec examples', roots: roots.map(([name, expression]) => ({ name, expression })), topologies: tails.map(([name]) => name), queries, stress: ['chain25.ts', 'join10.ts'] };
for (const [name, data] of [['queries.ts', text], ['manifest.json', JSON.stringify(manifest, null, 2) + '\n']]) {
  const path = fileURLToPath(new URL(`../test/types/bench/${name}`, import.meta.url));
  if (process.argv.includes('--refresh')) writeFileSync(path, data);
  else assert.equal(readFileSync(path, 'utf8'), data, `Stale ${name}`);
}
console.log('Verified 200 typed compositions (20 roots x 10 topologies), plus original two stress cases.');
