// S11 item 1: what the chat's stuck-run fork rests on, on pi-durable itself: a provider that ignores the abort, real
// SQLite. The conversation stays busy for good, so the chat moves to a fork at the stopped user entry. These stay as tests.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { ConversationBusy, createRegistry, defineExtension, defineTool, Harness, ProviderDoc, type Conversation, type EntryId } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { obj, str } from '@earendil-works/pi-schema';

type Request = { messages: { role: string; content: unknown }[] };
const dirs: string[] = [];
const harnesses: Harness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => Promise.race([h.close(context).catch(() => undefined), new Promise(resolve => setTimeout(resolve, 300))])));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const checks: string[] = [];
const check = defineTool({
  name: 'check',
  description: 'check',
  parameters: obj({ source: str() }),
  execute: async args => { checks.push(args.source); return { output: [{ type: 'text' as const, text: 'OK' }], control: { terminate: true } }; },
});
const call = (source: string) => fauxAssistantMessage([fauxToolCall('check', { source })], { stopReason: 'toolUse' });
const within = <T>(ms: number, work: Promise<T>) => Promise.race([work, new Promise<'late'>(resolve => setTimeout(() => resolve('late'), ms))]);

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-stuck-'));
  dirs.push(dir);
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const extension = defineExtension({ name: 'probe', tools: [check] });
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(await openNodeSqliteStorage(join(dir, 'pi.sqlite')), { models, registry }, context);
  harnesses.push(harness);
  const seen: Request[] = [];
  // Respond from a queue of behaviours by prompt: `ignore` never answers and never looks at the abort.
  const releases: ((message: unknown) => void)[] = [];
  const respond = (ctx: Request) => {
    seen.push(JSON.parse(JSON.stringify(ctx)) as Request);
    const last = JSON.stringify(ctx.messages.filter(m => m.role === 'user').at(-1)?.content);
    if (last.includes('STUCK')) return new Promise(resolve => { releases.push(resolve); });
    return call(`SOURCE_FOR_${last.replace(/\W+/g, '')}`);
  };
  faux.setResponses(Array.from({ length: 100 }, () => respond as never));
  const create = () => harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } }, context);
  return { harness, create, seen, releases, dir };
}
const ask = async (c: Conversation, content: string) => (await c.submit({ type: 'input', content, whenBusy: 'reject', entry: { kind: 'studio.user', data: { text: content } } }, context)).wait(context);
const entries = async (c: Conversation) => (await c.entries({ order: 'ascending' }, 500, undefined, context)).items;
const userEntry = async (c: Conversation, word: string): Promise<EntryId> => (await entries(c)).find(e => e.kind === 'studio.user' && JSON.stringify(e.data).includes(word))!.id;

