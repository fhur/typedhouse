// Tester (S10): independent probes of the chat server against R13 and the S10 acceptance criteria. Faux provider, real SQLite.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai';
import { DatabaseSync } from 'node:sqlite';
import { chatExtension, diffLines, type ChatTurn } from '../server/chat.js';
import type { Connection } from '../server/clickhouse.js';
import { createLlm, openStorage, unavailableLlm, type CheckResult, type Llm } from '../server/llm.js';
import { createRouter } from '../server/server.js';

type Message = { role: string; content: unknown; toolCallId?: string };
type Request = { messages: Message[]; model?: string };
/** The system prompt: pi-durable sends it as system messages. */
const system = ({ messages }: Request) => JSON.stringify(messages.filter(m => m.role === 'system'));
const dirs: string[] = [];
const open: Llm[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(l => l.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A source is good unless it says BAD; the SQL is derived, so a test can see which source it came from.
const goodCheck = (source: string): CheckResult => (source.includes('BAD') ? { ok: false, stage: 'compile', message: `refused ${source}` } : { ok: true, sql: `SELECT /* ${source.length} */ 1`, rowType: '{ n: number }' });
const call = (source: string, summary?: string) => fauxToolCall('check_query', { source, ...(summary === undefined ? {} : { summary }) });
const round = (...calls: ReturnType<typeof call>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' });
const say = (value: string) => fauxAssistantMessage([fauxText(value)]);

async function setup(options: { check?: (source: string) => CheckResult | Promise<CheckResult>; maxTurns?: number; timeoutMs?: number; abortGraceMs?: number; dir?: string; contextWindow?: number } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'studio-chat-tester-'));
  if (!options.dir) dirs.push(dir);
  const faux = fauxProvider({ models: [{ id: 'faux-a', ...(options.contextWindow ? { contextWindow: options.contextWindow, maxTokens: 1000 } : {}) }, { id: 'faux-b' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const llm = await createLlm({
    models, model: { provider: faux.provider.id, modelId: 'faux-a' }, schema: () => 'declare const events: unknown;\n', check: options.check ?? goodCheck, storage: await openStorage(dir),
    ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.abortGraceMs ? { abortGraceMs: options.abortGraceMs } : {}),
  });
  open.push(llm);
  const seen: Request[] = [];
  const wrap = (step: unknown) => (ctx: Request, opts: unknown, state: unknown, model?: { id: string }) => {
    seen.push({ ...JSON.parse(JSON.stringify(ctx)) as Request, ...(model ? { model: model.id } : {}) });
    return typeof step === 'function' ? (step as (...a: unknown[]) => unknown)(ctx, opts, state, model) : step;
  };
  const script = (...steps: unknown[]) => faux.setResponses(steps.map(wrap) as never);
  const api = createRouter({} as Connection, llm).createCaller({});
  return { api, llm, faux, script, seen, dir };
}

/** What every provider demands: each assistant tool call is answered right after it, every tool result answers a call. */
function assertWellFormed(request: Request) {
  const pending: string[] = [];
  for (const message of request.messages) {
    if (message.role === 'assistant') {
      expect(pending, 'tool calls left unanswered before an assistant message').toEqual([]);
      for (const block of message.content as { type: string; id: string; name: string; arguments: unknown }[]) {
        if (block.type === 'toolCall') { pending.push(block.id); expect(block.arguments).toBeTypeOf('object'); }
      }
    } else if (message.role === 'toolResult') {
      expect(pending, 'tool result without its call').toContain(message.toolCallId);
      pending.splice(pending.indexOf(message.toolCallId!), 1);
    } else {
      expect(pending, 'tool calls left unanswered before a user message').toEqual([]);
    }
  }
  expect(pending, 'tool calls left unanswered at the end').toEqual([]);
}
const users = (request: Request) => request.messages.filter(m => m.role === 'user').map(m => JSON.stringify(m.content));
const versions = (turns: ChatTurn[]) => turns.flatMap(t => (t.kind === 'version' ? [t.n] : []));

describe('conversation continuity, raw ctx.messages', () => {
  it('every earlier prompt and every message\'s own source reach the model, in order, across versions, text, failures and a hand edit', async () => {
    const { api, script, seen } = await setup({ maxTurns: 2 });
    script(
      round(call('Q1')),
      say('REPLY_TEXT'),
      round(call('BAD_1')), round(call('BAD_2')),
      round(call('Q2')),
      round(call('Q3')),
    );
    const { chatId } = await api.chat.send({ chatId: null, text: 'P1', source: 'S0_EDITOR' });
    await api.chat.send({ chatId, text: 'P2', source: 'Q1' });
    await api.chat.send({ chatId, text: 'P3', source: 'Q1' });
    await api.chat.send({ chatId, text: 'P4', source: 'Q1 HAND_EDIT' });
    await api.chat.send({ chatId, text: 'P5', source: 'Q2 ' });
    const last = seen.at(-1)!;
    const u = users(last);
    expect(u).toHaveLength(5);
    expect(u[0]).toContain('P1'); expect(u[0]).toContain('S0_EDITOR');
    expect(u[1]).toContain('P2'); expect(u[1]).toContain('Q1');
    expect(u[2]).toContain('P3');
    expect(u[3]).toContain('P4'); expect(u[3]).toContain('Q1 HAND_EDIT');
    expect(u[4]).toContain('P5'); expect(u[4]).toContain('Q2 ');
    const all = JSON.stringify(last.messages);
    for (const word of ['REPLY_TEXT', 'BAD_1', 'BAD_2', 'refused BAD_2']) expect(all).toContain(word);
    for (const request of seen) assertWellFormed(request);
  });

  it('stored replies and notes are not in what the model sees, the thread text has no editor source', async () => {
    const { api, script, seen } = await setup();
    script(round(call('Q1', 'SUMMARY_SENTINEL')), say('x'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'P1', source: 'EDITOR_SENTINEL' });
    await api.chat.send({ chatId, text: 'P2', source: 'Q1' });
    const detail = await api.chat.get({ id: chatId! });
    expect(detail!.turns[0]).toMatchObject({ kind: 'user', text: 'P1', source: 'EDITOR_SENTINEL' });
    // The model's own tool argument is legitimately in the history; the stored reply data (SQL, elapsedMs, changes) is not.
    expect(JSON.stringify(seen[1]!.messages)).not.toContain('elapsedMs');
    expect(JSON.stringify(seen[1]!.messages)).not.toContain('addedLines');
  });

  it('the chat prompt allows text replies and charts, and a chat offers its own two tools only', async () => {
    const { api, script, seen, dir, llm } = await setup();
    script(say('x'), round(fauxToolCall('generate_query', {})), say('y'));
    await api.chat.send({ chatId: null, text: 'P1', source: '' });
    expect(system(seen[0]!)).toContain('reply in plain text');
    expect(system(seen[0]!)).not.toContain('Always call the check_query');
    // Charts live in the chat (R13.6), with the chat's own rule.
    expect(system(seen[0]!)).toContain('Vega-Lite');
    expect(system(seen[0]!)).toContain('never set \\"data\\"');
    expect(system(seen[0]!)).not.toContain('Always call check_chart');
    expect(system(seen[0]!)).toContain('declare const events');
    // "Own tools" means something: the extension has exactly the two chat tools, a chat is stored with that extension alone, and anything else is refused.
    const extension = chatExtension({ guide: '', schema: () => '', check: goodCheck });
    expect(extension.tools!.map(tool => tool.name)).toEqual(['check_query', 'check_chart']);
    const [chat] = await api.chat.list();
    const sent = await api.chat.send({ chatId: chat!.id, text: 'P2', source: '' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'text', text: 'y', attempts: 0 } });
    expect(JSON.stringify(seen[2]!.messages)).toMatch(/generate_query.*not found|Tool .*generate_query/i);
    await llm.close();
    const db = new DatabaseSync(join(dir, 'pi.sqlite'), { readOnly: true });
    const agent = db.prepare(`select content from document_revisions r join documents d on d.id = r.document_id where d.kind = '"pi.agent"' and d.owner_id = ?`).get(chat!.conversationId) as { content: string };
    db.close();
    expect((JSON.parse(agent.content) as { extensions: string[] }).extensions).toEqual(['typedhouse-chat']);
  });

  it('a failed run leaves a history a next request can use', async () => {
    const { api, script, seen } = await setup({ maxTurns: 2 });
    script(round(call('BAD_1')), round(call('BAD_2')), round(call('Q1')));
    const failed = await api.chat.send({ chatId: null, text: 'P1', source: '' });
    expect(failed.ok).toBe(false);
    await api.chat.send({ chatId: failed.chatId, text: 'P2', source: '' });
    for (const request of seen) assertWellFormed(request);
  });

  it('a provider error leaves a history a next request can use', async () => {
    const { api, script, seen } = await setup();
    script(fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'quota exceeded' }), round(call('Q1')));
    const failed = await api.chat.send({ chatId: null, text: 'P1', source: '' });
    expect(failed.ok).toBe(false);
    expect(await api.chat.send({ chatId: failed.chatId, text: 'P2', source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    assertWellFormed(seen.at(-1)!);
    expect(JSON.stringify(seen.at(-1)!.messages)).toContain('P1');
  });
});

describe('version numbering and changed lines', () => {
  it('numbers count versions only: failures, text and identical sources take no number', async () => {
    const { api, script } = await setup({ maxTurns: 1 });
    script(round(call('A')), round(call('BAD')), say('hello'), round(call('A')), round(call('B')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(await api.chat.send({ chatId, text: 'p', source: 'A' })).toMatchObject({ ok: false, turn: { kind: 'error' } });
    expect(await api.chat.send({ chatId, text: 'p', source: 'A' })).toMatchObject({ ok: true, turn: { kind: 'text' } });
    expect(await api.chat.send({ chatId, text: 'p', source: 'A' })).toMatchObject({ ok: true, turn: { kind: 'text' } });
    expect(await api.chat.send({ chatId, text: 'p', source: 'A' })).toMatchObject({ ok: true, turn: { kind: 'version', n: 2, source: 'B' } });
    expect(versions((await api.chat.get({ id: chatId! }))!.turns)).toEqual([1, 2]);
  });

  it('a comment-only and an inner-whitespace change are real changes with real lines; the sent source is the base', async () => {
    const { api, script } = await setup();
    script(round(call('a\n// note\nb')), round(call('a\n  // note\nb')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: 'a\nb' });
    expect(await api.chat.send({ chatId, text: 'p', source: 'a\n// note\nb' })).toMatchObject({ ok: true, turn: { n: 2 } });
    const turns = (await api.chat.get({ id: chatId! }))!.turns.filter(t => t.kind === 'version');
    expect(turns[0]).toMatchObject({ changes: [{ type: 'add', text: '// note' }], addedLines: [1] });
    expect(turns[1]!.kind === 'version' && turns[1]!.changes).toEqual(expect.arrayContaining([{ type: 'remove', text: '// note' }, { type: 'add', text: '  // note' }]));
  });

  it('changed lines are against the hand-edited source that was sent, not against the previous version', async () => {
    const { api, script } = await setup();
    script(round(call('a\nb')), round(call('a\nHAND\nb\nNEW')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    const sent = await api.chat.send({ chatId, text: 'p', source: 'a\nHAND\nb' });
    expect(sent).toMatchObject({ ok: true, turn: { n: 2, changes: [{ type: 'add', text: 'NEW' }], addedLines: [3] } });
  });

  it('the model returning the previous version over a hand edit is a change', async () => {
    const { api, script } = await setup();
    script(round(call('a')), round(call('a')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(await api.chat.send({ chatId, text: 'undo my edit', source: 'a // mine' })).toMatchObject({ ok: true, turn: { kind: 'version', n: 2, changes: expect.arrayContaining([{ type: 'remove', text: 'a // mine' }, { type: 'add', text: 'a' }]) } });
  });

  it('diffLines is a true diff: replaying it gives both sides (random inputs)', () => {
    let seed = 42;
    const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let round = 0; round < 500; round++) {
      const lines = () => Array.from({ length: next(9) }, () => 'abc'[next(3)]!);
      const a = lines(), b = lines();
      const before = a.join('\n'), after = b.join('\n');
      const { changes, addedLines } = diffLines(before, after);
      // Every added line is where addedLines says.
      const adds = changes.filter(c => c.type === 'add');
      expect(adds.map(c => c.text)).toEqual(addedLines.map(i => b[i]));
      // Removing the removed lines from `a` and the added ones from `b` leaves the same common subsequence.
      const beforeLines = before === '' ? [] : a, afterLines = after === '' ? [] : b;
      const addedSet = new Set(addedLines);
      const kept = afterLines.filter((_, i) => !addedSet.has(i));
      const removed = changes.filter(c => c.type === 'remove').map(c => c.text);
      const left = [...beforeLines];
      let at = 0;
      for (const line of removed) { while (left[at] !== line) at++; left.splice(at, 1); }
      // Removing greedily can only pick a different equal line, so compare multisets plus minimality below.
      expect([...left].sort()).toEqual([...kept].sort());
    }
  });

  it('diffLines stays usable on the largest source the server accepts', () => {
    // MAX_EDITOR_SOURCE is 64 000 characters: 32 000 one-character lines. The model's source has no limit.
    const size = 8_000;
    const a = Array.from({ length: size }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: size }, (_, i) => `b${i}`).join('\n');
    const started = performance.now();
    expect(diffLines(a, b).changes).toHaveLength(size * 2);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 60_000);
});

describe('only checked source becomes a version, from this run only', () => {
  it('passes, fails in the same round, then gives up: an error with the failed attempt, no version', async () => {
    const { api, script, seen } = await setup();
    script(round(call('GOOD'), call('BAD')), say('I give up'));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: 'START' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', source: 'BAD', attempts: 2 } });
    expect(versions((await api.chat.get({ id: sent.chatId! }))!.turns)).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it('fails then passes in one round: the passing one is the version', async () => {
    const { api, script } = await setup();
    script(round(call('BAD'), call('GOOD', 'the good one')));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', source: 'GOOD', summary: 'the good one', attempts: 2 } });
  });

  it('passes twice in one round: the last wins and it is what was checked', async () => {
    const checked: string[] = [];
    const { api, script } = await setup({ check: source => { checked.push(source); return goodCheck(source); } });
    script(round(call('FIRST', 'one'), call('SECOND', 'two')));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', n: 1, source: 'SECOND', summary: 'two', attempts: 2 } });
    expect(checked).toEqual(['FIRST', 'SECOND', 'SECOND']);
  });

  it('a check from an earlier run never counts: v1, then the model only claims success in prose', async () => {
    const { api, script } = await setup();
    script(round(call('Q1')), say('OK. Row type: { n: number }\nSQL:\nSELECT 1'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(await api.chat.send({ chatId, text: 'p', source: 'Q1' })).toMatchObject({ ok: true, turn: { kind: 'text', attempts: 0 } });
    expect(versions((await api.chat.get({ id: chatId! }))!.turns)).toEqual([1]);
  });

  it('reusing an earlier run\'s tool call id cannot pull in its source', async () => {
    const { api, script } = await setup();
    script(round(fauxToolCall('check_query', { source: 'Q1' }, { id: 'same' })), round(fauxToolCall('check_query', { source: 'BAD' }, { id: 'same' })), say('done'));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(await api.chat.send({ chatId, text: 'p', source: 'Q1' })).toMatchObject({ ok: false, turn: { kind: 'error', source: 'BAD', attempts: 1 } });
    expect(versions((await api.chat.get({ id: chatId! }))!.turns)).toEqual([1]);
  });

  it('a call with a wrong argument type is no attempt to accept', async () => {
    const { api, script } = await setup({ maxTurns: 2 });
    script(round(fauxToolCall('check_query', { source: 123 } as never)), say('sorry'));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error' } });
    expect(versions((await api.chat.get({ id: sent.chatId! }))!.turns)).toEqual([]);
  });

  it('a call to a tool of another path or an unknown tool is no version', async () => {
    const { api, script } = await setup({ maxTurns: 3 });
    script(round(fauxToolCall('check_chart', { spec: { mark: 'bar' } } as never)), round(fauxToolCall('nope', {})), say('done'));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(versions((await api.chat.get({ id: sent.chatId! }))!.turns)).toEqual([]);
  });

  it('a check that throws is a refused attempt, and a re-check that throws leaves no version', async () => {
    const one = await setup({ maxTurns: 1, check: () => { throw new Error('checker exploded'); } });
    one.script(round(call('Q')));
    const sent = await one.api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error' } });
    let n = 0;
    const two = await setup({ check: source => { if (++n === 2) throw new Error('recheck exploded'); return goodCheck(source); } });
    two.script(round(call('Q')));
    const again = await two.api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(again).toMatchObject({ ok: false, turn: { kind: 'error' } });
    expect(versions((await two.api.chat.get({ id: again.chatId! }))!.turns)).toEqual([]);
    expect((await two.api.chat.list())[0]).toBeDefined();
  });

  it('a run timed out after a failed attempt keeps that attempt in the error turn', async () => {
    const { api, script } = await setup({ timeoutMs: 300 });
    const hang = (_c: unknown, options?: { signal?: AbortSignal }) => new Promise(resolve => {
      options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'aborted' })));
    });
    script(round(call('BAD_ATTEMPT')), hang);
    const sent = await api.chat.send({ chatId: null, text: 'p', source: '' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', error: expect.stringMatching(/timed out/), source: 'BAD_ATTEMPT', attempts: 1 } });
  });

  // F28.
  it('a re-check that never returns does not hang the send forever', async () => {
    let n = 0;
    const { api, script } = await setup({ timeoutMs: 300, abortGraceMs: 200, check: source => (++n === 2 ? new Promise<CheckResult>(() => undefined) : goodCheck(source)) });
    script(round(call('Q')), round(call('Q2')));
    const result = await Promise.race([api.chat.send({ chatId: null, text: 'p', source: '' }), new Promise<string>(resolve => setTimeout(() => resolve('HUNG'), 3_000))]);
    expect(result).not.toBe('HUNG');
    expect(result).toMatchObject({ ok: false, turn: { kind: 'error', source: 'Q' } });
    // No version, and the guard is free: the next send works.
    const { chatId } = result as { chatId: string };
    expect(versions((await api.chat.get({ id: chatId }))!.turns)).toEqual([]);
    expect(await api.chat.send({ chatId, text: 'again', source: '' })).toMatchObject({ ok: true, turn: { kind: 'version', n: 1, source: 'Q2' } });
  }, 10_000);
});

describe('text replies (R13.5)', () => {
  it('text is a normal turn, on every position; thinking is not shown', async () => {
    const { api, script } = await setup();
    script(fauxAssistantMessage([fauxThinking('SECRET_THOUGHT'), fauxText('Which table?')]), round(call('Q1')), say('It has one row.'));
    const first = await api.chat.send({ chatId: null, text: 'p', source: 'KEEP' });
    expect(first).toMatchObject({ ok: true, turn: { kind: 'text', text: 'Which table?', attempts: 0 } });
    expect(JSON.stringify(first)).not.toContain('SECRET_THOUGHT');
    expect(first.ok && 'source' in first.turn).toBe(false);
    await api.chat.send({ chatId: first.chatId, text: 'p', source: 'KEEP' });
    const third = await api.chat.send({ chatId: first.chatId, text: 'p', source: 'Q1' });
    expect(third).toMatchObject({ ok: true, turn: { kind: 'text', text: 'It has one row.' } });
    expect(third.ok && 'source' in third.turn).toBe(false);
  });
  it('a passing check with the same source is ok-shaped, carries no source to apply and no version', async () => {
    const { api, script } = await setup();
    script(round(call(' SAME\n', 'nothing to do')));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: 'SAME' });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'text', text: 'nothing to do' } });
    expect(sent.ok && 'source' in sent.turn).toBe(false);
  });
});

describe('concurrency and bad input', () => {
  const gated = () => {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    return { gate, release: () => release() };
  };
  it('two sends at once in one chat: one runs, the other is refused and writes nothing', async () => {
    const { api, script, seen } = await setup();
    const { gate, release } = gated();
    script(round(call('Q1')), async () => { await gate; return round(call('Q2')); }, round(call('Q3')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p1', source: '' });
    const running = api.chat.send({ chatId, text: 'RUNNING', source: 'Q1' });
    await new Promise(resolve => setTimeout(resolve, 30));
    const refused = await api.chat.send({ chatId, text: 'REFUSED', source: 'Q1' });
    expect(refused).toEqual({ ok: false, chatId, error: 'A generation is already running.' });
    release();
    expect(await running).toMatchObject({ ok: true, turn: { n: 2 } });
    const detail = await api.chat.get({ id: chatId! });
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'version']);
    expect(JSON.stringify(detail)).not.toContain('REFUSED');
    await api.chat.send({ chatId, text: 'p3', source: 'Q2' });
    expect(JSON.stringify(seen.at(-1)!.messages)).not.toContain('REFUSED');
  });
  it('truly simultaneous sends, same tick: exactly one runs', async () => {
    const { api, script } = await setup();
    script(round(call('Q1')), round(call('Q2')));
    const results = await Promise.all([api.chat.send({ chatId: null, text: 'a', source: '' }), api.chat.send({ chatId: null, text: 'b', source: '' })]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await api.chat.list()).toHaveLength(1);
  });
  it('sends in two chats at once: one refused, the other chat untouched; a burst of 20 leaves consistent state', async () => {
    const { api, script } = await setup();
    script(...Array.from({ length: 30 }, (_, i) => round(call(`Q${i}`))));
    const a = await api.chat.send({ chatId: null, text: 'a', source: '' });
    const b = await api.chat.send({ chatId: null, text: 'b', source: '' });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => api.chat.send({ chatId: i % 2 ? a.chatId : b.chatId, text: `x${i}`, source: '' })));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    const turns = [...(await api.chat.get({ id: a.chatId! }))!.turns, ...(await api.chat.get({ id: b.chatId! }))!.turns];
    expect(turns.filter(t => t.kind === 'user')).toHaveLength(3);
  });
  it('reads work during a generation and show the user turn; a missing chat answers even then', async () => {
    const { api, script } = await setup();
    const { gate, release } = gated();
    script(async () => { await gate; return round(call('Q')); });
    const running = api.chat.send({ chatId: null, text: 'p', source: '' });
    await new Promise(resolve => setTimeout(resolve, 50));
    const [chat] = await api.chat.list();
    expect(await api.chat.get({ id: chat!.id })).toMatchObject({ generating: true, turns: [{ kind: 'user', text: 'p' }] });
    expect(await api.chat.get({ id: 'missing' })).toBeNull();
    release();
    await running;
  });
  it.each([
    ['empty id', ''], ['spaces', '   '], ['proto', '__proto__'], ['path', '../../etc/passwd'], ['sql', "x'; DROP TABLE entries; --"], ['nul', 'a\u0000b'], ['long', 'x'.repeat(100_000)], ['a number-like id', '1'],
  ])('a malformed chat id (%s) is a clear result and writes nothing', async (_name, id) => {
    const { api } = await setup();
    expect(await api.chat.get({ id })).toBeNull();
    expect(await api.chat.send({ chatId: id, text: 'x', source: '' })).toMatchObject({ ok: false, chatId: id, error: expect.stringContaining('Unknown chat') });
    expect(await api.chat.list()).toEqual([]);
  });
  it.each([
    ['number chat id', { chatId: 1, text: 'x', source: '' }], ['missing chat id', { text: 'x', source: '' }], ['object chat id', { chatId: {}, text: 'x', source: '' }],
    ['empty text', { chatId: null, text: '', source: '' }], ['blank text', { chatId: null, text: ' \n\t', source: '' }], ['text not a string', { chatId: null, text: 1, source: '' }], ['no source', { chatId: null, text: 'x' }],
    ['huge text', { chatId: null, text: 'x'.repeat(16_001), source: '' }], ['huge source', { chatId: null, text: 'x', source: 'x'.repeat(64_001) }], ['null', null], ['string', 'x'], ['array', []],
  ])('invalid input (%s) is refused before any work', async (_name, input) => {
    const { api, seen } = await setup();
    await expect(api.chat.send(input as never)).rejects.toThrow(/Expected/);
    expect(seen).toEqual([]);
    expect(await api.chat.list()).toEqual([]);
  });
  it('the largest allowed message and source go through intact, also after a reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-chat-tester-'));
    dirs.push(dir);
    const { api, llm, script, seen } = await setup({ dir });
    script(round(call('Q')));
    const text = 'x'.repeat(16_000), source = 'y'.repeat(64_000);
    const sent = await api.chat.send({ chatId: null, text, source });
    expect(sent).toMatchObject({ ok: true });
    expect(JSON.stringify(seen[0]!.messages)).toContain(source);
    await llm.close();
    const next = await setup({ dir });
    expect(await next.api.chat.get({ id: sent.chatId! })).toMatchObject({ turns: [{ text, source }, { kind: 'version' }] });
  });
  it('odd text survives storage: emoji cut at the title limit, newlines first, control characters, a lone surrogate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-chat-tester-'));
    dirs.push(dir);
    const { api, llm, script } = await setup({ dir });
    script(say('a'), say('b'), say('c'));
    const emoji = `${'x'.repeat(79)}😀 tail`;
    const a = await api.chat.send({ chatId: null, text: emoji, source: '' });
    expect(a.ok).toBe(true);
    const b = await api.chat.send({ chatId: null, text: '\n\n  second line first  \nmore', source: '' });
    expect((await api.chat.list()).find(c => c.id === b.chatId)!.title).toBe('second line first');
    const c = await api.chat.send({ chatId: null, text: 'nul\u0000 and \ud83d lone', source: 'src\u0000' });
    expect(c.ok).toBe(true);
    const before = await api.chat.list();
    await llm.close();
    const next = await setup({ dir });
    expect(await next.api.chat.list()).toEqual(before);
    expect((await next.api.chat.get({ id: a.chatId! }))!.turns[0]).toMatchObject({ text: emoji });
  });
});

