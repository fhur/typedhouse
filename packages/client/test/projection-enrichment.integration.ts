import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, dateDiff, from, multiIf, now, table, val } from '@chql/core';
import { compile, emitNaive } from '@chql/compiler';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect } from './backend-harness.js';
import { projectionEnrichment } from '../../compiler/test/fixtures/corpus/projection-enrichment.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const epochs = ['2024-01-01T23:30:00.000Z', '2024-01-02T00:30:00.000Z', '2024-03-10T09:30:00.000Z', '2099-01-01T00:00:00.000Z'];
const specs = [{ id: 'p', mpn: 'MPN', manufacturer: null, description: 'description', package: null, part_type: null }];
const nullableSpecs = [{ id: 'null', mpn: null, manufacturer: null, description: null, package: null, part_type: null }];
const parts = (i: number) => i === 0 ? [] : i === 2 ? nullableSpecs : i === 3 ? [...specs, ...nullableSpecs] : specs;
const one = from(table('one', { n: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE one (n UInt8) ENGINE=Memory' });
  await driver.command({ query: 'INSERT INTO one VALUES (1)' });
  for (const statement of readFileSync(new URL('../../compiler/test/fixtures/schema.sql', import.meta.url), 'utf8').split(';').filter(s => s.trim())) await driver.command({ query: statement });
  await driver.insert({ table: 'entity_ots_component', format: 'JSONEachRow', values: epochs.map((updatedAt, i) => ({ tenantId: 'acme', entityId: String(i), category: i % 2 ? null : 'category', state: 'active', updatedAt: updatedAt.replace('T', ' ').replace('Z', ''), countOfParts: String(i), matched_part_ids: i ? ['p'] : [], part_specifications: parts(i) })) });
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
async function serverDay() {
  const result = await driver.query({ query: "SELECT toInt64(toUnixTimestamp(now())) AS epoch", format: 'JSONEachRow' });
  try { return Math.floor(Number((await result.json<{ epoch: string }>())[0]!.epoch) / 86400); } finally { result.close(); }
}
function expected(day: number) {
  return epochs.map((iso, i) => ({ tenantId: 'acme', entityId: String(i), category: i % 2 ? 'uncategorised' : 'category', state: 'active', updatedAt: new Date(iso), countOfParts: BigInt(i), matched_part_ids: i ? ['p'] : [], part_specifications: parts(i), matched: i ? 1n : 0n, mpns: parts(i).map(p => p.mpn), firstDesc: parts(i)[0]?.description ?? null, age: BigInt(day - Math.floor(Date.parse(iso) / 86400000)), tier: i === 0 ? 'none' : i < 3 ? 'few' : 'many', source: 'clickhouse' }));
}
it('runs and streams the complete projection versus independent native explicit-UTC SQL', async () => {
  const native = "SELECT *,ifNull(category,'uncategorised') AS categoryValue,length(matched_part_ids) AS matched,tupleElement(part_specifications,'mpn') AS mpns,tupleElement(arrayElement(part_specifications,1),'description') AS firstDesc,dateDiff('day',updatedAt,now(),'UTC') AS age,multiIf(countOfParts=0,'none',countOfParts<3,'few','many') AS tier,'clickhouse' AS source FROM entity_ots_component ORDER BY entityId";
  const before = await serverDay();
  const response = await driver.query({ query: native, format: 'JSONEachRow', clickhouse_settings: { date_time_output_format: 'iso', output_format_json_named_tuples_as_objects: 1 } });
  try {
    const rows = await response.json<Record<string, unknown>>();
    const after = await serverDay();
    const normalized = rows.map(({ categoryValue, ...r }) => ({ ...r, category: categoryValue, age: BigInt(String(r.age)), countOfParts: BigInt(String(r.countOfParts)), matched: BigInt(String(r.matched)), updatedAt: new Date(String(r.updatedAt)) }));
    expect([expected(before), expected(after)]).toContainEqual(normalized);
  } finally { response.close(); }
  for (const backend of backends) for (const streaming of [false, true]) {
    const client = createClientFromBackend(backend);
    const before = await serverDay();
    const query = projectionEnrichment.orderBy(r => r.entityId);
    const rows = streaming ? await collect(client.stream(query)) : await client.run(query);
    const after = await serverDay();
    expect([expected(before), expected(after)]).toContainEqual(rows);
  }
});
it('proves UTC calendar boundaries, not elapsed hours or session-local days, across DST/reversal/future inputs', async () => {
  const pairs = [
    ['2024-01-01T23:30:00Z', '2024-01-02T00:30:00Z', 1],
    ['2024-01-02T00:30:00Z', '2024-01-01T23:30:00Z', -1],
    ['2024-03-10T09:30:00Z', '2024-03-11T08:30:00Z', 1],
    ['2024-11-03T08:30:00Z', '2024-11-04T09:30:00Z', 1],
    ['2099-01-02T00:30:00Z', '2099-01-01T23:30:00Z', -1],
  ] as const;
  for (const zone of ['UTC', 'America/Los_Angeles']) for (const [start, end, expected] of pairs) {
    const query = one.map(() => ({ days: dateDiff('day', val(new Date(start), col.DateTime64(3)), val(new Date(end), col.DateTime64(3))) }));
    for (const emit of [compile, emitNaive]) {
      const plan = emit(query.ir);
      const response = await driver.query({ query: `SELECT days,dateDiff('day',toDateTime64('${start.replace('T', ' ').replace('Z', '')}',3,'UTC'),toDateTime64('${end.replace('T', ' ').replace('Z', '')}',3,'UTC'),'UTC') AS oracle,toTypeName(now()) AS clockType FROM (${plan.sql})`, query_params: plan.params, clickhouse_settings: { session_timezone: zone }, format: 'JSONEachRow' });
      try { expect(await response.json()).toEqual([{ days: String(expected), oracle: String(expected), clockType: 'DateTime' }]); } finally { response.close(); }
    }
  }
});
it('retains the same-epoch omitted-zone reproduction and explicit UTC fix', async () => {
  await driver.command({ query: 'CREATE TABLE temporal (dt DateTime, p0 DateTime64(0), p1 DateTime64(1), p2 DateTime64(2), p3 DateTime64(3)) ENGINE=Memory' });
  await driver.command({ query: "INSERT INTO temporal SELECT toDateTime(1704155400),toDateTime64(1704155400,0),toDateTime64(1704155400,1),toDateTime64(1704155400,2),toDateTime64(1704155400,3)" });
  const stored = from(table('temporal', { dt: col.DateTime(), p0: col.DateTime64(0), p1: col.DateTime64(1), p2: col.DateTime64(2), p3: col.DateTime64(3) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const same = val(new Date(1704155400000), col.DateTime64(3));
  const query = stored.map(r => ({ dt: dateDiff('day', r.dt, same), p0: dateDiff('day', r.p0, same), p1: dateDiff('day', r.p1, same), p2: dateDiff('day', r.p2, same), p3: dateDiff('day', r.p3, same) }));
  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);
    const response = await driver.query({ query: plan.sql, query_params: plan.params, clickhouse_settings: { session_timezone: 'America/Los_Angeles' }, format: 'JSONEachRow' });
    try { expect(await response.json()).toEqual([{ dt: '0', p0: '0', p1: '0', p2: '0', p3: '0' }]); } finally { response.close(); }
  }
  for (const field of ['dt', 'p0', 'p1', 'p2', 'p3']) {
    const response = await driver.query({ query: `SELECT dateDiff('day',${field},toDateTime(1704155400)) AS omitted,dateDiff('day',${field},toDateTime(1704155400),'UTC') AS utc FROM temporal`, clickhouse_settings: { session_timezone: 'America/Los_Angeles' }, format: 'JSONEachRow' });
    try { expect(await response.json()).toEqual([{ omitted: '-1', utc: '0' }]); } finally { response.close(); }
  }
});
it('decodes the server clock and skips NULL conditions with non-null String results', async () => {
  const query = one.map(() => ({ clock: now(), tier: multiIf([val(null, col.Nullable(col.Bool)), 'skip'], [val(true, col.Bool), 'yes'], 'no') }));
  for (const backend of backends) {
    const rows = await createClientFromBackend(backend).run(query);
    expect(rows[0]!.clock).toBeInstanceOf(Date);
    expect(rows[0]!.tier).toBe('yes');
  }
});
