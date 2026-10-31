import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { canonicalKey, col, from, table } from '@typedhouse/core';
import { createClickHouseBackend, rowDecoder } from '../src/index.js';

let container: StartedTestContainer;
let driver: ReturnType<typeof createDriver>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const query = from(table('pragmatic', {
  decimal: col.Decimal(38, 9), ints: col.Map(col.String, col.Int64), numeric: col.Map(col.UInt64, col.Int64),
  dates: col.Map(col.String, col.Date), nested: col.Map(col.String, col.Array(col.Int64)),
  decimals: col.Map(col.String, col.Decimal64(2)), day: col.Date32, precise: col.DateTime64(9),
  enum: col.Enum8({ ok: 1 }), uuid: col.UUID, ip4: col.IPv4, ip6: col.IPv6,
  containers: col.Array(col.Tuple({ n: col.Int64, at: col.DateTime64(3), map: col.Map(col.String, col.Int64), d: col.Decimal(38, 9) })),
  tuple: col.Tuple([col.UInt64, col.Date]), json: col.JSON, variant: col.Variant(col.String, col.UInt64),
}, { engine: 'View', sortingKey: [], partitionKey: [] }));
const select = `SELECT CAST('1234567890123456.123456789', 'Decimal(38,9)') AS decimal,
  map('x',toInt64('9223372036854775807')) AS ints, map(toUInt64(42),toInt64(7)) AS numeric,
  map('x',toDate('2024-01-01')) AS dates, map('x',[toInt64(7)]) AS nested,
  map('x',toDecimal64('1.20',2)) AS decimals, toDate32('1900-01-01') AS day,
  toDateTime64('2024-01-02 03:04:05.123456789',9,'UTC') AS precise,
  CAST('ok' AS Enum8('ok'=1)) AS enum, toUUID('00000000-0000-0000-0000-000000000001') AS uuid,
  toIPv4('1.2.3.4') AS ip4, toIPv6('::1') AS ip6,
  [CAST((toInt64(7),toDateTime64('2024-01-02 03:04:05.123',3,'UTC'),map('x',toInt64(7)),decimal),
    'Tuple(n Int64, at DateTime64(3), map Map(String,Int64), d Decimal(38,9))')] AS containers,
  tuple(toUInt64('18446744073709551615'),toDate('2024-01-01')) AS tuple,
  CAST('{"x":1}', 'JSON') AS json, CAST(toUInt64(42), 'Variant(String, UInt64)') AS variant`;
