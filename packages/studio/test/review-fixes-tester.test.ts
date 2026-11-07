// Independent tester's attacks on the fixes for the review of the agent exploration tools (bfaf90a).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, Harness, MemoryStorage, type Conversation } from '@earendil-works/pi-durable';
import { boundedValue, createAgentCapabilities, RESULT_LIMITS } from '../server/agent-results.js';
import { chatExtension, createChats } from '../server/chat.js';
import { createLlm, type ExplorationCapabilities, type Llm } from '../server/llm.js';
import { currentRunSignal } from '../server/tools.js';
import { charStart, cut } from '../server/text.js';
import type { Connection } from '../server/clickhouse.js';

// JSON.stringify escapes a lone surrogate (and only those), so a regex on its output alone would never see one.
const hasLone = (value: unknown) => { const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text) || /\\ud[89a-f][0-9a-f]{2}/i.test(text); };
const deferred = <T = void>() => { let resolve!: (value: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const call = (name: string, args: object) => fauxToolCall(name, args as never);
const round = (...calls: ReturnType<typeof call>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' });
const say = (text: string) => fauxAssistantMessage([fauxText(text)]);
const check = async (source: string) => source === 'bad' ? { ok: false as const, stage: 'compile' as const, message: 'Unknown table' } : { ok: true as const, sql: 'SELECT 1', rowType: '{}', columns: [{ name: 'x', type: 'UInt8' }] };
const spec = { mark: 'bar', encoding: { x: { field: 'x' } } };
const TOOLS = ['query_run', 'query_results_get', 'tables_list', 'table_describe', 'columns_describe', 'docs_search', 'docs_read'] as const;

let llm: Llm | undefined;
afterEach(async () => { await llm?.close(); llm = undefined; });
async function setup(options: { check?: typeof check; maxTurns?: number; abortGraceMs?: number; timeoutMs?: number } = {}) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  const exploration = Object.fromEntries(TOOLS.map(name => [name, vi.fn(async () => ({ rows: [] }))])) as unknown as ExplorationCapabilities;
  llm = await createLlm({ models, model: { provider: m.provider, modelId: m.id }, schema: () => '', check: options.check ?? check, exploration, abortGraceMs: options.abortGraceMs ?? 400, maxTurns: options.maxTurns ?? 6, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  return { faux, exploration, chat: llm.chat };
}
type Ctx = { messages: { role: string; toolCallId?: string; content: { type: string; id?: string; text?: string }[] | string }[] };
/** Every call has its result, and every result its call: what a provider would reject otherwise. */
const wellFormed = (ctx: Ctx) => {
  const calls = ctx.messages.flatMap(m => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter(c => c.type === 'toolCall').map(c => c.id!) : []));
  const results = ctx.messages.flatMap(m => (m.role === 'toolResult' ? [m.toolCallId!] : []));
  expect([...results].sort()).toEqual([...calls].sort());
};

describe('#4 refused rounds', () => {
  for (const [name, args] of [['query_apply', { source: 'good' }], ['chart_apply', { source: 'good', spec }]] as const) {
    for (const sibling of TOOLS) {
      it(`${name} is refused on either side of ${sibling}, and the retry is the version`, async () => {
        for (const order of ['first', 'last']) {
          const { faux, chat } = await setup();
          const other = call(sibling, sibling === 'query_run' ? { source: 'x' } : sibling === 'docs_search' ? { query: 'x' } : sibling === 'docs_read' ? { id: 'x' } : sibling === 'query_results_get' ? { resultId: 'x' } : sibling === 'tables_list' ? {} : sibling === 'table_describe' ? { table: 't' } : { table: 't', columns: ['c'] });
          faux.setResponses([
            order === 'first' ? round(call(name, args), other) : round(other, call(name, args)),
            round(call(name, args)),
            say('Must not run'),
          ]);
          const sent = await chat.send({ chatId: null, source: '', text: 'make it' });
          expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', attempts: 1 } });
          expect(faux.state.callCount).toBe(2);
          await llm!.close(); llm = undefined;
        }
      });
    }
  }

  it('a slow sibling doesn’t change the outcome: the apply is refused while it runs, and after it finished', async () => {
    const { faux, chat, exploration } = await setup();
    vi.mocked(exploration.query_run).mockImplementation(async () => { await sleep(150); return { rows: [] }; });
    faux.setResponses([round(call('query_run', { source: 'x' }), call('query_apply', { source: 'good' }), call('query_run', { source: 'y' })), round(call('query_apply', { source: 'good' }))]);
    expect(await chat.send({ chatId: null, source: '', text: 'x' })).toMatchObject({ ok: true, turn: { kind: 'version', attempts: 1 } });
  });

  it('a lone apply in the round after an exploration-only round is not refused', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('tables_list', {})), round(call('query_apply', { source: 'good' })), say('Must not run')]);
    expect(await chat.send({ chatId: null, source: '', text: 'x' })).toMatchObject({ ok: true, turn: { kind: 'version', attempts: 1 } });
    expect(faux.state.callCount).toBe(2);
  });

  it('a model that keeps mixing ends at the turn limit, with an error turn that counts no attempts, and the chat goes on', async () => {
    const { faux, chat, exploration } = await setup({ maxTurns: 3 });
    const mixed = () => round(call('query_apply', { source: 'good' }), call('tables_list', {}));
    faux.setResponses([mixed(), mixed(), mixed(), say('Must not run')]);
    const created = await chat.create();
    const sent = await chat.send({ chatId: created.id, source: '', text: 'x' });
    expect(faux.state.callCount).toBe(3);
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', attempts: 0 } });
    expect(exploration.tables_list).toHaveBeenCalledTimes(3);
    // What the user sees says why, and the activity log shows the source.
    const detail = (await chat.get(created.id))!;
    expect((sent as { error: string }).error).toMatch(/turn|limit/i);
    expect(JSON.stringify(detail.activity)).toContain('good');
    let seen: Ctx | undefined;
    faux.setResponses([((ctx: Ctx) => { seen = ctx; return say('Back.'); }) as never]);
    expect(await chat.send({ chatId: created.id, source: '', text: 'again' })).toMatchObject({ ok: true });
    wellFormed(seen!);
  });

  it('good then bad in one round, and the model gives up: an error turn, and the good source is still in the activity log', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'GOOD_SOURCE', summary: 's' }), call('query_apply', { source: 'bad' })), say('I give up.')]);
    const created = await chat.create();
    const sent = await chat.send({ chatId: created.id, source: '', text: 'x' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', source: 'bad', attempts: 2 } });
    const calls = (await chat.get(created.id))!.activity.filter(a => a.kind === 'toolCall' && a.toolName === 'query_apply');
    expect(calls.map(c => (c as { arguments: string }).arguments).join()).toContain('GOOD_SOURCE');
  });

  it('bad then good in one round runs on, and a later failure ends in an error turn; the good source is in the activity log', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'bad' }), call('query_apply', { source: 'GOOD_SOURCE' })), round(call('query_apply', { source: 'bad' })), say('Sorry.')]);
    const created = await chat.create();
    const sent = await chat.send({ chatId: created.id, source: '', text: 'x' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', source: 'bad', attempts: 3 } });
    expect(JSON.stringify((await chat.get(created.id))!.activity)).toContain('GOOD_SOURCE');
  });

  it('the good source of a good-and-bad round over the activity limit: how much survives', async () => {
    const { faux, chat } = await setup();
    const long = `GOOD${'x'.repeat(40_000)}END`;
    faux.setResponses([round(call('query_apply', { source: long }), call('query_apply', { source: 'bad' })), say('I give up.')]);
    const created = await chat.create();
    await chat.send({ chatId: created.id, source: '', text: 'x' });
    const found = (await chat.get(created.id))!.activity.find(a => a.kind === 'toolCall' && a.arguments.includes('GOOD')) as { arguments: string; truncated: boolean };
    // A limit, not a loss the user can't see: the log says it is truncated.
    expect(found.truncated).toBe(true);
    expect(found.arguments).not.toContain('END');
  });

  it('a refused apply shows as an error in the activity, with the reason', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'good' }), call('tables_list', {})), round(call('query_apply', { source: 'good' }))]);
    const created = await chat.create();
    await chat.send({ chatId: created.id, source: '', text: 'x' });
    const results = (await chat.get(created.id))!.activity.filter(a => a.kind === 'toolResult' && a.toolName === 'query_apply');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: 'error', text: expect.stringContaining('cannot share a message') });
    expect(results[1]).toMatchObject({ status: 'success' });
  });

  it('a chart_apply and a query_apply alone in a round still settle among themselves', async () => {
    const { faux, chat } = await setup();
    faux.setResponses([round(call('query_apply', { source: 'one' }), call('chart_apply', { source: 'two', spec })), say('Must not run')]);
    expect(await chat.send({ chatId: null, source: '', text: 'x' })).toMatchObject({ ok: true, turn: { kind: 'version', source: 'two', attempts: 2 } });
    expect(faux.state.callCount).toBe(1);
  });
});