describe('late and slow work', () => {
  it('a provider that answers after the timeout: no version appears, the error turn stands, and the chat continues well-formed', async () => {
    const { api, script, seen } = await setup({ timeoutMs: 100, abortGraceMs: 50 });
    script(() => new Promise(resolve => setTimeout(() => resolve(round(call('LATE_PASSING'))), 400)), round(call('Q2')));
    const sent = await api.chat.send({ chatId: null, text: 'p', source: 'START' });
    expect(sent).toMatchObject({ ok: false, turn: { kind: 'error', error: expect.stringMatching(/timed out/) } });
    await new Promise(resolve => setTimeout(resolve, 600));
    const detail = await api.chat.get({ id: sent.chatId! });
    expect(versions(detail!.turns)).toEqual([]);
    expect(detail!.generating).toBe(false);
    expect(await api.chat.send({ chatId: sent.chatId, text: 'again', source: 'START' })).toMatchObject({ ok: true, turn: { kind: 'version', n: 1, source: 'Q2', attempts: 1 } });
    assertWellFormed(seen.at(-1)!);
  });

  it('a send while a background compaction is still running works and is not told busy', async () => {
    const { api, faux } = await setup({ contextWindow: 24_000 });
    let slowSummaries = 0;
    const respond = async (ctx: Request) => {
      const lastUser = JSON.stringify(ctx.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
      if (!system(ctx).includes('You write TypedHouse queries')) {
        slowSummaries++;
        await new Promise(resolve => setTimeout(resolve, 1_500));
        return say('SUMMARY');
      }
      return round(call(`Q${/TURN(\d+)/.exec(lastUser)![1]}`));
    };
    faux.setResponses(Array.from({ length: 100 }, () => respond as never));
    let chatId: string | null = null;
    const pad = 'lorem ipsum '.repeat(1_200);
    const results: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const sent: Awaited<ReturnType<typeof api.chat.send>> = await api.chat.send({ chatId, text: `TURN${i} ${pad}`, source: '' });
      results.push(sent.ok ? sent.turn.kind : sent.error);
      chatId = sent.chatId;
    }
    expect(slowSummaries, 'a compaction ran').toBeGreaterThan(0);
    expect(results, JSON.stringify(results)).toEqual(Array.from({ length: 10 }, () => 'version'));
  }, 120_000);

  it('summaries: first line only, blank falls back, long is cut', async () => {
    const { api, script } = await setup();
    script(round(call('A', '\n  first line\nsecond line')), round(call('B', '   ')), round(call('C', 'y'.repeat(500))));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    await api.chat.send({ chatId, text: 'p', source: 'A' });
    await api.chat.send({ chatId, text: 'p', source: 'B' });
    const turns = (await api.chat.get({ id: chatId! }))!.turns.flatMap(t => (t.kind === 'version' ? [t.summary] : []));
    expect(turns[0]).toBe('first line');
    expect(turns[1]).toBe('Updated the query.');
    expect(turns[2]!.length).toBeLessThanOrEqual(200);
  });

  // F32.
  it('an empty editor on a later turn is reported to the model', async () => {
    const { api, script, seen } = await setup();
    script(round(call('Q1')), round(call('Q2')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'p', source: '' });
    await api.chat.send({ chatId, text: 'start over', source: '' });
    expect(users(seen[1]!).at(-1)).toContain('start over');
    expect(users(seen[1]!).at(-1)).toContain('The editor currently contains nothing.');
    // The source of turn 1 is history; the newest message must not offer one.
    expect(users(seen[1]!).at(-1)).not.toContain('```ts');
    expect((await api.chat.get({ id: chatId! }))!.turns.at(-1)).toMatchObject({ kind: 'version', n: 2, changes: [{ type: 'add', text: 'Q2' }] });
  });
});

