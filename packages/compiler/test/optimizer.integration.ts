import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

let container: StartedTestContainer;
let url: string;
async function execute(sql: string, params: Readonly<Record<string, string>> = {}) {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text;
}
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  await execute('CREATE TABLE optimizer_products (id UInt32, category String, stock Nullable(UInt32)) ENGINE=Memory');
}, 120000);
afterAll(async () => { await container?.stop(); });

it('folded arithmetic preserves rows and types under both alias-preference settings', async () => {
  await execute('CREATE TABLE inventory (sku String, onHand UInt32, reserved Nullable(UInt32), reorderPoint Int64) ENGINE=Memory');
  await execute("INSERT INTO inventory VALUES ('a', 2, 5, 4), ('b', 10, 1, 3), ('c', 0, NULL, 3), ('d', 4294967295, 0, 4294967296)");
  const input = from(table('inventory', { sku: col.String, onHand: col.UInt32, reserved: col.Nullable(col.UInt32), reorderPoint: col.Int64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const queries = [
    input.where(r => r.onHand.minus(r.reserved).lt(r.reorderPoint))
      .map(r => ({ sku: r.sku, available: r.onHand.minus(r.reserved) })),
    input.map(r => ({ available: r.onHand.minus(r.reserved), product: r.onHand.multiply(r.onHand) })),
    input.where(r => r.reorderPoint.gt(0n)).map(r => ({ onHand: r.onHand, reserved: r.reserved }))
      .map(r => ({ reorderPoint: r.onHand.minus(r.reserved) })),
  ];
  expect(compile(queries[0]!.ir).sql.match(/SELECT /g)).toHaveLength(1);
  for (const query of queries) for (const setting of [0, 1]) {
    const results = [];
    for (const emitter of [compile, emitNaive]) {
      const plan = emitter(query.ir);
      const json = JSON.parse(await execute(`${plan.sql} SETTINGS prefer_column_name_to_alias = ${setting} FORMAT JSON`, plan.params));
      results.push({ meta: json.meta, data: json.data });
    }
    expect(results[0]).toEqual(results[1]);
  }
});

it('generated filter/projection queries match naive rows and types on generated datasets', async () => {
  const products = table('optimizer_products', { id: col.UInt32, category: col.String, stock: col.Nullable(col.UInt32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const source = from(products);
  const row = fc.record({ category: fc.constantFrom('electronics', 'books'), stock: fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }) });
  await fc.assert(fc.asyncProperty(
    fc.array(row, { maxLength: 30 }),
    fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 20 }),
    fc.constantFrom('electronics', 'books'), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 5 }),
    async (rows, low, high, category, limit, offset) => {
      await execute('TRUNCATE TABLE optimizer_products');
      if (rows.length) await execute(`INSERT INTO optimizer_products FORMAT JSONEachRow\n${rows.map((r, id) => JSON.stringify({ id, ...r })).join('\n')}`);
      const available = source.where(r => r.stock.gt(low));
      const inner = available.where(r => r.category.eq(category)).map(r => ({ id: r.id }));
      const queries = [
        available.where(r => r.category.eq(category)).map(r => ({ id: r.id, stock: r.stock }))
          .orderBy(r => r.stock.desc().nullsLast()).thenBy(r => r.id).limit(limit, offset),
        source.where(r => r.stock.gt(low).or(r.id.eq(0))).map(r => ({ id: r.id, stock: r.stock }))
          .where(r => r.stock.lt(high)).map(r => ({ id: r.id })).orderBy(r => r.id).limit(limit, offset),
        source.orderBy(r => r.id).limit(limit, offset).where(r => r.stock.gt(low))
          .where(r => r.category.eq(category)).map(r => ({ id: r.id })).orderBy(r => r.id),
        source.map(r => ({ stock: r.id, id: r.stock })).where(r => r.stock.gt(low))
          .where(r => r.stock.lt(high)).orderBy(r => r.stock),
        source.where(r => r.id.in(inner)).map(r => ({ id: r.id })).orderBy(r => r.id),
      ];
      async function result(rel: Rel, emitter: typeof compile) {
        const plan = emitter(rel);
        // JSON includes column metadata as well as row values. Compare both;
        // omit timing/scan statistics, which optimization is expected to change.
        const json = JSON.parse(await execute(`${plan.sql} FORMAT JSON`, plan.params));
        return { meta: json.meta, data: json.data };
      }
      for (const query of queries) {
        expect(await result(query.ir, compile)).toEqual(await result(query.ir, emitNaive));
      }
    },
  ), { numRuns: 30, seed: 20260318 });
}, 120000);