/** What the chat does on a stop whose abort does not settle. */
async function stuckThenFork(harness: Harness, c: Conversation, seen: Request[], word: string) {
  const before = seen.length;
  void ask(c, word).catch(() => undefined);
  const deadline = Date.now() + 5_000;
  while (seen.length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(seen.length).toBe(before + 1);
  expect(await within(100, c.abort(context))).toBe('late');
  const fork = await within(2_000, c.fork(await userEntry(c, word), { ownership: { kind: 'ownerless' } }, context));
  expect(fork).not.toBe('late');
  void harness;
  return fork as Conversation;
}

describe('stuck-run fork (pi-durable, real SQLite, a provider that ignores the abort)', () => {
  it('the parent stays busy; the fork is idle, has the stopped prompt, and answers at once', async () => {
    const { harness, create, seen } = await setup();
    const parent = await create();
    await ask(parent, 'ALPHA');
    const fork = await stuckThenFork(harness, parent, seen, 'STUCK_BRAVO');
    await expect(parent.submit({ type: 'input', content: 'x', whenBusy: 'reject' }, context)).rejects.toBeInstanceOf(ConversationBusy);
    expect(await within(2_000, fork.submit({ type: 'write', entry: { kind: 'studio.note', data: { text: 'Stopped' } } }, context).then(s => s.wait(context)))).not.toBe('late');
    const started = Date.now();
    expect(await within(2_000, ask(fork, 'CHARLIE'))).toMatchObject({ status: 'done' });
    expect(Date.now() - started).toBeLessThan(1_000);
    const request = JSON.stringify(seen.at(-1)!.messages);
    for (const word of ['ALPHA', 'SOURCE_FOR', 'STUCK_BRAVO', 'CHARLIE']) expect(request).toContain(word);
    expect(request).not.toContain('Stopped');
    // A fresh provider session, so nothing on the provider side links the branches.
    expect((await harness.snapshot(ProviderDoc, fork.id, context))).not.toEqual(await harness.snapshot(ProviderDoc, parent.id, context));
    // Every tool call has its result.
    const roles = seen.at(-1)!.messages.map(m => m.role).filter(r => r !== 'system');
    expect(roles).toEqual(['user', 'assistant', 'toolResult', 'user', 'user']);
  });

  it.each([
    ['a tool call', () => call('LATE_SOURCE')],
    ['nothing useful', () => fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'late' })],
  ])('the late answer (%s) never reaches the fork, and never runs a tool', async (_name, late) => {
    const { harness, create, seen, releases } = await setup();
    const parent = await create();
    await ask(parent, 'ALPHA');
    const fork = await stuckThenFork(harness, parent, seen, 'STUCK_BRAVO');
    await ask(fork, 'CHARLIE');
    const before = JSON.stringify(await entries(fork));
    checks.length = 0;
    releases[0]!(late());
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(JSON.stringify(await entries(fork))).toBe(before);
    expect(JSON.stringify(await entries(fork))).not.toContain('LATE_SOURCE');
    expect(checks).toEqual([]);
    await ask(fork, 'DELTA');
    expect(JSON.stringify(seen.at(-1)!.messages)).not.toContain('LATE_SOURCE');
  });

  it('five stuck runs in a row do not starve the scheduler: the sixth answers in normal time, other conversations too', async () => {
    const { harness, create, seen } = await setup();
    let current = await create();
    const other = await create();
    await ask(current, 'ALPHA');
    for (let i = 0; i < 5; i++) current = await stuckThenFork(harness, current, seen, `STUCK_${i}`);
    const started = Date.now();
    expect(await within(2_000, ask(current, 'SIXTH'))).toMatchObject({ status: 'done' });
    expect(await within(2_000, ask(other, 'OTHER'))).toMatchObject({ status: 'done' });
    expect(Date.now() - started).toBeLessThan(1_000);
    const request = JSON.stringify(seen.filter(r => JSON.stringify(r).includes("SIXTH")).at(-1)!.messages);
    for (const word of ['ALPHA', 'STUCK_0', 'STUCK_4', 'SIXTH']) expect(request).toContain(word);
    expect(request).not.toContain('OTHER');
  });

  it.each(['SIGTERM', 'SIGKILL'] as const)('after a real %s with the abandoned parent live: no request at open, and the fork continues', { timeout: 60_000 }, async signal => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-stuck-process-'));
    dirs.push(dir);
    const logPath = join(dir, 'child.log');
    writeFileSync(logPath, '');
    const run = (stage: string, extra: Record<string, string> = {}) => spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/chat-stuck-child.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, CHILD_STAGE: stage, CHILD_DATA_DIR: dir, CHILD_LOG: logPath, ...extra },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const line = (child: ReturnType<typeof spawn>, word: string) => new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout!.on('data', chunk => { out += String(chunk); const match = new RegExp(`${word} (.*)`).exec(out); if (match) resolve(match[1]!); });
      child.once('exit', () => reject(new Error(`exited before ${word}`)));
    });
    const first = run('first');
    const [forkId, parentId] = (await line(first, 'FORKED')).split(' ');
    const exited = new Promise(resolve => first.once('exit', (code, sig) => resolve({ code, sig })));
    first.kill(signal);
    expect(await exited).toEqual(signal === 'SIGTERM' ? { code: 0, sig: null } : { code: null, sig: 'SIGKILL' });

    const second = run('second', { CHILD_FORK: forkId!, CHILD_PARENT: parentId! });
    const result = JSON.parse(await line(second, 'RESULT')) as { left: number[]; status: string; live: number; parentEntries: string[] };
    // The abandoned parent was found, it alone, and ended.
    expect(result.left.length).toBeGreaterThan(0);
    expect(new Set(result.left)).toEqual(new Set([Number(parentId)]));
    expect(result.status).toBe('done');
    expect(result.live).toBe(0);
    const log = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { type: string; stage?: string; messages?: unknown });
    const opened = log.findIndex(e => e.type === 'opened');
    expect(opened).toBeGreaterThan(0);
    // No model request between the open and CHARLIE; exactly one for CHARLIE, with the earlier turns and the stopped prompt.
    const secondRequests = log.filter(e => e.type === 'request' && e.stage === 'second');
    expect(secondRequests).toHaveLength(1);
    expect(log.slice(0, opened).filter(e => e.stage === 'second')).toEqual([]);
    const request = JSON.stringify(secondRequests[0]!.messages);
    for (const word of ['ALPHA', 'STUCK_BRAVO', 'CHARLIE']) expect(request).toContain(word);
  });
});
