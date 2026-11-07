// Independent tester's attacks, on real ClickHouse 24.8.
import { getEventListeners } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { connect, type Connection } from '../server/clickhouse.js';
import { createAgentCapabilities } from '../server/agent-results.js';
import { createLlm, type Llm } from '../server/llm.js';
import { currentRunSignal } from '../server/tools.js';

// JSON.stringify escapes a lone surrogate (and only those), so a regex on its output alone would never see one.
const hasLone = (value: unknown) => { const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text) || /\\ud[89a-f][0-9a-f]{2}/i.test(text); };
let container: StartedTestContainer | undefined;
let connection: Connection | undefined;
let config: { url: string; username: string; password: string; database: string };
const ALIASES = ['min', 'max', 'nulls', 'sampledRows', 'approximateDistinct', 'commonValues'];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  config = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'test-secret', database: 'default' };
  const admin = createClient(config);
  try {
    for (const [name, type] of [['Int64', 'Int64'], ['Str', 'String'], ['NStr', 'Nullable(String)'], ['Date', 'Date'], ['Arr', 'Array(UInt8)'], ['Dec', 'Nullable(Decimal(10, 2))']] as const) {
      const columns = ALIASES.map(a => `\`${a}\` ${type}`).join(', ');
      await admin.command({ query: `CREATE TABLE named_${name} (id UInt8, ${columns}) ENGINE=Memory` });
      const value = name === 'Int64' ? 'number' : name === 'Str' || name === 'NStr' ? 'toString(number)' : name === 'Date' ? "toDate('2024-01-01') + number" : name === 'Arr' ? '[1]' : 'toDecimal64(number, 2)';
      await admin.command({ query: `INSERT INTO named_${name} SELECT number, ${ALIASES.map(() => value).join(', ')} FROM numbers(5)` });
    }
    await admin.command({ query: `CREATE TABLE kinds (
      s String, ns Nullable(String), lc LowCardinality(String), lcn LowCardinality(Nullable(String)), e Enum8('a' = 1, 'b' = 2), b Bool, u UUID, f FixedString(4),
      d Date, d32 Date32, dt DateTime, dt64 DateTime64(3), dec Decimal(10, 2), nf Nullable(Float64), arr Array(String), m Map(String, UInt8), t Tuple(UInt8, String), ip IPv4,
      \`we ird\` UInt8, \`back\`\`tick\` UInt8, \`dot.ted\` UInt8, \`qu'ote\` UInt8, \`ñandú\` UInt8, \`🦄\` String, \`min__stat\` UInt8, \`min \` UInt8, \`MIN\` UInt8, emoji String
    ) ENGINE=Memory` });
    await admin.command({ query: `INSERT INTO kinds SELECT toString(number), if(number = 0, NULL, 'x'), 'l', NULL, 'a', true, generateUUIDv4(), 'abcd', today(), today(), now(), now64(3), 1.5, nan, ['a'], map('k', 1), (1, 'z'), toIPv4('1.1.1.1'),
      1, 2, 3, 4, 5, '🦄', 6, 7, 8, repeat('🦄', 100) FROM numbers(3)` });
    await admin.command({ query: 'CREATE TABLE empty (min Nullable(Int32), v String) ENGINE=Memory' });
    await admin.command({ query: 'CREATE TABLE allnull (max Nullable(Int32)) ENGINE=Memory' });
    await admin.command({ query: 'INSERT INTO allnull SELECT NULL FROM numbers(2)' });
    await admin.command({ query: 'CREATE VIEW slow AS SELECT number AS id, sleepEachRow(1) AS waited FROM numbers(8) SETTINGS max_block_size = 1' });
    await admin.command({ query: 'CREATE TABLE quick (id UInt8) ENGINE=Memory' });
    await admin.command({ query: 'INSERT INTO quick SELECT number FROM numbers(3)' });
    const wide = (n: number) => Array.from({ length: n }, (_, i) => `c${i} UInt8`).join(', ');
    for (const n of [19, 20, 21, 32, 33, 40]) {
      await admin.command({ query: `CREATE TABLE wide${n} (${wide(n)}) ENGINE=Memory` });
      await admin.command({ query: `INSERT INTO wide${n} SELECT ${Array.from({ length: n }, () => 'number').join(', ')} FROM numbers(45)` });
    }
    await admin.command({ query: "CREATE TABLE emoji_cells (a String) ENGINE=Memory" });
    await admin.command({ query: "INSERT INTO emoji_cells SELECT concat(repeat('x', number % 2), repeat('🦄', 400)) FROM numbers(2)" });
  } finally { await admin.close(); }
  connection = connect(config);
  await connection.refresh();
}, 180_000);
afterAll(async () => { await connection?.close(); await container?.stop(); });

