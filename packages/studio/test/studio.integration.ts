import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient as createDriver } from '@clickhouse/client';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { connect, type Connection } from '../server/clickhouse.js';
import { startServer, type AppRouter } from '../server/server.js';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { toChartData } from '../web/chart-data.js';
import { createLlm } from '../server/llm.js';

const fixtures = new URL('../../compiler/test/fixtures/', import.meta.url);
let container: StartedTestContainer, conn: Connection, server: Awaited<ReturnType<typeof startServer>>;
let api: ReturnType<typeof createTRPCClient<AppRouter>>;
let url: string, total: number;

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  const admin = createDriver({ url, username: 'fixture', password: 'test-secret' });
  await admin.command({ query: 'CREATE DATABASE fixture' });
  await admin.close();
  const setup = createDriver({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
  for (const file of ['schema.sql', 'seed.sql']) {
    const text = await readFile(new URL(file, fixtures), 'utf8');
    for (const statement of text.split(';').filter(s => s.trim())) await setup.command({ query: statement });
  }
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

describe('studio server against ClickHouse 24.8', () => {
  it('binds 127.0.0.1 only', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('meta.get lists the fixture tables with columns', async () => {
    const meta = await api.meta.get.query();
    expect(meta.schemaError).toBeNull();
    expect(meta.connection).toMatch(/· fixture$/);
    const names = meta.tables.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['entity_ots_component', 'entity_off_the_shelf_part', 'coverage', 'coverage_view']));
    const component = meta.tables.find(t => t.name === 'entity_ots_component')!;
    expect(component.columns).toHaveLength(8);
    expect(component.columns.find(c => c.name === 'countOfParts')).toEqual({ name: 'countOfParts', type: 'UInt64' });
  });

  it('query.run auto-limits to 100 rows and reports limited exactly; bigint and Date survive superjson', async () => {
    const source = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts, updatedAt: c.updatedAt }))';
    const limited = await api.query.run.mutate({ source, autoLimit: true });
    if (!limited.ok) throw new Error(JSON.stringify(limited.error));
    expect(limited).toMatchObject({ rowCount: 100, limited: true, rowType: '{ id: string; parts: bigint; updatedAt: Date }' });
    expect(limited.rows).toHaveLength(100);
    expect(limited.sql).toMatch(/LIMIT 100\s*$/);
    expect(limited.columns.map(c => c.type)).toEqual(['String', 'UInt64', 'DateTime64(3)']);
    expect(limited.elapsedMs).toBeGreaterThanOrEqual(0);
    const first = limited.rows[0] as { id: string; parts: unknown; updatedAt: unknown };
    expect(typeof first.parts).toBe('bigint');
    expect(first.updatedAt).toBeInstanceOf(Date);

    const all = await api.query.run.mutate({ source, autoLimit: false });
    if (!all.ok) throw new Error(JSON.stringify(all.error));
    expect(all.limited).toBe(false);
    expect(all.rowCount).toBe(total);
    expect(all.sql).not.toMatch(/LIMIT/);
  });

  it('limited is false when the result fits exactly', async () => {
    const exact = await api.query.run.mutate({ source: 'const query = from(entity_ots_component).orderBy(c => c.entityId).limit(100)', autoLimit: true });
    expect(exact).toMatchObject({ ok: true, rowCount: 100, limited: false });
    const small = await api.query.run.mutate({ source: 'export default from(entity_ots_component).where(c => c.entityId.eq("cmp_1").and(c.tenantId.eq("acme")))', autoLimit: true });
    expect(small).toMatchObject({ ok: true, rowCount: 1, limited: false });
  });

  it('returns typed errors by stage and stays up after a runaway loop', async () => {
    expect(await api.query.run.mutate({ source: "import fs from 'node:fs'", autoLimit: true })).toMatchObject({ ok: false, error: { stage: 'parse' } });
    expect(await api.query.run.mutate({ source: 'while (true) {}', autoLimit: true })).toMatchObject({ ok: false, error: { stage: 'evaluate', message: expect.stringMatching(/timed out/) } });
    expect(await api.query.run.mutate({ source: 'export default from(entity_ots_component).where(c => c.countOfParts.eq(-1))', autoLimit: true })).toMatchObject({ ok: false, error: { stage: 'compile' } });
    // Defined in the editor, missing on the server: fails at ClickHouse with the server's message.
    expect(await api.query.run.mutate({ source: "const ghost = table('ghost', { id: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });\nexport default from(ghost)", autoLimit: true }))
      .toMatchObject({ ok: false, error: { stage: 'clickhouse', message: expect.stringMatching(/ghost/) } });
    expect(await api.query.run.mutate({ source: 'export default from(coverage)', autoLimit: true })).toMatchObject({ ok: true });
  });

  it('refuses writes and DDL through the readonly=2 connection', async () => {
    await expect(conn.driver.command({ query: 'CREATE TABLE fixture.evil (id UInt8) ENGINE = Memory' })).rejects.toThrow(/readonly/i);
    await expect(conn.driver.command({ query: "INSERT INTO fixture.coverage_mv_target VALUES (1)" })).rejects.toThrow(/readonly/i);
    await expect(conn.driver.command({ query: 'DROP TABLE fixture.coverage_mv_target' })).rejects.toThrow(/readonly/i);
  });

  it('schema.refresh re-introspects', async () => {
    const meta = await api.schema.refresh.mutate();
    expect(meta.tables.length).toBeGreaterThan(5);
  });
});

