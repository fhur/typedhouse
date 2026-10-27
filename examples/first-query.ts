import { from, registerCompiler } from "@chql/core";
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
    .limit(10);
  console.log(q.toSQL());
  console.log(await client.run(q));
} finally {
  await client.close();
}
