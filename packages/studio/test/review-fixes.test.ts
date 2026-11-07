// Regressions for the review of the agent exploration tools (bfaf90a).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, Harness, MemoryStorage, type Conversation } from '@earendil-works/pi-durable';
import { boundedValue, createAgentCapabilities, RESULT_LIMITS } from '../server/agent-results.js';
import { chatExtension, createChats } from '../server/chat.js';
import { createLlm, type ExplorationCapabilities, type Llm } from '../server/llm.js';
import { currentRunSignal } from '../server/tools.js';
import type { Connection } from '../server/clickhouse.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const call = (name: string, args: object) => fauxToolCall(name, args as never);
const round = (...calls: ReturnType<typeof call>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' });
const say = (text: string) => fauxAssistantMessage([fauxText(text)]);
const check = (source: string) => source === 'bad' ? { ok: false as const, stage: 'compile' as const, message: 'Unknown table' } : { ok: true as const, sql: 'SELECT 1', rowType: '{}', columns: [{ name: 'x', type: 'UInt8' }] };
const spec = { mark: 'bar', encoding: { x: { field: 'x' } } };

let llm: Llm | undefined;
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { await llm?.close(); llm = undefined; for (const close of closers.splice(0)) await close(); });

async function setup() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  const exploration = Object.fromEntries(['query_run', 'query_results_get', 'tables_list', 'table_describe', 'columns_describe', 'docs_search', 'docs_read'].map(name => [name, vi.fn(async () => ({ rows: [] }))])) as unknown as ExplorationCapabilities;
  llm = await createLlm({ models, model: { provider: m.provider, modelId: m.id }, schema: () => '', check, exploration, abortGraceMs: 400 });
  return { faux, exploration, chat: llm.chat };
}

/** A real harness, whose conversation's full reads can be made to hang or fail once, from the moment it is asked. */
async function setupReads() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  const held = deferred<void>();
  const entered = deferred<void>();
  const extension = chatExtension({ guide: '', schema: () => '', check, exploration: { docs_read: async () => { entered.resolve(); await held.promise; return 'late'; } } as unknown as ExplorationCapabilities });
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  closers.push(() => Promise.race([harness.close(context).catch(() => undefined), new Promise(resolve => setTimeout(resolve, 200))]));
  closers.push(async () => held.resolve());
  const reads = { next: undefined as 'hang' | 'fail' | undefined };
  const open = harness.conversation.bind(harness);
  const patched = new WeakSet<Conversation>();
  vi.spyOn(harness, 'conversation').mockImplementation(async (id, ctx) => {
    const conversation = await open(id, ctx);
    if (conversation && !patched.has(conversation)) {
      patched.add(conversation);
      const entries = conversation.entries.bind(conversation);
      conversation.entries = ((filter, limit, cursor, c) => {
        if (reads.next && filter?.minEntryId === undefined) {
          const mode = reads.next;
          reads.next = undefined;
          return mode === 'hang' ? new Promise(() => undefined) : Promise.reject(new Error('read failed'));
        }
        return entries(filter, limit, cursor, c);
      }) as Conversation['entries'];
    }
    return conversation;
  });
  let busy = false;
  const chat = createChats(harness, { extension, model: () => ({ provider: m.provider, modelId: m.id }), maxTurns: 6, timeoutMs: 60_000, abortGraceMs: 200, check, exclusive: async (_busy, fail, work) => {
    if (busy) return _busy;
    busy = true;
    try { return await work(); } catch (error) { return fail(String(error)); } finally { busy = false; }
  } });
  return { faux, chat, reads, entered, release: () => held.resolve() };
}

