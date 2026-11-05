import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, defineExtension, Harness } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { chatExtension, createChats, MAX_SOURCE } from '../server/chat.js';
import { createLlm, openStorage, type Llm, type ExplorationCapabilities } from '../server/llm.js';

const call = (name: string, args: object) => fauxAssistantMessage([fauxToolCall(name, args as never)], { stopReason: 'toolUse' });
const say = (text: string) => fauxAssistantMessage([fauxText(text)]);
const check = (source: string) => source === 'bad' ? { ok: false as const, stage: 'compile' as const, message: 'Unknown table' } : { ok: true as const, sql: 'SELECT 1', rowType: '{}', columns: [{ name: 'x', type: 'UInt8' }] };
let llm: Llm | undefined;
const dirs: string[] = [];
afterEach(async () => { await llm?.close(); llm = undefined; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function setup() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  const model = { provider: m.provider, modelId: m.id };
  const exploration = Object.fromEntries(['query_run', 'query_results_get', 'tables_list', 'table_describe', 'columns_describe', 'docs_search', 'docs_read'].map(name => [name, vi.fn(async () => ({ ok: true, rows: [{ x: 1 }] }))])) as unknown as ExplorationCapabilities;
  llm = await createLlm({ models, model, schema: () => '', check, exploration });
  return { faux, models, model, exploration, chat: llm.chat };
}

it('persists an empty identity and exposes durable calls while a tool is held, then its output', async () => {
  const { faux, chat, exploration } = await setup();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(exploration.docs_read).mockImplementation(async () => { entered(); await held; return { body: 'PUBLIC_OUTPUT' }; });
  faux.setResponses([fauxAssistantMessage([fauxText('Looking it up.'), fauxToolCall('docs_read', { id: 'guide' })], { stopReason: 'toolUse' }), say('Final answer.')]);
  const created = await chat.create();
  expect(await chat.get(created.id)).toMatchObject({ turns: [], activity: [], generating: false });
  const sending = chat.send({ chatId: created.id, source: '', text: 'Read guide' });
  await started;
  try {
    const live = (await chat.get(created.id))!;
    expect(live.generating).toBe(true);
    expect(live.activity).toMatchObject([
      { kind: 'text', text: 'Looking it up.', afterUserId: live.turns[0]!.id },
      { kind: 'toolCall', toolName: 'docs_read', arguments: '{"id":"guide"}', status: 'running' },
    ]);
    const callId = live.activity[1]!.id;
    release();
    await sending;
    const done = (await chat.get(created.id))!;
    expect(done.activity).toHaveLength(3);
    expect(done.activity[1]).toMatchObject({ id: callId, status: 'success' });
    expect(done.activity[2]).toMatchObject({ kind: 'toolResult', text: expect.stringContaining('PUBLIC_OUTPUT'), isError: false });
    expect(done.turns.at(-1)).toMatchObject({ kind: 'text', text: 'Final answer.' });
    expect(await chat.list()).toHaveLength(1);
    expect(done.title).toBe('Read guide');
  } finally { release(); await sending; }
});

it('marks a held tool interrupted after stop without letting a late result change the thread', async () => {
  const { faux, chat, exploration } = await setup();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(exploration.docs_read).mockImplementation(async () => { entered(); await held; return { body: 'LATE_OUTPUT' }; });
  faux.setResponses([call('docs_read', { id: 'guide' })]);
  const created = await chat.create();
  const sending = chat.send({ chatId: created.id, source: '', text: 'Read' });
  await started;
  try {
    await chat.stop(created.id);
    expect(await sending).toMatchObject({ stopped: true });
    const stopped = (await chat.get(created.id))!;
    expect(stopped.activity).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'toolCall', status: 'interrupted', afterUserId: stopped.turns[0]!.id })]));
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((await chat.get(created.id))!.activity).toEqual(stopped.activity);
    // Tool-call IDs are provider-owned; a later user turn may reuse one from an abandoned run.
    const abandoned = stopped.activity.find(item => item.kind === 'toolCall');
    if (abandoned?.kind !== 'toolCall') throw new Error('Missing abandoned call');
    faux.setResponses([fauxAssistantMessage([{ ...fauxToolCall('docs_read', { id: 'next' }), id: abandoned.toolCallId }], { stopReason: 'toolUse' }), say('Read it.')]);
    await chat.send({ chatId: created.id, source: '', text: 'Read another page' });
    const continued = (await chat.get(created.id))!;
    const newestUser = continued.turns.filter(turn => turn.kind === 'user').at(-1)!;
    expect(continued.activity).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'toolResult', afterUserId: newestUser.id, status: 'success' })]));
  } finally { release(); await sending; }
});

