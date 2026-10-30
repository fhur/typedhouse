import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, defineFunction, from, stringLike, table, val } from '@chql/core';
import { compile, emitNaive } from '@chql/compiler';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect } from './backend-harness.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const parts = from(table('user_parts', { mpn: col.String, nullable: col.Nullable(col.String), n: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const editDistance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE user_parts (mpn String, nullable Nullable(String), n UInt64) ENGINE=Memory' });
  await driver.command({ query: "INSERT INTO user_parts VALUES ('GRM155R61A104KA01D','GRM155R61A104KA01D',1),('GRM155R61A104KA01X',NULL,2),('','',0),('é','é',3)" });
}, 120000);
afterAll(async () => { for (const b of backends) await b.close(); await driver?.close(); await container?.stop(); });
it('runs the unchanged spec example against independent native UInt64 output on both backends, run and stream', async () => {
  const query = parts.map(p => ({ mpn: p.mpn, distance: editDistance(p.mpn, 'GRM155R61A104KA01D') })).orderBy(r => r.mpn);
  const native = await (await driver.query({ query: "SELECT mpn, editDistance(mpn,'GRM155R61A104KA01D') AS distance, toTypeName(distance) AS type FROM user_parts ORDER BY mpn", format: 'JSONEachRow' })).json<{ mpn: string; distance: string; type: string }>();
  expect(native.every(r => r.type === 'UInt64')).toBe(true);
  expect(native.find(r => r.mpn === 'GRM155R61A104KA01D')!.distance).toBe('0');
  expect(native.find(r => r.mpn === 'GRM155R61A104KA01X')!.distance).toBe('1');
  const expected = native.map(({ mpn, distance }) => ({ mpn, distance: BigInt(distance) }));
  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir); expect(plan.sql).not.toContain('CAST');
    expect(plan.columns.distance).toEqual(col.UInt64.type);
    expect(plan.params).toEqual({ p0: 'GRM155R61A104KA01D' });
  }
  for (const backend of backends) { const c = createClientFromBackend(backend); expect(await c.run(query)).toEqual(expected); expect(await collect(c.stream(query))).toEqual(expected); }
});
it('checks null, empty, Unicode, nesting, concrete heterogeneous inputs and zero arguments independently', async () => {
  const repeat = defineFunction({ name: 'repeat', args: [col.String, col.UInt64], returns: col.String, deterministic: true });
  const identity = defineFunction({ name: 'identity', args: [col.String], returns: col.String, deterministic: true });
  const version = defineFunction({ name: 'version', args: [], returns: col.String, deterministic: true });
  const query = parts.map(p => ({ mpn: p.mpn, distance: editDistance(identity(p.nullable), 'e'), repeated: repeat(p.mpn, p.n), literal: repeat('a', 2n), version: version() })).orderBy(r => r.mpn);
  const native = await (await driver.query({ query: "SELECT mpn,editDistance(identity(nullable),'e') AS distance,repeat(mpn,n) AS repeated,repeat('a',toUInt64(2)) AS literal,version() AS version,toTypeName(distance) AS type,toTypeName(repeated) AS rt FROM user_parts ORDER BY mpn", format: 'JSONEachRow' })).json<{ mpn: string; distance: string | null; repeated: string; literal: string; version: string; type: string; rt: string }>();
  expect(native.every(r => r.type === 'Nullable(UInt64)' && r.rt === 'String')).toBe(true);
  expect(native.find(r => r.mpn === 'é')!.distance).toBe('2');
  expect(native.find(r => r.mpn === '')!.distance).toBe('1');
  expect(native.find(r => r.mpn === 'GRM155R61A104KA01X')!.distance).toBeNull();
  const expected = native.map(({ type: _type, rt: _rt, distance, ...r }) => ({ ...r, distance: distance === null ? null : BigInt(distance) }));
  const nullableCount = parts.map(() => ({ value: repeat('a', val(null, col.Nullable(col.UInt64))) })).limit(1);
  const nullNative = await (await driver.query({ query: "SELECT repeat('a',CAST(NULL AS Nullable(UInt64))) AS value,toTypeName(value) AS type", format: 'JSONEachRow' })).json();
  expect(nullNative).toEqual([{ value: null, type: 'Nullable(String)' }]);
  for (const backend of backends) {
    const c = createClientFromBackend(backend); expect(await c.run(query)).toEqual(expected); expect(await collect(c.stream(query))).toEqual(expected);
    expect(await c.run(nullableCount)).toEqual([{ value: null }]); expect(await collect(c.stream(nullableCount))).toEqual([{ value: null }]);
  }
});
it('retains native-backed FixedString/Enum rejection and LowCardinality descriptor mismatch controls', async () => {
  for (const expr of ["toFixedString('abc',3)", "CAST('abc' AS Enum8('abc'=1))"]) {
    await expect(driver.query({ query: `SELECT editDistance(${expr},'abc')`, format: 'JSONEachRow' })).rejects.toThrow(/Illegal type.*argument of function editDistance/);
  }
  await driver.command({ query: 'CREATE TABLE user_lc (s LowCardinality(String), n LowCardinality(Nullable(String))) ENGINE=Memory' });
  await driver.command({ query: "INSERT INTO user_lc VALUES ('abc','abc'),('axc',NULL)" });
  const native = await (await driver.query({ query: "SELECT version() AS version,toTypeName(editDistance(s,'abc')) AS st,toTypeName(editDistance(n,'abc')) AS nt FROM user_lc", format: 'JSONEachRow' })).json<{ version: string; st: string; nt: string }>();
  expect(native).toHaveLength(2);
  for (const r of native) { expect(r.version).toMatch(/^24\.8\./); expect(r.st).toBe('LowCardinality(UInt64)'); expect(r.nt).toBe('LowCardinality(Nullable(UInt64))'); }
  for (const descriptor of [col.FixedString(3), col.Enum8({ abc: 1 }), col.LowCardinality(col.String), col.LowCardinality(col.Nullable(col.String)), col.Nullable(col.LowCardinality(col.String))]) {
    const s = from(table('user_lc', { s: descriptor }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    for (const emit of [compile, emitNaive]) expect(() => emit(s.map(r => editDistance(r.s, 'abc')).ir)).toThrow('unsupported_user_argument');
  }
});