describe('#2 exploration tools follow the run', () => {
  it('gives a capability the run signal, and a stop settles a tool that ignores it without forking', async () => {
    const { faux, chat, exploration } = await setup();
    let signal: AbortSignal | undefined;
    const entered = deferred<void>();
    const held = deferred<{ rows: [] }>();
    vi.mocked(exploration.query_run).mockImplementation(async () => { signal = currentRunSignal(); entered.resolve(); return held.promise; });
    faux.setResponses([round(call('query_run', { source: 'slow' }))]);
    const created = await chat.create();
    const sending = chat.send({ chatId: created.id, source: '', text: 'run' });
    await entered.promise;
    expect(signal?.aborted).toBe(false);
    const before = (await chat.get(created.id))!.conversationId;
    await chat.stop(created.id);
    expect(await sending).toMatchObject({ stopped: true });
    expect(signal?.aborted).toBe(true);
    expect((await chat.get(created.id))!.conversationId).toBe(before);
    held.resolve({ rows: [] });
    faux.setResponses([say('Still fine.')]);
    expect(await chat.send({ chatId: created.id, source: '', text: 'next' })).toMatchObject({ ok: true, turn: { kind: 'text', text: 'Still fine.' } });
  });

  it('has no run signal outside a tool call', () => { expect(currentRunSignal()).toBeUndefined(); });

  it('still reports an ordinary capability failure to the model', async () => {
    const { faux, chat, exploration } = await setup();
    vi.mocked(exploration.query_run).mockRejectedValue(new Error('NO_SUCH_THING'));
    let seen = '';
    faux.setResponses([round(call('query_run', { source: 'x' })), ((ctx: unknown) => { seen = JSON.stringify(ctx); return say('Noted.'); }) as never]);
    await chat.send({ chatId: null, source: '', text: 'run' });
    expect(seen).toContain('NO_SUCH_THING');
  });

  const describeFixture = () => {
    const columns = Array.from({ length: 8 }, (_, n) => ({ name: `c${n}`, type: 'UInt8' }));
    const query = vi.fn(async (_params: { abort_signal: AbortSignal }) => ({ json: async () => [{}], close: () => undefined }));
    const connection = { database: 'd', tables: () => [{ name: 't', binding: 't', engine: 'Memory', columns }], runAgentQuery: vi.fn(), driver: { query } as unknown as Connection['driver'] };
    return { columns, query, connection };
  };

  it('columns_describe passes the signal to each query and stops between columns', async () => {
    const { columns, query, connection } = describeFixture();
    const controller = new AbortController();
    query.mockImplementationOnce(async params => {
      controller.abort();
      expect(params.abort_signal.aborted).toBe(true);
      return { json: async () => [{}], close: () => undefined };
    });
    await expect(createAgentCapabilities(connection).columnsDescribe('t', columns.map(c => c.name), controller.signal)).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('query_run hands the signal to the connection', async () => {
    const runAgentQuery = vi.fn(async () => ({ rows: [], sql: 'SELECT 1', columns: [], truncated: false, elapsedMs: 0 }));
    const { signal } = new AbortController();
    await createAgentCapabilities({ ...describeFixture().connection, runAgentQuery }).queryRun('q', 'owner', signal);
    expect(runAgentQuery).toHaveBeenCalledWith('q', signal);
  });
});

describe('#3 activity reads on the stop and stuck paths', () => {
  it.each(['hang', 'fail'] as const)('a stop whose read %s still records the note and frees the guard', async mode => {
    const { faux, chat, reads, entered } = await setupReads();
    faux.setResponses([round(call('docs_read', { id: 'x' }))]);
    const created = await chat.create();
    const sending = chat.send({ chatId: created.id, source: '', text: 'read' });
    await entered.promise;
    reads.next = mode;
    await chat.stop(created.id);
    expect(await sending).toMatchObject({ stopped: true });
    const after = (await chat.get(created.id))!;
    expect(after.generating).toBe(false);
    expect(after.turns.map(t => t.kind)).toEqual(['user', 'note']);
    faux.setResponses([say('Back.')]);
    expect(await chat.send({ chatId: created.id, source: '', text: 'again' })).toMatchObject({ ok: true });
  });

  it.each(['hang', 'fail'] as const)('a stuck run whose read %s still forks, with the note', async mode => {
    const { faux, chat, reads } = await setupReads();
    const asked = deferred<void>();
    faux.setResponses([(() => { asked.resolve(); return new Promise(() => undefined); }) as never]);
    const created = await chat.create();
    const before = (await chat.get(created.id))!.conversationId;
    const sending = chat.send({ chatId: created.id, source: '', text: 'never answers' });
    await asked.promise;
    reads.next = mode;
    await chat.stop(created.id);
    expect(await sending).toMatchObject({ stopped: true });
    const after = (await chat.get(created.id))!;
    expect(after.conversationId).not.toBe(before);
    expect(after.generating).toBe(false);
    expect(after.turns.map(t => t.kind)).toEqual(['user', 'note']);
  });
});

describe('#4 an apply must be alone in its round', () => {
  it.each([
    ['query_apply', { source: 'good', summary: 'Done' }],
    ['chart_apply', { source: 'good', spec, summary: 'Done' }],
  ])('%s beside an exploration call is refused, and the retry is the version', async (name, args) => {
    const { faux, chat, exploration } = await setup();
    let told = '';
    faux.setResponses([
      round(call(name, args), call('query_run', { source: 'good' })),
      ((ctx: unknown) => { told = JSON.stringify(ctx); return round(call(name, args)); }) as never,
      say('Must not run'),
    ]);
    const sent = await chat.send({ chatId: null, source: '', text: 'make it' });
    expect(told).toContain('cannot share a message');
    expect(exploration.query_run).toHaveBeenCalled();
    // The refusal was not an attempt, and nothing after a passing apply runs.
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', source: 'good', attempts: 1 } });
    expect(faux.state.callCount).toBe(2);
  });

  it('a passing apply is never undone by a later failing one', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([
      round(call('query_apply', { source: 'good' }), call('tables_list', {})),
      round(call('query_apply', { source: 'good' })),
      round(call('query_apply', { source: 'bad' })),
    ]);
    expect(await chat.send({ chatId: null, source: '', text: 'make it' })).toMatchObject({ ok: true, turn: { kind: 'version', source: 'good' } });
  });

  it('two passing applies in one round still end the run, the last deciding', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'one' }), call('query_apply', { source: 'two' })), say('Must not run')]);
    expect(await chat.send({ chatId: null, source: '', text: 'make it' })).toMatchObject({ ok: true, turn: { kind: 'version', source: 'two', attempts: 2 } });
    expect(faux.state.callCount).toBe(1);
  });

  it('applies beside a validate call or an unknown tool are refused too', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([
      round(call('query_apply', { source: 'good' }), call('query_validate', { source: 'good' })),
      round(call('query_apply', { source: 'good' }), call('nope', {})),
      round(call('query_apply', { source: 'good' })),
    ]);
    expect(await chat.send({ chatId: null, source: '', text: 'make it' })).toMatchObject({ ok: true, turn: { kind: 'version', source: 'good', attempts: 1 } });
  });

  it('text after a refused apply is a reply, not a failed attempt', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'good' }), call('tables_list', {})), say('Here is what I found instead.')]);
    expect(await chat.send({ chatId: null, source: '', text: 'look' })).toMatchObject({ ok: true, turn: { kind: 'text', text: 'Here is what I found instead.', attempts: 0 } });
  });

  it('a failing apply alone is still an attempt the model can fix', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'bad' })), round(call('query_apply', { source: 'good' }))]);
    expect(await chat.send({ chatId: null, source: '', text: 'make it' })).toMatchObject({ ok: true, turn: { kind: 'version', attempts: 2 } });
  });
});

