// Tester (S1): adversarial checks for query.run against ClickHouse 24.8 — auto-limit exactness at the
// boundaries, row order under the wrapping LIMIT, superjson round-trip of every decodable fixture type,
// and readonly=2 enforcement beyond INSERT/CREATE/DROP.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient as createDriver } from '@clickhouse/client';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { connect, type Connection } from '../server/clickhouse.js';
import { startServer, type AppRouter } from '../server/server.js';

const fixtures = new URL('../../compiler/test/fixtures/', import.meta.url);
let container: StartedTestContainer, conn: Connection, server: Awaited<ReturnType<typeof startServer>>;
let api: ReturnType<typeof createTRPCClient<AppRouter>>;
let total: number;

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  const admin = createDriver({ url, username: 'fixture', password: 'test-secret' });
  await admin.command({ query: 'CREATE DATABASE fixture' });
  await admin.close();
  const setup = createDriver({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
  for (const file of ['schema.sql', 'seed.sql']) {
    const text = await readFile(new URL(file, fixtures), 'utf8');
    for (const statement of text.split(';').filter(s => s.trim())) await setup.command({ query: statement });
  }
  await setup.command({ query: `INSERT INTO coverage (id, \`__proto__\`, \`odd-name\`, precise, \`nested.label\`, \`nested.amount\`, amount, status, tags, pair, at) VALUES
    (1, 'p', 'o', '1969-12-31 23:59:59.123456789', ['x','y'], [18446744073709551615, 0], -12345.6789, 'b', {'k': 18446744073709551615}, ('t', 255), '2024-02-29 12:34:56')` });
  total = Number((await (await setup.query({ query: 'SELECT count() AS n FROM entity_ots_component', format: 'JSONEachRow' })).json<{ n: string }>())[0]!.n);
  await setup.close();
  conn = connect({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
  await conn.refresh();
  server = await startServer({ conn, port: 0, ui: 'none', packageRoot: '.' });
  api = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${server.url}/trpc`, transformer: superjson })] });
}, 180_000);

afterAll(async () => {
  await server?.close();
  await conn?.close();
  await container?.stop();
});

async function ok(source: string, autoLimit = true) {
  const result = await api.query.run.mutate({ source, autoLimit });
  if (!result.ok) throw new Error(`${result.error.stage}: ${result.error.message}`);
  return result;
}
const base = 'from(entity_ots_component).orderBy(c => c.tenantId).thenBy(c => c.entityId)';

describe('auto-limit exactness at the boundaries', () => {
  it('fixture has more than 101 rows', () => expect(total).toBeGreaterThan(101));

  it.each([
    ['0 rows', `export default ${base}.where(c => c.entityId.eq('nope'))`, 0, false],
    ['99 rows (user limit)', `export default ${base}.limit(99)`, 99, false],
    ['100 rows (user limit)', `export default ${base}.limit(100)`, 100, false],
    ['101 rows (user limit)', `export default ${base}.limit(101)`, 100, true],
    ['user limit < 100', `export default ${base}.limit(7)`, 7, false],
    ['user limit > 100', `export default ${base}.limit(150)`, 100, true],
    ['limit with offset, < 100 left', `export default ${base}.limit(1000, ${0}).limit(50, 10)`, 50, false],
    ['offset leaving exactly 100', `export default ${base}.limit(100, 5)`, 100, false],
    ['union of two 60-row branches', `export default unionAll(${base}.limit(60), ${base}.limit(60))`, 100, true],
    ['union of two 50-row branches', `export default unionAll(${base}.limit(50), ${base}.limit(50))`, 100, false],
    ['aggregate', `export default from(entity_ots_component).groupBy(c => ({ t: c.tenantId })).aggregate(() => ({ n: count() }))`, 2, false],
    ['self join', `const a = from(entity_ots_component), b = from(entity_ots_component).where(c => c.tenantId.eq('acme'));\nexport default join({ a, b }).on(r => r.a.entityId.eq(r.b.entityId).and(r.a.tenantId.eq(r.b.tenantId))).map(r => ({ id: r.a.entityId }))`, 100, true],
  ])('%s', async (_name, source, rowCount, limited) => {
    const result = await ok(source);
    expect({ rowCount: result.rowCount, rows: result.rows.length, limited: result.limited }).toEqual({ rowCount, rows: rowCount, limited });
    expect(result.sql).toMatch(/LIMIT 100\s*$/);
  });

  it('auto-limited rows are the first 100 of the unlimited ordered rows', async () => {
    for (const source of [`export default ${base}.map(c => ({ id: c.entityId, t: c.tenantId }))`, `export default ${base}.limit(150, 3).map(c => ({ id: c.entityId, t: c.tenantId }))`]) {
      const limited = await ok(source, true);
      const all = await ok(source, false);
      expect(limited.rows).toEqual(all.rows.slice(0, 100));
    }
  });

  it('off: returns everything, limited false, no LIMIT in SQL', async () => {
    const all = await ok(`export default ${base}`, false);
    expect(all).toMatchObject({ rowCount: total, limited: false });
    expect(all.rows).toHaveLength(total);
  });
});

describe('superjson round-trip', () => {
  it('a row with a `__proto__` column reaches the client', async () => {
    const r = await ok("export default from(coverage).map(c => ({ id: c.id, proto: c['__proto__'] }))");
    expect(r.rows).toEqual([{ id: 1, proto: 'p' }]);
    // Full table: the decoded row has an own `__proto__` key.
    await expect(api.query.run.mutate({ source: 'export default from(coverage)', autoLimit: true })).resolves.toMatchObject({ ok: true, rowCount: 1 });
  });

  it('coverage row survives tRPC exactly as decoded in-process', async () => {
    const source = "export default from(coverage).map(c => ({ id: c.id, odd: c['odd-name'], precise: c.precise, label: c['nested.label'], amounts: c['nested.amount'], amount: c.amount, status: c.status, tags: c.tags, pair: c.pair, at: c.at }))";
    const direct = await conn.runQuery({ source, autoLimit: true });
    const viaHttp = await ok(source);
    if (!direct.ok) throw new Error(direct.error.message);
    expect(viaHttp.rows).toEqual(direct.rows);
    expect(viaHttp.rows).toHaveLength(1);
    const row = viaHttp.rows[0] as Record<string, unknown>;
    expect(row['id']).toBe(1);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(row['at']).toBeInstanceOf(Date);
    expect((row['at'] as Date).toISOString()).toBe('2024-02-29T12:34:56.000Z');
    expect(viaHttp.columns.map(c => c.name)).toContain('amounts');
    // Recursively: every bigint/Date in the in-process result is still a bigint/Date after HTTP.
    const kinds = (v: unknown): unknown => typeof v === 'bigint' ? 'bigint' : v instanceof Date ? 'date' : v instanceof Map ? ['map', [...v].map(kinds)] : Array.isArray(v) ? v.map(kinds) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, kinds(x)])) : typeof v;
    expect(kinds(viaHttp.rows)).toEqual(kinds(direct.rows));
    expect(JSON.stringify(kinds(row))).toContain('bigint');
  });

  it('UInt64 max and nullable/array columns survive', async () => {
    const r = await ok(`export default from(coverage).map(c => ({ big: c.tags, arr: c['nested.amount'] }))`);
    const row = r.rows[0] as { big: unknown; arr: unknown[] };
    expect(r.rowType).toContain('bigint');
    expect(row.arr).toEqual([18446744073709551615n, 0n]);
    const n = await ok(`export default ${base}.limit(5).map(c => ({ cat: c.category, parts: c.countOfParts }))`);
    for (const x of n.rows as { cat: unknown; parts: unknown }[]) {
      expect(x.cat === null || typeof x.cat === 'string').toBe(true);
      expect(typeof x.parts).toBe('bigint');
    }
  });
});

describe('readonly=2 enforcement', () => {
  it.each([
    'ALTER TABLE fixture.coverage_mv_target ADD COLUMN x UInt8',
    'ALTER TABLE fixture.entity_ots_component DELETE WHERE 1',
    'TRUNCATE TABLE fixture.coverage_mv_target',
    'OPTIMIZE TABLE fixture.coverage FINAL',
    'SYSTEM DROP DNS CACHE',
    'CREATE DATABASE evil',
    'RENAME TABLE fixture.coverage_mv_target TO fixture.x',
    'GRANT ALL ON *.* TO fixture',
  ])('refuses %s', async query => {
    await expect(conn.driver.command({ query })).rejects.toThrow(/readonly|Not enough privileges|ACCESS_DENIED|Cannot execute/i);
  });

  it('cannot lift readonly per query', async () => {
    await expect(conn.driver.query({ query: 'SELECT 1 SETTINGS readonly = 0' })).rejects.toThrow(/readonly/i);
    await expect(conn.driver.command({ query: 'SET readonly = 0' })).rejects.toThrow(/readonly/i);
  });

  it('string values are parameters, never inlined (hostile value is matched literally)', async () => {
    const hostile = "x'); INSERT INTO fixture.coverage_mv_target VALUES (1); --";
    const r = await ok(`export default from(entity_ots_component).where(c => c.entityId.eq(${JSON.stringify(hostile)}))`);
    expect(r.rowCount).toBe(0);
    expect(r.sql).not.toContain('INSERT');
    expect(Object.values(r.params)).toContain(hostile);
  });

  it('raw sql snippet cannot lift readonly or write', async () => {
    const before = await (await conn.driver.query({ query: 'SELECT count() AS n FROM fixture.coverage_mv_target', format: 'JSONEachRow' })).json<{ n: string }>();
    const r = await api.query.run.mutate({ source: "export default from(coverage).map(c => ({ v: sql`(SELECT 1) SETTINGS readonly = 0`.as(col.UInt8) }))", autoLimit: true });
    expect(r.ok).toBe(false);
    const counts = await (await conn.driver.query({ query: 'SELECT count() AS n FROM fixture.coverage_mv_target', format: 'JSONEachRow' })).json<{ n: string }>();
    expect(counts[0]!.n).toBe(before[0]!.n);
  });
});
