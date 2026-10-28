import { avg, avgIf, argMax, argMaxIf, cast, col, val, count, max, sum, scalar, from, registerCompiler, join, unionAll } from "@chql/core";
import { emitNaive } from "@chql/compiler";
import { createClient } from "@chql/client";
// Checked-in output of the real codegen integration fixture. For your database,
// generate examples/generated and change this import to './generated/schema.js'.
import { db } from "../packages/codegen/test/snapshots/schema.js";
registerCompiler(emitNaive);
const client = createClient({
  url: process.env["CLICKHOUSE_URL"] ?? "http://localhost:8123",
  username: process.env["CLICKHOUSE_USER"] ?? "default",
  password: process.env["CLICKHOUSE_PASSWORD"] ?? "",
  database: process.env["CLICKHOUSE_DATABASE"] ?? "default",
});
try {
  const q = from(db.entity_ots_component)
    .where((c) => c.tenantId.eq("acme"))
    .map((c) => ({
      id: c.entityId,
      count: c.countOfParts,
      updatedAt: c.updatedAt,
      category: c.category,
    }))
    .orderBy(r => r.id)
    .limit(10);
  console.log(q.toSQL());
  console.log(await client.run(q));
  const structural = from(db.entity_ots_component)
    .where(c => c.tenantId.eq('acme').and(c.matched_part_ids.notEmpty()))
    .map(c => ({
      id: c.entityId,
      category: c.category.ifNull('uncategorised'),
      matched: c.matched_part_ids.length(),
      mpns: c.part_specifications.element('mpn'),
      firstDescription: c.part_specifications.arrayElement(1).element('description'),
    })).orderBy(r => r.id).limit(10);
  console.log(structural.toSQL());
  console.log(await client.run(structural));
  const rollup = from(db.entity_ots_component).where(c => c.tenantId.eq('acme'))
    .groupBy(c => ({ category: c.category.ifNull('uncategorised') }))
    .aggregate(g => ({ components: count(), largest: max(g.countOfParts) }))
    .orderBy(r => r.category);
  console.log(rollup.toSQL());
  console.log(await client.run(rollup));
  // NULL metric values are skipped independently, so leadDays may be older than version.
  // Different values tied at the maximal version have no deterministic winner.
  const cleanIndices = from(db.metric_group_ots_component_indices).final();
  // Caller-selected half-open history window; no weekly bucketing/quantile yet.
  const historyMeans = cleanIndices.where(i => i.tenantId.eq('acme'))
    .where(i => i.effectiveAt.ge(new Date('2026-01-01T00:00:00Z')).and(i.effectiveAt.lt(new Date('2027-01-01T00:00:00Z'))))
    .groupBy(i => ({ entityId: i.entityId }))
    .aggregate(g => ({ stock: avg(g.stock_index), leadDays: avg(g.lead_time_max_days), positiveStock: avgIf(g.stock_index, g.stock_index.gt(0)) }))
    .orderBy(r => r.stock.desc()).limit(10);
  console.log('history means', await client.run(historyMeans));
  for await (const row of client.stream(historyMeans)) console.log('streamed history mean', row);
  const latestMetrics = cleanIndices.where(i => i.tenantId.eq('acme'))
    .groupBy(i => ({ entityId: i.entityId }))
    .aggregate(g => ({ version: max(g.version), stockIndex: argMax(g.stock_index, g.version), leadDays: argMax(g.lead_time_max_days, g.version) }))
    .orderBy(r => r.entityId).limit(10);
  console.log('latest metrics', await client.run(latestMetrics));
  for await (const row of client.stream(latestMetrics)) console.log('streamed latest metric', row);
  const latestPositive = cleanIndices.where(i => i.tenantId.eq('acme'))
    .aggregate(g => ({ stock: argMaxIf(g.stock_index, g.version, g.stock_index.gt(0)) }));
  console.log('latest positive stock', await client.run(latestPositive));
  const componentParts = from(db.entity_ots_component).where(c => c.tenantId.eq('acme'))
    .leftArrayJoin(c => c.matched_part_ids, 'partId')
    .map(c => ({ id: c.entityId, partId: c.partId }))
    .orderBy(r => r.id).thenBy(r => r.partId).limit(10);
  console.log(componentParts.toSQL());
  console.log(await client.run(componentParts));
  for await (const row of client.stream(componentParts)) console.log('streamed part', row);
  // Ordinary CTE hint only: compilation warns; this does not cache server results.
  const fencedParts = componentParts.materialize().where(r => r.partId.notEmpty())
    .groupBy(r => r.partId).aggregate(() => count()).orderBy(r => r.count.desc()).limit(10);
  console.log(fencedParts.toSQL());
  console.log(await client.run(fencedParts));
  const sharedParts = join({ a: componentParts, b: componentParts })
    .on(r => [r.a.partId.eq(r.b.partId), r.a.id.lt(r.b.id)])
    .map(r => ({ a: r.a.id, b: r.b.id, partId: r.a.partId }));
  console.log(sharedParts.toSQL());
  console.log(await client.run(sharedParts));
  // Bag union keeps duplicates and each branch's local order/limit boundary.
  const combined = unionAll(q, q.limit(1)).orderBy(r => r.id);
  console.log(combined.toSQL());
  console.log(await client.run(combined));
  // Explicit SQL conversion aligns descriptors; .as() does not convert values.
  const integerValues = q.map(() => ({ value: val(2, col.UInt32) }));
  const floatValues = q.map(() => ({ value: val(2.5, col.Float64) }));
  const aligned = unionAll(integerValues.map(r => cast(r.value, col.Float64)), floatValues)
    .where(r => r.value.gt(0)).groupBy(r => r.value).aggregate(() => count()).orderBy(r => r.value);
  console.log(aligned.toSQL());
  console.log(await client.run(aligned));
  for await (const row of client.stream(aligned)) console.log('aligned union', row);
  const selectedIds = q.map(r => r.id).distinct().limit(2);
  const membership = q.where(r => r.id.in(selectedIds)).map(r => ({ id: r.id, known: r.category.notIn(['obsolete']) }));
  console.log(membership.toSQL());
  console.log(await client.run(membership));
  // Scalar wrappers have Nullable descriptors on ClickHouse 24.8, even for count/sum.
  const totalParts = q.aggregate(g => sum(g.count));
  const shares = q.map(r => ({ id: r.id, share: r.count.divide(scalar(totalParts)).multiply(100) }));
  console.log(shares.toSQL());
  console.log(await client.run(shares));
  // Fixture tables have no sampling key: demonstrate SQL only, not execution.
  console.log(from(db.entity_ots_component).sample(0.1).toSQL());
} finally {
  await client.close();
}