describe('#9 cuts keep characters whole', () => {
  it('a long cell cut on a surrogate pair stays well formed', () => {
    const { value, truncated } = boundedValue(`a${'💡'.repeat(400)}`);
    expect(truncated).toBe(true);
    expect(value as string).not.toMatch(LONE_SURROGATE);
  });

  it('schema views and SQL cut whole characters', async () => {
    const long = `a${'💡'.repeat(5000)}`;
    const connection = {
      database: 'd', driver: {} as Connection['driver'],
      tables: () => [{ name: 't', binding: long, engine: long, columns: [{ name: 'c', type: long }] }],
      runAgentQuery: async () => ({ rows: [], sql: long, columns: [], truncated: false, elapsedMs: 0 }),
      schemaMetadata: () => ({ functions: [], tables: [{ name: 't', columns: [{ name: 'c', comment: long, defaultKind: long, position: 1 }] }] }) as never,
    };
    const api = createAgentCapabilities(connection);
    expect(JSON.parse(JSON.stringify(api.tablesList())).tables[0].binding).not.toMatch(LONE_SURROGATE);
    const described = api.tableDescribe('t');
    for (const text of [described.binding, described.engine, described.columns[0]!.type, described.columns[0]!.comment, described.columns[0]!.defaultKind]) expect(text).not.toMatch(LONE_SURROGATE);
    expect((await api.queryRun('q', 'owner')).sql).not.toMatch(LONE_SURROGATE);
    const offline = createAgentCapabilities({ ...connection, schemaError: () => long });
    expect(() => offline.tablesList()).toThrow();
    try { offline.tablesList(); } catch (error) { expect((error as Error).message).not.toMatch(LONE_SURROGATE); }
  });
});

