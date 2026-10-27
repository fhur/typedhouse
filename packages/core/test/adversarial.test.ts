import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, table, parseCHType, print, toTypeScript } from '../src/index.js';

it('preserves prototype-shaped keys without mutating caller metadata', () => {
  const columns = { ['__proto__']: col.String, constructor: col.UInt64, 'x`), evil String': col.Bool };
  const metadata = { engine: 'Memory', sortingKey: ['__proto__'], partitionKey: [] };
  const t = table('hostile', columns, metadata);
  expect(Object.keys(t.columns)).toEqual(Object.keys(columns));
  expect(Object.getPrototypeOf(t.columns)).toBe(Object.prototype);
  expect(t.columns['__proto__']).toEqual(col.String.type);
  metadata.sortingKey.push('constructor');
  expect(t.sortingKey).toEqual(['__proto__']);
  const tuple = col.Tuple(columns);
  expect(parseCHType(print(tuple.type))).toEqual(tuple.type);
  expect(() => Object.assign(t.columns['__proto__']!, { name: 'UInt8' })).toThrow();
});

it('maps non-string-like CH keys to pairs even when their decoded value is a TS string', () => {
  expect(toTypeScript(col.Map(col.Decimal(18, 4), col.UInt8).type)).toBe('Array<[Decimal<18, 4>, number]>');
  expect(toTypeScript(col.Map(col.DateTime64(9), col.UInt8).type)).toBe('Array<[string, number]>');
});

it('handles its exact nesting limit and preserves unsupported nested types as whole input', () => {
  const atLimit = 'Array('.repeat(128) + 'String' + ')'.repeat(128);
  expect(print(parseCHType(atLimit))).toBe(atLimit);
  expect(parseCHType(atLimit).kind).toBe('Array');
  for (const raw of ['Array(' + atLimit + ')', 'Tuple(a String, b FutureType(2))', 'Array(String); DROP TABLE x']) {
    expect(parseCHType(raw)).toEqual({ kind: 'Unknown', raw });
  }
});

describe('adversarial real ClickHouse 24.8 escaping', () => {
  let container: StartedTestContainer | undefined;
  let url: string;
  async function sql(query: string): Promise<string> {
    const response = await fetch(url, { method: 'POST', body: query });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    return text;
  }
  beforeAll(async () => {
    container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
      .withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1' }).withExposedPorts(8123)
      .withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
    url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  });
  afterAll(async () => { await container?.stop(); });
  it.each([String.raw`\x41`, String.raw`\q`, String.raw`\a`, String.raw`\v`, String.raw`\b`, String.raw`\f`, String.raw`\n`, String.raw`\0`, String.raw`\xC3\xA9`, String.raw`\xE2\x82\xAC`, String.raw`\xF0\x9F\x98\x80`, String.raw`é\xC3\xA9`, String.raw`\xEF\xBB\xBF`, String.raw`\xC3\xA9\n\xE2\x82\xAC`])('matches server labels and canonical output for %s', async escape => {
    const type = `Enum8('prefix${escape}suffix' = 1)`;
    const row = JSON.parse(await sql(`SELECT CAST(1 AS ${type}) AS label FORMAT JSONEachRow`)) as { label: string };
    expect.soft(parseCHType(type), `label semantics for ${JSON.stringify(escape)}`).toEqual({ kind: 'Enum', bits: 8, values: [{ name: row.label, value: 1 }] });
    await sql(`DROP TABLE IF EXISTS escape_probe`);
    await sql(`CREATE TABLE escape_probe (value ${type}) ENGINE = Memory`);
    const record = JSON.parse(await sql("SELECT type FROM system.columns WHERE database = currentDatabase() AND table = 'escape_probe' FORMAT JSONEachRow")) as { type: string };
    expect.soft(parseCHType(record.type), `canonical label for ${JSON.stringify(escape)}`).toEqual({ kind: 'Enum', bits: 8, values: [{ name: row.label, value: 1 }] });
    expect.soft(print(parseCHType(record.type)), `canonical bytes for ${JSON.stringify(escape)}`).toBe(record.type);
  });
  it.each([
    [String.raw`line\nbreak`, 'line\nbreak'],
    [String.raw`tab\tkey`, 'tab\tkey'],
    [String.raw`back\bspace`, 'back\bspace'],
    [String.raw`return\rkey`, 'return\rkey'],
    [String.raw`form\ffeed`, 'form\ffeed'],
    [String.raw`null\0key`, 'null\0key'],
    [String.raw`bell\akey`, 'bell\x07key'],
    [String.raw`vertical\vkey`, 'vertical\vkey'],
    [String.raw`tick\`key`, 'tick`key'],
    [String.raw`\xC3\xA9`, 'é'],
    [String.raw`all\n\t\b\r\f\0`, 'all\n\t\b\r\f\0'],
    [String.raw`literal\\n`, String.raw`literal\n`],
    ["single'quote", "single'quote"],
    ['SELECT', 'SELECT'],
    ['String', 'String'],
    ['x), evil UInt8); --', 'x), evil UInt8); --'],
    ['😀é', '😀é'],
  ])('round trips genuine named tuple identifier %s', async (spelling, name) => {
    const type = 'Tuple(`' + spelling + '` String)';
    await sql('DROP TABLE IF EXISTS tuple_probe');
    await sql(`CREATE TABLE tuple_probe (value ${type}) ENGINE = Memory`);
    const record = JSON.parse(await sql("SELECT type FROM system.columns WHERE database = currentDatabase() AND table = 'tuple_probe' FORMAT JSONEachRow")) as { type: string };
    const expected = { kind: 'Tuple', items: [{ name, type: { kind: 'scalar', name: 'String' } }] };
    expect.soft(parseCHType(type)).toEqual(expected);
    expect.soft(parseCHType(record.type)).toEqual(expected);
    expect.soft(print(parseCHType(record.type))).toBe(record.type);
  });
  it('accepts numeric/date map keys that decode to string without making them String keys', async () => {
    await sql('CREATE TABLE map_probe (d Map(Decimal(18, 4), UInt8), t Map(DateTime64(9), UInt8)) ENGINE = Memory');
    const rows = JSON.parse(await sql("SELECT type FROM system.columns WHERE database = currentDatabase() AND table = 'map_probe' ORDER BY position FORMAT JSON")) as { data: Array<{ type: string }> };
    expect(rows.data.map(r => r.type)).toEqual(['Map(Decimal(18, 4), UInt8)', 'Map(DateTime64(9), UInt8)']);
  });
});
