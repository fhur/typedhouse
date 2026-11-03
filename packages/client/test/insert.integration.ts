import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient as createDriver } from '@clickhouse/client';
import { col, from, table, InsertCommand, parseCHType } from '@typedhouse/core';
import { quoteIdentifier } from '@typedhouse/compiler';
import { createClient, InsertValidationError } from '../src/index.js';

const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
let container: StartedTestContainer | undefined;
let driver: ReturnType<typeof createDriver>;
let client: ReturnType<typeof createClient>;
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createDriver(options);
  client = createClient({ ...options, clickhouse_settings: {
    max_insert_block_size: '1024', async_insert: 1, input_format_defaults_for_omitted_fields: 0, input_format_null_as_default: 1,
    input_format_skip_unknown_fields: 1, input_format_allow_errors_num: '100', input_format_allow_errors_ratio: 1,
    input_format_import_nested_json: 1, input_format_json_named_tuples_as_objects: 0,
    input_format_json_defaults_for_missing_elements_in_named_tuple: 1, input_format_json_ignore_unknown_keys_in_named_tuple: 1,
    date_time_input_format: 'basic',
  } });
}, 120000);
afterAll(async () => { await client?.close(); await driver?.close(); await container?.stop(); });
async function rows(query: string): Promise<Record<string, unknown>[]> {
  const result = await driver.query({ query, format: 'JSONEachRow' });
  try { return await result.json(); } finally { result.close(); }
}
it('preserves heterogeneous defaults, explicit null, generated columns and hostile identifiers/settings', async () => {
  const name = 'insert.dot`\\;--';
  const key = 'key.dot`\\;--';
  await driver.command({ query: `CREATE TABLE ${quoteIdentifier(name)} (${quoteIdentifier(key)} UInt32, a UInt32 DEFAULT 17, b UInt32 DEFAULT a + ${quoteIdentifier(key)}, n Nullable(String) DEFAULT 'server', generated UInt32 MATERIALIZED b + 1) ENGINE=Memory` });
  // A computed property widens the descriptor keys; use the nominal runtime boundary here.
  const descriptor = table(name, { [key]: col.UInt32, a: col.UInt32, b: col.UInt32, n: col.Nullable(col.String) }, {
    ...meta, columnMetadata: { a: { defaultKind: 'DEFAULT' }, b: { defaultKind: 'DEFAULT' }, n: { defaultKind: 'DEFAULT' } },
  });
  await client.execute(InsertCommand.create(descriptor, [{ [key]: 1 }, { [key]: 2, a: 30, b: 32, n: null }, { [key]: 3, b: 99, n: 'explicit' }]));
  expect(await rows(`SELECT ${quoteIdentifier(key)} AS id, a, b, n, generated FROM ${quoteIdentifier(name)} ORDER BY id`)).toEqual([
    { id: 1, a: 17, b: 18, n: 'server', generated: 19 },
    { id: 2, a: 30, b: 32, n: null, generated: 33 },
    { id: 3, a: 17, b: 99, n: 'explicit', generated: 100 },
  ]);
  await client.execute(from(descriptor).insertMany([]));
});
it('evaluates dependent defaults from the supplied value in heterogeneous rows', async () => {
  await driver.command({ query: 'CREATE TABLE insert_dependencies (id UInt32, a UInt32 DEFAULT 17, b UInt32 DEFAULT a + id) ENGINE=Memory' });
  const source = from(table('insert_dependencies', { id: col.UInt32, a: col.UInt32, b: col.UInt32 }, {
    ...meta, columnMetadata: { a: { defaultKind: 'DEFAULT' }, b: { defaultKind: 'DEFAULT' } },
  }));
  await client.execute(source.insertMany([{ id: 1 }, { id: 2, a: 30 }, { id: 3, b: 99 }]));
  expect(await rows('SELECT * FROM insert_dependencies ORDER BY id')).toEqual([
    { id: 1, a: 17, b: 18 }, { id: 2, a: 30, b: 32 }, { id: 3, a: 17, b: 99 },
  ]);
});
it.each(['supplied', 'transitive', 'mixed', 'equal_length'] as const)('preserves bulk %s omission masks across parser blocks on MergeTree', async shape => {
  const name = `insert_bulk_${shape}`;
  await driver.command({ query: `CREATE TABLE ${name} (id UInt32, a UInt32 DEFAULT 17, b UInt32 DEFAULT a + id, c UInt32 DEFAULT b + a, n Nullable(UInt32) DEFAULT a + 5) ENGINE=MergeTree ORDER BY id` });
  const source = from(table(name, { id: col.UInt32, a: col.UInt32, b: col.UInt32, c: col.UInt32, n: col.Nullable(col.UInt32) }, {
    engine: 'MergeTree', sortingKey: ['id'], partitionKey: [],
    columnMetadata: { a: { defaultKind: 'DEFAULT' }, b: { defaultKind: 'DEFAULT' }, c: { defaultKind: 'DEFAULT' }, n: { defaultKind: 'DEFAULT' } },
  }));
  // More than eight configured parser blocks; bounded so the mixed-mask
  // one-row workaround remains cheap in CI. c is omitted by every row, while
  // b depends on supplied a (including zero) or its transitively applied default.
  const count = 8193;
  const values = Array.from({ length: count }, (_, id) => {
    if (shape === 'supplied') return id % 2 ? { n: null, a: id % 31, id } : { id, a: id % 31, n: null };
    if (shape === 'equal_length') return id % 2 ? { id, a: id % 31, n: null } : { id, b: 99, n: 0 };
    if (shape === 'mixed') {
      if (id % 3 === 1) return { id, a: id % 31, n: null };
      if (id % 3 === 2) return { id, b: 99, n: 0 };
    }
    return { id };
  });
  await client.execute(source.insertMany(values));
  const a = shape === 'supplied' ? 'id % 31' : shape === 'transitive' ? '17' : `if(id % ${shape === 'mixed' ? '3 = 1' : '2 = 1'}, id % 31, 17)`;
  const suppliedB = shape === 'mixed' ? 'id % 3 = 2' : shape === 'equal_length' ? 'id % 2 = 0' : '0';
  const suppliedNull = shape === 'supplied' ? '1' : shape === 'mixed' ? 'id % 3 = 1' : shape === 'equal_length' ? 'id % 2 = 1' : '0';
  expect(await rows(`SELECT count() AS total, countIf(a != ${a} OR b != if(${suppliedB}, 99, a + id) OR c != b + a OR if(${suppliedNull}, isNotNull(n), ifNull(n != if(${suppliedB}, 0, a + 5), 1))) AS incorrect FROM ${name}`)).toEqual([{ total: String(count), incorrect: '0' }]);
});
it('round trips the supported scalar and recursive container matrix against native expressions', async () => {
  const cases: { type: string; value: unknown; sql: string }[] = [];
  for (const bits of [8, 16, 32, 64, 128, 256]) for (const unsigned of [false, true]) {
    const type = `${unsigned ? 'U' : ''}Int${bits}`;
    const value = unsigned ? (1n << BigInt(bits)) - 1n : -(1n << BigInt(bits - 1));
    cases.push({ type, value: bits <= 32 ? Number(value) : value, sql: `CAST('${value}', '${type}')` });
  }
  cases.push(
    { type: 'Float32', value: 1.5, sql: 'toFloat32(1.5)' }, { type: 'Float64', value: -1.25, sql: '-1.25' },
    { type: 'Bool', value: true, sql: 'true' }, { type: 'String', value: 'quotes\n"\\secret', sql: "unhex('71756f7465730a225c736563726574')" },
    { type: 'UUID', value: 'ffffffff-0000-1234-abcd-0123456789ab', sql: "toUUID('ffffffff-0000-1234-abcd-0123456789ab')" },
    { type: 'Decimal(38, 9)', value: '1234567890123456789.123456789', sql: "toDecimal128('1234567890123456789.123456789', 9)" },
    { type: 'Date', value: new Date('2024-02-29T00:00:00Z'), sql: "toDate('2024-02-29')" },
    { type: 'Date32', value: new Date('1901-01-01T00:00:00Z'), sql: "toDate32('1901-01-01')" },
    { type: "DateTime('Asia/Tokyo')", value: new Date('2024-02-29T12:34:56Z'), sql: 'toDateTime(1709210096)' },
    { type: "Enum8('yes' = 1, 'no' = -1)", value: 'yes', sql: "'yes'" },
    { type: "Enum16('large' = 300)", value: 'large', sql: "'large'" },
    { type: 'Nullable(UInt64)', value: null, sql: 'NULL' },
    { type: 'LowCardinality(Nullable(String))', value: 'nested', sql: "'nested'" },
    { type: 'Array(Array(Nullable(Int64)))', value: [[1n, null], []], sql: '[[toInt64(1), NULL], []]' },
    { type: 'Tuple(UInt64, Array(String))', value: [42n, ['a', 'b']], sql: "tuple(toUInt64(42), ['a', 'b'])" },
    { type: 'Tuple(id UInt64, nested Tuple(v String))', value: { id: 42n, nested: { v: 'x' } }, sql: "tuple(toUInt64(42), tuple('x'))" },
  );
  for (const precision of [0, 1, 2, 3]) {
    const fraction = ['000', '100', '120', '123'][precision]!;
    cases.push({ type: `DateTime64(${precision}, 'America/New_York')`, value: new Date(`2024-02-29T12:34:56.${fraction}Z`), sql: `fromUnixTimestamp64Milli(1709210096${fraction})` });
  }
  const columns = Object.fromEntries(cases.map((c, i) => [`c${i}`, parseCHType(c.type)]));
  await driver.command({ query: `CREATE TABLE insert_matrix (${cases.map((c, i) => `c${i} ${c.type}`).join(', ')}) ENGINE=Memory` });
  const command = InsertCommand.create({ name: 'insert_matrix', columns, ...meta }, [Object.fromEntries(cases.map((c, i) => [`c${i}`, c.value]))]);
  await client.execute(command);
  expect(await rows(`SELECT ${cases.map((c, i) => c.value === null ? `isNull(c${i}) AS c${i}` : `toJSONString(c${i}) = toJSONString(CAST(${c.sql} AS ${c.type})) AS c${i}`).join(', ')} FROM insert_matrix`)).toEqual([Object.fromEntries(cases.map((_, i) => [`c${i}`, 1]))]);
});
it('rejects unaligned timestamps before writing any row', async () => {
  await driver.command({ query: 'CREATE TABLE insert_precision (v DateTime64(2)) ENGINE=Memory' });
  const source = from(table('insert_precision', { v: col.DateTime64(2) }, meta));
  await expect(client.execute(source.insertMany([{ v: new Date('2024-01-01T00:00:00.120Z') }, { v: new Date('2024-01-01T00:00:00.123Z') }]))).rejects.toBeInstanceOf(InsertValidationError);
  expect(await rows('SELECT count() AS n FROM insert_precision')).toEqual([{ n: '0' }]);
});
