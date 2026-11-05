// R13.2 through the real server against ClickHouse: real introspection, real check, real run, in separate OS processes.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient as createDriver } from '@clickhouse/client';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/server.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtures = new URL('../../compiler/test/fixtures/', import.meta.url);
let container: StartedTestContainer, clickhouse: string, dir: string;
const children = new Set<ChildProcess>();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'studio-chat-integration-'));
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
  clickhouse = JSON.stringify({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
}, 180_000);

afterAll(async () => {
  for (const child of children) child.kill('SIGKILL');
  await container?.stop();
  rmSync(dir, { recursive: true, force: true });
});

function server(dataDir: string, name: string) {
  const logPath = join(dir, `${name}.log`);
  writeFileSync(logPath, '');
  const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/chat-child.ts'], {
    cwd: packageRoot,
    env: { ...process.env, CHILD_DATA_DIR: dataDir, CHILD_LOG: logPath, CHILD_CLICKHOUSE: clickhouse },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.add(child);
  const exited = new Promise<void>(resolve => child.once('exit', () => { children.delete(child); resolve(); }));
  const ready = new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); const match = /READY (\S+)/.exec(out); if (match) resolve(match[1]!); });
    void exited.then(() => reject(new Error('child exited before READY')));
  });
  return {
    async api() { return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${await ready}/trpc`, transformer: superjson })] }); },
    requests: () => readFileSync(logPath, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line) as { type: string; request?: unknown }).filter(e => e.type === 'request'),
    async kill(signal: NodeJS.Signals) { child.kill(signal); await exited; },
  };
}

const q1 = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId }))';
const q2 = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts }))';
const q3 = `${q2}.limit(2)`;
const prompt = (word: string, source: string) => `${word} src:${source}|`;

describe('chats survive a real restart, against ClickHouse 24.8', () => {
  it.each(['SIGTERM', 'SIGKILL'] as const)('after %s: same turns, continues with the history, next version runs', async signal => {
    const dataDir = join(dir, `data-${signal}`);
    const first = server(dataDir, `first-${signal}`);
    const api1 = await first.api();
    const one = await api1.chat.send.mutate({ chatId: null, text: prompt('PROMPT_ONE', q1), source: '' });
    expect(one).toMatchObject({ ok: true, turn: { kind: 'version', n: 1, source: q1, rowType: expect.stringContaining('id') } });
    // A real type error from the real check is refused and fed back, and the chat carries on.
    const refused = await api1.chat.send.mutate({ chatId: one.chatId, text: prompt('PROMPT_BAD', 'export default from(no_such_table)'), source: q1 }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ ok: false });
    const two = await api1.chat.send.mutate({ chatId: one.chatId, text: prompt('PROMPT_TWO', q2), source: q1 });
    expect(two).toMatchObject({ ok: true, turn: { n: 2, source: q2 } });
    const before = await api1.chat.get.query({ id: one.chatId! });
    await first.kill(signal);

    const second = server(dataDir, `second-${signal}`);
    const api2 = await second.api();
    expect(await api2.chat.get.query({ id: one.chatId! })).toEqual(before);
    expect(second.requests()).toHaveLength(0);
    const three = await api2.chat.send.mutate({ chatId: one.chatId, text: prompt('PROMPT_THREE', q3), source: q2 });
    expect(three).toMatchObject({ ok: true, turn: { kind: 'version', n: 3, source: q3 } });
    const request = JSON.stringify(second.requests()[0]);
    for (const word of ['PROMPT_ONE', 'PROMPT_TWO', 'PROMPT_THREE', 'c.countOfParts']) expect(request).toContain(word);
    if (!three.ok || three.turn.kind !== 'version') throw new Error('expected a version');
    const run = await api2.query.run.mutate({ source: three.turn.source, autoLimit: true });
    expect(run).toMatchObject({ ok: true, rowCount: 2 });
    await second.kill('SIGTERM');
  });
});