describe('titles', () => {
  // F29.
  it('a title cut at the limit does not split an emoji', async () => {
    const { api, script } = await setup();
    script(say('a'));
    await api.chat.send({ chatId: null, text: `${'x'.repeat(79)}😀 tail`, source: '' });
    expect(((await api.chat.list())[0]!.title as string & { isWellFormed(): boolean }).isWellFormed()).toBe(true);
  });
});

describe('long chats', () => {
  it('more deltas than a checkpoint and more entries than a page: all turns, numbers, and history across a reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-chat-tester-'));
    dirs.push(dir);
    const { api, llm, script, seen } = await setup({ dir });
    const total = 180;
    script(...Array.from({ length: total }, (_, i) => round(call(`Q${i}`, `sum ${i}`))));
    let chatId: string | null = null;
    for (let i = 0; i < total; i++) {
      const sent: Awaited<ReturnType<typeof api.chat.send>> = await api.chat.send({ chatId, text: `P${i}`, source: i ? `Q${i - 1}` : '' });
      expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', n: i + 1, source: `Q${i}`, attempts: 1 } });
      chatId = sent.chatId;
    }
    expect(users(seen.at(-1)!)).toHaveLength(total);
    const before = await api.chat.get({ id: chatId! });
    expect(before!.turns).toHaveLength(total * 2);
    await llm.close();
    const next = await setup({ dir });
    expect(await next.api.chat.get({ id: chatId! })).toEqual(before);
    next.script(round(call('LAST')));
    expect(await next.api.chat.send({ chatId, text: 'LAST', source: `Q${total - 1}` })).toMatchObject({ turn: { n: total + 1, attempts: 1 } });
  }, 120_000);

  it('many chats keep the index right past a checkpoint, across a reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-chat-tester-'));
    dirs.push(dir);
    const { api, llm, script } = await setup({ dir });
    script(...Array.from({ length: 70 }, () => say('t')));
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) ids.push((await api.chat.send({ chatId: null, text: `chat ${i}`, source: '' })).chatId!);
    const before = await api.chat.list();
    expect(before).toHaveLength(70);
    await llm.close();
    const next = await setup({ dir });
    expect(await next.api.chat.list()).toEqual(before);
  }, 60_000);

  it('automatic compaction on a small context window: sends keep working, the thread keeps every turn, attempts stay right', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-chat-tester-'));
    dirs.push(dir);
    // The window must fit the guide, so this only compacts once the turns outgrow it.
    const { api, faux, seen } = await setup({ dir, contextWindow: 24_000 });
    const asked: Request[] = [];
    let summaries = 0;
    const respond = (ctx: Request) => {
      asked.push(JSON.parse(JSON.stringify(ctx)) as Request);
      const lastUser = JSON.stringify(ctx.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
      if (!system(ctx).includes('You write TypedHouse queries')) { summaries++; return say('SUMMARY OF THE EARLIER TURNS'); }
      return round(call(`Q${/TURN(\d+)/.exec(lastUser)![1]}`));
    };
    faux.setResponses(Array.from({ length: 200 }, () => respond as never));
    let chatId: string | null = null;
    const pad = 'lorem ipsum '.repeat(1_200);
    const results: unknown[] = [];
    for (let i = 0; i < 12; i++) {
      const sent: Awaited<ReturnType<typeof api.chat.send>> = await api.chat.send({ chatId, text: `TURN${i} ${pad}`, source: i ? `Q${i - 1}` : '' });
      results.push(sent.ok ? sent.turn.kind : sent.error);
      chatId = sent.chatId;
    }
    expect(results, JSON.stringify(results)).toEqual(Array.from({ length: 12 }, () => 'version'));
    expect(summaries, 'compaction ran').toBeGreaterThan(0);
    const detail = await api.chat.get({ id: chatId! });
    expect(detail!.turns.filter(t => t.kind === 'user')).toHaveLength(12);
    expect(versions(detail!.turns)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    for (const turn of detail!.turns) if (turn.kind === 'version') expect(turn.attempts).toBe(1);
    for (const request of asked) if (system(request).includes('You write TypedHouse queries')) assertWellFormed(request);
    // The model still has the newest turns and the summary stands in for the rest.
    const newest = asked.filter(request => system(request).includes('You write TypedHouse queries')).at(-1)!;
    expect(JSON.stringify(newest.messages)).toContain('TURN11');
    expect(JSON.stringify(newest.messages)).toContain('SUMMARY OF THE EARLIER TURNS');
    expect(seen).toEqual([]);
  }, 120_000);
});

