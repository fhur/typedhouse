// S11 on the service: stuck-run fork, edit-and-resend, stop, charts in chat, and findings F28-F34. Faux provider, real SQLite.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import type { Storage } from '@earendil-works/pi-durable';
import { diffLines, MAX_SOURCE } from '../server/chat.js';
import type { Connection } from '../server/clickhouse.js';
import { createLlm, openStorage, type CheckResult, type Llm } from '../server/llm.js';
import { createRouter, startServer, type AppRouter } from '../server/server.js';

type Message = { role: string; content: unknown; toolCallId?: string };
type Request = { systemPrompt?: string; messages: Message[]; sessionId?: string };
const dirs: string[] = [];
const open: Llm[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(l => l.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const columns = [{ name: 'country', type: 'String' }, { name: 'revenue', type: 'Float64' }];
const goodCheck = (source: string): CheckResult => (source.includes('BAD') ? { ok: false, stage: 'compile', message: `refused ${source}` } : { ok: true, sql: `SELECT /* ${source} */ 1`, rowType: '{ country: string; revenue: number }', columns });
const query = (source: string, summary?: string) => fauxAssistantMessage([fauxToolCall('query_apply', { source, ...(summary ? { summary } : {}) })], { stopReason: 'toolUse' });
const chart = (args: Record<string, unknown>) => fauxAssistantMessage([fauxToolCall('chart_apply', args as never)], { stopReason: 'toolUse' });
const say = (text: string) => fauxAssistantMessage([fauxText(text)]);
const spec = { mark: 'bar', encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };

/** Never answers and never looks at the abort. */
const ignores = () => new Promise(() => undefined);
/** Waits for the abort, like a real stream. */
const honours = (_ctx: unknown, options?: { signal?: AbortSignal }) => new Promise(resolve => {
  options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'Request was aborted' })));
});

async function setup(options: { check?: (source: string) => CheckResult | Promise<CheckResult>; maxTurns?: number; timeoutMs?: number; abortGraceMs?: number; dir?: string; wrap?: (storage: Storage) => Storage } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'studio-s11-'));
  if (!options.dir) dirs.push(dir);
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const llm = await createLlm({
    models, model: { provider: faux.provider.id, modelId: faux.getModel().id }, schema: () => 'declare const events: unknown;\n', check: options.check ?? goodCheck, storage: (options.wrap ?? (storage => storage))(await openStorage(dir)),
    abortGraceMs: options.abortGraceMs ?? 200,
    ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  open.push(llm);
  const seen: Request[] = [];
  const script = (...steps: unknown[]) => faux.setResponses(steps.map(step => (ctx: Request, opts: { sessionId?: string } | undefined, state: unknown, model: unknown) => {
    seen.push({ ...JSON.parse(JSON.stringify(ctx)) as Request, ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}) });
    return typeof step === 'function' ? (step as (...a: unknown[]) => unknown)(ctx, opts, state, model) : step;
  }) as never);
  const api = createRouter({} as Connection, llm).createCaller({});
  const until = async (condition: () => boolean, what: string) => {
    const deadline = Date.now() + 5_000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  return { api, llm, faux, script, seen, until, dir };
}
const dump = (request: Request) => JSON.stringify(request);
const kinds = (turns: { kind: string }[]) => turns.map(t => t.kind);
function assertWellFormed(request: Request) {
  const pending: string[] = [];
  for (const message of request.messages) {
    if (message.role === 'assistant') {
      expect(pending).toEqual([]);
      for (const block of message.content as { type: string; id: string }[]) if (block.type === 'toolCall') pending.push(block.id);
    } else if (message.role === 'toolResult') {
      expect(pending).toContain(message.toolCallId);
      pending.splice(pending.indexOf(message.toolCallId!), 1);
    } else expect(pending).toEqual([]);
  }
  expect(pending).toEqual([]);
}

