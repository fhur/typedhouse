import fc from 'fast-check';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient as createDriver } from '@clickhouse/client';
import { col, from, table, type Decimal, type UUID } from '@typedhouse/core';
import { createClickHouseBackend, createClient, createClientFromBackend } from '../src/index.js';

/*
 * Round-trip property: for any row of supported values,
 *   insert it, read it back by id                        -> exactly the inserted row
 *   filter by id AND <column> = <inserted value>, per column -> exactly that row
 * The second half exercises parameter serialization for every column type: a value the
 * builder's types accept must be usable as a filter (a DateTime parameter once threw here).
 * Columns are every type the insert encoder can write (FixedString and IP types cannot be inserted).
 */
const roundtrip = table('roundtrip', {
  id: col.UInt32,
  u8: col.UInt8, i8: col.Int8, u16: col.UInt16, i16: col.Int16, u32: col.UInt32, i32: col.Int32,
  u64: col.UInt64, i64: col.Int64, u128: col.UInt128, i128: col.Int128, u256: col.UInt256, i256: col.Int256,
  f32: col.Float32, f64: col.Float64,
  bool: col.Bool,
  str: col.String,
  lcStr: col.LowCardinality(col.String),
  nStr: col.Nullable(col.String),
  uuid: col.UUID,
  date: col.Date,
  date32: col.Date32,
  dt: col.DateTime(),
  dtAms: col.DateTime('Europe/Amsterdam'),
  dt64s: col.DateTime64(0),
  dt64ms: col.DateTime64(3, 'Europe/Amsterdam'),
  dec: col.Decimal(18, 4),
  enm: col.Enum8({ draft: 1, paid: 2, refunded: -3 }),
}, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });

const ddl = `CREATE TABLE roundtrip (
  id UInt32,
  u8 UInt8, i8 Int8, u16 UInt16, i16 Int16, u32 UInt32, i32 Int32,
  u64 UInt64, i64 Int64, u128 UInt128, i128 Int128, u256 UInt256, i256 Int256,
  f32 Float32, f64 Float64,
  bool Bool,
  str String,
  lcStr LowCardinality(String),
  nStr Nullable(String),
  uuid UUID,
  date Date,
  date32 Date32,
  dt DateTime,
  dtAms DateTime('Europe/Amsterdam'),
  dt64s DateTime64(0),
  dt64ms DateTime64(3, 'Europe/Amsterdam'),
  dec Decimal(18, 4),
  enm Enum8('draft' = 1, 'paid' = 2, 'refunded' = -3)
) ENGINE = MergeTree ORDER BY id`;

const DAY = 86_400_000;
const signed = (bits: number) => fc.bigInt(-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n);
const unsigned = (bits: number) => fc.bigInt(0n, (1n << BigInt(bits)) - 1n);
const utcDay = (min: string, max: string) => fc.integer({ min: Date.parse(min) / DAY, max: Date.parse(max) / DAY }).map(d => new Date(d * DAY));
const seconds = (min: number, max: number) => fc.integer({ min, max }).map(s => new Date(s * 1000));
// ClickHouse prints decimals without trailing zeros; generate that canonical text from a scaled integer.
const decimal = (precision: number, scale: number) => fc.bigInt(-(10n ** BigInt(precision)) + 1n, 10n ** BigInt(precision) - 1n).map(n => {
  const sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  const whole = abs / 10n ** BigInt(scale);
  const fraction = (abs % 10n ** BigInt(scale)).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
});
const text = fc.string({ unit: 'binary', maxLength: 40 });
// ClickHouse 24.8 parses float text inexactly beyond about 1e±22 and for subnormals (off by
// 1 ULP, or flushed to 0), on inserts and on {p:Float64} parameters alike; see the canary below.
// Floats are generated where the server is exact: both zeros and magnitudes in [1e-6, 1e15].
const exactlyParsed = (arb: typeof fc.double | typeof fc.float, min: number, max: number) => fc.oneof(
  fc.constantFrom(0, -0),
  arb({ min, max, noNaN: true }),
  arb({ min, max, noNaN: true }).map(x => -x),
);

const row = fc.record({
  u8: fc.integer({ min: 0, max: 255 }), i8: fc.integer({ min: -128, max: 127 }),
  u16: fc.integer({ min: 0, max: 65_535 }), i16: fc.integer({ min: -32_768, max: 32_767 }),
  u32: fc.integer({ min: 0, max: 4_294_967_295 }), i32: fc.integer({ min: -2_147_483_648, max: 2_147_483_647 }),
  u64: unsigned(64), i64: signed(64), u128: unsigned(128), i128: signed(128), u256: unsigned(256), i256: signed(256),
  f32: exactlyParsed(fc.float, Math.fround(1e-6), Math.fround(1e15)),
  f64: exactlyParsed(fc.double, 1e-6, 1e15),
  bool: fc.boolean(),
  str: text,
  lcStr: text,
  nStr: fc.option(text, { nil: null }),
  uuid: fc.uuid().map(u => u as UUID),
  date: utcDay('1970-01-01', '2149-06-06'),
  date32: utcDay('1900-01-01', '2299-12-31'),
  dt: seconds(0, 0xFFFF_FFFF),
  dtAms: seconds(0, 0xFFFF_FFFF),
  dt64s: seconds(Date.parse('1900-01-01') / 1000, Date.parse('2299-12-31T23:59:59Z') / 1000),
  dt64ms: fc.integer({ min: Date.parse('1900-01-01'), max: Date.parse('2299-12-31T23:59:59.999Z') }).map(ms => new Date(ms)),
  dec: decimal(18, 4).map(d => d as Decimal<18, 4>),
  enm: fc.constantFrom('draft', 'paid', 'refunded'),
});
type Generated = Omit<(typeof row) extends fc.Arbitrary<infer T> ? T : never, never>;
const columns = Object.keys(roundtrip.columns).filter(name => name !== 'id') as (keyof Generated)[];