describe('#2 a stop during each exploration tool', () => {
  const cases: [typeof TOOLS[number], object][] = [['query_run', { source: 'q' }], ['columns_describe', { table: 't', columns: ['c'] }], ['tables_list', {}], ['docs_read', { id: 'x' }]];
  for (const honours of [true, false]) {
    it.each(cases)(`%s, ${honours ? 'noticing' : 'ignoring'} the signal: settles in the grace, no fork, well-formed afterwards`, async (name, args) => {
      const { faux, chat, exploration } = await setup({ abortGraceMs: 400 });
      const entered = deferred();
      const held = deferred<{ rows: [] }>();
      let signal: AbortSignal | undefined;
      vi.mocked(exploration[name] as never as () => Promise<unknown>).mockImplementation(async () => {
        signal = currentRunSignal();
        entered.resolve();
        if (honours) await new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted by the signal')), { once: true }));
        return held.promise;
      });
      faux.setResponses([round(call(name, args))]);
      const created = await chat.create();
      const before = (await chat.get(created.id))!.conversationId;
      const sending = chat.send({ chatId: created.id, source: '', text: 'x' });
      await entered.promise;
      const t = performance.now();
      await chat.stop(created.id);
      expect(await sending).toMatchObject({ ok: false, stopped: true });
      expect(performance.now() - t).toBeLessThan(400);
      const detail = (await chat.get(created.id))!;
      expect(detail.conversationId).toBe(before);
      expect(detail.turns.map(t => t.kind)).toEqual(['user', 'note']);
      expect(detail.activity.filter(a => a.kind === 'toolCall').map(a => a.status)).toEqual(['interrupted']);
      held.resolve({ rows: [] });
      let seen: Ctx | undefined;
      let later: AbortSignal | undefined;
      let abortedInLater: boolean | undefined;
      vi.mocked(exploration[name] as never as () => Promise<unknown>).mockImplementation(async () => { later = currentRunSignal(); abortedInLater = later?.aborted; await sleep(20); abortedInLater ||= later?.aborted; return { rows: [] }; });
      faux.setResponses([round(call(name, args)), ((ctx: Ctx) => { seen = ctx; return say('Back.'); }) as never]);
      expect(await chat.send({ chatId: created.id, source: '', text: 'again' })).toMatchObject({ ok: true });
      wellFormed(seen!);
      expect(later).not.toBe(signal);
      expect(abortedInLater).toBe(false);
    });
  }

  it('a capability that rejects long after the abort is nobody’s unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { faux, chat, exploration } = await setup();
      const entered = deferred();
      vi.mocked(exploration.query_run).mockImplementation(async () => { entered.resolve(); await sleep(150); throw new Error('late'); });
      faux.setResponses([round(call('query_run', { source: 'q' }))]);
      const created = await chat.create();
      const sending = chat.send({ chatId: created.id, source: '', text: 'x' });
      await entered.promise;
      await chat.stop(created.id);
      await sending;
      await sleep(300);
      expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off('unhandledRejection', unhandled); }
  });

  it('the run’s timeout aborts the capability too', async () => {
    const { faux, chat, exploration } = await setup({ timeoutMs: 150 });
    let signal: AbortSignal | undefined;
    vi.mocked(exploration.query_run).mockImplementation(async () => { signal = currentRunSignal(); return new Promise(() => undefined); });
    faux.setResponses([round(call('query_run', { source: 'q' }))]);
    const created = await chat.create();
    const before = (await chat.get(created.id))!.conversationId;
    expect(await chat.send({ chatId: created.id, source: '', text: 'x' })).toMatchObject({ ok: false, turn: { kind: 'error' } });
    expect(signal?.aborted).toBe(true);
    expect((await chat.get(created.id))!.conversationId).toBe(before);
  });

  it('each call runs under a live signal of its own run, and no signal is left outside a call', async () => {
    const { faux, chat, exploration } = await setup();
    const signals: AbortSignal[] = [];
    const live: boolean[] = [];
    const record = async () => { const own = currentRunSignal()!; signals.push(own); await sleep(5); expect(currentRunSignal()).toBe(own); live.push(!own.aborted); return { rows: [] }; };
    vi.mocked(exploration.query_run).mockImplementation(record);
    faux.setResponses([round(call('query_run', { source: 'a' }), call('query_run', { source: 'b' })), say('one'), round(call('query_run', { source: 'c' })), say('two')]);
    const created = await chat.create();
    await chat.send({ chatId: created.id, source: '', text: 'first' });
    await chat.send({ chatId: created.id, source: '', text: 'second' });
    expect(signals).toHaveLength(3);
    expect(live).toEqual([true, true, true]);
    expect(signals[2]).not.toBe(signals[0]);
    expect(currentRunSignal()).toBeUndefined();
  });

  it('a stop while another chat’s tool is long gone doesn’t touch it: one chat’s stop only reaches its own run', async () => {
    const { faux, chat, exploration } = await setup();
    const entered = deferred();
    const held = deferred<{ rows: [] }>();
    let signal: AbortSignal | undefined;
    vi.mocked(exploration.query_run).mockImplementation(async () => { signal = currentRunSignal(); entered.resolve(); return held.promise; });
    faux.setResponses([round(call('query_run', { source: 'q' })), say('done')]);
    const a = await chat.create();
    const b = await chat.create();
    const sending = chat.send({ chatId: a.id, source: '', text: 'x' });
    await entered.promise;
    expect(await chat.stop(b.id)).toEqual({ stopped: false });
    expect(signal?.aborted).toBe(false);
    held.resolve({ rows: [] });
    expect(await sending).toMatchObject({ ok: true });
  });

  it('a slow query_validate under a stop: does it take the stuck path?', async () => {
    const held = deferred<void>();
    const entered = deferred();
    const { faux, chat } = await setup({ abortGraceMs: 200, check: async source => { if (source === 'slow') { entered.resolve(); await held.promise; } return check(source); } });
    faux.setResponses([round(call('query_validate', { source: 'slow' }))]);
    const created = await chat.create();
    const before = (await chat.get(created.id))!.conversationId;
    const sending = chat.send({ chatId: created.id, source: '', text: 'x' });
    await entered.promise;
    await chat.stop(created.id);
    expect(await sending).toMatchObject({ stopped: true });
    const after = (await chat.get(created.id))!;
    held.resolve();
    // Documents today's behaviour (see the report): check isn't abortable, so this forks. Only exploration was in scope of #2.
    expect(after.conversationId).not.toBe(before);
  });
});

