// S11 through the real check and a real run, against ClickHouse 24.8: chart columns, edit-and-resend and stop.
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient as createDriver } from '@clickhouse/client';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { connect, type Connection } from '../server/clickhouse.js';
import { createLlm, openStorage, type Llm } from '../server/llm.js';
import { createRouter } from '../server/server.js';
import { toChartData } from '../web/chart-data.js';

const fixtures = new URL('../../compiler/test/fixtures/', import.meta.url);
let container: StartedTestContainer, conn: Connection, llm: Llm, dir: string;
let faux: ReturnType<typeof fauxProvider>;
let api: ReturnType<ReturnType<typeof createRouter>['createCaller']>;

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
  await setup.close();
  conn = connect({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
  await conn.refresh();
  dir = mkdtempSync(join(tmpdir(), 'studio-s11-integration-'));
  faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: faux.getModel().id }, schema: conn.schemaSource, check: conn.checkAsync, storage: await openStorage(dir), abortGraceMs: 500 });
  api = createRouter(conn, llm).createCaller({});
}, 180_000);

afterAll(async () => {
  await llm?.close();
  await conn?.close();
  await container?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const q1 = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts }))';
const q2 = `${q1}.limit(2)`;
const query = (source: string) => fauxAssistantMessage([fauxToolCall('check_query', { source })], { stopReason: 'toolUse' });
const chart = (args: Record<string, unknown>) => fauxAssistantMessage([fauxToolCall('check_chart', args as never)], { stopReason: 'toolUse' });
const bar = { mark: 'bar', encoding: { x: { field: 'id', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } };

describe('chart, edit and stop against ClickHouse 24.8', () => {
  it('the check reports the same column names as a run and the chart data', async () => {
    const checked = await conn.checkAsync(q1);
    const run = await conn.runQuery({ source: q1, autoLimit: true });
    if (!checked.ok || !run.ok) throw new Error('expected both to pass');
    expect(checked.columns).toEqual(run.columns.map(c => ({ name: c.name, type: c.type })));
    expect(Object.keys(toChartData(run.rows, run.columns)[0]!)).toEqual(checked.columns!.map(c => c.name));
  });

  it('a chart turn uses the real columns; an unknown field is fed back; the query runs unchanged', async () => {
    faux.setResponses([query(q1), chart({ spec: { mark: 'bar', encoding: { x: { field: 'nation' } } } }), chart({ spec: bar, summary: 'Parts by id.' })]);
    const { chatId } = await api.chat.send({ chatId: null, text: 'parts', source: '' });
    const sent = await api.chat.send({ chatId, text: 'bar chart', source: q1 });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', n: 2, source: q1, attempts: 2, changes: [], chart: { mark: 'bar', data: { name: 'table' } } } });
    expect(await api.query.run({ source: q1, autoLimit: true })).toMatchObject({ ok: true });
  });

  it('a chart with a query change is checked in both parts, by the real type check', async () => {
    faux.setResponses([chart({ spec: bar, source: 'export default from(no_such_table)' }), chart({ spec: bar, source: q2 })]);
    const sent = await api.chat.send({ chatId: null, text: 'top two', source: q1 });
    expect(sent).toMatchObject({ ok: true, turn: { source: q2, attempts: 2, chart: { mark: 'bar' } } });
    if (sent.ok) expect(await api.query.run({ source: sent.turn.kind === 'version' ? sent.turn.source : '', autoLimit: true })).toMatchObject({ ok: true, rowCount: 2 });
  });

  it('edit-and-resend drops the later turn, and a stop leaves the chat usable', async () => {
    let seen = '';
    const capture = (message: unknown) => (ctx: unknown) => { seen = JSON.stringify(ctx); return message; };
    faux.setResponses([query(q1), query(q2), capture(query(q1))] as never);
    const { chatId } = await api.chat.send({ chatId: null, text: 'PROMPT_ONE', source: '' });
    await api.chat.send({ chatId, text: 'PROMPT_DROPPED', source: q1 });
    const turns = (await api.chat.get({ id: chatId! }))!.turns;
    const resent = await api.chat.send({ chatId, text: 'PROMPT_NEW', source: q1, replaceFrom: turns[2]!.id });
    expect(resent).toMatchObject({ ok: true, turn: { kind: 'text' } });
    expect(seen).toContain('PROMPT_NEW');
    expect(seen).not.toContain('PROMPT_DROPPED');

    faux.setResponses([((_c: unknown, options?: { signal?: AbortSignal }) => new Promise(resolve => {
      options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'aborted' })));
    })) as never, query(q2) as never]);
    const sending = api.chat.send({ chatId, text: 'PROMPT_STOPPED', source: q1 });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
    expect(await sending).toMatchObject({ stopped: true });
    expect(await api.chat.send({ chatId, text: 'PROMPT_NEXT', source: q1 })).toMatchObject({ ok: true, turn: { kind: 'version', n: 2, source: q2 } });
  });
});