const caps = () => createAgentCapabilities(connection!);

describe('#1 real SQL', () => {
  it.each(['Int64', 'Str', 'NStr', 'Date', 'Dec', 'Arr'])('all aliases as %s columns, mixed in one call', async kind => {
    const result = await caps().columnsDescribe(`named_${kind}`, ['id', ...ALIASES]);
    expect(result.columns.map(c => c.column)).toEqual(['id', ...ALIASES]);
    for (const column of result.columns) {
      const values = column.statistics as Record<string, unknown>;
      expect(values['sampledRows']).toBe('5');
      expect(values['nulls']).toBe('0');
      expect(Object.keys(values).filter(k => k.endsWith('__stat'))).toEqual([]);
    }
    if (kind === 'Int64') for (const c of result.columns.slice(1)) expect(c.statistics).toMatchObject({ min: '0', max: '4', approximateDistinct: '5' });
    if (kind === 'Date') for (const c of result.columns.slice(1)) expect(c.statistics).toMatchObject({ min: '2024-01-01', max: '2024-01-05' });
  });
  it('types beyond the numeric ones, and odd quoted names', async () => {
    const all = connection!.tables().find(t => t.name === 'kinds')!.columns.map(c => c.name);
    expect(all.length).toBeGreaterThan(8);
    const out: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < all.length; i += 8) {
      const result = await caps().columnsDescribe('kinds', all.slice(i, i + 8));
      for (const c of result.columns) out[c.column] = c.statistics as Record<string, unknown>;
    }
    for (const name of all) { expect(out[name]?.['sampledRows'], name).toBe('3'); expect(Object.keys(out[name]!).filter(k => k.endsWith('__stat')), name).toEqual([]); }
    expect(out['ns']).toMatchObject({ nulls: '1', approximateDistinct: '1', commonValues: ['x'] });
    expect(out['lcn']).toMatchObject({ nulls: '3' });
    expect(out['min__stat']).toMatchObject({ min: '6', max: '6' });
    expect(out['MIN']).toMatchObject({ min: '8', max: '8' });
    expect(out['back`tick']).toMatchObject({ min: '2' });
    expect(out['🦄']).toMatchObject({ commonValues: ['🦄'] });
  });
  it('empty and all-NULL columns named after an alias', async () => {
    expect((await caps().columnsDescribe('empty', ['min', 'v'])).columns[0]!.statistics).toMatchObject({ sampledRows: '0', nulls: '0' });
    expect((await caps().columnsDescribe('allnull', ['max'])).columns[0]!.statistics).toMatchObject({ sampledRows: '2', nulls: '2' });
  });
  it('OBSERVATION: commonValues cut in bytes leaves U+FFFD in a 128-byte prefix, never a lone surrogate', async () => {
    const stats = (await caps().columnsDescribe('kinds', ['emoji'])).columns[0]!.statistics as { commonValues: string[] };
    expect(hasLone(stats)).toBe(false);
    expect(stats.commonValues[0]!.startsWith('🦄')).toBe(true);
  });
});