describe('#2 a stop in a round of several calls', () => {
  it('leaves a result for every call, finished or not', async () => {
    const { faux, chat, exploration } = await setup();
    const entered = deferred();
    vi.mocked(exploration.query_run).mockImplementation(async () => { entered.resolve(); return new Promise(() => undefined); });
    faux.setResponses([round(call('docs_read', { id: 'x' }), call('query_run', { source: 'q' }), call('tables_list', {}))]);
    const created = await chat.create();
    const sending = chat.send({ chatId: created.id, source: '', text: 'x' });
    await entered.promise;
    await sleep(50);
    await chat.stop(created.id);
    expect(await sending).toMatchObject({ stopped: true });
    let seen: Ctx | undefined;
    faux.setResponses([((ctx: Ctx) => { seen = ctx; return say('Back.'); }) as never]);
    expect(await chat.send({ chatId: created.id, source: '', text: 'again' })).toMatchObject({ ok: true });
    wellFormed(seen!);
  });
});

describe('#3 the last read of a send', () => {
  /** Lets `skip` full reads through after being armed, then hangs one. */
  async function setupReads() {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const m = faux.getModel();
    const entered = deferred();
    const held = deferred();
    const extension = chatExtension({ guide: '', schema: () => '', check, exploration: { docs_read: async () => { entered.resolve(); await held.promise; return 'late'; } } as unknown as ExplorationCapabilities });
    const registry = createRegistry();
    registry.install(extension);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
    const armed = { skip: -1 };
    const open = harness.conversation.bind(harness);
    const patched = new WeakSet<Conversation>();
    vi.spyOn(harness, 'conversation').mockImplementation(async (id, ctx) => {
      const conversation = await open(id, ctx);
      if (conversation && !patched.has(conversation)) {
        patched.add(conversation);
        const entries = conversation.entries.bind(conversation);
        conversation.entries = ((filter, limit, cursor, c) => {
          if (armed.skip >= 0 && filter?.minEntryId === undefined && armed.skip-- === 0) return new Promise(() => undefined);
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
    return { faux, chat, armed, entered, release: () => held.resolve() };
  }
  it.each(['version', 'text', 'error'] as const)('a %s reply whose last read hangs: answered from what was written, id 0, and the stored chat has the real numbers', async kind => {
    const { faux, chat, armed, release } = await setupReads();
    faux.setResponses([round(call('query_apply', { source: 'one' }))]);
    const created = await chat.create();
    await chat.send({ chatId: created.id, source: '', text: 'first' });
    faux.setResponses(kind === 'version' ? [round(call('query_apply', { source: 'two', summary: 'second' }))] : kind === 'text' ? [say('words')] : [round(call('query_apply', { source: 'bad' })), say('gave up')]);
    // retitle read, then the last one
    armed.skip = 1;
    const sent = await Promise.race([chat.send({ chatId: created.id, source: 'one', text: 'next' }), sleep(5_000).then(() => 'hung' as const)]);
    release();
    expect(sent).not.toBe('hung');
    const turn = (sent as { turn: { id: number; kind: string; n?: number; source?: string } }).turn;
    expect(turn).toMatchObject({ id: 0, kind });
    if (kind === 'version') expect(turn).toMatchObject({ n: 1, source: 'two' });
    const stored = (await chat.get(created.id))!;
    const versions = stored.turns.filter(t => t.kind === 'version');
    expect(versions.map(t => (t as { n: number }).n)).toEqual(kind === 'version' ? [1, 2] : [1]);
    expect(stored.turns.every(t => t.id > 0)).toBe(true);
    expect(stored.generating).toBe(false);
    // The next resend names a real turn and works.
    const last = stored.turns.filter(t => t.kind === 'user').at(-1)!;
    faux.setResponses([say('again')]);
    expect(await chat.send({ chatId: created.id, source: 'one', text: 'resent', replaceFrom: last.id })).toMatchObject({ ok: true, turn: { kind: 'text', text: 'again' } });
    // id 0 itself is not a message: a resend naming it is refused.
    faux.setResponses([say('never')]);
    expect(await chat.send({ chatId: created.id, source: 'one', text: 'x', replaceFrom: 0 })).toMatchObject({ ok: false });
  });

  it('a read that hangs after the note is recorded must not hold the guard', async () => {
    const { faux, chat, armed, entered, release } = await setupReads();
    faux.setResponses([round(call('docs_read', { id: 'x' }))]);
    const created = await chat.create();
    const sending = chat.send({ chatId: created.id, source: '', text: 'read' });
    await entered.promise;
    armed.skip = 1; // the abandoned-activity read goes through; the one after the commit hangs
    await chat.stop(created.id);
    const settled = await Promise.race([sending.then(() => true), sleep(2_000).then(() => false)]);
    release();
    expect(settled, 'send settled within 2 s of the stop').toBe(true);
  });
});

describe('#9 every cut boundary', () => {
  const pairs = '🦄'.repeat(20_000);
  it('cut and charStart at every offset', () => {
    const text = `a${'🦄'.repeat(30)}`;
    for (let limit = 0; limit <= text.length + 1; limit++) {
      const head = cut(text, limit);
      expect(hasLone(head)).toBe(false);
      expect(text.startsWith(head)).toBe(true);
      expect(limit - head.length).toBeLessThanOrEqual(1);
      expect(hasLone(text.slice(charStart(text, limit)))).toBe(false);
    }
  });
  it('cells at both parities, nested too', () => {
    for (let shift = 0; shift < 4; shift++) {
      const cell = 'x'.repeat(shift) + pairs;
      for (const value of [cell, [cell], { a: cell }, { a: [{ b: cell }] }]) {
        expect(hasLone(boundedValue(value).value)).toBe(false);
      }
    }
  });
  it('comments, types, bindings, SQL and schema errors at both parities', async () => {
    for (let shift = 0; shift < 2; shift++) {
      const long = 'y'.repeat(shift) + pairs;
      const connection = {
        database: 'd', driver: {} as Connection['driver'],
        tables: () => [{ name: 't', binding: long, engine: long, columns: [{ name: long, type: long }] }],
        runAgentQuery: async () => ({ rows: [{ a: long }], sql: long, columns: [{ name: 'a', path: ['a'], type: long }] as never, truncated: false, elapsedMs: 0 }),
        schemaMetadata: () => ({ functions: [], tables: [{ name: 't', sortingKey: [long], partitionKey: [], columns: [{ name: long, comment: long, defaultKind: long, position: 1 }] }] }) as never,
      };
      const api = createAgentCapabilities(connection);
      expect(hasLone(api.tablesList())).toBe(false);
      expect(hasLone(api.tableDescribe('t'))).toBe(false);
      const run = await api.queryRun('q', 'owner');
      expect(hasLone(run)).toBe(false);
      expect(run.columnsTruncated).toBe(true);
      const offline = createAgentCapabilities({ ...connection, schemaError: () => long });
      expect(() => offline.tablesList()).toThrow();
      try { offline.tablesList(); } catch (error) { expect(hasLone((error as Error).message)).toBe(false); }
    }
  });
  it('the transcript and the activity hold no lone surrogates, for tool output and long arguments at both parities', async () => {
    for (let shift = 0; shift < 2; shift++) {
      const { faux, chat, exploration } = await setup();
      const long = 'z'.repeat(shift) + pairs;
      vi.mocked(exploration.docs_read).mockImplementation(async () => long as never);
      let seen = '';
      faux.setResponses([round(call('docs_read', { id: long })), ((ctx: unknown) => { seen = JSON.stringify(ctx); return say('ok'); }) as never]);
      const created = await chat.create();
      await chat.send({ chatId: created.id, source: '', text: 'x' });
      expect(seen).toContain('🦄');
      expect(hasLone(seen)).toBe(false);
      const detail = (await chat.get(created.id))!;
      expect(detail.activity.some(a => a.truncated)).toBe(true);
      for (const item of detail.activity) expect(hasLone(item)).toBe(false);
      await llm!.close(); llm = undefined;
    }
  });
});

describe('#10 column counts', () => {
  const run = (columnCount: number, rowCount: number, sql = 'SELECT 1') => {
    const names = Array.from({ length: columnCount }, (_, n) => `c${n}`);
    const rows = Array.from({ length: rowCount }, () => Object.fromEntries(names.map(name => [name, 1])));
    const columns = names.map(name => ({ name, path: [name], type: 'UInt8' }));
    return createAgentCapabilities({ database: 'd', driver: {} as Connection['driver'], tables: () => [], runAgentQuery: async () => ({ rows, sql, columns: columns as never, truncated: false, elapsedMs: 0 }) }).queryRun('q', 'owner');
  };
  it.each([[0, false], [1, false], [19, false], [20, false], [21, false], [31, false], [32, false], [33, true], [40, true], [500, true]])('%i columns', async (count, cut) => {
    const result = await run(count, 3);
    const kept = Math.min(count, RESULT_LIMITS.columns);
    expect(result.columns).toHaveLength(kept);
    expect(result).toMatchObject({ truncated: cut, columnsTruncated: cut });
    expect(Object.keys((result.rows[0] ?? {}) as object)).toEqual((result.columns as { name: string }[]).map(c => c.name));
    const empty = await run(count, 0);
    expect(empty).toMatchObject({ truncated: false, columnsTruncated: cut });
  });
  it('later pages keep the row verdict, and the snapshot pages to every row', async () => {
    for (const [count, verdict] of [[21, false], [33, true]] as const) {
      const first = await run(count, 45);
      const api = first as { rows: unknown[]; nextCursor: string | null; truncated: boolean; retainedRows: number };
      expect(api.truncated).toBe(verdict);
      expect(api.retainedRows).toBe(45);
    }
    const names = Array.from({ length: 21 }, (_, n) => `c${n}`);
    const rows = Array.from({ length: 45 }, (_, i) => Object.fromEntries(names.map(name => [name, i])));
    const api = createAgentCapabilities({ database: 'd', driver: {} as Connection['driver'], tables: () => [], runAgentQuery: async () => ({ rows, sql: 'S', columns: names.map(name => ({ name, path: [name], type: 'UInt8' })) as never, truncated: false, elapsedMs: 0 }) });
    const first = await api.queryRun('q', 'o');
    let page: { rows: unknown[]; nextCursor: string | null; truncated: boolean } = first;
    const seen = [...first.rows];
    while (page.nextCursor) { page = api.queryResultsGet(first.resultId, page.nextCursor, 'o'); expect(page.truncated).toBe(false); seen.push(...page.rows); }
    expect(seen).toEqual(rows);
  });
  it('more than 500 rows stay truncated however many columns', async () => {
    const api = createAgentCapabilities({ database: 'd', driver: {} as Connection['driver'], tables: () => [], runAgentQuery: async () => ({ rows: [{ a: 1 }], sql: 'S', columns: [{ name: 'a', path: ['a'], type: 'UInt8' }] as never, truncated: true, elapsedMs: 0 }) });
    expect(await api.queryRun('q', 'o')).toMatchObject({ truncated: true, columnsTruncated: false });
  });
  it('SQL over 8000 characters is reported as sqlTruncated, and complete rows stay complete', async () => {
    for (const [length, cut] of [[7999, false], [8000, false], [8001, true], [64000, true]] as const) {
      const result = await run(2, 3, 'S'.repeat(length));
      expect(result).toMatchObject({ truncated: false, columnsTruncated: false, sqlTruncated: cut, retainedRows: 3 });
      expect(result.sql).toHaveLength(Math.min(length, 8000));
    }
    // Each flag on its own, and on no later page: the first page answers for the SQL and the column list.
    expect(await run(33, 3, 'S'.repeat(8001))).toMatchObject({ truncated: true, columnsTruncated: true, sqlTruncated: true });
    expect(await run(33, 0, 'S')).toMatchObject({ truncated: false, columnsTruncated: true, sqlTruncated: false });
  });
  // OBSERVATION: JS moves integer-like keys first, so past the limit a row keeps a different 32 columns than the metadata.
  it('column names that are array indexes differ past the limit (pinned, see the report)', async () => {
    const names = [...Array.from({ length: 32 }, (_, n) => `c${n}`), '1'];
    const rows = [Object.fromEntries(names.map(name => [name, 1]))];
    const columns = names.map(name => ({ name, path: [name], type: 'UInt8' }));
    const result = await createAgentCapabilities({ database: 'd', driver: {} as Connection['driver'], tables: () => [], runAgentQuery: async () => ({ rows, sql: 'S', columns: columns as never, truncated: false, elapsedMs: 0 }) }).queryRun('q', 'o');
    expect(Object.keys(result.rows[0] as object)).toContain('1');
    expect((result.columns as { name: string }[]).map(c => c.name)).not.toContain('1');
  });
});