let container: StartedTestContainer;
let writer: ReturnType<typeof createClient>;
const readers: { mode: string; client: ReturnType<typeof createClientFromBackend>; close: () => Promise<void> }[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  writer = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) {
    const backend = createClickHouseBackend(options, mode);
    readers.push({ mode, client: createClientFromBackend(backend), close: () => backend.close() });
  }
  const driver = createDriver(options);
  try { await driver.command({ query: ddl }); } finally { await driver.close(); }
}, 120000);
afterAll(async () => { for (const reader of readers) await reader.close(); await writer?.close(); await container?.stop(); });

// ClickHouse prints a Float32 as the shortest decimal that identifies it (0.1, not
// 0.10000000149011612); the decoder keeps that friendly number. It denotes the same stored
// float32, which is what "read equals written" means for this type: fround recovers it exactly.
// MergeTree also stores -0 as +0 (Memory keeps the sign; see the canary), so the sign of a
// zero float is not part of the stored value on this engine.
const unsignedZero = (x: number) => (x === 0 ? 0 : x);
const sameStoredValue = <T extends { f32: number; f64: number }>(r: T): T => ({ ...r, f32: unsignedZero(Math.fround(r.f32)), f64: unsignedZero(r.f64) });

/** Names the columns that differ, so a failure says which type broke (toEqual's diff truncates wide rows). */
function differences(actual: readonly Record<string, unknown>[], expected: Record<string, unknown>): string {
  if (actual.length !== 1) return `${actual.length} rows`;
  const row = actual[0]!;
  const same = (a: unknown, b: unknown) => a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : Object.is(a, b);
  const show = (v: unknown) => Object.is(v, -0) ? '-0' : v instanceof Date ? v.toISOString() : `${String(v)} (${typeof v})`;
  return Object.keys(expected).filter(k => !same(row[k], expected[k])).map(k => `${k}: wrote ${show(expected[k])}, read ${show(row[k])}`).join('; ');
}

let nextId = 0;
it('reads back every inserted row, and finds it by an equality filter on each column', async () => {
  const property = fc.asyncProperty(row, async generated => {
    const id = ++nextId;
    const inserted = { id, ...generated };
    const expected = { ...inserted, f32: unsignedZero(inserted.f32), f64: unsignedZero(inserted.f64) };
    await writer.execute(from(roundtrip).insertMany([inserted]));
    const byId = from(roundtrip).where(r => r.id.eq(id));
    for (const { mode, client } of readers) {
      const read = (await client.run(byId)).map(sameStoredValue);
      expect(read, `${mode}: read back by id: ${differences(read, expected)}`).toEqual([expected]);
      for (const name of columns) {
        const value = inserted[name];
        // NULL never equals anything in SQL; a null value is found with isNull().
        const query = byId.where(r => {
          const column = (r as unknown as Record<string, { eq(v: unknown): never; isNull(): never }>)[name]!;
          return value === null ? column.isNull() : column.eq(value);
        });
        const found = (await client.run(query)).map(sameStoredValue);
        expect(found, `${mode}: where ${name} = ${String(value)}: ${differences(found, expected)}`).toEqual([expected]);
      }
    }
  });
  // Fixed for reproducible CI; set TYPEDHOUSE_ROUNDTRIP_SEED (and _RUNS) to explore further.
  const seed = Number(process.env.TYPEDHOUSE_ROUNDTRIP_SEED ?? 20261103);
  const result = await fc.check(property, { seed, numRuns: Number(process.env.TYPEDHOUSE_ROUNDTRIP_RUNS ?? 100) });
  if (result.failed) throw new Error(`roundtrip failed (seed ${result.seed}, path ${result.counterexamplePath}): ${fc.defaultReportMessage(result)}\nCause: ${String(result.errorInstance)}`);
}, 300000);

it('canary: ClickHouse 24.8 still parses extreme floats inexactly', async () => {
  // If this fails, the server now parses float text exactly: widen exactlyParsed() to the full
  // range in the round-trip property above, and delete this canary.
  const bits = (x: number) => { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x); return view.getBigUint64(0); };
  const driver = createDriver({ url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' });
  try {
    const result = await driver.query({ query: "SELECT toString(reinterpretAsUInt64(toFloat64('4.598794547937795e-113'))) AS ulp, toFloat64('5e-324') AS subnormal", format: 'JSONEachRow' });
    try {
      const [row] = await result.json<{ ulp: string; subnormal: number }>();
      expect(BigInt(row!.ulp)).toBe(bits(4.598794547937795e-113) - 1n);
      expect(row!.subnormal).toBe(0);
    } finally { result.close(); }
    // MergeTree normalizes -0 to +0 on write; Memory keeps it.
    for (const [engine, bits] of [['MergeTree ORDER BY tuple()', '0'], ['Memory', '9223372036854775808']] as const) {
      const name = engine === 'Memory' ? 'canary_zero_memory' : 'canary_zero_mergetree';
      await driver.command({ query: `CREATE TABLE ${name} (x Float64) ENGINE = ${engine}` });
      await driver.insert({ table: name, values: [{ x: '-0' }], format: 'JSONEachRow' });
      const stored = await driver.query({ query: `SELECT toString(reinterpretAsUInt64(x)) AS bits FROM ${name}`, format: 'JSONEachRow' });
      try { expect((await stored.json<{ bits: string }>())[0]!.bits, engine).toBe(bits); } finally { stored.close(); }
    }
  } finally { await driver.close(); }
});