describe('#9 and #10 real results', () => {
  it('emoji cells at both parities', async () => {
    const result = await caps().queryRun('export default from(emoji_cells)', 'emoji');
    expect(hasLone(result)).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.columnsTruncated).toBe(false);
  });
  it('a long error message from the source holds no lone surrogate, at both parities', async () => {
    for (const prefix of ['', 'x']) {
      const source = `throw new Error(${JSON.stringify(prefix)} + '🦄'.repeat(3000));\nexport default from(quick)`;
      const message = await caps().queryRun(source, 'owner').then(() => '', (error: Error) => error.message);
      expect(message.length).toBeGreaterThan(1000);
      // No .toMatch here: a failure would print 4000 emoji.
      expect(hasLone(message), `query_run error, prefix ${JSON.stringify(prefix)}`).toBe(false);
    }
  });
  it('a long error through the check query_apply and query_validate use holds no lone surrogate', async () => {
    for (const prefix of ['', 'x']) {
      const check = await connection!.checkAsync(`throw new Error(${JSON.stringify(prefix)} + '🦄'.repeat(3000));\nexport default from(quick)`);
      expect(check.ok).toBe(false);
      expect(hasLone(check), `query_apply error, prefix ${JSON.stringify(prefix)}`).toBe(false);
    }
  });
  it('a type error quoting a long emoji literal holds no lone surrogate', async () => {
    for (const prefix of ['', 'x', 'xx', 'xxx']) {
      const source = `const v: number = ${JSON.stringify(prefix + '🦄'.repeat(3000))};\nexport default from(quick)`;
      const message = await caps().queryRun(source, 'owner').then(() => '', (error: Error) => error.message);
      expect(message.length).toBeGreaterThan(0);
      expect(hasLone(message), `query_run, prefix ${JSON.stringify(prefix)}`).toBe(false);
      expect(hasLone(await connection!.checkAsync(source)), `check, prefix ${JSON.stringify(prefix)}`).toBe(false);
    }
  });
  it.each([[19, false], [20, false], [21, false], [32, false], [33, true], [40, true]])('%i real columns, 45 rows', async (n, cutColumns) => {
    const api = caps();
    const first = await api.queryRun(`export default from(wide${n}).limit(45)`, 'owner');
    expect(first.columns).toHaveLength(Math.min(n, 32));
    expect(first).toMatchObject({ truncated: cutColumns, columnsTruncated: cutColumns, retainedRows: 45 });
    expect(Object.keys(first.rows[0] as object).sort()).toEqual((first.columns as { name: string }[]).map(c => c.name).sort());
    let rows = first.rows.length;
    let cursor = first.nextCursor;
    while (cursor) {
      const page = api.queryResultsGet(first.resultId, cursor, 'owner');
      expect(page.truncated).toBe(cutColumns);
      rows += page.rows.length;
      cursor = page.nextCursor;
    }
    expect(rows).toBe(45);
  });
});

describe('sqlTruncated on real SQL', () => {
  it('a long query: complete rows, and only the SQL text cut', async () => {
    const name = (i: number) => `${'n'.repeat(110)}${i}`;
    const fields = Array.from({ length: 30 }, (_, i) => `${name(i)}: r.id.eq(0)${Array.from({ length: 12 }, (_, k) => `.or(r.id.eq(${k + 1}))`).join('')}`).join(', ');
    const result = await caps().queryRun(`export default from(quick).map(r => ({ ${fields} }))`, 'owner');
    expect(result.retainedRows).toBe(3);
    expect(result).toMatchObject({ truncated: false, columnsTruncated: false, sqlTruncated: true });
    expect(result.sql).toHaveLength(8000);
  }, 60_000);
  it('a short query is not', async () => {
    expect(await caps().queryRun('export default from(quick)', 'owner')).toMatchObject({ truncated: false, columnsTruncated: false, sqlTruncated: false });
  });
});