const settings = { date_time_output_format: 'iso' as const, output_format_json_quote_64bit_integers: 1 as const, output_format_json_quote_denormals: 1 as const, output_format_json_quote_decimals: 1 as const };
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { allow_experimental_json_type: 1 as const, allow_experimental_variant_type: 1 as const, output_format_json_quote_decimals: 0 as const } };
  driver = createDriver(options);
  await driver.command({ query: `CREATE VIEW pragmatic AS ${select}` });
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
it('preserves exact decimal strings and wire Maps while adapting only arrays/tuples in buffered and streaming modes', async () => {
  const result = await driver.query({ query: select, format: 'JSONEachRow', clickhouse_settings: settings });
  const wire = await result.json<Record<string, unknown>>(); result.close();
  const streamed = [];
  const response = await driver.query({ query: select, format: 'JSONEachRow', clickhouse_settings: settings });
  try { for await (const batch of response.stream()) for (const row of batch) streamed.push(row.json()); } finally { response.close(); }
  expect(streamed).toEqual(wire);
  expect(wire[0]).toMatchObject({ decimal: '1234567890123456.123456789', ints: { x: '9223372036854775807' }, numeric: { '42': '7' }, dates: { x: '2024-01-01' }, nested: { x: ['7'] }, decimals: { x: '1.2' }, day: '1900-01-01', enum: 'ok', uuid: '00000000-0000-0000-0000-000000000001', ip4: '1.2.3.4', ip6: '::1', variant: '42', json: { x: 1 } });
  const expected = { ...wire[0], day: new Date('1900-01-01'), containers: [{ n: 7n, at: new Date('2024-01-02T03:04:05.123Z'), map: { x: '7' }, d: '1234567890123456.123456789' }], tuple: [18446744073709551615n, new Date('2024-01-01')] };
  expect(wire[0]?.precise).toBe('2024-01-02T03:04:05.123456789Z');
  for (const backend of backends) {
    const plan = backend.compile(query.ir);
    expect(await backend.runBuffered(plan)).toEqual([expected]);
    const actual = []; for await (const batch of backend.run(plan)) actual.push(...batch);
    expect(actual).toEqual([expected]);
    const adapted = rowDecoder(plan.compiled.columns)(wire[0]);
    for (const name of ['ints', 'numeric', 'dates', 'nested', 'decimals', 'json']) expect(adapted[name]).toBe(wire[0]?.[name]);
    expect(canonicalKey(adapted, Object.entries(plan.compiled.columns))).toBe(canonicalKey(expected, Object.entries(plan.compiled.columns)));
  }
  const lossy = await driver.query({ query: select, format: 'JSONEachRow', clickhouse_settings: { ...settings, output_format_json_quote_decimals: 0 } });
  try { expect((await lossy.json<Record<string, unknown>>())[0]?.decimal).toBe(1234567890123456.1); } finally { lossy.close(); }
});
it('keeps negative/scaled Decimals and duplicate-key Map wire semantics at temporal and nested boundaries', async () => {
  const columns = {
    negative: col.Decimal256(18), zeroScale: col.Decimal128(0), small: col.Decimal32(4),
    duplicate: col.Map(col.String, col.Int64), numeric: col.Map(col.Int64, col.Date32),
    deep: col.Array(col.Array(col.Map(col.String, col.Tuple([col.Int64, col.Date32, col.Array(col.Int64)])))),
    days: col.Array(col.Date32), timestamps: col.Array(col.DateTime64(3)), wide: col.Array(col.Int256),
  };
  const sql = `SELECT toDecimal256('-123456789012345678901234567890.123456789012345678',18) AS negative,
    toDecimal128('-123456789012345678901234567890',0) AS zeroScale, toDecimal32('-0.0123',4) AS small,
    map('x',toInt64(1),'x',toInt64(2),'__proto__',toInt64(3)) AS duplicate,
    map(toInt64(-42),toDate32('1900-01-01')) AS numeric,
    [[map('x',tuple(toInt64(-7),toDate32('1900-01-01'),[toInt64(8)]))]] AS deep,
    [toDate32('1900-01-01'),toDate32('2299-12-31')] AS days,
    [toDateTime64('1969-12-31 23:59:59.123',3,'UTC'),toDateTime64('2024-01-02 03:04:05.123',3,'Asia/Kolkata')] AS timestamps,
    [toInt256('-57896044618658097711785492504343953926634992332820282019728792003956564819968')] AS wide`;
  await driver.command({ query: `CREATE VIEW pragmatic_edges AS ${sql}` });
  const result = await driver.query({ query: sql, format: 'JSONEachRow', clickhouse_settings: settings });
  const raw = await result.text(); result.close();
  expect(raw).toContain('"x":"1","x":"2"');
  const wire = JSON.parse(raw) as Record<string, unknown>;
  expect(wire).toMatchObject({ negative: '-123456789012345678901234567890.123456789012345678', zeroScale: '-123456789012345678901234567890', small: '-0.0123', duplicate: { x: '2', ['__proto__']: '3' }, numeric: { '-42': '1900-01-01' }, deep: [[{ x: ['-7', '1900-01-01', ['8']] }]] });
  const expected = { ...wire, days: [new Date('1900-01-01'), new Date('2299-12-31')], timestamps: [new Date('1969-12-31T23:59:59.123Z'), new Date('2024-01-01T21:34:05.123Z')], wide: [-(1n << 255n)] };
  const q = from(table('pragmatic_edges', columns, { engine: 'View', sortingKey: [], partitionKey: [] }));
  for (const backend of backends) {
    const plan = backend.compile(q.ir);
    expect(await backend.runBuffered(plan)).toEqual([expected]);
    const streamed = []; for await (const batch of backend.run(plan)) streamed.push(...batch);
    expect(streamed).toEqual([expected]);
    const adapted = rowDecoder(plan.compiled.columns)(wire);
    expect((adapted.deep as unknown[][])[0]![0]).toBe((wire.deep as unknown[][])[0]![0]);
    expect(adapted.duplicate).toBe(wire.duplicate);
  }
});
