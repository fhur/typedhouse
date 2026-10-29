import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, greatest, table, val } from '@chql/core';
import { compile, emitNaive } from '@chql/compiler';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect } from './backend-harness.js';
import { componentsLatest } from '../../compiler/test/fixtures/corpus/components-latest.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const one = from(table('one', { n: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE one (n UInt8) ENGINE=Memory' });
  await driver.command({ query: 'INSERT INTO one VALUES (1)' });
  for (const statement of readFileSync(new URL('../../compiler/test/fixtures/schema.sql', import.meta.url), 'utf8').split(';').filter(s => s.trim())) await driver.command({ query: statement });
  const ids = ['a-newer', 'i-newer', 'tie', 'inactive', 'missing-a', 'missing-i', 'other-category', 'null-category'];
  await driver.insert({ table: 'entity_ots_component', format: 'JSONEachRow', values: [...ids.map(entityId => ({ tenantId: 'acme', entityId, category: entityId === 'null-category' ? null : entityId === 'other-category' ? 'Actives' : 'Passives/Capacitors', state: entityId === 'inactive' ? 'inactive' : 'active' })), { tenantId: 'other', entityId: 'other-only', category: 'Passives', state: 'active' }] });
  for (const [side, name] of [['a', 'metric_group_ots_component_market_availability'], ['i', 'metric_group_ots_component_indices']] as const) {
    const values = [];
    for (const tenantId of ['acme', 'other']) for (const entityId of [...ids, 'other-only']) {
      if (tenantId === 'acme' && entityId === `missing-${side}`) continue;
      for (const version of side === 'a' ? [1, 2] : [1, 3]) for (const duplicate of [false, true]) {
        const effectiveAt = version === 1 ? '2026-01-01 00:00:00.000' : entityId === `${side}-newer` ? '2026-07-03 00:00:00.123' : '2026-07-02 00:00:00.123';
        const metric = tenantId === 'other' ? 999 : version === 1 ? 1 : duplicate ? 20 : 10;
        values.push({ tenantId, entityId, version, effectiveAt, insertedAt: duplicate ? '2026-08-02 00:00:00.000' : '2026-08-01 00:00:00.000', ...(side === 'a' ? { market_stock_total: metric, market_stock_p50: metric / 2, market_lead_time_p50_days: metric / 4 } : { stock_index: metric / 10 }) });
      }
    }
    await driver.insert({ table: name, format: 'JSONEachRow', values });
  }
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });

it('executes the exact spec three-input query against independently written SQL and rows', async () => {
  const native = `SELECT c.entityId AS entityId,c.category AS category,a.market_stock_total AS stockTotal,a.market_stock_p50 AS stockP50,a.market_lead_time_p50_days AS leadDays,i.stock_index AS stockIndex,greatest(a.effectiveAt,i.effectiveAt) AS asOf
FROM entity_ots_component c
INNER ALL JOIN (SELECT * FROM metric_group_ots_component_market_availability FINAL WHERE tenantId='acme' AND (tenantId,entityId,version) IN (SELECT tenantId,entityId,max(version) FROM metric_group_ots_component_market_availability WHERE tenantId='acme' GROUP BY tenantId,entityId)) a ON c.entityId=a.entityId
INNER ALL JOIN (SELECT * FROM metric_group_ots_component_indices FINAL WHERE tenantId='acme' AND (tenantId,entityId,version) IN (SELECT tenantId,entityId,max(version) FROM metric_group_ots_component_indices WHERE tenantId='acme' GROUP BY tenantId,entityId)) i ON c.entityId=i.entityId
WHERE c.tenantId='acme' AND c.state='active' AND startsWith(c.category,'Passives') ORDER BY entityId`;
  const expected = ['a-newer', 'i-newer', 'tie'].map(entityId => ({ entityId, category: 'Passives/Capacitors', stockTotal: 20, stockP50: 10, leadDays: 5, stockIndex: 2, asOf: new Date(entityId === 'tie' ? '2026-07-02T00:00:00.123Z' : '2026-07-03T00:00:00.123Z') }));
  const response = await driver.query({ query: native, format: 'JSONEachRow', clickhouse_settings: { date_time_output_format: 'iso' } });
  try { expect((await response.json<{ entityId: string; asOf: string }>()).map(r => ({ ...r, asOf: new Date(r.asOf) }))).toEqual(expected); } finally { response.close(); }
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    const query = componentsLatest.orderBy(r => r.entityId);
    expect(await client.run(query)).toEqual(expected);
    expect(await collect(client.stream(query))).toEqual(expected);
    expect(await client.run(query.where(r => r.asOf.gt(new Date('2026-07-02T12:00:00Z'))).map(r => r.entityId))).toEqual([{ entityId: 'a-newer' }, { entityId: 'i-newer' }]);
  }
});