describe('item 1: the stuck-run fork, through the chat', () => {
  it('stop on a provider that ignores the abort: the next send in the same chat answers at once with the earlier turns and the stopped prompt', async () => {
    const { api, script, seen, until } = await setup();
    script(query('Q1'), ignores, query('Q2'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    const before = (await api.chat.list())[0]!.conversationId;
    const sending = api.chat.send({ chatId, text: 'BRAVO', source: 'Q1' });
    await until(() => seen.length === 2, 'the stuck request');
    expect(await api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
    expect(await sending).toMatchObject({ ok: false, stopped: true, turn: { kind: 'note' } });
    expect((await api.chat.list())[0]!.conversationId).not.toBe(before);
    expect(kinds((await api.chat.get({ id: chatId! }))!.turns)).toEqual(['user', 'version', 'user', 'note']);

    const started = performance.now();
    expect(await api.chat.send({ chatId, text: 'CHARLIE', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, source: 'Q2' } });
    expect(performance.now() - started).toBeLessThan(1_000);
    for (const word of ['ALPHA', 'Q1', 'BRAVO', 'CHARLIE']) expect(dump(seen.at(-1)!)).toContain(word);
    assertWellFormed(seen.at(-1)!);
    expect(kinds((await api.chat.get({ id: chatId! }))!.turns)).toEqual(['user', 'version', 'user', 'note', 'user', 'version']);
  });

  it('the timeout takes the same fork, with an error turn', async () => {
    const { api, script, seen } = await setup({ timeoutMs: 100 });
    script(query('Q1'), ignores, query('Q2'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    expect(await api.chat.send({ chatId, text: 'BRAVO', source: 'Q1' })).toMatchObject({ ok: false, turn: { kind: 'error', error: expect.stringMatching(/timed out/) } });
    expect(await api.chat.send({ chatId, text: 'CHARLIE', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2 } });
    for (const word of ['ALPHA', 'BRAVO', 'CHARLIE']) expect(dump(seen.at(-1)!)).toContain(word);
  });

  it('on a first turn too: nothing before it is needed', async () => {
    const { api, script, seen, until } = await setup();
    script(ignores, query('Q1'));
    const sending = api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    await until(() => seen.length === 1, 'the stuck request');
    const chatId = (await api.chat.list())[0]!.id;
    await api.chat.stop({ id: chatId });
    await sending;
    expect(await api.chat.send({ chatId, text: 'BRAVO', source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    expect(dump(seen.at(-1)!)).toContain('ALPHA');
  });

  it('a late answer never reaches the fork, the thread or a check', async () => {
    const checks: string[] = [];
    let release: (message: unknown) => void = () => {};
    const { api, script, seen, until } = await setup({ check: source => { checks.push(source); return goodCheck(source); } });
    script(() => new Promise(resolve => { release = resolve; }), query('Q2'));
    const sending = api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    await until(() => seen.length === 1, 'the stuck request');
    const chatId = (await api.chat.list())[0]!.id;
    await api.chat.stop({ id: chatId });
    await sending;
    const thread = await api.chat.get({ id: chatId });
    release(query('LATE_SOURCE'));
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await api.chat.get({ id: chatId })).toEqual(thread);
    expect(checks).toEqual([]);
    await api.chat.send({ chatId, text: 'BRAVO', source: '' });
    expect(dump(seen.at(-1)!)).not.toContain('LATE_SOURCE');
    expect(JSON.stringify(await api.chat.get({ id: chatId }))).not.toContain('LATE_SOURCE');
  });

  it('five stuck runs in a row: the sixth send answers in normal time, and another chat keeps working', async () => {
    const { api, script, seen, until } = await setup({ abortGraceMs: 100 });
    script(query('OTHER_Q'), ...Array.from({ length: 5 }, () => ignores), query('SIXTH_Q'), query('OTHER_Q2'));
    const other = await api.chat.send({ chatId: null, text: 'OTHER_CHAT', source: '' });
    let chatId: string | null = null;
    for (let i = 0; i < 5; i++) {
      const count = seen.length;
      const sending: ReturnType<typeof api.chat.send> = api.chat.send({ chatId, text: `STUCK_${i}`, source: '' });
      await until(() => seen.length === count + 1, 'the stuck request');
      chatId ??= (await api.chat.list()).find(c => c.id !== other.chatId)!.id;
      await api.chat.stop({ id: chatId });
      expect(await sending).toMatchObject({ stopped: true });
    }
    const started = performance.now();
    expect(await api.chat.send({ chatId, text: 'SIXTH', source: '' })).toMatchObject({ ok: true, turn: { source: 'SIXTH_Q' } });
    expect(await api.chat.send({ chatId: other.chatId, text: 'OTHER_AGAIN', source: 'OTHER_Q' })).toMatchObject({ ok: true, turn: { source: 'OTHER_Q2' } });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(dump(seen.at(-2)!)).toContain('STUCK_0');
    expect(dump(seen.at(-2)!)).toContain('STUCK_4');
    expect(dump(seen.at(-2)!)).not.toContain('OTHER_CHAT');
    expect(dump(seen.at(-1)!)).not.toContain('STUCK_0');
  });

  it('llm.close() stays within its bound with stuck runs alive', async () => {
    const { api, llm, script, seen, until } = await setup({ abortGraceMs: 100 });
    script(ignores, ignores);
    let chatId: string | null = null;
    for (let i = 0; i < 2; i++) {
      const count = seen.length;
      const sending: ReturnType<typeof api.chat.send> = api.chat.send({ chatId, text: `STUCK_${i}`, source: '' });
      await until(() => seen.length === count + 1, 'the stuck request');
      chatId ??= (await api.chat.list())[0]!.id;
      await api.chat.stop({ id: chatId });
      await sending;
    }
    const started = performance.now();
    await llm.close();
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('edit-and-resend', () => {
  /** ALPHA, BRAVO, CHARLIE, as version turns. */
  async function three(context: Awaited<ReturnType<typeof setup>>) {
    const { api } = context;
    const { chatId } = await api.chat.send({ chatId: null, text: 'PROMPT_ALPHA', source: '' });
    const second = await api.chat.send({ chatId, text: 'PROMPT_BRAVO', source: 'SOURCE_ALPHA' });
    await api.chat.send({ chatId, text: 'PROMPT_CHARLIE', source: 'SOURCE_BRAVO' });
    const turns = (await api.chat.get({ id: chatId! }))!.turns;
    return { chatId: chatId!, second, turns };
  }
  const threeSteps = [query('SOURCE_ALPHA'), query('SOURCE_BRAVO'), query('SOURCE_CHARLIE')];
  const clean = (request: Request) => { for (const word of ['BRAVO', 'CHARLIE']) expect(dump(request)).not.toContain(word); };

  it('the model no longer sees the later turns, anywhere, and the thread and numbers follow the fork', async () => {
    const context = await setup();
    const { api, script, seen } = context;
    script(...threeSteps, query('SOURCE_DELTA'), query('SOURCE_ECHO'));
    const { chatId, turns } = await three(context);
    const parent = (await api.chat.list())[0]!.conversationId;
    const replaceFrom = turns.filter(t => t.kind === 'user')[1]!.id;

    const resent = await api.chat.send({ chatId, text: 'PROMPT_DELTA', source: 'SOURCE_ALPHA', replaceFrom });
    expect(resent).toMatchObject({ ok: true, chatId, turn: { kind: 'version', n: 2, source: 'SOURCE_DELTA' } });
    const request = seen.at(-1)!;
    for (const word of ['PROMPT_ALPHA', 'SOURCE_ALPHA', 'PROMPT_DELTA']) expect(dump(request)).toContain(word);
    clean(request);
    assertWellFormed(request);
    // No provider-side state links the branches.
    expect(request.sessionId).toBeTruthy();
    expect(request.sessionId).not.toBe(seen[0]!.sessionId);

    const detail = (await api.chat.get({ id: chatId }))!;
    expect(detail.conversationId).not.toBe(parent);
    expect(kinds(detail.turns)).toEqual(['user', 'version', 'user', 'version']);
    expect(JSON.stringify(detail.turns)).not.toMatch(/BRAVO|CHARLIE/);

    expect(await api.chat.send({ chatId, text: 'PROMPT_FOLLOWUP', source: 'SOURCE_DELTA' })).toMatchObject({ turn: { n: 3, source: 'SOURCE_ECHO' } });
    clean(seen.at(-1)!);
    expect(dump(seen.at(-1)!)).toContain('PROMPT_DELTA');
    expect((await api.chat.list())).toHaveLength(1);
  });

  it('it stays clean after a reopen of the same file', async () => {
    const context = await setup();
    const { api, script, seen, llm, dir } = context;
    script(...threeSteps, query('SOURCE_DELTA'));
    const { chatId, turns } = await three(context);
    await api.chat.send({ chatId, text: 'PROMPT_DELTA', source: 'SOURCE_ALPHA', replaceFrom: turns.filter(t => t.kind === 'user')[1]!.id });
    await llm.close();
    const next = await setup({ dir });
    next.script(query('SOURCE_ECHO'));
    expect(await next.api.chat.send({ chatId, text: 'PROMPT_ECHO', source: 'SOURCE_DELTA' })).toMatchObject({ ok: true, turn: { n: 3 } });
    clean(next.seen[0]!);
    expect(dump(next.seen[0]!)).toContain('PROMPT_DELTA');
    expect(seen).toHaveLength(4);
  });

  it('resending turn 1 is a fresh conversation with no earlier text, and renames the chat', async () => {
    const context = await setup();
    const { api, script, seen } = context;
    script(...threeSteps, query('SOURCE_DELTA'));
    const { chatId, turns } = await three(context);
    const before = (await api.chat.list())[0]!;
    expect(before.title).toBe('PROMPT_ALPHA');
    expect(await api.chat.send({ chatId, text: 'PROMPT_DELTA', source: '', replaceFrom: turns[0]!.id })).toMatchObject({ ok: true, chatId, turn: { n: 1 } });
    const request = dump(seen.at(-1)!);
    for (const word of ['ALPHA', 'BRAVO', 'CHARLIE']) expect(request).not.toContain(word);
    const after = (await api.chat.list())[0]!;
    expect(after.conversationId).not.toBe(before.conversationId);
    expect(after.title).toBe('PROMPT_DELTA');
    expect(kinds((await api.chat.get({ id: chatId }))!.turns)).toEqual(['user', 'version']);
  });

  it('retry is the same mutation with the same text', async () => {
    const { api, script, seen } = await setup();
    script(query('Q1'), say('oops'), query('Q2'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'FIRST', source: '' });
    await api.chat.send({ chatId, text: 'SECOND', source: 'Q1' });
    const turns = (await api.chat.get({ id: chatId! }))!.turns;
    expect(await api.chat.send({ chatId, text: 'SECOND', source: 'Q1', replaceFrom: turns[2]!.id })).toMatchObject({ ok: true, turn: { n: 2, source: 'Q2' } });
    expect(dump(seen.at(-1)!)).not.toContain('oops');
    expect(kinds((await api.chat.get({ id: chatId! }))!.turns)).toEqual(['user', 'version', 'user', 'version']);
  });

  it('a turn that is not a user turn of this chat is refused and changes nothing', async () => {
    const { api, script } = await setup();
    script(query('Q1'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'FIRST', source: '' });
    const before = await api.chat.get({ id: chatId! });
    expect(await api.chat.send({ chatId, text: 'x', source: '', replaceFrom: before!.turns[1]!.id })).toMatchObject({ ok: false, error: expect.stringMatching(/not a message/) });
    expect(await api.chat.send({ chatId, text: 'x', source: '', replaceFrom: 999_999 })).toMatchObject({ ok: false });
    expect(await api.chat.send({ chatId: null, text: 'x', source: '', replaceFrom: 1 })).toMatchObject({ ok: false });
    expect(await api.chat.get({ id: chatId! })).toEqual(before);
  });

  it('editing after a stopped turn on a stuck run still works', async () => {
    const { api, script, seen, until } = await setup();
    script(query('Q1'), ignores, query('Q2'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    const sending = api.chat.send({ chatId, text: 'STUCK_BRAVO', source: 'Q1' });
    await until(() => seen.length === 2, 'the stuck request');
    await api.chat.stop({ id: chatId! });
    await sending;
    const turns = (await api.chat.get({ id: chatId! }))!.turns;
    expect(await api.chat.send({ chatId, text: 'DELTA', source: 'Q1', replaceFrom: turns[2]!.id })).toMatchObject({ ok: true, turn: { n: 2 } });
    expect(dump(seen.at(-1)!)).not.toContain('STUCK_BRAVO');
    expect(dump(seen.at(-1)!)).toContain('ALPHA');
  });
});

describe('stop leaves the conversation usable', () => {
  /** Runs a turn up to `ready`, stops it, and proves the next send in the same chat. */
  async function stopCase(context: Awaited<ReturnType<typeof setup>>, ready: () => boolean) {
    const { api, seen, until } = context;
    const { chatId } = await api.chat.send({ chatId: null, text: 'EARLIER_PROMPT', source: '' });
    const sending = api.chat.send({ chatId, text: 'STOPPED_PROMPT', source: 'Q1' });
    await until(ready, 'the point to stop at');
    const started = performance.now();
    expect(await api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
    // The product's bound is a 200 ms timer here. What this proves is that a stop doesn't wait on what it stops, so a loaded machine gets room.
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(await sending).toEqual({ ok: false, chatId, error: 'Stopped.', stopped: true, turn: expect.objectContaining({ kind: 'note', text: expect.stringMatching(/^Stopped/) }) });
    const detail = (await api.chat.get({ id: chatId! }))!;
    expect(detail.generating).toBe(false);
    expect(kinds(detail.turns)).toEqual(['user', 'version', 'user', 'note']);
    expect(await api.chat.send({ chatId, text: 'NEXT_PROMPT', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, source: 'NEXT_Q' } });
    for (const word of ['EARLIER_PROMPT', 'Q1', 'STOPPED_PROMPT', 'NEXT_PROMPT']) expect(dump(seen.at(-1)!)).toContain(word);
    assertWellFormed(seen.at(-1)!);
  }

  it('while the model is streaming', async () => {
    const context = await setup();
    context.script(query('Q1'), honours, query('NEXT_Q'));
    await stopCase(context, () => context.seen.length === 2);
  });

  it('while check_query is executing, on a check that finishes when it finishes', async () => {
    let entered = false;
    let n = 0;
    const context = await setup({ check: async source => {
      // The first turn checks twice; the third check is the stopped turn's.
      if (++n === 3) { entered = true; await new Promise(resolve => setTimeout(resolve, 50)); }
      return goodCheck(source);
    } });
    context.script(query('Q1'), query('SLOW_Q'), query('NEXT_Q'));
    await stopCase(context, () => entered);
    expect(JSON.stringify(await context.api.chat.list())).not.toContain('SLOW_Q');
  });

  it('while check_query never returns: every tool call in the next request has a result', async () => {
    let entered = false;
    const context = await setup({ check: source => {
      if (source === 'HANGS') { entered = true; return new Promise<CheckResult>(() => undefined); }
      return goodCheck(source);
    } });
    context.script(query('Q1'), query('HANGS'), query('NEXT_Q'));
    await stopCase(context, () => entered);
  });

  it('with a provider that ignores the abort', async () => {
    const context = await setup();
    context.script(query('Q1'), ignores, query('NEXT_Q'));
    await stopCase(context, () => context.seen.length === 2);
  });

  it('during the re-check, which never returns (F28 path)', async () => {
    let n = 0;
    let entered = false;
    const context = await setup({ check: source => {
      // Check and re-check of Q1, check of Q2, then its re-check.
      if (++n === 4) { entered = true; return new Promise<CheckResult>(() => undefined); }
      return goodCheck(source);
    } });
    context.script(query('Q1'), query('Q2'), query('NEXT_Q'));
    await stopCase(context, () => entered);
  });

  it('during a retry', async () => {
    const context = await setup();
    context.script(query('Q1'), fauxAssistantMessage('', { stopReason: 'error', errorMessage: '503 overloaded, retry' }), query('NEXT_Q'));
    await stopCase(context, () => context.seen.length === 2);
  });

  it('stop wins over a check that passes in the same moment', async () => {
    let n = 0;
    let pass: (result: CheckResult) => void = () => {};
    const context = await setup({ check: source => (++n === 2 ? new Promise<CheckResult>(resolve => { pass = resolve; }) : goodCheck(source)) });
    context.script(query('PASSES'));
    const { api, until } = context;
    const sending = api.chat.send({ chatId: null, text: 'x', source: '' });
    await until(() => n === 2, 'the re-check');
    const chatId = (await api.chat.list())[0]!.id;
    const stopping = api.chat.stop({ id: chatId });
    pass(goodCheck('PASSES'));
    await stopping;
    expect(await sending).toMatchObject({ stopped: true });
    expect(kinds((await api.chat.get({ id: chatId }))!.turns)).toEqual(['user', 'note']);
  });

  it('stop when idle, on an unknown chat, and for another chat are no-ops; a double stop is too', async () => {
    const { api, script, seen, until } = await setup();
    script(query('Q1'), honours);
    expect(await api.chat.stop({ id: 'nope' })).toEqual({ stopped: false });
    const { chatId } = await api.chat.send({ chatId: null, text: 'x', source: '' });
    const before = await api.chat.get({ id: chatId! });
    expect(await api.chat.stop({ id: chatId! })).toEqual({ stopped: false });
    expect(await api.chat.get({ id: chatId! })).toEqual(before);

    const sending = api.chat.send({ chatId: null, text: 'other', source: '' });
    await until(() => seen.length === 2, 'the second chat');
    expect(await api.chat.stop({ id: chatId! })).toEqual({ stopped: false });
    const other = (await api.chat.list()).find(c => c.id !== chatId)!;
    const stops = await Promise.all([api.chat.stop({ id: other.id }), api.chat.stop({ id: other.id })]);
    expect(stops.filter(s => s.stopped)).toHaveLength(1);
    await sending;
    expect((await api.chat.get({ id: other.id }))!.turns.filter(t => t.kind === 'note')).toHaveLength(1);
    expect(await api.chat.get({ id: chatId! })).toEqual(before);
  });
});

describe('generating until the reply is recorded (F34)', () => {
  it('with the reply commit held open, reads keep saying generating until the reply is there', async () => {
    // Slow storage makes the gap between a finished run and its recorded reply wide enough to read in.
    let slow = false;
    const wrap = (storage: Storage): Storage => new Proxy(storage, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (key !== 'commit') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        return async (...args: Parameters<Storage['commit']>) => {
          if (slow) await new Promise(resolve => setTimeout(resolve, 40));
          return target.commit(...args);
        };
      },
    });
    const { api, script, seen, until } = await setup({ wrap });
    let release: (message: unknown) => void = () => {};
    script(() => new Promise(resolve => { release = resolve; }));
    let done = false;
    const sending = api.chat.send({ chatId: null, text: 'x', source: '' }).finally(() => { done = true; });
    await until(() => seen.length === 1, 'the request');
    const chatId = (await api.chat.list())[0]!.id;
    slow = true;
    release(query('Q1'));
    const reads: boolean[] = [];
    while (!done) {
      const detail = (await api.chat.get({ id: chatId }))!;
      reads.push(detail.generating);
      if (!detail.generating) expect(detail.turns.at(-1)).toMatchObject({ kind: 'version', n: 1 });
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    await sending;
    expect(reads.length).toBeGreaterThan(3);
    expect(reads[0]).toBe(true);
  });

  it('any read that sees generating false also sees the reply', async () => {
    for (const steps of [[query('Q1')], [say('text')]]) {
      const { api, script, until, seen } = await setup();
      script(...steps);
      let done = false;
      const sending = api.chat.send({ chatId: null, text: 'x', source: '' }).finally(() => { done = true; });
      await until(() => seen.length === 1, 'the request');
      const chatId = (await api.chat.list())[0]!.id;
      while (!done) {
        const detail = (await api.chat.get({ id: chatId }))!;
        if (!detail.generating) expect(detail.turns.at(-1)!.kind).not.toBe('user');
      }
      await sending;
    }
  });
});

describe('the run is not tied to the HTTP connection', () => {
  it('the sender goes away mid-run: the version is still recorded, and a second client sees generating until then', async () => {
    const { llm, script, seen, until, dir } = await setup();
    let release: (message: unknown) => void = () => {};
    script(() => new Promise(resolve => { release = resolve; }));
    const server = await startServer({ conn: {} as Connection, llm, dataDir: dir, port: 0, ui: 'none', packageRoot: '.' });
    try {
      const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${server.url}/trpc`, transformer: superjson })] });
      const leaving = new AbortController();
      const sent = client.chat.send.mutate({ chatId: null, text: 'x', source: '' }, { signal: leaving.signal }).catch((error: unknown) => error);
      await until(() => seen.length === 1, 'the request');
      const chatId = (await client.chat.list.query())[0]!.id;
      leaving.abort();
      expect(await sent).toBeInstanceOf(Error);
      expect((await client.chat.get.query({ id: chatId }))!.generating).toBe(true);
      release(query('AFTER_LEAVING'));
      const deadline = Date.now() + 5_000;
      let detail = await client.chat.get.query({ id: chatId });
      while (detail!.generating && Date.now() < deadline) detail = await client.chat.get.query({ id: chatId });
      expect(detail!.generating).toBe(false);
      expect(detail!.turns.at(-1)).toMatchObject({ kind: 'version', n: 1, source: 'AFTER_LEAVING' });
    } finally { await server.close(); }
  });
});

describe('F28, F29, F30, F32, F33', () => {
  it('F28: a re-check that never returns gives an error turn, no version, and frees the guard', async () => {
    let n = 0;
    const { api, script } = await setup({ timeoutMs: 100, check: source => (++n === 2 ? new Promise<CheckResult>(() => undefined) : goodCheck(source)) });
    script(query('Q1'), query('Q2'));
    const sent = await api.chat.send({ chatId: null, text: 'x', source: '' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', source: 'Q1', error: expect.stringMatching(/final check/) } });
    expect(await api.chat.send({ chatId: sent.chatId, text: 'y', source: '' })).toMatchObject({ ok: true, turn: { n: 1, source: 'Q2' } });
  });

  it('F29: titles and summaries never end in half an emoji, with the limits unchanged', async () => {
    const { api, script } = await setup();
    script(query('Q1', `${'s'.repeat(199)}😀 tail`), query('Q2', `${'s'.repeat(201)}`));
    const first = await api.chat.send({ chatId: null, text: `${'x'.repeat(79)}😀 tail`, source: '' });
    const [chat] = await api.chat.list();
    expect(chat!.title).toBe('x'.repeat(79));
    expect(first).toMatchObject({ turn: { summary: 's'.repeat(199) } });
    expect(await api.chat.send({ chatId: first.chatId, text: 'y', source: 'Q1' })).toMatchObject({ turn: { summary: 's'.repeat(200) } });
  });

  it('F30: prefix and suffix are trimmed, above the limit it is all removed and all added, and it stays a true diff', () => {
    expect(diffLines('a\nb\nc\nd', 'a\nB\nc\nd')).toEqual({ changes: [{ type: 'remove', text: 'b' }, { type: 'add', text: 'B' }], addedLines: [1] });
    const lines = (word: string, count: number) => Array.from({ length: count }, (_, i) => `${word}${i}`);
    const before = ['same', ...lines('a', 3_000), 'end'], after = ['same', ...lines('b', 3_000), 'end'];
    const { changes, addedLines } = diffLines(before.join('\n'), after.join('\n'));
    expect(changes).toHaveLength(6_000);
    expect(changes.slice(0, 3_000).every(c => c.type === 'remove')).toBe(true);
    expect(addedLines[0]).toBe(1);
    expect(addedLines.at(-1)).toBe(3_000);
  });

  it('F30: 32,000 x 32,000 one-character lines finish quickly in a small heap', () => {
    const script = `
      import { diffLines } from './server/chat.ts';
      const a = Array.from({ length: 32000 }, () => 'a').join('\\n');
      const b = Array.from({ length: 32000 }, () => 'b').join('\\n');
      const started = performance.now();
      const { changes } = diffLines(a, b);
      console.log(JSON.stringify({ changes: changes.length, ms: performance.now() - started }));
    `;
    const child = spawnSync(process.execPath, ['--no-warnings', '--max-old-space-size=64', '--import', 'tsx', '--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 25_000 });
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    const { changes, ms } = JSON.parse(child.stdout) as { changes: number; ms: number };
    expect(changes).toBe(64_000);
    expect(ms).toBeLessThan(1_000);
  });

  it('F30: a model source over the editor limit is a failed check fed back, and never reaches the editor', async () => {
    const long = `export default ${'x'.repeat(MAX_SOURCE)}`;
    const { api, script, seen } = await setup();
    script(query(long), query('SHORT'));
    expect(await api.chat.send({ chatId: null, text: 'x', source: '' })).toMatchObject({ ok: true, turn: { source: 'SHORT', attempts: 2 } });
    expect(dump(seen[1]!)).toContain('at most 64000');
  });

  it('F30: exactly at the limit is accepted', async () => {
    const atLimit = 'x'.repeat(MAX_SOURCE);
    const { api, script } = await setup();
    script(query(atLimit));
    expect(await api.chat.send({ chatId: null, text: 'x', source: '' })).toMatchObject({ ok: true, turn: { source: atLimit } });
  });

  it('F32: an emptied editor is said out loud, on every turn, and whitespace counts as empty', async () => {
    const { api, script, seen } = await setup();
    script(query('Q1'), query('Q2'), query('Q3'));
    const lastUser = (request: Request) => JSON.stringify(request.messages.filter(m => m.role === 'user').at(-1)!.content);
    const { chatId } = await api.chat.send({ chatId: null, text: 'first', source: '' });
    expect(lastUser(seen[0]!)).toContain('The editor currently contains nothing.');
    await api.chat.send({ chatId, text: 'emptied', source: '' });
    expect(lastUser(seen[1]!)).toContain('The editor currently contains nothing.');
    await api.chat.send({ chatId, text: 'spaces', source: ' \n ' });
    expect(lastUser(seen[2]!)).toContain('The editor currently contains nothing.');
    // The thread keeps what was typed.
    expect((await api.chat.get({ id: chatId! }))!.turns.at(-2)).toMatchObject({ text: 'spaces', source: ' \n ' });
  });

  it('F33: a changed line lists its removal first, and addedLines stay right', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nC\nc')).toEqual({ changes: [{ type: 'remove', text: 'b' }, { type: 'add', text: 'B' }, { type: 'add', text: 'C' }], addedLines: [1, 2] });
    expect(diffLines('x', 'y')).toEqual({ changes: [{ type: 'remove', text: 'x' }, { type: 'add', text: 'y' }], addedLines: [0] });
  });
});

describe('charts in chat', () => {
  it('a valid spec is a version with chart, and the query unchanged', async () => {
    const { api, script } = await setup();
    script(query('Q1'), chart({ spec, summary: 'Bar of revenue.' }));
    const { chatId } = await api.chat.send({ chatId: null, text: 'q', source: '' });
    const sent = await api.chat.send({ chatId, text: 'bar chart', source: 'Q1' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', n: 2, summary: 'Bar of revenue.', source: 'Q1', changes: [], addedLines: [], chart: { mark: 'bar', data: { name: 'table' } } } });
  });

  it('is validated against the sent source, with no prior run, including a hand edit', async () => {
    const checks: string[] = [];
    const { api, script } = await setup({ check: source => { checks.push(source); return goodCheck(source); } });
    script(chart({ spec }));
    expect(await api.chat.send({ chatId: null, text: 'chart', source: 'HAND_EDITED' })).toMatchObject({ ok: true, turn: { n: 1, source: 'HAND_EDITED', summary: 'Charted the result.' } });
    // A source the server hasn't seen: once for the columns in the message, once by check_chart, once as the re-check. Never any other source.
    expect(checks).toEqual(['HAND_EDITED', 'HAND_EDITED', 'HAND_EDITED']);
  });

  it('an unknown field is fed back with the real columns of that source', async () => {
    const { api, script, seen } = await setup();
    script(chart({ spec: { mark: 'bar', encoding: { x: { field: 'nope' } } } }), chart({ spec }));
    expect(await api.chat.send({ chatId: null, text: 'chart', source: 'Q1' })).toMatchObject({ ok: true, turn: { attempts: 2, chart: { mark: 'bar' } } });
    expect(dump(seen[1]!)).toMatch(/Unknown field\(s\): nope.*country \(String\)/);
  });

  it('with source: both parts are checked, a fault in either is fed back, and the version has the new query and diff', async () => {
    const { api, script, seen } = await setup();
    script(chart({ spec, source: 'BAD_Q' }), chart({ spec: { mark: 'bar', encoding: { x: { field: 'nope' } } }, source: 'NEW_Q' }), chart({ spec, source: 'NEW_Q', summary: 'Changed both.' }));
    const sent = await api.chat.send({ chatId: null, text: 'chart', source: 'OLD_Q' });
    expect(sent).toMatchObject({ ok: true, turn: { source: 'NEW_Q', attempts: 3, summary: 'Changed both.', changes: [{ type: 'remove', text: 'OLD_Q' }, { type: 'add', text: 'NEW_Q' }], chart: { mark: 'bar' } } });
    expect(dump(seen[1]!)).toContain('refused BAD_Q');
    expect(dump(seen[2]!)).toContain('Unknown field');
  });

  it('with source, the spec is checked against that source, not the sent one', async () => {
    const check = (source: string): CheckResult => (source === 'NEW_Q' ? { ok: true, sql: 'S', rowType: 'R', columns: [{ name: 'only_new', type: 'String' }] } : goodCheck(source));
    const { api, script } = await setup({ check, maxTurns: 2 });
    script(chart({ spec, source: 'NEW_Q' }), chart({ spec: { mark: 'bar', encoding: { x: { field: 'only_new' } } }, source: 'NEW_Q' }));
    expect(await api.chat.send({ chatId: null, text: 'chart', source: 'OLD_Q' })).toMatchObject({ ok: true, turn: { attempts: 2, source: 'NEW_Q' } });
  });

  it.each([
    ['inlined data', { ...spec, data: { values: [{ country: 'DE', revenue: 1 }] } }],
    ['a url', { ...spec, data: { url: 'http://example.com' } }],
    ['nested data', { layer: [{ ...spec, data: { values: [] } }] }],
    ['unknown fields', { mark: 'bar', encoding: { x: { field: 'nope' } } }],
    ['a JSON string with inlined data', JSON.stringify({ ...spec, data: { values: [] } })],
    ['datasets', { ...spec, datasets: { a: [] } }],
  ])('refuses %s, with an error turn, no version and the last attempt unmarked', async (_name, bad) => {
    const { api, script } = await setup({ maxTurns: 2 });
    script(chart({ spec: bad }), chart({ spec: bad }));
    const sent = await api.chat.send({ chatId: null, text: 'chart', source: 'Q1' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', error: expect.stringMatching(/No valid chart after 2 attempts/), attempts: 2 } });
    expect((await api.chat.get({ id: sent.chatId! }))!.turns.some(t => t.kind === 'version')).toBe(false);
  });

  it('claiming success in prose after a refused chart is an error turn', async () => {
    const { api, script } = await setup();
    script(chart({ spec: { ...spec, data: { values: [] } } }), say('check_chart said OK.'));
    expect(await api.chat.send({ chatId: null, text: 'chart', source: 'Q1' })).toMatchObject({ ok: false, turn: { kind: 'error' } });
  });

  it('a chart on an empty editor without source is refused and fed back', async () => {
    const { api, script, seen } = await setup();
    script(chart({ spec }), chart({ spec, source: 'NEW_Q' }));
    expect(await api.chat.send({ chatId: null, text: 'chart', source: '' })).toMatchObject({ ok: true, turn: { source: 'NEW_Q', attempts: 2 } });
    expect(dump(seen[1]!)).toContain('no columns to chart');
  });

  it('a chart that fails the re-check is no version', async () => {
    let n = 0;
    const check = (source: string): CheckResult => (++n === 2 ? { ok: true, sql: 'S', rowType: 'R', columns: [{ name: 'other', type: 'String' }] } : goodCheck(source));
    const { api, script } = await setup({ check });
    script(chart({ spec }));
    const sent = await api.chat.send({ chatId: null, text: 'chart', source: 'Q1' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', error: expect.stringMatching(/Unknown field/) } });
  });

  it('a chart and a query share one conversation: each sees the other, and the numbering carries on', async () => {
    const { api, script, seen } = await setup();
    script(query('SOURCE_V1'), chart({ spec: { ...spec, title: 'CHART_TITLE' } }), query('SOURCE_V3'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'query', source: '' });
    const conversation = (await api.chat.list())[0]!.conversationId;
    await api.chat.send({ chatId, text: 'chart', source: 'SOURCE_V1' });
    expect(dump(seen[1]!)).toContain('SOURCE_V1');
    expect(await api.chat.send({ chatId, text: 'query again', source: 'SOURCE_V1' })).toMatchObject({ turn: { n: 3, source: 'SOURCE_V3' } });
    expect(dump(seen[2]!)).toContain('CHART_TITLE');
    expect((await api.chat.list())[0]!.conversationId).toBe(conversation);
  });

  it('sample rows reach the model, capped, and the thread does not hold them', async () => {
    const { api, script, seen } = await setup();
    script(chart({ spec }));
    const sample = Array.from({ length: 30 }, (_, i) => ({ country: `C${i}`, revenue: BigInt(i) }));
    const { chatId } = await api.chat.send({ chatId: null, text: 'chart', source: 'Q1', sample });
    const message = JSON.stringify(seen[0]!.messages.filter(m => m.role === 'user').at(-1)!.content);
    expect(message).toContain('C19');
    expect(message).not.toContain('C20');
    expect(JSON.stringify((await api.chat.get({ id: chatId! }))!.turns)).not.toContain('C19');
  });

  it('a stop during a chart run leaves no version', async () => {
    const context = await setup();
    context.script(honours);
    const sending = context.api.chat.send({ chatId: null, text: 'chart', source: 'Q1' });
    await context.until(() => context.seen.length === 1, 'the request');
    const chatId = (await context.api.chat.list())[0]!.id;
    await context.api.chat.stop({ id: chatId });
    expect(await sending).toMatchObject({ stopped: true });
  });
});

describe('chat.note', () => {
  it('is in the thread, not in what the model sees, and is refused while generating', async () => {
    const { api, script, seen, until } = await setup();
    script(query('Q1'), honours, query('Q2'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'x', source: '' });
    expect(await api.chat.note({ id: chatId!, text: 'NOTE_SENTINEL' })).toMatchObject({ ok: true, turn: { kind: 'note', text: 'NOTE_SENTINEL' } });
    const sending = api.chat.send({ chatId, text: 'y', source: 'Q1' });
    await until(() => seen.length === 2, 'the request');
    expect(await api.chat.note({ id: chatId!, text: 'z' })).toMatchObject({ ok: false, error: expect.stringMatching(/generating/) });
    await api.chat.stop({ id: chatId! });
    await sending;
    expect(dump(seen[1]!)).not.toContain('NOTE_SENTINEL');
    expect(await api.chat.note({ id: 'nope', text: 'z' })).toMatchObject({ ok: false });
    await expect(api.chat.note({ id: chatId!, text: ' ' })).rejects.toThrow(/Expected/);
  });
});