describe('#10 column metadata is not row truncation', () => {
  const run = (columnCount: number, rowCount: number) => {
    const names = Array.from({ length: columnCount }, (_, n) => `c${n}`);
    const rows = Array.from({ length: rowCount }, () => Object.fromEntries(names.map(name => [name, 1])));
    const columns = names.map(name => ({ name, path: [name], type: 'UInt8' }));
    return createAgentCapabilities({ database: 'd', driver: {} as Connection['driver'], tables: () => [], runAgentQuery: async () => ({ rows, sql: 'SELECT 1', columns: columns as never, truncated: false, elapsedMs: 0 }) }).queryRun('q', 'owner');
  };

  it('25 columns and 3 rows are complete', async () => {
    const result = await run(25, 3);
    expect(result.columns).toHaveLength(25);
    expect(Object.keys(result.rows[0] as object)).toHaveLength(25);
    expect(result).toMatchObject({ truncated: false, columnsTruncated: false });
  });

  it('rows and metadata keep the same columns past the limit', async () => {
    const result = await run(RESULT_LIMITS.columns + 8, 3);
    expect(result.columns).toHaveLength(RESULT_LIMITS.columns);
    expect(Object.keys(result.rows[0] as object)).toEqual((result.columns as { name: string }[]).map(c => c.name));
    expect(result).toMatchObject({ truncated: true, columnsTruncated: true });
  });

  it('a cut column list on no rows does not mark the rows cut', async () => {
    expect(await run(RESULT_LIMITS.columns + 1, 0)).toMatchObject({ truncated: false, columnsTruncated: true });
  });

  it('a column whose name a row would drop is dropped from the metadata too', async () => {
    const long = 'x'.repeat(129);
    const rows = [{ [long]: 1, short: 2 }];
    const columns = [{ name: long, path: [long], type: 'UInt8' }, { name: 'short', path: ['short'], type: 'UInt8' }];
    const result = await createAgentCapabilities({ database: 'd', driver: {} as Connection['driver'], tables: () => [], runAgentQuery: async () => ({ rows, sql: 'S', columns: columns as never, truncated: false, elapsedMs: 0 }) }).queryRun('q', 'owner');
    expect(result.columns).toEqual([columns[1]]);
    expect(result.rows[0]).toEqual({ short: 2 });
    expect(result.columnsTruncated).toBe(true);
  });
});
