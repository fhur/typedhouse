import { count, max, from, registerCompiler, join, unionAll } from "@chql/core";
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
  const componentParts = from(db.entity_ots_component).where(c => c.tenantId.eq('acme'))
    .leftArrayJoin(c => c.matched_part_ids, 'partId')
    .map(c => ({ id: c.entityId, partId: c.partId }))
    .orderBy(r => r.id).thenBy(r => r.partId).limit(10);
  console.log(componentParts.toSQL());
  console.log(await client.run(componentParts));
  const sharedParts = join({ a: componentParts, b: componentParts })
    .on(r => [r.a.partId.eq(r.b.partId), r.a.id.lt(r.b.id)])
    .map(r => ({ a: r.a.id, b: r.b.id, partId: r.a.partId }));
  console.log(sharedParts.toSQL());
  console.log(await client.run(sharedParts));
  // Bag union keeps duplicates and each branch's local order/limit boundary.
  const combined = unionAll(q, q.limit(1)).orderBy(r => r.id);
  console.log(combined.toSQL());
  console.log(await client.run(combined));
  // Fixture tables have no sampling key: demonstrate SQL only, not execution.
  console.log(from(db.entity_ots_component).sample(0.1).toSQL());
} finally {
  await client.close();
}