describe('text to query (faux model) against the fixture schema', () => {
  it('ai.generateQuery returns checked source that query.run executes', async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const llm = await createLlm({ models, model: { provider: model.provider, modelId: model.id }, schema: conn.schemaSource, check: conn.check });
    const ai = await startServer({ conn, llm, port: 0, ui: 'none', packageRoot: '.' });
    try {
      const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${ai.url}/trpc`, transformer: superjson })] });
      expect((await client.meta.get.query()).model).toEqual({ available: true, provider: model.provider, modelId: model.id });
      const wrong = 'export default from(entity_ots_component).groupBy(c => ({ state: c.state })).aggregate(g => ({ parts: sum(g.countOfPart) }))';
      const right = 'export default from(entity_ots_component).groupBy(c => ({ state: c.state })).aggregate(g => ({ components: count(), parts: sum(g.countOfParts) })).orderBy(r => r.state)';
      const call = (source: string) => fauxAssistantMessage([fauxToolCall('check_query', { source })], { stopReason: 'toolUse' });
      let systemPrompt = '';
      faux.setResponses([(ctx: { systemPrompt?: string }) => { systemPrompt = JSON.stringify(ctx); return call(wrong); }, call(right)] as never);
      const generated = await client.ai.generateQuery.mutate({ prompt: 'parts per state' });
      expect(generated).toMatchObject({ ok: true, source: right, attempts: 2, rowType: '{ state: string; components: bigint; parts: bigint }' });
      // The model saw the introspected fixture tables.
      expect(systemPrompt).toContain('entity_ots_component');
      const ran = await client.query.run.mutate({ source: right, autoLimit: true });
      if (!ran.ok) throw new Error(JSON.stringify(ran.error));
      expect(ran.rows).toEqual([
        { state: 'active', components: expect.any(BigInt), parts: expect.any(BigInt) },
        { state: 'inactive', components: expect.any(BigInt), parts: expect.any(BigInt) },
      ]);
    } finally {
      await ai.close();
      await llm.close();
    }
  });
});

describe('prompt to chart (faux model) over a fixture result', () => {
  it('ai.generateChart returns a spec whose fields are the result columns', async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const llm = await createLlm({ models, model: { provider: model.provider, modelId: model.id }, schema: conn.schemaSource, check: conn.check });
    const ai = await startServer({ conn, llm, port: 0, ui: 'none', packageRoot: '.' });
    try {
      const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${ai.url}/trpc`, transformer: superjson })] });
      const ran = await client.query.run.mutate({ source: 'export default from(entity_ots_component).groupBy(c => ({ state: c.state })).aggregate(g => ({ parts: sum(g.countOfParts) }))', autoLimit: true });
      if (!ran.ok) throw new Error(JSON.stringify(ran.error));
      const columns = ran.columns.map(c => ({ name: c.name, type: c.type }));
      const sample = toChartData(ran.rows, ran.columns);
      const call = (spec: unknown) => fauxAssistantMessage([fauxToolCall('check_chart', { spec } as never)], { stopReason: 'toolUse' });
      faux.setResponses([
        call({ mark: 'bar', encoding: { x: { field: 'status', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } }),
        call({ mark: 'bar', encoding: { x: { field: 'state', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } }),
      ]);
      const chart = await client.ai.generateChart.mutate({ prompt: 'parts per state', columns, sample });
      expect(chart).toMatchObject({ ok: true, attempts: 2, spec: { data: { name: 'table' } } });
      if (!chart.ok) return;
      const encoding = chart.spec['encoding'] as Record<string, { field: string }>;
      expect(Object.values(encoding).map(e => e.field).sort()).toEqual(columns.map(c => c.name).sort());
      expect(sample.every(row => typeof row['parts'] === 'number')).toBe(true);
    } finally {
      await ai.close();
      await llm.close();
    }
  });
});

