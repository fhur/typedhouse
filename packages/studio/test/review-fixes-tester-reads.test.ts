// Independent tester: the page's guess for the user turn, `reply.id - 1`, can never act on the wrong turn.
import { afterEach, describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createLlm, type ExplorationCapabilities, type Llm } from '../server/llm.js';

const call = (name: string, args: object) => fauxToolCall(name, args as never);
const round = (...calls: ReturnType<typeof call>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' });
const say = (text: string) => fauxAssistantMessage([fauxText(text)]);
const check = async (source: string) => source === 'bad' ? { ok: false as const, stage: 'compile' as const, message: 'Unknown table' } : { ok: true as const, sql: 'SELECT 1', rowType: '{}', columns: [{ name: 'x', type: 'UInt8' }] };
const TOOLS = ['query_run', 'query_results_get', 'tables_list', 'table_describe', 'columns_describe', 'docs_search', 'docs_read'];

let llm: Llm | undefined;
afterEach(async () => { await llm?.close(); llm = undefined; });
async function setup() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  const exploration = Object.fromEntries(TOOLS.map(name => [name, async () => ({ rows: [] })])) as unknown as ExplorationCapabilities;
  llm = await createLlm({ models, model: { provider: m.provider, modelId: m.id }, schema: () => '', check, exploration, abortGraceMs: 400, maxTurns: 6 });
  return { faux, chat: llm.chat };
}

type Scenario = [string, (s: Awaited<ReturnType<typeof setup>>, id: string) => Promise<{ replaceFrom?: number } | void>, unknown[]];
const scenarios: Scenario[] = [
  ['a version', async () => undefined, [round(call('query_apply', { source: 'two' }))]],
  ['a text reply', async () => undefined, [say('words')]],
  ['a text reply after exploring', async () => undefined, [round(call('tables_list', {})), say('words')]],
  ['an error turn', async () => undefined, [round(call('query_apply', { source: 'bad' })), say('gave up')]],
  ['a reply after a note', async (s, id) => { await s.chat.note(id, 'Restored v1 to the editor.'); }, [round(call('query_apply', { source: 'two' }))]],
  ['a text reply after a note', async (s, id) => { await s.chat.note(id, 'Restored v1 to the editor.'); }, [say('words')]],
  ['a resend of the last message', async (s, id) => ({ replaceFrom: (await s.chat.get(id))!.turns.filter(t => t.kind === 'user').at(-1)!.id }), [round(call('query_apply', { source: 'two' }))]],
  ['a resend of the first message', async (s, id) => ({ replaceFrom: (await s.chat.get(id))!.turns.filter(t => t.kind === 'user')[0]!.id }), [say('words')]],
];

describe('the guess for the user turn, reply.id - 1', () => {
  it.each(scenarios)('%s: resending with the guess is the right turn or refused, and a refusal changes nothing', async (_name, before, responses) => {
    const s = await setup();
    s.faux.setResponses([round(call('query_apply', { source: 'one' }))]);
    const created = await s.chat.create();
    await s.chat.send({ chatId: created.id, source: '', text: 'first' });
    const extra = await before(s, created.id) ?? {};
    s.faux.setResponses(responses as never);
    const sent = await s.chat.send({ chatId: created.id, source: 'one', text: 'target', ...extra });
    const reply = (sent as { turn: { id: number } }).turn;
    const stored = (await s.chat.get(created.id))!;
    const realUser = stored.turns.filter(t => t.kind === 'user').at(-1)!.id;
    const guess = reply.id - 1;
    const ids = stored.turns.map(t => t.id);
    s.faux.setResponses([say('resent')]);
    const resent = await s.chat.send({ chatId: created.id, source: 'one', text: 'via the guess', replaceFrom: guess });
    const after = (await s.chat.get(created.id))!;
    if (guess === realUser) {
      expect(resent).toMatchObject({ ok: true });
      expect(after.turns.map(t => t.kind === 'user' ? t.text : undefined)).not.toContain('target');
    } else {
      expect(resent).toMatchObject({ ok: false, error: expect.stringContaining('is not a message of this chat') });
      expect(after.turns.map(t => t.id)).toEqual(ids);
    }
  });

  it('a stop before the model answers: the guess is the user turn itself', async () => {
    const s = await setup();
    let asked!: () => void;
    const seen = new Promise<void>(resolve => { asked = resolve; });
    s.faux.setResponses([(() => { asked(); return new Promise(() => undefined); }) as never]);
    const created = await s.chat.create();
    const sending = s.chat.send({ chatId: created.id, source: '', text: 'stopped' });
    await seen;
    await s.chat.stop(created.id);
    const sent = await sending;
    const reply = (sent as { turn: { id: number; kind: string } }).turn;
    expect(reply.kind).toBe('note');
    const stored = (await s.chat.get(created.id))!;
    const user = stored.turns.find(t => t.kind === 'user')!;
    expect(reply.id - 1 === user.id || !stored.turns.some(t => t.id === reply.id - 1)).toBe(true);
  });
});
