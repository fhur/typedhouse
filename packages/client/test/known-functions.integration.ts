import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, val } from '@chql/core';
import { compile, emitNaive } from '@chql/compiler';
import { fn, agg } from '../../codegen/test/snapshots/functions.js';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect } from './backend-harness.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const source = from(table('known_items', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE known_items (id String) ENGINE=Memory' });
  await driver.command({ query: "INSERT INTO known_items VALUES ('a'),('b'),('a')" });
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
it('executes the actual generated scalar module with native UInt64 descriptors and exact bigint rows', async () => {
  const shared = val('salt');
  const query = source.map(r => ({ id: r.id, h: fn.cityHash64(r.id).as(col.UInt64), salted: fn.cityHash64(r.id, shared, shared).as(col.UInt64) })).orderBy(r => r.id);
  const response = await driver.query({ query: "SELECT id,cityHash64(id) AS h,cityHash64(id,'salt','salt') AS salted,toTypeName(h) AS ht,toTypeName(salted) AS st FROM known_items ORDER BY id", format: 'JSONEachRow' });
  const native = await response.json<{ id: string; h: string; salted: string; ht: string; st: string }>();
  expect(native.map(r => [r.ht, r.st])).toEqual([['UInt64', 'UInt64'], ['UInt64', 'UInt64'], ['UInt64', 'UInt64']]);
  const expected = native.map(({ id, h, salted }) => ({ id, h: BigInt(h), salted: BigInt(salted) }));
  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);
    expect(plan.sql).not.toContain('CAST');
    expect(plan.params).toEqual({ p0: 'salt' });
    expect(plan.sql.match(/\{p0:String\}/g)).toHaveLength(2);
  }
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    expect(await client.run(query)).toEqual(expected);
    expect(await collect(client.stream(query))).toEqual(expected);
  }
});
it('executes generated aggregates, scalar-around-aggregate and zero-argument calls on both backends', async () => {
  const query = source.aggregate(g => ({ n: agg.uniqExact(g.id).as(col.UInt64), h: fn.cityHash64(agg.uniqExact(g.id).as(col.UInt64)).as(col.UInt64), count: agg.count().as(col.UInt64) }));
  const response = await driver.query({ query: 'SELECT uniqExact(id) AS n,cityHash64(uniqExact(id)) AS h,count() AS count,toTypeName(n) AS nt,toTypeName(h) AS ht FROM known_items', format: 'JSONEachRow' });
  const native = await response.json<{ n: string; h: string; count: string; nt: string; ht: string }>();
  expect(native[0]!.nt).toBe('UInt64'); expect(native[0]!.ht).toBe('UInt64');
  const expected = native.map(({ n, h, count }) => ({ n: BigInt(n), h: BigInt(h), count: BigInt(count) }));
  const zero = source.map(() => fn.version().as(col.String)).limit(1);
  const version = await (await driver.query({ query: 'SELECT version() AS version', format: 'JSONEachRow' })).json();
  for (const emit of [compile, emitNaive]) expect(emit(query.ir).sql).not.toContain('CAST');
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    expect(await client.run(query)).toEqual(expected);
    expect(await collect(client.stream(query))).toEqual(expected);
    expect(await client.run(zero)).toEqual(version);
    expect(await collect(client.stream(zero))).toEqual(version);
  }
});