describe('saved queries and model switch over tRPC', () => {
  it('saves, lists, refuses a duplicate, overwrites, deletes; models.select is reflected by meta.get', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dataDir = await mkdtemp(join(tmpdir(), 'studio-int-'));
    const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: 'faux-a' }, schema: conn.schemaSource, check: conn.check });
    const s = await startServer({ conn, llm, dataDir, port: 0, ui: 'none', packageRoot: '.' });
    try {
      const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${s.url}/trpc`, transformer: superjson })] });
      const source = 'export default from(entity_ots_component).groupBy(c => ({ state: c.state })).aggregate(() => ({ n: count() }))';
      expect(await client.saved.save.mutate({ name: 'Components by state', prompt: 'components by state', source, chart: { mark: 'bar' } })).toEqual({ ok: true });
      expect(await client.saved.save.mutate({ name: 'Components by state', prompt: 'p', source: 'x' })).toEqual({ ok: false, exists: true });
      expect(await client.saved.save.mutate({ name: 'Other', prompt: '', source })).toEqual({ ok: true });
      const listed = await client.saved.list.query();
      expect(listed).toMatchObject({ ok: true, queries: [{ name: 'Other' }, { name: 'Components by state', chart: { mark: 'bar' } }] });
      // A loaded saved query runs as saved.
      const saved = listed.ok ? listed.queries.find(q => q.name === 'Components by state')! : undefined;
      expect(await client.query.run.mutate({ source: saved!.source, autoLimit: true })).toMatchObject({ ok: true, rowCount: 2 });
      expect(await client.saved.delete.mutate({ name: 'Other' })).toEqual({ ok: true });
      expect((await client.saved.list.query())).toMatchObject({ ok: true, queries: [{ name: 'Components by state' }] });

      expect((await client.models.list.query()).models.map(m => m.modelId)).toEqual(['faux-a', 'faux-b']);
      expect(await client.models.select.mutate({ provider: faux.provider.id, modelId: 'faux-b' })).toEqual({ ok: true });
      expect((await client.meta.get.query()).model).toEqual({ available: true, provider: faux.provider.id, modelId: 'faux-b' });
      // The table list carries the editor binding used by palette/sidebar inserts.
      expect((await client.meta.get.query()).tables.find(t => t.name === 'coverage_view')).toMatchObject({ binding: 'coverage_view' });
    } finally {
      await s.close();
      await llm.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('F13: tables named like core functions', () => {
  it('get non-colliding bindings; from(from_table) and count() both work, and db.from keeps the name', async () => {
    const writer = createDriver({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
    await writer.command({ query: 'CREATE TABLE `from` (id UInt32) ENGINE = Memory' });
    await writer.command({ query: 'CREATE TABLE `count` (n UInt32) ENGINE = Memory' });
    await writer.command({ query: 'INSERT INTO `from` VALUES (1), (2), (3)' });
    await writer.close();
    const s = await startServer({ conn, port: 0, ui: 'none', packageRoot: '.' });
    try {
      const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${s.url}/trpc`, transformer: superjson })] });
      const meta = await client.schema.refresh.mutate();
      expect(meta.tables.filter(t => t.name === 'from' || t.name === 'count').map(t => [t.name, t.binding])).toEqual([['count', 'count_table'], ['from', 'from_table']]);
      expect(conn.schemaSource()).toContain('const from_table = table("from"');
      expect(await client.query.run.mutate({ source: 'export default from(from_table).aggregate(() => ({ n: count() }))', autoLimit: true })).toMatchObject({ ok: true, rows: [{ n: 3n }] });
      expect(await client.query.run.mutate({ source: 'export default from(db.from).map(r => ({ id: r.id }))', autoLimit: false })).toMatchObject({ ok: true, rowCount: 3 });
      expect(await client.query.run.mutate({ source: 'export default from(count_table)', autoLimit: true })).toMatchObject({ ok: true, rowCount: 0 });
    } finally {
      await s.close();
    }
  });
});