it('preserves multiple call IDs and public blocks without exposing reasoning or duplicating final blocks', async () => {
  const { faux, chat } = await setup();
  const first = fauxToolCall('docs_read', { id: 'one' });
  const second = fauxToolCall('docs_read', { id: 'two' });
  faux.setResponses([
    fauxAssistantMessage([fauxThinking('SECRET_REASONING'), fauxText('First.'), first, fauxText('Second.'), second], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxThinking('SECRET_FINAL'), fauxText('Final '), fauxText('answer.')]),
  ]);
  const sent = await chat.send({ chatId: null, source: '', text: 'read' });
  const detail = (await chat.get(sent.chatId!))!;
  expect(detail.activity.map(a => a.kind)).toEqual(['text', 'toolCall', 'text', 'toolCall', 'toolResult', 'toolResult']);
  expect(detail.activity.filter(a => a.kind === 'toolCall').map(a => a.toolCallId)).toEqual([first.id, second.id]);
  expect(detail.activity.filter(a => a.kind === 'toolResult').map(a => a.toolCallId)).toEqual([first.id, second.id]);
  expect(JSON.stringify(detail)).not.toContain('SECRET_');
  expect(detail.turns.at(-1)).toMatchObject({ kind: 'text', text: 'Final answer.' });
});

it('exposes errors and explicit truncation, and hides replaced activity on a fork', async () => {
  const { faux, chat, exploration } = await setup();
  vi.mocked(exploration.docs_read).mockRejectedValue(new Error('FAILED_READ' + 'x'.repeat(20_000)));
  faux.setResponses([call('docs_read', { id: 'x'.repeat(20_000) }), say('Cannot read.'), say('Replacement.')]);
  const sent = await chat.send({ chatId: null, source: '', text: 'read' });
  const detail = (await chat.get(sent.chatId!))!;
  expect(detail.activity[0]).toMatchObject({ kind: 'toolCall', status: 'error', truncated: true });
  expect(detail.activity[1]).toMatchObject({ kind: 'toolResult', status: 'error', isError: true, truncated: true });
  await chat.send({ chatId: sent.chatId, source: '', text: 'replace', replaceFrom: detail.turns[0]!.id });
  expect((await chat.get(sent.chatId!))!.activity).toEqual([]);
});

it.each(['query_validate', 'chart_validate'])('%s is nonterminal and cannot produce a version', async name => {
  const { faux, chat } = await setup();
  faux.setResponses([call(name, { source: 'good', spec: { mark: 'bar', encoding: { x: { field: 'x' } } } }), say('Validated only.')]);
  expect(await chat.send({ chatId: null, source: '', text: 'inspect' })).toMatchObject({ ok: true, turn: { kind: 'text', attempts: 0, text: 'Validated only.' } });
});

it('failed exploratory validation followed by text is not a failed apply', async () => {
  const { faux, chat } = await setup();
  faux.setResponses([call('query_validate', { source: 'bad' }), say('That table does not exist.')]);
  expect(await chat.send({ chatId: null, source: '', text: 'inspect' })).toMatchObject({ ok: true, turn: { kind: 'text', attempts: 0 } });
});

it('explores, validates, runs then applies, scoped to the conversation', async () => {
  const { faux, chat, exploration } = await setup();
  faux.setResponses([call('tables_list', {}), call('query_validate', { source: 'good' }), call('query_run', { source: 'good' }), call('query_apply', { source: 'good', summary: 'Done' }), say('Must not run')]);
  const result = await chat.send({ chatId: null, source: '', text: 'make it' });
  expect(result).toMatchObject({ ok: true, turn: { kind: 'version', attempts: 1, source: 'good' } });
  const owner = (await chat.get(result.chatId!))!.conversationId;
  expect(exploration.tables_list).toHaveBeenCalledWith({}, owner);
  expect(exploration.query_run).toHaveBeenCalledWith({ source: 'good' }, owner);
});

