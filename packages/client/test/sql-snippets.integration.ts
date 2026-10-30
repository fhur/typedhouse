import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, sql } from '@chql/core';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect } from './backend-harness.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const source = from(table('snippet_items', { mpn: col.String, optional: col.Nullable(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE snippet_items (mpn String, optional Nullable(String)) ENGINE=Memory' });
  await driver.command({ query: "INSERT INTO snippet_items VALUES ('GRM155','GRM156'),('abc',NULL),('','')" });
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
it('matches independent native editDistance SQL and exact nullable descriptors on run and stream', async () => {
  const query = source.map(p => ({ mpn: p.mpn, distance: sql`editDistance(${p.mpn}, ${'GRM155'})`.as(col.UInt64), optional: sql`editDistance(${p.optional}, ${'GRM155'})`.as(col.Nullable(col.UInt64)) })).orderBy(r => r.mpn);
  const response = await driver.query({ query: "SELECT mpn,editDistance(mpn,'GRM155') AS distance,editDistance(optional,'GRM155') AS optionalDistance,toTypeName(distance) AS dt,toTypeName(optionalDistance) AS ot FROM snippet_items ORDER BY mpn", format: 'JSONEachRow' });
  const rows = await response.json<{ mpn: string; distance: string; optionalDistance: string | null; dt: string; ot: string }>();
  expect(rows.map(r => [r.dt, r.ot])).toEqual(Array.from({ length: 3 }, () => ['UInt64', 'Nullable(UInt64)']));
  const expected = rows.map(r => ({ mpn: r.mpn, distance: BigInt(r.distance), optional: r.optionalDistance === null ? null : BigInt(r.optionalDistance) }));
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    expect(await client.run(query)).toEqual(expected);
    expect(await collect(client.stream(query))).toEqual(expected);
  }
});
