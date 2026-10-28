import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, type Rel } from '@chql/core';
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
