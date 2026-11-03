import { afterEach, describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { parseCHType } from '@typedhouse/core';
import { renderSchema, type DatabaseSchema } from '@typedhouse/codegen';
import { editorScope, prepare, schemaScope, StudioError } from '../server/eval.js';
import { createLlm, unavailableLlm, type CheckResult, type Llm } from '../server/llm.js';

const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
const schema: DatabaseSchema = {
  functions: [],
  tables: [{ name: 'events', engine: 'MergeTree', sortingKey: [], partitionKey: [], primaryKey: [], columns: [column('country', 'String', 1), column('amount', 'Float64', 2)] }],
};
const scope = editorScope(schemaScope(schema));
const checked: string[] = [];
function check(source: string): CheckResult {
  checked.push(source);
  try {
    const p = prepare(source, scope, { autoLimit: false });
    return { ok: true, sql: p.compiled.sql, rowType: p.rowType };
  } catch (error) {
    if (error instanceof StudioError) return { ok: false, stage: error.stage, message: error.message };
    throw error;
  }
}

const good = 'export default from(events).groupBy(e => ({ country: e.country })).aggregate(g => ({ revenue: sum(g.amount) }))';
const bad = 'export default from(evnts)';

let llm: Llm | undefined;
afterEach(async () => { await llm?.close(); llm = undefined; checked.length = 0; });

async function setup(maxTurns?: number, extra: { timeoutMs?: number; abortGraceMs?: number } = {}) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  llm = await createLlm({ models, model: { provider: model.provider, modelId: model.id }, schema: () => renderSchema(schema), check, ...(maxTurns ? { maxTurns } : {}), ...extra });
  return { faux, llm };
}
const call = (source: string) => fauxAssistantMessage([fauxToolCall('check_query', { source })], { stopReason: 'toolUse' });

describe('generateQuery (faux provider)', () => {
  it('(a) returns the checked source after one attempt, without asking the model again', async () => {
    const { faux, llm } = await setup();
    faux.setResponses([call(good)]);
    const result = await llm.generateQuery({ prompt: 'revenue by country' });
    expect(result).toMatchObject({ ok: true, source: good, attempts: 1, rowType: '{ country: string; revenue: number }' });
    if (result.ok) expect(result.sql).toContain('sum(');
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(faux.state.callCount).toBe(1);
  });

  it('(b) feeds the check error back and accepts the fixed source on the second attempt', async () => {
    const { faux, llm } = await setup();
    faux.setResponses([call(bad), call(good)]);
    const result = await llm.generateQuery({ prompt: 'revenue by country' });
    expect(result).toMatchObject({ ok: true, source: good, attempts: 2 });
    // The passing source is checked once more server-side before it is returned.
    expect(checked).toEqual([bad, good, good]);
    expect(faux.state.callCount).toBe(2);
  });

  it('(c) stops at the turn limit with the last error and the best source, not marked as passing', async () => {
    const { faux, llm } = await setup(3);
    faux.setResponses(Array.from({ length: 5 }, () => call(bad)));
    const result = await llm.generateQuery({ prompt: 'revenue by country' });
    expect(result).toMatchObject({ ok: false, source: bad, attempts: 3 });
    if (!result.ok) expect(result.error).toMatch(/No valid query after 3 attempts.*evnts is not defined/s);
    expect(faux.state.callCount).toBe(3);
  });

  it('reports a model that answers without calling check_query', async () => {
    const { faux, llm } = await setup();
    faux.setResponses([fauxAssistantMessage([fauxText('Here you go: from(events)')])]);
    expect(await llm.generateQuery({ prompt: 'x' })).toMatchObject({ ok: false, source: null, attempts: 0, error: expect.stringMatching(/without a query/) });
  });

  it('reports a provider error cleanly', async () => {
    const { faux, llm } = await setup();
    faux.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'quota exceeded' })]);
    const result = await llm.generateQuery({ prompt: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/model stopped|quota/);
  });

  it('puts the schema and the current editor source in front of the model', async () => {
    const { faux, llm } = await setup();
    let seen = '';
    faux.setResponses([(ctx: { systemPrompt?: string; messages: { content: unknown }[] }) => {
      seen = `${ctx.systemPrompt ?? ''}\n${JSON.stringify(ctx.messages)}`;
      return call(good);
    }] as never);
    await llm.generateQuery({ prompt: 'only Germany', source: 'export default from(events)' });
    expect(seen).toMatch(/table\(\\?"events\\?"/);
    expect(seen).toContain('only Germany');
    expect(seen).toContain('export default from(events)');
  });
});

describe('prompt guidance (F4b, F6) and abort fallback (F1)', () => {
  it('asks for one chained call per line and labelled unionAll branches', async () => {
    const { faux, llm } = await setup();
    let system = '';
    faux.setResponses([((ctx: { systemPrompt?: unknown }) => { system = JSON.stringify(ctx); return call(good); }) as never]);
    await llm.generateQuery({ prompt: 'x' });
    expect(system).toContain('one chained call per line');
    expect(system).toContain("source: val('<table>')");
  });

  it('a unionAll with val() labels, as the guidance shows, passes check_query', async () => {
    const { faux, llm } = await setup();
    const union = [
      'export default unionAll(',
      "  from(events).map(e => ({ source: val('events'), amount: e.amount })),",
      "  from(events).where(e => e.amount.gt(0)).map(e => ({ source: val('positive'), amount: e.amount })),",
      ')',
      '  .groupBy(r => ({ source: r.source }))',
      '  .aggregate(g => ({ rows: count(), total: sum(g.amount) }))',
    ].join('\n');
    faux.setResponses([call(union)]);
    expect(await llm.generateQuery({ prompt: 'rows per table' })).toMatchObject({ ok: true, source: union, attempts: 1, rowType: '{ source: string; rows: bigint; total: number }' });
  });

  it('a provider that ignores the abort signal cannot hang generation, and the next one is accepted', async () => {
    const { faux, llm } = await setup(undefined, { timeoutMs: 300, abortGraceMs: 200 });
    // Ignores the abort signal entirely; answers only after 3 s.
    faux.setResponses([(() => new Promise(resolve => setTimeout(() => resolve(call(bad)), 3_000))) as never]);
    const started = Date.now();
    const hung = await llm.generateQuery({ prompt: 'countries' });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(hung).toMatchObject({ ok: false, error: expect.stringMatching(/timed out/) });
    faux.setResponses([call(good)]);
    expect(await llm.generateQuery({ prompt: 'again' })).toMatchObject({ ok: true, source: good });
  }, 20_000);
});

describe('unavailableLlm', () => {
  it('never throws and explains why', async () => {
    const off = unavailableLlm('no credentials');
    expect(off.status).toEqual({ available: false, reason: 'no credentials' });
    expect(await off.generateQuery({ prompt: 'x' })).toMatchObject({ ok: false, error: 'LLM unavailable: no credentials', attempts: 0 });
  });
});