describe('switch model on an existing chat', () => {
  it('each send uses the model selected at that moment; a refused selection changes nothing; the history stays', async () => {
    const { api, llm, faux, script, seen } = await setup();
    script(round(call('Q1')), round(call('Q2')), round(call('Q3')), round(call('Q4')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'P1', source: '' });
    await llm.selectModel({ provider: faux.provider.id, modelId: 'faux-b' });
    await api.chat.send({ chatId, text: 'P2', source: 'Q1' });
    expect(await llm.selectModel({ provider: faux.provider.id, modelId: 'nope' })).toMatchObject({ ok: false });
    await api.chat.send({ chatId, text: 'P3', source: 'Q2' });
    await llm.selectModel({ provider: faux.provider.id, modelId: 'faux-a' });
    await api.chat.send({ chatId, text: 'P4', source: 'Q3' });
    expect(seen.map(r => r.model)).toEqual(['faux-a', 'faux-b', 'faux-b', 'faux-a']);
    expect(users(seen[3]!)).toHaveLength(4);
    expect(system(seen[3]!)).toContain('reply in plain text');
    for (const request of seen) assertWellFormed(request);
    expect(versions((await api.chat.get({ id: chatId! }))!.turns)).toEqual([1, 2, 3, 4]);
  });
  it('a retry round inside a run still uses the new model after a switch (tools intact)', async () => {
    const { api, llm, faux, script, seen } = await setup();
    script(round(call('Q1')), round(call('BAD')), round(call('Q2')));
    const { chatId } = await api.chat.send({ chatId: null, text: 'P1', source: '' });
    await llm.selectModel({ provider: faux.provider.id, modelId: 'faux-b' });
    expect(await api.chat.send({ chatId, text: 'P2', source: 'Q1' })).toMatchObject({ ok: true, turn: { n: 2, attempts: 2 } });
    expect(seen.map(r => r.model)).toEqual(['faux-a', 'faux-b', 'faux-b']);
  });
});

describe('no LLM', () => {
  it('chat procedures answer clearly, validation still applies, and the rest of the router works', async () => {
    const api = createRouter({ tables: () => [], schemaError: () => null, label: 'x' } as unknown as Connection).createCaller({});
    expect(await api.chat.list()).toEqual([]);
    expect(await api.chat.get({ id: 'x' })).toBeNull();
    expect(await api.chat.send({ chatId: 'x', text: 'hi', source: 's' })).toEqual({ ok: false, chatId: 'x', error: 'LLM unavailable: not configured' });
    expect(await api.chat.send({ chatId: null, text: 'hi', source: '' })).toEqual({ ok: false, chatId: null, error: 'LLM unavailable: not configured' });
    await expect(api.chat.send({ chatId: null, text: '', source: '' })).rejects.toThrow(/Expected/);
    expect(await api.models.list()).toEqual({ models: [], reason: 'not configured' });
    expect(unavailableLlm('why').status).toEqual({ available: false, reason: 'why' });
  });
});