it('restores timezone metadata after UTC parsing without changing epoch ticks, precision or parameter identity', async () => {
  const instants = ['2026-01-02T03:04:05.678Z', '2026-07-02T03:04:05.678Z', '2026-03-29T00:59:59.999Z', '2026-03-29T01:00:00.001Z', '2026-10-25T00:59:59.999Z', '2026-10-25T01:00:00.001Z', '1969-12-31T23:59:59.123Z'];
  for (const zone of [undefined, 'UTC', 'Europe/Amsterdam'] as const) for (const precision of [0, 1, 2, 3] as const) for (const iso of instants) {
    const descriptor = col.DateTime64(precision, zone);
    const value = val(new Date(iso), descriptor);
    const query = one.map(() => ({ at: value, again: value }));
    const expectedMillis = Math.floor(new Date(iso).getTime() / 10 ** (3 - precision)) * 10 ** (3 - precision);
    // Literal server type is the oracle, including an omitted timezone under server defaults.
    const literal = `toDateTime64('2026-01-01 00:00:00',${precision}${zone === undefined ? '' : `,'${zone}'`})`;
    for (const emit of [compile, emitNaive]) {
      const plan = emit(query.ir);
      expect(Object.keys(plan.params)).toEqual(['p0']);
      const result = await driver.query({ query: `SELECT toTypeName(at) AS actual,toTypeName(${literal}) AS expected,toUnixTimestamp64Milli(at) AS millis FROM (${plan.sql})`, query_params: plan.params, format: 'JSONEachRow' });
      try {
        const [row] = await result.json<{ actual: string; expected: string; millis: string }>();
        expect(row!.actual).toBe(row!.expected);
        expect(BigInt(row!.millis)).toBe(BigInt(expectedMillis));
      } finally { result.close(); }
    }
    for (const backend of backends) expect(await createClientFromBackend(backend).run(query)).toEqual([{ at: new Date(expectedMillis), again: new Date(expectedMillis) }]);
  }
}, 120000);

it('greatest max precision agrees with literal server descriptors for every supported precision and homogeneous zones', async () => {
  const queries = [
    one.map(() => ({ at: greatest(val(new Date(1000), col.DateTime64(0)), val(new Date(2000), col.DateTime64(0))) })),
    one.map(() => ({ at: greatest(val(new Date(1000), col.DateTime64(0, 'UTC')), val(new Date(2100), col.DateTime64(1, 'UTC'))) })),
    one.map(() => ({ at: greatest(val(new Date(2100), col.DateTime64(1, 'Europe/Amsterdam')), val(new Date(2120), col.DateTime64(2, 'Europe/Amsterdam'))) })),
    one.map(() => ({ at: greatest(val(new Date(2123), col.DateTime64(3, 'Europe/Amsterdam')), val(new Date(2120), col.DateTime64(2, 'Europe/Amsterdam')), val(new Date(1000), col.DateTime64(0, 'Europe/Amsterdam'))) })),
  ];
  for (const [index, query] of queries.entries()) for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);
    // Independent literals: never derive the server oracle from compiler output.
    const expectedType = ["DateTime64(0)", "DateTime64(1, 'UTC')", "DateTime64(2, 'Europe/Amsterdam')", "DateTime64(3, 'Europe/Amsterdam')"][index]!;
    const literal = `CAST('2026-01-01 00:00:00' AS ${expectedType})`;
    const result = await driver.query({ query: `SELECT toTypeName(at) AS actual,toTypeName(${literal}) AS expected,toUnixTimestamp64Milli(at) AS millis FROM (${plan.sql})`, query_params: plan.params, format: 'JSONEachRow' });
    try { const [row] = await result.json<{ actual: string; expected: string; millis: string }>(); expect(row!.actual).toBe(row!.expected); expect(Number(row!.millis)).toBe([2000, 2100, 2120, 2123][index]); } finally { result.close(); }
  }
});

