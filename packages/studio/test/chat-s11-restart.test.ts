// S11 across real process deaths: separate OS processes on one data dir, driven over HTTP (test/chat-tester-child.ts).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/server.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const children = new Set<ChildProcess>();
const dirs: string[] = [];
afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-s11-restart-'));
  dirs.push(dir);
  return dir;
}
type LogEntry = { type: string; request?: { messages: unknown[] } };
function server(dataDir: string) {
  const logPath = join(tempDir(), 'child.log');
  writeFileSync(logPath, '');
  const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/chat-tester-child.ts'], {
    cwd: packageRoot, env: { ...process.env, CHILD_DATA_DIR: dataDir, CHILD_LOG: logPath, CHILD_GRACE_MS: '300' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.add(child);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal }); }));
  const ready = new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); const match = /READY (\S+)/.exec(out); if (match) resolve(match[1]!); });
    void exited.then(() => reject(new Error('child exited before READY')));
  });
  const requests = () => readFileSync(logPath, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line) as LogEntry).filter(e => e.type === 'request');
  return {
    requests,
    async api() { return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${await ready}/trpc`, transformer: superjson })] }); },
    async url() { return ready; },
    async until(condition: () => boolean, what: string) {
      const deadline = Date.now() + 20_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    async kill(signal: 'SIGTERM' | 'SIGKILL') { child.kill(signal); return exited; },
  };
}
const src = (source: string) => `src:${source}|`;

describe.each(['SIGTERM', 'SIGKILL'] as const)('after a real %s', signal => {
  it('with an abandoned parent still live: no request at open, no note for the parent, and the chat continues', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const one = await api1.chat.send.mutate({ chatId: null, text: `ALPHA ${src('SOURCE_ALPHA')}`, source: '' });
    const sending = api1.chat.send.mutate({ chatId: one.chatId, text: 'ignore BRAVO', source: 'SOURCE_ALPHA' });
    await first.until(() => first.requests().length === 2, 'the stuck request');
    const parent = (await api1.chat.list.query())[0]!.conversationId;
    const started = performance.now();
    expect(await api1.chat.stop.mutate({ id: one.chatId! })).toEqual({ stopped: true });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(await sending).toMatchObject({ stopped: true });
    const before = (await api1.chat.get.query({ id: one.chatId! }))!;
    expect(before.conversationId).not.toBe(parent);
    expect(before.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'note']);
    expect(await first.kill(signal)).toMatchObject(signal === 'SIGKILL' ? { signal: 'SIGKILL' } : { code: 0 });

    const second = server(dataDir);
    const api2 = await second.api();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(second.requests()).toHaveLength(0);
    // Exactly the same thread: the one Stopped note, and no Interrupted one.
    expect(await api2.chat.get.query({ id: one.chatId! })).toEqual(before);
    const next = await api2.chat.send.mutate({ chatId: one.chatId, text: `CHARLIE ${src('SOURCE_CHARLIE')}`, source: 'SOURCE_ALPHA' });
    expect(next).toMatchObject({ ok: true, turn: { n: 2, source: 'SOURCE_CHARLIE' } });
    expect(second.requests()).toHaveLength(1);
    const request = JSON.stringify(second.requests()[0]!.request);
    for (const word of ['ALPHA', 'SOURCE_ALPHA', 'BRAVO', 'CHARLIE']) expect(request).toContain(word);
    await second.kill('SIGTERM');
  });

  it('edit-and-resend stays clean: no dropped turn in the next request, numbering carries on', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `ALPHA ${src('SOURCE_ALPHA')}`, source: '' });
    await api1.chat.send.mutate({ chatId, text: `BRAVO ${src('SOURCE_BRAVO')}`, source: 'SOURCE_ALPHA' });
    await api1.chat.send.mutate({ chatId, text: `CHARLIE ${src('SOURCE_CHARLIE')}`, source: 'SOURCE_BRAVO' });
    const turns = (await api1.chat.get.query({ id: chatId! }))!.turns;
    expect(await api1.chat.send.mutate({ chatId, text: `DELTA ${src('SOURCE_DELTA')}`, source: 'SOURCE_ALPHA', replaceFrom: turns.filter(t => t.kind === 'user')[1]!.id })).toMatchObject({ ok: true, turn: { n: 2 } });
    const before = await api1.chat.get.query({ id: chatId! });
    await first.kill(signal);

    const second = server(dataDir);
    const api2 = await second.api();
    expect(await api2.chat.get.query({ id: chatId! })).toEqual(before);
    expect(await api2.chat.send.mutate({ chatId, text: `ECHO ${src('SOURCE_ECHO')}`, source: 'SOURCE_DELTA' })).toMatchObject({ ok: true, turn: { n: 3 } });
    const request = JSON.stringify(second.requests()[0]!.request);
    for (const word of ['ALPHA', 'DELTA', 'ECHO']) expect(request).toContain(word);
    for (const word of ['BRAVO', 'CHARLIE']) expect(request).not.toContain(word);
    await second.kill('SIGTERM');
  });
});

describe('the run is not tied to the sender', () => {
  it('a second client sees generating; the reply is recorded though the sender went away', { timeout: 60_000 }, async () => {
    const dataDir = tempDir();
    const first = server(dataDir);
    const api1 = await first.api();
    const { chatId } = await api1.chat.send.mutate({ chatId: null, text: `ALPHA ${src('SOURCE_ALPHA')}`, source: '' });
    const going = new AbortController();
    const sent = api1.chat.send.mutate({ chatId, text: 'hang BRAVO', source: 'SOURCE_ALPHA' }, { signal: going.signal }).catch((error: unknown) => error);
    await first.until(() => first.requests().length === 2, 'the running request');
    const second = await first.api();
    expect((await second.chat.get.query({ id: chatId! }))!.generating).toBe(true);
    going.abort();
    await sent;
    await new Promise(resolve => setTimeout(resolve, 100));
    // The sender is gone; the run is still there, and a second client can end it and read the outcome.
    expect((await second.chat.get.query({ id: chatId! }))!.generating).toBe(true);
    expect(await second.chat.stop.mutate({ id: chatId! })).toEqual({ stopped: true });
    const detail = (await second.chat.get.query({ id: chatId! }))!;
    expect(detail.generating).toBe(false);
    expect(detail.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'note']);
    await first.kill('SIGTERM');
  });
});
