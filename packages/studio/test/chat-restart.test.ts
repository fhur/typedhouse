// The required proof for R13.2: chats survive a real process death. Every server here is a separate OS process
// (test/chat-child.ts) on one data dir, driven over HTTP. An in-process close and reopen would not count.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/server.js';
import { cutOffOldGeneration, writeOldGeneration } from './old-data.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const children = new Set<ChildProcess>();
const dirs: string[] = [];
afterEach(async () => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-restart-'));
  dirs.push(dir);
  return dir;
}

type LogEntry = { type: 'open' } | { type: 'check'; source: string } | { type: 'request'; model: string; request: { messages: { role: string; content: unknown }[] } };
function server(dataDir: string, env: Record<string, string> = {}) {
  const logPath = join(tempDir(), 'child.log');
  writeFileSync(logPath, '');
  const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/chat-child.ts'], {
    cwd: packageRoot,
    env: { ...process.env, CHILD_DATA_DIR: dataDir, CHILD_LOG: logPath, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal }); }));
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const ready = new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', chunk => {
      out += String(chunk);
      const match = /READY (\S+)/.exec(out);
      if (match) resolve(match[1]!);
    });
    void exited.then(() => reject(new Error(`child exited before READY: ${stderr}`)));
  });
  const log = () => readFileSync(logPath, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line) as LogEntry);
  const requests = () => log().flatMap(entry => (entry.type === 'request' ? [entry] : []));
  return {
    child, exited, log, requests,
    async api() {
      const url = await ready;
      return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${url}/trpc`, transformer: superjson })] });
    },
    async until(condition: () => boolean, what: string) {
      const deadline = Date.now() + 15_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    async kill(signal: 'SIGTERM' | 'SIGKILL') { child.kill(signal); return exited; },
  };
}
const src = (source: string) => `src:${source}|`;

describe.each(['SIGTERM', 'SIGKILL'] as const)('restart after %s', signal => {
  it('the chat comes back with the same turns and numbers, and the next send continues it as v3', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const one = await api1.chat.send.mutate({ chatId: null, text: `PROMPT_ONE ${src('SOURCE_ONE')}`, source: '' });
    expect(one).toMatchObject({ ok: true, turn: { n: 1, source: 'SOURCE_ONE' } });
    const chatId = one.chatId!;
    const two = await api1.chat.send.mutate({ chatId, text: `PROMPT_TWO ${src('SOURCE_TWO')}`, source: 'SOURCE_ONE' });
    expect(two).toMatchObject({ ok: true, turn: { n: 2, source: 'SOURCE_TWO' } });
    const before = await api1.chat.get.query({ id: chatId });
    const listBefore = await api1.chat.list.query();
    expect(await first.kill(signal)).toMatchObject(signal === 'SIGKILL' ? { signal: 'SIGKILL' } : { code: 0 });

    const second = server(dataDir);
    expect(second.child.pid).not.toBe(first.child.pid);
    const api2 = await second.api();
    expect(await api2.chat.list.query()).toEqual(listBefore);
    expect(await api2.chat.get.query({ id: chatId })).toEqual(before);
    expect(before!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'version']);
    expect(second.requests()).toHaveLength(0);

    const three = await api2.chat.send.mutate({ chatId, text: `PROMPT_THREE ${src('SOURCE_THREE')}`, source: 'SOURCE_TWO' });
    expect(three).toMatchObject({ ok: true, chatId, turn: { kind: 'version', n: 3, source: 'SOURCE_THREE' } });
    const request = JSON.stringify(second.requests()[0]!.request.messages);
    for (const word of ['PROMPT_ONE', 'SOURCE_ONE', 'PROMPT_TWO', 'SOURCE_TWO', 'PROMPT_THREE']) expect(request).toContain(word);
    expect((await api2.chat.list.query())[0]!.conversationId).toBe(listBefore[0]!.conversationId);
    await second.kill('SIGTERM');
  });

  it('a run cut off mid-generation ends at open: a note, no model request, and the next send works', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `PROMPT_ONE ${src('SOURCE_ONE')}`, source: '' });
    void api1.chat.send.mutate({ chatId, text: 'hang forever PROMPT_CUT', source: 'SOURCE_ONE' }).catch(() => undefined);
    await first.until(() => first.requests().length === 2, 'the second model request');
    await first.kill(signal);

    const second = server(dataDir);
    const api2 = await second.api();
    const detail = await api2.chat.get.query({ id: chatId! });
    expect(detail!.generating).toBe(false);
    expect(detail!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'note']);
    expect(detail!.turns.at(-1)).toMatchObject({ text: expect.stringMatching(/^Interrupted/) });
    // Nothing runs by itself, however long we wait.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(second.requests()).toHaveLength(0);

    const next = await api2.chat.send.mutate({ chatId, text: `PROMPT_AFTER ${src('SOURCE_AFTER')}`, source: 'SOURCE_ONE' });
    expect(next).toMatchObject({ ok: true, turn: { n: 2, source: 'SOURCE_AFTER' } });
    expect(second.requests()).toHaveLength(1);
    const messages = second.requests()[0]!.request.messages;
    expect(JSON.stringify(messages)).toContain('PROMPT_CUT');
    expect(JSON.stringify(messages)).toContain('PROMPT_AFTER');
    await second.kill('SIGTERM');

    // Once only: another restart adds no second note.
    const third = server(dataDir);
    const api3 = await third.api();
    expect((await api3.chat.get.query({ id: chatId! }))!.turns.filter(t => t.kind === 'note')).toHaveLength(1);
    await third.kill('SIGTERM');
  });
});

describe('restart: other ways to be cut off (SIGKILL)', () => {
  const killed = (dataDir: string) => server(dataDir);

  it('killed while check_query runs: the next request is valid, every tool call has a result', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = killed(dataDir);
    const api1 = await first.api();
    void api1.chat.send.mutate({ chatId: null, text: `PROMPT_ONE ${src('HANGCHECK')}`, source: '' }).catch(() => undefined);
    await first.until(() => first.log().some(entry => entry.type === 'check'), 'the check to start');
    const chatId = (await api1.chat.list.query())[0]!.id;
    const liveActivity = (await api1.chat.get.query({ id: chatId }))!.activity;
    expect(liveActivity).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'toolCall', status: 'running' })]));
    await first.kill('SIGKILL');

    const second = server(dataDir);
    const api2 = await second.api();
    const recovered = (await api2.chat.get.query({ id: chatId }))!;
    expect(recovered.turns.map(t => t.kind)).toEqual(['user', 'note']);
    expect(recovered.activity).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'toolCall', id: liveActivity[0]!.id, status: 'interrupted' })]));
    expect(second.log().filter(entry => entry.type !== 'open')).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId, text: `PROMPT_TWO ${src('SOURCE_TWO')}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    const messages = second.requests()[0]!.request.messages as { role: string; content: unknown; toolCallId?: string }[];
    const calls = messages.flatMap(m => (m.role === 'assistant' ? (m.content as { type: string; id: string }[]).filter(b => b.type === 'toolCall').map(b => b.id) : []));
    const results = messages.flatMap(m => (m.role === 'toolResult' ? [m.toolCallId!] : []));
    expect(calls.length).toBeGreaterThan(0);
    expect(results).toEqual(calls);
    await second.kill('SIGTERM');
  });

  it('killed after the run but before the reply was written: a note, no version, the chat continues', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = killed(dataDir);
    const api1 = await first.api();
    void api1.chat.send.mutate({ chatId: null, text: `PROMPT_ONE ${src('KILLRECHECK')}`, source: '' }).catch(() => undefined);
    expect(await first.exited).toMatchObject({ signal: 'SIGKILL' });

    const second = server(dataDir);
    const api2 = await second.api();
    const [chat] = await api2.chat.list.query();
    expect((await api2.chat.get.query({ id: chat!.id }))!.turns.map(t => t.kind)).toEqual(['user', 'note']);
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId: chat!.id, text: `PROMPT_TWO ${src('SOURCE_TWO')}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    await second.kill('SIGTERM');
  });

  it('two chats, one cut off: only that chat gets the note and the other keeps working', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = killed(dataDir);
    const api1 = await first.api();
    const quiet = await api1.chat.send.mutate({ chatId: null, text: `QUIET ${src('SOURCE_QUIET')}`, source: '' });
    void api1.chat.send.mutate({ chatId: null, text: 'hang CUT_CHAT', source: '' }).catch(() => undefined);
    await first.until(() => first.requests().length === 2, 'the second chat request');
    const cut = (await api1.chat.list.query()).find(c => c.id !== quiet.chatId)!;
    await first.kill('SIGKILL');

    const second = server(dataDir);
    const api2 = await second.api();
    expect((await api2.chat.get.query({ id: cut.id }))!.turns.map(t => t.kind)).toEqual(['user', 'note']);
    expect((await api2.chat.get.query({ id: quiet.chatId! }))!.turns.map(t => t.kind)).toEqual(['user', 'version']);
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId: quiet.chatId, text: `AGAIN ${src('SOURCE_AGAIN')}`, source: 'SOURCE_QUIET' })).toMatchObject({ ok: true, turn: { n: 2 } });
    // One request only: the cut-off chat's old input did not come back to life with this submit.
    expect(second.requests()).toHaveLength(1);
    expect(JSON.stringify(second.requests()[0]!.request.messages)).not.toContain('CUT_CHAT');
    await second.kill('SIGTERM');
  });

  it('after a restart the running session model is used, not the stored one', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir, { CHILD_MODEL: 'faux-a' });
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: src('SOURCE_ONE'), source: '' });
    expect(first.requests()[0]!.model).toBe('faux-a');
    await first.kill('SIGTERM');

    const second = server(dataDir, { CHILD_MODEL: 'faux-b' });
    const api2 = await second.api();
    await api2.chat.send.mutate({ chatId, text: src('SOURCE_TWO'), source: 'SOURCE_ONE' });
    expect(second.requests()[0]!.model).toBe('faux-b');
    await second.kill('SIGTERM');
  });

  it('a one-shot generation cut off by a kill ends at open: not listed, no request, and its prompt stays out of a new chat', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    await cutOffOldGeneration(dataDir, 'hang CUT_ONE_SHOT');

    const second = server(dataDir);
    const api2 = await second.api();
    expect(await api2.chat.list.query()).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(second.requests()).toHaveLength(0);
    expect(await api2.chat.send.mutate({ chatId: null, text: `NEW_CHAT ${src('SOURCE_NEW')}`, source: '' })).toMatchObject({ ok: true, turn: { n: 1 } });
    expect(second.requests()).toHaveLength(1);
    expect(JSON.stringify(second.requests()[0]!.request.messages)).not.toContain('CUT_ONE_SHOT');
    await second.kill('SIGTERM');
  });

  it('finished one-shot generations in an old file are not listed and cause no request', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    // A one-shot generation that finished, as old pi.sqlite files hold.
    await writeOldGeneration(dataDir, 'old');

    const next = server(dataDir);
    const api = await next.api();
    expect(await api.chat.list.query()).toEqual([]);
    expect(next.requests()).toHaveLength(0);
    await next.kill('SIGTERM');
  });
});