it('proves the pre-fix metadata mismatch and omitted-zone semantics under non-UTC session defaults', async () => {
  const response = await driver.query({ query: "SELECT toTypeName({v:DateTime64(3,'UTC')}) AS before,toTypeName(CAST({v:DateTime64(3,'UTC')} AS DateTime64(3,'Europe/Amsterdam'))) AS after,toUnixTimestamp64Milli(CAST({v:DateTime64(3,'UTC')} AS DateTime64(3,'Europe/Amsterdam'))) AS epoch", query_params: { v: '2026-07-02 03:04:05.678' }, format: 'JSONEachRow' });
  try { expect(await response.json()).toEqual([{ before: "DateTime64(3, 'UTC')", after: "DateTime64(3, 'Europe/Amsterdam')", epoch: String(Date.parse('2026-07-02T03:04:05.678Z')) }]); } finally { response.close(); }
  const query = one.map(() => ({ at: val(new Date('2026-07-02T03:04:05.678Z'), col.DateTime64(3)) }));
  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);
    const result = await driver.query({ query: `SELECT toTypeName(at) AS actual,toTypeName(toDateTime64('2026-07-02 03:04:05.678',3)) AS expected,toUnixTimestamp64Milli(at) AS epoch FROM (${plan.sql})`, query_params: plan.params, clickhouse_settings: { session_timezone: 'Europe/Amsterdam' }, format: 'JSONEachRow' });
    try { const [row] = await result.json<{ actual: string; expected: string; epoch: string }>(); expect(row!.actual).toBe(row!.expected); expect(row!.epoch).toBe(String(Date.parse('2026-07-02T03:04:05.678Z'))); } finally { result.close(); }
  }
});

it('rejects the unsupported LowCardinality DateTime64 server type rather than claiming restoration', async () => {
  await expect(driver.query({ query: "SELECT CAST('2026-01-01' AS LowCardinality(DateTime64(3,'UTC')))", format: 'JSONEachRow' })).rejects.toThrow('DataTypeLowCardinality is supported only');
  const low = col.LowCardinality(col.DateTime64(3));
  for (const query of [
    one.map(() => ({ at: val(new Date(), low) })),
    one.map(() => ({ at: val(null, col.Nullable(low)) })),
    one.map(() => ({ at: val([new Date()], col.Array(low)) })),
  ]) {
    // Deliberately invalid descriptor; value serialization must never reach the server.
    for (const emit of [compile, emitNaive]) expect(() => emit(query.ir)).toThrow('param_incompatible');
  }
});

it('restores nullable and array temporal parameters, including NULL elements', async () => {
  const date = col.DateTime64(3, 'Europe/Amsterdam');
  const query = one.map(() => ({ nullAt: val(null, col.Nullable(date)), at: val(new Date(-877), col.Nullable(date)), items: val([new Date(-877), null, new Date(123)], col.Array(col.Nullable(date))) }));
  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);
    const response = await driver.query({ query: `SELECT toTypeName(nullAt) AS n,toTypeName(at) AS a,toTypeName(items) AS itemType,toUnixTimestamp64Milli(at) AS epoch,arrayMap(x -> toUnixTimestamp64Milli(x),items) AS epochs FROM (${plan.sql})`, clickhouse_settings: Object.fromEntries(Object.entries(plan.params).map(([name, value]) => [`param_${name}`, value])), format: 'JSONEachRow' });
    try { expect(await response.json()).toEqual([{ n: "Nullable(DateTime64(3, 'Europe/Amsterdam'))", a: "Nullable(DateTime64(3, 'Europe/Amsterdam'))", itemType: "Array(Nullable(DateTime64(3, 'Europe/Amsterdam')))", epoch: '-877', epochs: ['-877', null, '123'] }]); } finally { response.close(); }
  }
  for (const backend of backends) expect(await createClientFromBackend(backend).run(query)).toEqual([{ nullAt: null, at: new Date(-877), items: [new Date(-877), null, new Date(123)] }]);
});