it('forwards opaque cursors and documentation IDs without inventing offsets', async () => {
  const { faux, chat, exploration } = await setup();
  const requests = [
    ['tables_list', { search: 'event', cursor: 'tables-token' }],
    ['table_describe', { table: 'events', cursor: 'columns-token' }],
    ['query_results_get', { resultId: 'result', cursor: 'rows-token' }],
    ['docs_search', { query: 'joins', cursor: 'search-token' }],
    ['docs_read', { id: 'query-builder/joins', cursor: 'document-token' }],
  ] as const;
  faux.setResponses([...requests.map(([name, args]) => call(name, args)), say('Read all pages.')]);
  const result = await chat.send({ chatId: null, source: '', text: 'continue reading' });
  expect(result).toMatchObject({ ok: true, turn: { kind: 'text', attempts: 0 } });
  const owner = (await chat.get(result.chatId!))!.conversationId;
  for (const [name, args] of requests) expect(exploration[name]).toHaveBeenCalledWith(args, owner);
});

it('wraps exploration exceptions and rejects oversized runs before dispatch', async () => {
  const { faux, chat, exploration } = await setup();
  vi.mocked(exploration.docs_read).mockRejectedValue(new Error('Unknown page; use docs_search'));
  const seen: string[] = [];
  faux.setResponses([call('docs_read', { id: 'missing' }), ((ctx: unknown) => { seen.push(JSON.stringify(ctx)); return call('query_run', { source: 'x'.repeat(MAX_SOURCE + 1) }); }) as never, ((ctx: unknown) => { seen.push(JSON.stringify(ctx)); return say('Unable to run.'); }) as never]);
  expect(await chat.send({ chatId: null, source: '', text: 'inspect' })).toMatchObject({ ok: true, turn: { kind: 'text', attempts: 0 } });
  expect(seen.join('\n')).toContain('Unknown page; use docs_search');
  expect(seen.join('\n')).toContain('Shorten the query');
  expect(exploration.query_run).not.toHaveBeenCalled();
});

it.each(['check_query', 'check_chart'])('continues persisted %s history without exposing legacy aliases', async legacyName => {
  const { faux, models, model } = await setup();
  await llm!.close();
  llm = undefined;
  const dir = mkdtempSync(join(tmpdir(), 'studio-legacy-tools-'));
  dirs.push(dir);
  const storage = await openStorage(dir);
  const current = chatExtension({ guide: '', schema: () => '', check });
  const legacy = defineExtension({ name: 'typedhouse-chat', tools: current.tools!.filter(t => t.name === 'query_apply' || t.name === 'chart_apply').map(t => ({ ...t, name: t.name === 'query_apply' ? 'check_query' : 'check_chart' })) });
  const registry = createRegistry();
  registry.install(legacy);
  const harness = await Harness.open(storage, { models, registry }, context);
  const oldChat = createChats(harness, { extension: legacy as typeof current, model: () => model, maxTurns: 6, timeoutMs: 10_000, abortGraceMs: 100, check, exclusive: async (_busy, _fail, work) => work() });
  faux.setResponses([call(legacyName, { source: 'old', ...(legacyName === 'check_chart' ? { spec: { mark: 'bar', encoding: { x: { field: 'x' } } } } : {}) })]);
  const first = await oldChat.send({ chatId: null, source: '', text: 'old query' });
  expect(first).toMatchObject({ ok: true, turn: { kind: 'version', source: 'old' } });
  await harness.close(context);
  let request = '';
  faux.setResponses([((ctx: unknown) => { request = JSON.stringify(ctx); return say('Still readable.'); }) as never]);
  llm = await createLlm({ models, model, schema: () => '', check, storage: await openStorage(dir) });
  expect(await llm.chat.send({ chatId: first.chatId, source: 'old', text: 'explain' })).toMatchObject({ ok: true, turn: { kind: 'text', attempts: 0 } });
  expect(request).toContain(legacyName);
  expect(current.tools!.map(t => t.name)).not.toContain('check_query');
  expect((await llm.chat.get(first.chatId!))!.turns.map(t => t.kind)).toEqual(['user', 'version', 'user', 'text']);
});
