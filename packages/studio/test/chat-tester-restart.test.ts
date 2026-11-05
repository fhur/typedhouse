// Tester (S10): real child processes on one data dir, killed at different moments. Every server here is a separate OS process.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import type { ChatDetail } from '../server/chat.js';
import type { AppRouter } from '../server/server.js';
import { cutOffOldGeneration } from './old-data.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const children = new Set<ChildProcess>();
const dirs: string[] = [];
afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-tester-restart-'));
  dirs.push(dir);
  return dir;
}
type Message = { role: string; content: unknown; toolCallId?: string };
type LogEntry = { type: 'open' } | { type: 'check'; source: string } | { type: 'request'; request: { messages: Message[] } };

function server(dataDir: string, env: Record<string, string> = {}) {
  const logPath = join(tempDir(), 'child.log');
  writeFileSync(logPath, '');
  const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/chat-tester-child.ts'], {
    cwd: packageRoot, env: { ...process.env, CHILD_DATA_DIR: dataDir, CHILD_LOG: logPath, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal }); }));
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const ready = new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); const match = /READY (\S+)/.exec(out); if (match) resolve(match[1]!); });
    void exited.then(() => reject(new Error(`child exited before READY: ${stderr}`)));
  });
  ready.catch(() => undefined);
  const log = () => readFileSync(logPath, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line) as LogEntry);
  const requests = () => log().flatMap(entry => (entry.type === 'request' ? [entry] : []));
  return {
    child, exited, log, requests, stderr: () => stderr, ready,
    async api() { return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${await ready}/trpc`, transformer: superjson })] }); },
    async until(condition: () => boolean, what: string) {
      const deadline = Date.now() + 15_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
    kill(signal: 'SIGTERM' | 'SIGKILL') { child.kill(signal); return exited; },
  };
}
const src = (source: string) => `src:${source}|`;
/** With TESTER_MATRIX set, records what a damaged file really did: no requirement fixes one exact answer. */
const note = (...parts: unknown[]) => { if (process.env['TESTER_MATRIX']) appendFileSync(process.env['TESTER_MATRIX'], `${parts.join(' ')}\n`); };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function assertWellFormed(messages: Message[]) {
  const pending: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      expect(pending, 'unanswered tool calls before an assistant message').toEqual([]);
      for (const block of message.content as { type: string; id: string }[]) if (block.type === 'toolCall') pending.push(block.id);
    } else if (message.role === 'toolResult') {
      expect(pending, 'tool result without its call').toContain(message.toolCallId);
      pending.splice(pending.indexOf(message.toolCallId!), 1);
    } else expect(pending, 'unanswered tool calls before a user message').toEqual([]);
  }
  expect(pending, 'unanswered tool calls at the end').toEqual([]);
}
/** After any cut-off: each user turn has exactly one reply or note, numbers are 1..n, nothing is generating. */
function assertConsistent(detail: ChatDetail | null) {
  expect(detail).not.toBeNull();
  expect(detail!.generating).toBe(false);
  const kinds = detail!.turns.map(t => t.kind);
  kinds.forEach((kind, i) => {
    if (kind === 'user') expect(['version', 'text', 'error', 'note'], JSON.stringify(kinds)).toContain(kinds[i + 1]);
    else expect(kinds[i - 1], JSON.stringify(kinds)).toBe('user');
  });
  const numbers = detail!.turns.flatMap(t => (t.kind === 'version' ? [t.n] : []));
  expect(numbers).toEqual(numbers.map((_, i) => i + 1));
}

describe('several restarts in a row', () => {
  it('four processes, alternating signals: each continues the same conversation with everything before it', { timeout: 120_000 }, async () => {
    const dataDir = tempDir();
    let chatId: string | null = null;
    let conversationId: number | undefined;
    const signals = ['SIGKILL', 'SIGTERM', 'SIGKILL', 'SIGTERM'] as const;
    let source = '';
    for (const [i, signal] of signals.entries()) {
      const s = server(dataDir);
      const api = await s.api();
      const sent: { ok: boolean; chatId: string | null } = await api.chat.send.mutate({ chatId, text: `PROMPT_${i} ${src(`SOURCE_${i}`)}`, source });
      expect(sent).toMatchObject({ ok: true, turn: { kind: 'version', n: i + 1 } });
      chatId = sent.chatId;
      source = `SOURCE_${i}`;
      const request = JSON.stringify(s.requests().at(-1)!.request.messages);
      for (let j = 0; j <= i; j++) expect(request).toContain(`PROMPT_${j}`);
      for (let j = 0; j < i; j++) expect(request).toContain(`SOURCE_${j}`);
      const [listed] = await api.chat.list.query();
      conversationId ??= listed!.conversationId;
      expect(listed!.conversationId).toBe(conversationId);
      await s.kill(signal);
    }
  });

  it('killed mid-generation in three processes in a row: one note per cut-off, the chat still works', { timeout: 120_000 }, async () => {
    const dataDir = tempDir();
    let chatId: string | null = null;
    for (let i = 0; i < 3; i++) {
      const s = server(dataDir);
      const api = await s.api();
      const send = api.chat.send.mutate({ chatId, text: `hang ${i}`, source: '' }).catch(() => undefined);
      await s.until(() => s.requests().length === 1, 'the request');
      chatId ??= (await api.chat.list.query())[0]!.id;
      await s.kill('SIGKILL');
      await send;
    }
    const s = server(dataDir);
    const api = await s.api();
    const detail = await api.chat.get.query({ id: chatId! });
    assertConsistent(detail);
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'note', 'user', 'note', 'user', 'note']);
    await sleep(300);
    expect(s.requests()).toHaveLength(0);
    expect(await api.chat.send.mutate({ chatId, text: `next ${src('Q')}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    assertWellFormed(s.requests()[0]!.request.messages);
    await s.kill('SIGTERM');
  });

  it('killed again during recovery, repeatedly: still exactly one note, no request', { timeout: 120_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const send = api1.chat.send.mutate({ chatId: null, text: 'hang', source: '' }).catch(() => undefined);
    await first.until(() => first.requests().length === 1, 'the request');
    const chatId = (await api1.chat.list.query())[0]!.id;
    await first.kill('SIGKILL');
    await send;
    // tsx startup takes a few hundred ms: spread the kills across opening the storage and recovery.
    for (const delay of [350, 450, 550, 650, 750, 850]) {
      const s = server(dataDir);
      await sleep(delay);
      await s.kill('SIGKILL');
      expect(s.requests()).toHaveLength(0);
    }
    const last = server(dataDir);
    const api = await last.api();
    const detail = await api.chat.get.query({ id: chatId });
    assertConsistent(detail);
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'note']);
    await sleep(300);
    expect(last.requests()).toHaveLength(0);
    expect(await api.chat.send.mutate({ chatId, text: `next ${src('Q')}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    await last.kill('SIGTERM');
  });
});

describe('kills at different moments', () => {
  it('fuzz: SIGKILL at a random moment during fast sends leaves a consistent chat that continues', { timeout: 180_000 }, async () => {
    const dataDir = tempDir();
    let seed = 7;
    const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const outcomes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const s = server(dataDir);
      const api = await s.api();
      const before = await api.chat.list.query();
      for (const chat of before) assertConsistent(await api.chat.get.query({ id: chat.id }));
      expect(s.requests(), 'nothing runs at open').toHaveLength(0);
      const chatId = before[0]?.id ?? null;
      const send = api.chat.send.mutate({ chatId, text: `P${i} ${src(`Q${i}`)}`, source: '' }).then(r => (r.ok ? r.turn.kind : 'failed'), () => 'cut');
      await sleep(next(30));
      await s.kill('SIGKILL');
      outcomes.push(await send);
    }
    const last = server(dataDir);
    const api = await last.api();
    const [chat] = await api.chat.list.query();
    if (chat) {
      assertConsistent(await api.chat.get.query({ id: chat.id }));
      expect(await api.chat.send.mutate({ chatId: chat.id, text: `end ${src('END')}`, source: '' })).toMatchObject({ ok: true, turn: { kind: 'version' } });
      assertWellFormed(last.requests().at(-1)!.request.messages);
    }
    await last.kill('SIGTERM');
    expect(outcomes).toHaveLength(12);
  });

  it('killed after a failed attempt, in the next model request: the next request is well-formed and has the attempt', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const send = api1.chat.send.mutate({ chatId: null, text: 'badthenhang', source: '' }).catch(() => undefined);
    await first.until(() => first.requests().length === 2, 'the second round');
    const chatId = (await api1.chat.list.query())[0]!.id;
    await first.kill('SIGKILL');
    await send;
    const second = server(dataDir);
    const api2 = await second.api();
    const detail = await api2.chat.get.query({ id: chatId });
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'note']);
    await api2.chat.send.mutate({ chatId, text: `next ${src('Q')}`, source: '' });
    const messages = second.requests()[0]!.request.messages;
    assertWellFormed(messages);
    expect(JSON.stringify(messages)).toContain('BAD_ATTEMPT');
    await second.kill('SIGTERM');
  });

  it('killed during a retry backoff: nothing runs at open, the chat continues', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const send = api1.chat.send.mutate({ chatId: null, text: 'retrythenhang', source: '' }).catch(() => undefined);
    await first.until(() => first.requests().length >= 1, 'the first request');
    await sleep(30);
    const chatId = (await api1.chat.list.query())[0]!.id;
    await first.kill('SIGKILL');
    await send;
    const second = server(dataDir);
    const api2 = await second.api();
    assertConsistent(await api2.chat.get.query({ id: chatId }));
    await sleep(2_500);
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId, text: `next ${src('Q')}`, source: '' })).toMatchObject({ ok: true });
    assertWellFormed(second.requests()[0]!.request.messages);
    await second.kill('SIGTERM');
  });

  it.each(['hang', 'badthenhang', 'ignore', `x ${src('HANGCHECK')}`])('SIGTERM during "%s": the process exits within the bound and the chat recovers', { timeout: 60_000 }, async prompt => {
    const dataDir = tempDir();
    const first = server(dataDir, { CHILD_GRACE_MS: '500' });
    const api1 = await first.api();
    const send = api1.chat.send.mutate({ chatId: null, text: prompt, source: '' }).catch(() => undefined);
    await first.until(() => first.requests().length >= 1, 'the request');
    await sleep(50);
    const chatId = (await api1.chat.list.query())[0]!.id;
    const started = Date.now();
    await first.kill('SIGTERM');
    expect(Date.now() - started).toBeLessThan(8_000);
    await send;
    const second = server(dataDir);
    const api2 = await second.api();
    const detail = await api2.chat.get.query({ id: chatId });
    assertConsistent(detail);
    expect(detail!.turns.some(t => t.kind === 'version')).toBe(false);
    await sleep(300);
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId, text: `next ${src('Q')}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    assertWellFormed(second.requests()[0]!.request.messages);
    await second.kill('SIGTERM');
  });

  it('SIGKILL right after a reply returned, with a failed turn and a text turn before it', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `one ${src('Q1')}`, source: '' });
    await api1.chat.send.mutate({ chatId, text: 'say:just text', source: 'Q1' });
    const before = await api1.chat.get.query({ id: chatId! });
    await first.kill('SIGKILL');
    const second = server(dataDir);
    const api2 = await second.api();
    expect(await api2.chat.get.query({ id: chatId! })).toEqual(before);
    await second.kill('SIGTERM');
  });
});

