// S10 item 0: what the chat design assumes about pi-durable, run for real (faux provider, SQLite file in a temp dir).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, defineExtension, defineTool, Harness, type Conversation } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { obj, str } from '@earendil-works/pi-schema';

type Request = { systemPrompt?: string; messages: { role: string; content: unknown }[] };
const dirs: string[] = [];
const open: Harness[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(h => h.close(context).catch(() => undefined)));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const check = defineTool({
  name: 'check',
  description: 'check',
  parameters: obj({ source: str() }),
  execute: async args => (args.source.includes('bad')
    ? { output: [{ type: 'text' as const, text: 'nope' }], isError: true }
    : { output: [{ type: 'text' as const, text: 'OK' }], control: { terminate: true } }),
});
const call = (source: string) => fauxAssistantMessage([fauxToolCall('check', { source })], { stopReason: 'toolUse' });

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-probe-'));
  dirs.push(dir);
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const extension = defineExtension({ name: 'probe', tools: [check] });
  const registry = createRegistry();
  registry.install(extension);
  const storage = await openNodeSqliteStorage(join(dir, 'pi.sqlite'));
  const harness = await Harness.open(storage, { models, registry }, context);
  open.push(harness);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } }, context);
  const seen: Request[] = [];
  const reply = (message: unknown) => (ctx: Request) => { seen.push(JSON.parse(JSON.stringify(ctx)) as Request); return message; };
  const script = (...messages: unknown[]) => faux.setResponses(messages.map(reply) as never);
  return { faux, conversation, seen, script };
}
const ask = async (conversation: Conversation, content: string, entry?: { kind: string; data: { text: string } }) =>
  (await conversation.submit({ type: 'input', content, ...(entry ? { entry } : {}) }, context)).wait(context);
const entries = async (conversation: Conversation) => (await conversation.entries({ order: 'ascending' }, 200, undefined, context)).items;

describe('pi-durable probes (S10 item 0)', () => {
  it('(a) a run ended by terminate can be continued, and the next request has the earlier turn', async () => {
    const { conversation, seen, script } = await setup();
    script(call('SOURCE_ONE'), call('SOURCE_TWO'));
    expect((await ask(conversation, 'PROMPT_ONE')).status).toBe('done');
    expect(seen).toHaveLength(1);
    expect((await ask(conversation, 'PROMPT_TWO')).status).toBe('done');
    expect(seen).toHaveLength(2);
    const second = JSON.stringify(seen[1]!.messages);
    expect(second).toContain('PROMPT_ONE');
    expect(second).toContain('SOURCE_ONE');
    expect(second).toContain('PROMPT_TWO');
    // Every tool call in the continued request has its result, in order.
    expect(seen[1]!.messages.map(m => m.role).filter(role => role !== 'system')).toEqual(['user', 'assistant', 'toolResult', 'user']);
  });

  it('(b) a { kind, data } write is stored but is not in the model messages', async () => {
    const { conversation, seen, script } = await setup();
    script(call('s1'), call('s2'));
    await ask(conversation, 'one');
    await (await conversation.submit({ type: 'write', entry: { kind: 'studio.reply', data: { text: 'WRITE_SENTINEL' } } }, context)).wait(context);
    await ask(conversation, 'two');
    expect((await entries(conversation)).filter(e => e.kind === 'studio.reply')).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain('WRITE_SENTINEL');
  });

  it('(c) an input with a custom entry shows the model content only', async () => {
    const { conversation, seen, script } = await setup();
    script(call('s1'));
    await ask(conversation, 'CONTENT_SENTINEL', { kind: 'studio.user', data: { text: 'DATA_SENTINEL' } });
    const request = JSON.stringify(seen[0]);
    expect(request).toContain('CONTENT_SENTINEL');
    expect(request).not.toContain('DATA_SENTINEL');
    const stored = (await entries(conversation)).find(e => e.kind === 'studio.user');
    expect(stored?.data).toEqual({ text: 'DATA_SENTINEL' });
  });

  it('(d) a fork at entry X has nothing after X, in its context, its entries and its next request', async () => {
    const { conversation, seen, script } = await setup();
    script(call('SOURCE_ALPHA'), call('SOURCE_BRAVO'), call('SOURCE_DELTA'));
    await ask(conversation, 'ALPHA', { kind: 'studio.user', data: { text: 'ALPHA' } });
    await (await conversation.submit({ type: 'write', entry: { kind: 'studio.reply', data: { text: 'REPLY_ALPHA' } } }, context)).wait(context);
    await ask(conversation, 'BRAVO', { kind: 'studio.user', data: { text: 'BRAVO' } });
    const all = await entries(conversation);
    const bravo = all.find(e => e.kind === 'studio.user' && JSON.stringify(e.data).includes('BRAVO'))!;
    const before = all[all.indexOf(bravo) - 1]!;
    expect(before.kind).toBe('studio.reply');
    const fork = await conversation.fork(before.id, { ownership: { kind: 'ownerless' } }, context);
    const view = JSON.stringify((await fork.context(context)).messages);
    expect(view).toContain('ALPHA');
    expect(view).not.toContain('BRAVO');
    const kept = await entries(fork);
    expect(JSON.stringify(kept)).toContain('REPLY_ALPHA');
    expect(JSON.stringify(kept)).not.toContain('BRAVO');
    await ask(fork, 'DELTA');
    const request = JSON.stringify(seen[2]);
    expect(request).toContain('ALPHA');
    expect(request).toContain('SOURCE_ALPHA');
    expect(request).toContain('DELTA');
    expect(request).not.toContain('BRAVO');
    // The parent is unaffected.
    expect(JSON.stringify(await entries(conversation))).toContain('BRAVO');
  });

  it('(extra) maxTurns is per run: three runs of 2 rounds each all pass under maxTurns 2', async () => {
    const { conversation, script } = await setup();
    await conversation.configure({ maxTurns: 2 }, context);
    script(call('bad'), call('a'), call('bad'), call('b'), call('bad'), call('c'));
    for (const prompt of ['one', 'two', 'three']) expect((await ask(conversation, prompt)).status).toBe('done');
  });

  it('(extra) a text answer settles done, and the next input continues', async () => {
    const { conversation, seen, script } = await setup();
    script(fauxAssistantMessage([fauxText('TEXT_ANSWER')]), call('s'));
    expect((await ask(conversation, 'question')).status).toBe('done');
    expect((await ask(conversation, 'next')).status).toBe('done');
    expect(JSON.stringify(seen[1])).toContain('TEXT_ANSWER');
  });
});
