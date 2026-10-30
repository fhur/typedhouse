import { beforeAll, afterAll, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, table, from, crossJoin, join, unionAll, scalar, count, val } from '@typedhouse/core';
import { createClient, QueryError } from '../src/index.js';
let container: StartedTestContainer;
let client: ReturnType<typeof createClient>;
let url: string;
let version: string;
async function sql(query: string) {
  const response = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: query });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text;
}
async function collect<R>(rows: AsyncIterable<R>): Promise<R[]> { const result: R[] = []; for await (const row of rows) result.push(row); return result; }
const source = from(table('stream_rows', { id: col.UInt64, ['a.b']: col.Nullable(col.String), at: col.DateTime64(3), ids: col.Array(col.String), pair: col.Tuple({ name: col.Nullable(col.String) }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  version = (await sql('SELECT version()')).trim();
  client = createClient({ url, username: 'fixture', password: 'fixture' });
  await sql('CREATE TABLE stream_rows (id UInt64, `a.b` Nullable(String), at DateTime64(3), ids Array(String), pair Tuple(name Nullable(String))) ENGINE=Memory');
  await sql("INSERT INTO stream_rows VALUES (1,NULL,'2026-10-27 12:00:00.123',['x','y'],(NULL)),(2,'yes','2026-10-27 12:00:00.123',[],('ok'))");
}, 120000);
afterAll(async () => { await client?.close(); await container?.stop(); });
it('streams decoded components against independent SQL and run, including hostile paths and parameters', async () => {
  const expanded = source.arrayJoin(r => r.ids, 'partId').orderBy(r => r.partId);
  const direct = (await sql("SELECT *, partId FROM stream_rows ARRAY JOIN ids AS partId ORDER BY partId SETTINGS date_time_output_format='iso', output_format_json_quote_64bit_integers=1 FORMAT JSONEachRow")).trim().split('\n').map(line => {
    const r = JSON.parse(line) as { id: string; at: string };
    return { ...r, id: BigInt(r.id), at: new Date(r.at) };
  });
  expect(await collect(client.stream(expanded))).toEqual(direct);
  expect(await collect(client.stream(expanded))).toEqual(await client.run(expanded));
  const hostile = "x'\\\n{p9:Array(String)} --";
  const q = source.limit(1).map(() => ({ ['__proto__']: val([hostile], col.Array(col.String)) })).arrayJoin(r => r.__proto__, 'a.b');
  const literal = `unhex('${Buffer.from(hostile).toString('hex')}')`;
  const expected = JSON.parse((await sql(`SELECT [${literal}] AS \`__proto__\`, ${literal} AS \`a.b\` FORMAT JSONEachRow`)).trim()) as unknown;
  expect(await collect(client.stream(q))).toEqual([expected]);
  expect(await collect(client.stream(q))).toEqual(await client.run(q));
});
it('streams nested inner/cross joins and UNION/IN/scalar/CTE composition independently', async () => {
  const small = source.map(r => ({ id: r.id })).orderBy(r => r.id);
  const inner = join({ a: small, b: small }).on(r => r.a.id.eq(r.b.id));
  const nested = crossJoin({ inner, c: small.limit(1) }).orderBy(r => r.inner.a.id);
  const direct = (await sql('SELECT a.id AS a,b.id AS b,c.id AS c FROM stream_rows a INNER ALL JOIN stream_rows b ON a.id=b.id CROSS JOIN (SELECT id FROM stream_rows ORDER BY id LIMIT 1) c ORDER BY a.id FORMAT JSONEachRow')).trim().split('\n').map(line => {
    const r = JSON.parse(line) as { a: string; b: string; c: string };
    return { inner: { a: { id: BigInt(r.a) }, b: { id: BigInt(r.b) } }, c: { id: BigInt(r.c) } };
  });
  expect(await collect(client.stream(nested))).toEqual(direct);
  expect(await collect(client.stream(nested))).toEqual(await client.run(nested));
  const union = unionAll(small, small).cte();
  const q = union.where(r => r.id.in(small)).map(r => ({ id: r.id, total: scalar(union.aggregate(() => count())) })).orderBy(r => r.id);
  const expected = (await sql('WITH u AS (SELECT id FROM stream_rows UNION ALL SELECT id FROM stream_rows) SELECT id,(SELECT count() FROM u) AS total FROM u WHERE id IN (SELECT id FROM stream_rows) ORDER BY id FORMAT JSONEachRow')).trim().split('\n').map(line => {
    const r = JSON.parse(line) as { id: string; total: string }; return { id: BigInt(r.id), total: BigInt(r.total) };
  });
  expect(await collect(client.stream(q))).toEqual(expected);
  expect(await collect(client.stream(q))).toEqual(await client.run(q));
  expect(await collect(client.stream(source.limit(0)))).toEqual([]);
});
it('supports early break, reuse, independent concurrent cursors and server errors', async () => {
  for await (const row of client.stream(source)) { expect(row.id).toBe(1n); break; }
  const q = source.orderBy(r => r.id);
  const expected = await client.run(q);
  expect(await Promise.all([collect(client.stream(q)), collect(client.stream(q))])).toEqual([expected, expected]);
  const missing = from(table('missing_stream_table', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  await expect(collect(client.stream(missing))).rejects.toBeInstanceOf(QueryError);
  expect(await collect(client.stream(q))).toEqual(expected);
});
it('keeps mixed scalar/Array parameters safe across union fences and overrides incompatible driver output defaults', async () => {
  const configured = createClient({ url, username: 'fixture', password: 'fixture', max_open_connections: 1, clickhouse_settings: {
    date_time_output_format: 'simple', output_format_json_quote_64bit_integers: 0, output_format_json_quote_denormals: 0,
  } });
  const hostile = "\\\\'\n\t{p0:String}); DROP TABLE stream_rows; --";
  const shared = val(hostile, col.String);
  const projection = source.map(r => ({
    id: r.id, text: shared, equal: val(hostile, col.String), list: val([hostile, '', 'NULL'], col.Array(col.String)),
    at: r.at, nonfinite: r.id.divide(0n), pair: r.pair,
  }));
  const q = unionAll(projection.limit(1), projection).cte().orderBy(r => r.id);
  try {
    const literal = `unhex('${Buffer.from(hostile).toString('hex')}')`;
    const direct = (await sql(`WITH u AS (SELECT * FROM stream_rows ORDER BY id LIMIT 1) SELECT id,${literal} AS text,${literal} AS equal,[${literal},'', 'NULL'] AS list,at,id/0 AS nonfinite,pair FROM (SELECT * FROM u UNION ALL SELECT * FROM stream_rows) ORDER BY id SETTINGS date_time_output_format='iso',output_format_json_quote_64bit_integers=1,output_format_json_quote_denormals=1 FORMAT JSONEachRow`)).trim().split('\n').map(line => {
      const r = JSON.parse(line) as { id: string; at: string; nonfinite: string };
      expect(r.nonfinite).toBe('inf');
      return { ...r, id: BigInt(r.id), at: new Date(r.at), nonfinite: Infinity };
    });
    const rows = await collect(configured.stream(q));
    expect(rows).toEqual(direct);
    expect(rows).toEqual(await configured.run(q));
    rows[0]!.list.push('consumer mutation');
    rows[0]!.at.setUTCFullYear(2000);
    expect(rows[1]!.list).toEqual([hostile, '', 'NULL']);
    expect(rows[1]!.at.getUTCFullYear()).toBe(2026);
    for await (const _row of configured.stream(q)) break;
    expect(await collect(configured.stream(source.orderBy(r => r.id)))).toEqual(await client.run(source.orderBy(r => r.id)));
    expect((await sql('SELECT count() FROM stream_rows')).trim()).toBe('2');
  } finally { await configured.close(); }
});
it('measures an isolated real ten-million-row consumer below 200 MB heap', async () => {
  await sql('CREATE TABLE stream_budget (id UInt32) ENGINE=MergeTree ORDER BY id');
  try {
    await sql('INSERT INTO stream_budget SELECT toUInt32(number) FROM numbers(10000000)');
    const { stdout } = await promisify(execFile)(process.execPath, ['scripts/verify-stream-memory.mjs'], { env: { ...process.env, CLICKHOUSE_URL: url, CLICKHOUSE_VERSION: version }, timeout: 120000 });
    console.log('Streaming budget:', stdout.trim());
    const result = JSON.parse(stdout.trim()) as { count: number; peakHeapUsed: number; checksum: number };
    expect(result.count).toBe(10_000_000);
    expect(result.checksum).toBe(49_999_995_000_000);
    expect(result.peakHeapUsed).toBeLessThan(200_000_000);
  } finally { await sql('DROP TABLE stream_budget'); }
}, 120000);