describe('several cut-off chats at once', () => {
  it('three chats in flight at a SIGKILL: each gets one note, nothing runs, none leaks into another, all continue', { timeout: 90_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir, { CHILD_UNGUARDED: '1' });
    const api1 = await first.api();
    const prompts = ['hang CUT_A', 'badthenhang CUT_B', `CUT_C ${src('HANGCHECK')}`];
    const sends = prompts.map(text => api1.chat.send.mutate({ chatId: null, text, source: '' }).catch(() => undefined));
    await first.until(() => first.log().some(e => e.type === 'check' && e.source === 'HANGCHECK') && first.requests().length >= 4, 'all three in flight');
    const chats = await api1.chat.list.query();
    expect(chats).toHaveLength(3);
    await first.kill('SIGKILL');
    await Promise.all(sends);

    const second = server(dataDir);
    const api2 = await second.api();
    for (const chat of chats) {
      const detail = await api2.chat.get.query({ id: chat.id });
      assertConsistent(detail);
      expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'note']);
    }
    await sleep(500);
    expect(second.log().filter(e => e.type !== 'open')).toHaveLength(0);
    for (const [i, chat] of chats.entries()) {
      expect(await api2.chat.send.mutate({ chatId: chat.id, text: `next${i} ${src(`Q${i}`)}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
      const messages = second.requests().at(-1)!.request.messages;
      assertWellFormed(messages);
      const words = JSON.stringify(messages);
      expect(words.match(/CUT_[ABC]/g)!.every((word, _, all) => word === all[0])).toBe(true);
    }
    expect(second.requests()).toHaveLength(3);
    await second.kill('SIGTERM');

    const third = server(dataDir);
    const api3 = await third.api();
    for (const chat of chats) expect((await api3.chat.get.query({ id: chat.id }))!.turns.filter(t => t.kind === 'note')).toHaveLength(1);
    await third.kill('SIGTERM');
  });

  it('a chat cut off and a one-shot cut off in the same file', { timeout: 90_000 }, async () => {
    const dataDir = tempDir();
    await cutOffOldGeneration(dataDir, 'hang ONE_SHOT_CUT');
    const second = server(dataDir);
    let api = await second.api();
    const chat = api.chat.send.mutate({ chatId: null, text: 'hang CHAT_CUT', source: '' }).catch(() => undefined);
    await second.until(() => second.requests().length === 1, 'the chat');
    const chatId = (await api.chat.list.query())[0]!.id;
    await second.kill('SIGKILL');
    await chat;
    const third = server(dataDir);
    api = await third.api();
    expect((await api.chat.list.query()).map(c => c.id)).toEqual([chatId]);
    expect((await api.chat.get.query({ id: chatId }))!.turns.map(t => t.kind)).toEqual(['user', 'note']);
    await sleep(300);
    expect(third.requests()).toHaveLength(0);
    expect(await api.chat.send.mutate({ chatId: null, text: `fresh ${src('FRESH')}`, source: '' })).toMatchObject({ ok: true, turn: { source: 'FRESH' } });
    expect(third.requests()).toHaveLength(1);
    expect(JSON.stringify(third.requests()[0]!.request.messages)).not.toContain('CUT');
    await third.kill('SIGTERM');
  });
});

describe('S11 across real restarts', () => {
  it('SIGKILL during an edit-and-resend: the dropped turns stay gone, one note, the next request is clean', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `ALPHA ${src('Q_ALPHA')}`, source: '' });
    await api1.chat.send.mutate({ chatId, text: `BRAVO_DROPPED ${src('Q_BRAVO_DROPPED')}`, source: 'Q_ALPHA' });
    const id = (await api1.chat.get.query({ id: chatId! }))!.turns.filter(t => t.kind === 'user')[1]!.id;
    const editing = api1.chat.send.mutate({ chatId, text: 'hang DELTA', source: 'Q_ALPHA', replaceFrom: id }).catch(() => undefined);
    await first.until(() => first.requests().length === 3, 'the resend');
    await first.kill('SIGKILL');
    await editing;
    const second = server(dataDir);
    const api2 = await second.api();
    const detail = await api2.chat.get.query({ id: chatId! });
    assertConsistent(detail);
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'note']);
    expect(JSON.stringify(detail)).not.toContain('BRAVO_DROPPED');
    await sleep(200);
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId, text: `next ${src('Q_NEXT')}`, source: 'Q_ALPHA' })).toMatchObject({ ok: true, turn: { n: 2 } });
    const request = JSON.stringify(second.requests()[0]!.request);
    expect(request).not.toContain('BRAVO_DROPPED');
    for (const word of ['ALPHA', 'DELTA', 'next']) expect(request).toContain(word);
    assertWellFormed(second.requests()[0]!.request.messages);
    await second.kill('SIGTERM');
  });

  it.each(['SIGKILL', 'SIGTERM'] as const)('three abandoned parents still live at %s, two restarts: no request at open, no note for them, the chat continues; nothing of theirs comes back', { timeout: 90_000 }, async signal => {
    const dataDir = tempDir();
    const first = server(dataDir, { CHILD_GRACE_MS: '200' });
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `ALPHA ${src('Q_ALPHA')}`, source: '' });
    for (let i = 0; i < 3; i++) {
      const sending = api1.chat.send.mutate({ chatId, text: `ignore STUCK_${i}`, source: 'Q_ALPHA' });
      await first.until(() => first.requests().length === 2 + i, 'the stuck request');
      await api1.chat.stop.mutate({ id: chatId! });
      expect(await sending).toMatchObject({ ok: false, stopped: true });
    }
    const before = await api1.chat.get.query({ id: chatId! });
    expect(before!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'note', 'user', 'note', 'user', 'note']);
    await first.kill(signal);

    for (const round of [0, 1]) {
      const s = server(dataDir);
      const api = await s.api();
      expect(await api.chat.get.query({ id: chatId! })).toEqual(round === 0 ? before : expect.anything());
      await sleep(300);
      expect(s.requests(), 'nothing runs at open').toHaveLength(0);
      const sent = await api.chat.send.mutate({ chatId, text: `next${round} ${src(`Q_${round}`)}`, source: 'Q_ALPHA' });
      expect(sent).toMatchObject({ ok: true, turn: { n: 2 + round } });
      expect(s.requests()).toHaveLength(1);
      const messages = s.requests()[0]!.request.messages;
      assertWellFormed(messages);
      for (const word of ['ALPHA', 'STUCK_0', 'STUCK_1', 'STUCK_2']) expect(JSON.stringify(messages)).toContain(word);
      await s.kill(round ? 'SIGTERM' : 'SIGKILL');
    }
    const last = server(dataDir);
    const api = await last.api();
    const detail = await api.chat.get.query({ id: chatId! });
    expect(detail!.turns.filter(t => t.kind === 'note')).toHaveLength(3);
    expect(detail!.turns.flatMap(t => (t.kind === 'version' ? [t.n] : []))).toEqual([1, 2, 3]);
    await last.kill('SIGTERM');
  });

  it('SIGKILL while a stop waits on a stuck run: consistent at open, and the chat continues', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `ALPHA ${src('Q_ALPHA')}`, source: '' });
    const sending = api1.chat.send.mutate({ chatId, text: 'ignore STUCK', source: 'Q_ALPHA' }).catch(() => undefined);
    await first.until(() => first.requests().length === 2, 'the stuck request');
    const stopping = api1.chat.stop.mutate({ id: chatId! }).catch(() => undefined);
    await sleep(100);
    await first.kill('SIGKILL');
    await Promise.all([sending, stopping]);
    const second = server(dataDir);
    const api2 = await second.api();
    const detail = await api2.chat.get.query({ id: chatId! });
    assertConsistent(detail);
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'note']);
    await sleep(200);
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId, text: `next ${src('Q_NEXT')}`, source: 'Q_ALPHA' })).toMatchObject({ ok: true, turn: { n: 2 } });
    await second.kill('SIGTERM');
  });
});

describe('sizes over real HTTP', () => {
  it('the largest allowed message and source, in three-byte characters, go through the real server and survive a kill', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const text = `say:ok ${'語'.repeat(15_990)}`;
    const source = '語'.repeat(64_000);
    const sent = await api1.chat.send.mutate({ chatId: null, text, source });
    expect(sent).toMatchObject({ ok: true, turn: { kind: 'text' } });
    await expect(api1.chat.send.mutate({ chatId: sent.chatId, text: 'x'.repeat(16_001), source: '' })).rejects.toThrow(/Expected/);
    await first.kill('SIGKILL');
    const second = server(dataDir);
    const api2 = await second.api();
    expect((await api2.chat.get.query({ id: sent.chatId! }))!.turns[0]).toMatchObject({ text, source });
    await second.kill('SIGTERM');
  });
});

describe('damaged data', () => {
  async function chatFile() {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api = await first.api();
    const a = await api.chat.send.mutate({ chatId: null, text: `A ${src('QA')}`, source: '' });
    const b = await api.chat.send.mutate({ chatId: null, text: `B ${src('QB')}`, source: '' });
    await first.kill('SIGTERM');
    return { dataDir, a: a.chatId!, b: b.chatId! };
  }
  const sql = <T,>(dataDir: string, work: (db: DatabaseSync) => T) => {
    const db = new DatabaseSync(join(dataDir, 'pi.sqlite'));
    try { return work(db); } finally { db.close(); }
  };
  const indexDocument = (db: DatabaseSync) => (db.prepare(`select id from documents where kind = '"studio.chats"'`).get() as { id: number }).id;

  it('a chat whose conversation is gone: listed or not, it answers clearly and the other chat works', { timeout: 60_000 }, async () => {
    const { dataDir, a, b } = await chatFile();
    const s0 = sql(dataDir, db => {
      db.prepare('PRAGMA foreign_keys = OFF').run();
      const index = indexDocument(db);
      const rows = db.prepare('select seq, kind, content from document_revisions where document_id = ? order by seq').all(index) as { seq: number; kind: string; content: string }[];
      const conversationIds = db.prepare('select id from conversations').all() as { id: number }[];
      const victim = conversationIds.at(-2)!.id;
      db.prepare('delete from entries where conversation_id = ?').run(victim);
      db.prepare('delete from conversations where id = ?').run(victim);
      return rows.length;
    });
    expect(s0).toBeGreaterThan(0);
    const s = server(dataDir);
    const api = await s.api();
    const list = await api.chat.list.query();
    expect(list.map(c => c.id)).toContain(b);
    expect(await api.chat.get.query({ id: a })).toBeNull();
    expect(await api.chat.send.mutate({ chatId: a, text: 'x', source: '' })).toMatchObject({ ok: false, error: expect.stringContaining('Unknown chat') });
    expect(await api.chat.send.mutate({ chatId: b, text: `again ${src('QB2')}`, source: 'QB' })).toMatchObject({ ok: true, turn: { n: 2 } });
    await s.kill('SIGTERM');
  });

  it('the same with the missing chat cut off at the time: open still succeeds', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const b = await api1.chat.send.mutate({ chatId: null, text: `B ${src('QB')}`, source: '' });
    const send = api1.chat.send.mutate({ chatId: null, text: 'hang', source: '' }).catch(() => undefined);
    await first.until(() => first.requests().length === 2, 'the request');
    const a = (await api1.chat.list.query()).find(c => c.id !== b.chatId)!;
    await first.kill('SIGKILL');
    await send;
    sql(dataDir, db => {
      db.prepare('delete from entries where conversation_id = ?').run(a.conversationId);
      db.prepare('delete from submissions where conversation_id = ?').run(a.conversationId);
      db.prepare('delete from tasks where conversation_id = ?').run(a.conversationId);
      db.prepare('delete from conversations where id = ?').run(a.conversationId);
    });
    const s = server(dataDir);
    const api = await s.api();
    expect(await api.chat.get.query({ id: a.id })).toBeNull();
    expect(await api.chat.send.mutate({ chatId: b.chatId, text: `again ${src('QB2')}`, source: 'QB' })).toMatchObject({ ok: true, turn: { n: 2 } });
    await s.kill('SIGTERM');
  });

  it.each([
    ['chats is not an array', '{"chats":"oops"}'],
    ['chats is missing', '{}'],
    ['a record with no conversation', '{"chats":[{"id":"x","title":"t","updatedAt":1,"running":true}]}'],
    ['a record of the wrong shape', '{"chats":[1,null,"x"]}'],
    ['a record pointing at no conversation, running', '{"chats":[{"id":"x","title":"t","conversationId":999999,"updatedAt":1,"running":true}]}'],
    ['the index is null', 'null'],
  ])('an index with %s: the process starts or falls back with a reason; it never crashes', { timeout: 60_000 }, async (_name, content) => {
    const { dataDir } = await chatFile();
    sql(dataDir, db => {
      const index = indexDocument(db);
      const rows = db.prepare('select seq, kind from document_revisions where document_id = ? order by seq').all(index) as { seq: number; kind: string }[];
      const base = rows.find(r => r.kind === 'base')!;
      db.prepare('delete from document_revisions where document_id = ? and seq > ?').run(index, base.seq);
      db.prepare('update document_revisions set content = ? where document_id = ? and seq = ?').run(content, index, base.seq);
    });
    const s = server(dataDir);
    const outcome = await Promise.race([s.ready.then(() => 'ready', () => 'exited'), s.exited.then(() => 'exited')]);
    if (outcome === 'exited') {
      // The child, unlike main.ts, has no try/catch: an exception at open is what main.ts turns into "LLM unavailable".
      note(_name, 'open threw:', s.stderr().split('\n').find(line => line.includes('Error')));
      expect(s.stderr()).not.toBe('');
      return;
    }
    const api = await s.api();
    const list = await Promise.race([api.chat.list.query().then(l => ({ ok: true as const, l }), (e: Error) => ({ ok: false as const, e })), sleep(5_000).then(() => 'HUNG' as const)]);
    expect(list).not.toBe('HUNG');
    // A send either works or answers; it does not take the server down.
    const sent = await api.chat.send.mutate({ chatId: null, text: `n ${src('Q')}`, source: '' }).then(r => r, (e: Error) => ({ threw: e.message }));
    note(_name, 'list:', JSON.stringify(list), 'send:', JSON.stringify(sent).slice(0, 200));
    expect(sent).toBeDefined();
    expect(s.child.exitCode).toBeNull();
    await s.kill('SIGTERM');
  });

  describe('through the real main.ts (fake credential, no ClickHouse, no model request)', () => {
    function main(dataDir: string) {
      const piDir = tempDir();
      writeFileSync(join(piDir, 'auth.json'), JSON.stringify({ anthropic: { type: 'api_key', key: 'sk-not-real' } }), { mode: 0o600 });
      const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'server/main.ts', '--url', 'http://127.0.0.1:1', '--port', '0', '--pi-dir', piDir, '--data-dir', dataDir, '--model', 'anthropic/claude-sonnet-4-5'], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TYPEDHOUSE_STUDIO_MODEL: '' } });
      children.add(child);
      let out = '', err = '';
      child.stderr.on('data', chunk => { err += String(chunk); });
      const url = new Promise<string>((resolve, reject) => {
        child.stdout.on('data', chunk => { out += String(chunk); const match = /TypedHouse Studio: (\S+)/.exec(out); if (match) resolve(match[1]!); });
        child.once('exit', code => { children.delete(child); reject(new Error(`main exited ${code}: ${err}`)); });
      });
      return { child, url, err: () => err, out: () => out };
    }
    const client = async (url: string) => createTRPCClient<AppRouter>({ links: [httpLink({ url: `${url}/trpc`, transformer: superjson })] });
    const stop = (child: ChildProcess) => new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });

    it.each([
      ['garbage bytes', (file: string) => writeFileSync(file, 'this is not a sqlite database, not at all, and it is long enough to read a header')],
      ['an empty file', (file: string) => writeFileSync(file, '')],
    ])('pi.sqlite with %s: the app starts, says why when it cannot use it, and chat answers', { timeout: 60_000 }, async (_name, damage) => {
      const dataDir = tempDir();
      mkdirSync(dataDir, { recursive: true });
      damage(join(dataDir, 'pi.sqlite'));
      const m = main(dataDir);
      const api = await client(await m.url);
      const list = await api.chat.list.query();
      expect(list).toEqual([]);
      const sent = await api.chat.send.mutate({ chatId: 'x', text: 'hi', source: '' });
      expect(sent.ok).toBe(false);
      await stop(m.child);
    });

    it('a pi.sqlite cut off in the middle (a partial copy): the app still starts and chat answers', { timeout: 60_000 }, async () => {
      const { dataDir, a } = await chatFile();
      sql(dataDir, db => db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run());
      const file = join(dataDir, 'pi.sqlite');
      expect(existsSync(file)).toBe(true);
      truncateSync(file, 8192);
      const m = main(dataDir);
      const api = await client(await m.url);
      const answer = await api.chat.send.mutate({ chatId: a, text: 'hi', source: '' }).then(r => r, (e: Error) => ({ threw: e.message }));
      expect(answer).toMatchObject({ ok: false });
      expect((await api.models.list.query())).toBeDefined();
      await stop(m.child);
    });

    it('a corrupt index through main.ts: the app starts and the rest keeps working', { timeout: 60_000 }, async () => {
      const { dataDir } = await chatFile();
      sql(dataDir, db => {
        const index = indexDocument(db);
        const rows = db.prepare('select seq, kind from document_revisions where document_id = ? order by seq').all(index) as { seq: number; kind: string }[];
        const base = rows.find(r => r.kind === 'base')!;
        db.prepare('delete from document_revisions where document_id = ? and seq > ?').run(index, base.seq);
        db.prepare("update document_revisions set content = '{\"chats\":\"oops\"}' where document_id = ? and seq = ?").run(index, base.seq);
      });
      const m = main(dataDir);
      const api = await client(await m.url);
      expect(await api.models.list.query()).toBeDefined();
      const list = await api.chat.list.query().then(l => l, (e: Error) => ({ threw: e.message }));
      note('main', JSON.stringify(list), m.err());
      await stop(m.child);
    });
  });
});