describe('#2 real stops through the chat', () => {
  let llm: Llm | undefined;
  const setup = async (abortGraceMs = 1_000) => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const m = faux.getModel();
    const api = createAgentCapabilities(connection!);
    // As main.ts wires them.
    llm = await createLlm({ models, model: { provider: m.provider, modelId: m.id }, schema: () => '', check: connection!.checkAsync, abortGraceMs, exploration: {
      query_run: (args, owner) => api.queryRun(args.source, String(owner), currentRunSignal()),
      query_results_get: (args, owner) => api.queryResultsGet(args.resultId, args.cursor, String(owner)),
      tables_list: args => api.tablesList(args.search, args.cursor),
      table_describe: args => api.tableDescribe(args.table, args.cursor),
      columns_describe: args => api.columnsDescribe(args.table, args.columns, currentRunSignal()),
      docs_search: () => ({}), docs_read: () => ({}),
    } });
    return { faux, chat: llm.chat };
  };
  const processes = async () => {
    const r = await connection!.driver.query({ query: "SELECT count() AS n FROM system.processes WHERE query LIKE '%slow%' AND query NOT LIKE '%system.processes%'", format: 'JSONEachRow' });
    return (await r.json<{ n: string }>())[0]!.n;
  };
  it.each([
    ['query_run', { source: 'export default from(slow)' }, 400],
    ['query_run, rows arriving', { source: 'export default from(slow)' }, 2_300],
    ['columns_describe', { table: 'slow', columns: ['id', 'waited'] }, 400],
  ])('%s: stop settles without a fork, the server query ends, and the next query works', async (name, args, wait) => {
    const { faux, chat } = await setup();
    const tool = name.split(',')[0]!;
    let seen = '';
    faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args as never)], { stopReason: 'toolUse' })]);
    const created = await chat.create();
    const before = (await chat.get(created.id))!.conversationId;
    const sending = chat.send({ chatId: created.id, source: '', text: 'x' });
    await new Promise(resolve => setTimeout(resolve, wait));
    const t = performance.now();
    await chat.stop(created.id);
    const result = await sending;
    expect(result).toMatchObject({ stopped: true });
    expect(performance.now() - t).toBeLessThan(1_000);
    const after = (await chat.get(created.id))!;
    expect(after.conversationId).toBe(before);
    expect(after.activity.filter(a => a.kind === 'toolCall').map(a => a.status)).toEqual(['interrupted']);
    await expect.poll(processes, { timeout: 12_000 }).toBe('0');
    faux.setResponses([fauxAssistantMessage([fauxToolCall('query_run', { source: 'export default from(quick)' } as never)], { stopReason: 'toolUse' }), ((ctx: unknown) => { seen = JSON.stringify(ctx); return fauxAssistantMessage([fauxText('ok')]); }) as never]);
    expect(await chat.send({ chatId: created.id, source: '', text: 'again' })).toMatchObject({ ok: true });
    expect(seen).toContain('retainedRows');
    await llm?.close();
  }, 60_000);
  it('a pile of aborts leaves no sockets behind: queries still run afterwards', async () => {
    const api = caps();
    for (let i = 0; i < 25; i++) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), i % 2 ? 30 : 1_100);
      await api.queryRun('export default from(slow)', 'owner', controller.signal).catch(() => undefined);
    }
    const started = performance.now();
    expect((await api.queryRun('export default from(quick)', 'owner')).retainedRows).toBe(3);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 120_000);
  it('a long-lived signal keeps no listeners after many runs, and firing it later hurts nothing', async () => {
    const controller = new AbortController();
    const warnings: string[] = [];
    const onWarning = (w: Error) => { warnings.push(w.name); };
    process.on('warning', onWarning);
    const api = caps();
    for (let i = 0; i < 30; i++) await api.queryRun('export default from(quick)', 'owner', controller.signal);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 100));
    process.off('warning', onWarning);
    expect(warnings).toEqual([]);
    expect((await api.queryRun('export default from(quick)', 'owner')).retainedRows).toBe(3);
  }, 60_000);
});
