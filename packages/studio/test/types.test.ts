import { afterAll, describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { parseCHType } from '@typedhouse/core';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { editorScope, prepare, schemaScope, StudioError } from '../server/eval.js';
import { createLlm, type CheckResult } from '../server/llm.js';
import { createTypeService, shorten } from '../server/types.js';

const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
const table = (name: string, columns: ReturnType<typeof column>[]) => ({ name, engine: 'MergeTree', sortingKey: [], partitionKey: [], primaryKey: [], columns });
const schema: DatabaseSchema = {
  functions: [],
  tables: [
    table('entity_ots_component', [column('tenantId', 'String', 1), column('entityId', 'String', 2), column('category', 'Nullable(String)', 3), column('countOfParts', 'UInt64', 4), column('updatedAt', 'DateTime64(3)', 5)]),
    table('from', [column('id', 'UInt32', 1)]),
  ],
};
const types = createTypeService();
types.setSchema(schema);
const errors = (source: string) => types.diagnostics(source).filter(d => d.severity === 'error');
const at = (source: string, marker: string, offset = 0) => source.indexOf(marker) + offset;

describe('type service (R12)', () => {
  it('the no-import contract type-checks, and so does an explicit core import', () => {
    expect(errors('export default from(entity_ots_component).where(c => c.entityId.eq("x"))')).toEqual([]);
    expect(errors("import { from, count } from '@typedhouse/core';\nexport default from(entity_ots_component).aggregate(() => ({ n: count() }))")).toEqual([]);
    expect(errors('const query = from(db.entity_ots_component).map(c => ({ id: c.entityId }))')).toEqual([]);
  });

  it('a wrong operand type gives one error at the operand, with a short message', () => {
    const source = 'export default from(entity_ots_component).where(c => c.entityId.eq(1))';
    const found = errors(source);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ from: at(source, 'eq(1)', 3), to: at(source, 'eq(1)', 4), line: 1 });
    expect(found[0]!.message).toBe("Argument of type '1' is not assignable to parameter of type 'Operand<string | null>'.");
    expect(found[0]!.message.length).toBeLessThanOrEqual(300);
  });

  it('an unknown column is an error, with the row type collapsed', () => {
    const found = errors('export default from(entity_ots_component).where(c => c.nope.eq("x"))');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe("Property 'nope' does not exist on type 'DescribedRow<…>'.");
    expect(found[0]!.full.length).toBeGreaterThan(found[0]!.message.length);
  });

  it('member completions after c. list the columns with their ClickHouse types', () => {
    const source = 'export default from(entity_ots_component).where(c => c.';
    const { from, items } = types.completions(source, source.length);
    expect(from).toBe(source.length);
    expect(items.filter(i => i.kind === 'column').map(i => [i.label, i.detail])).toEqual([
      ['category', 'Nullable(String)'], ['countOfParts', 'UInt64'], ['entityId', 'String'], ['tenantId', 'String'], ['updatedAt', 'DateTime64(3)'],
    ]);
  });

  it('builder methods after a query, and tables/db/core at the top level (F13 names)', () => {
    const builder = 'export default from(entity_ots_component).';
    expect(types.completions(builder, builder.length).items.map(i => i.label)).toEqual(expect.arrayContaining(['where', 'map', 'groupBy', 'orderBy', 'limit', 'aggregate']));
    const top = 'export default from(fr';
    const { from, items } = types.completions(top, top.length);
    expect(from).toBe(top.length - 2);
    const labels = items.map(i => i.label);
    expect(labels).toEqual(expect.arrayContaining(['entity_ots_component', 'from_table', 'db', 'from', 'count', 'sum', 'val', 'join']));
    expect(labels).not.toContain('Array'); // lib globals are not offered
    expect(items.find(i => i.label === 'from_table')).toMatchObject({ kind: 'table', boost: 4 });
  });

  it('hover shows a column type, and short builder types', () => {
    const source = 'export default from(entity_ots_component).groupBy(c => ({ cat: c.category })).aggregate(g => ({ n: count() }))';
    expect(types.hover(source, at(source, 'category', 2))).toMatchObject({ text: '(column) category: Nullable(String)' });
    const method = types.hover(source, at(source, 'groupBy', 2))!;
    expect(method.text).toMatch(/^\(method\) Query<…>\.groupBy/);
    expect(method.text.split('\n')[0]!.length).toBeLessThanOrEqual(200);
  });

  it('an F13 binding (from_table) type-checks next to core from', () => {
    expect(errors('export default from(from_table).aggregate(() => ({ n: count() }))')).toEqual([]);
    expect(errors('export default from(db.from)')).toEqual([]);
  });

  it('a schema change updates the globals without a restart', () => {
    const svc = createTypeService();
    svc.setSchema({ functions: [], tables: [table('a', [column('x', 'UInt8', 1)])] });
    expect(svc.diagnostics('export default from(b)').length).toBeGreaterThan(0);
    svc.setSchema({ functions: [], tables: [table('a', [column('x', 'UInt8', 1)]), table('b', [column('y', 'String', 1)])] });
    expect(svc.diagnostics('export default from(b)')).toEqual([]);
    expect(svc.completions('b', 1).items.map(i => i.label)).toContain('b');
  });

  it('warm completions and diagnostics are fast (generous ceilings)', () => {
    types.warm();
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const source = `export default from(entity_ots_component).where(c => c.entityId.eq("${i}")).where(c => c.`;
      const started = performance.now();
      types.completions(source, source.length);
      times.push(performance.now() - started);
    }
    // Generous: the root test run shares the CPU with every other suite. Measured numbers are in the S9 evidence.
    const median = [...times].sort((a, b) => a - b)[5]!;
    expect(median, times.map(t => t.toFixed(0)).join(' ')).toBeLessThan(500);
  });

  it('shorten trims and collapses', () => {
    expect(shorten("Type 'Expr<string, \"a\", \"row\">' is not\nassignable")).toBe("Type 'Expr<string>' is not assignable");
    expect(shorten('x'.repeat(400)).length).toBe(300);
  });
});

describe('check_query requires 0 type errors (faux provider)', () => {
  const scope = editorScope(schemaScope(schema));
  const check = (source: string): CheckResult => {
    const found = errors(source);
    if (found.length) return { ok: false, stage: 'types', message: found.map(d => `${d.line}:${d.column} ${d.message}`).join('\n') };
    try {
      const p = prepare(source, scope, { autoLimit: false });
      return { ok: true, sql: p.compiled.sql, rowType: p.rowType };
    } catch (error) {
      if (error instanceof StudioError) return { ok: false, stage: error.stage, message: error.message };
      throw error;
    }
  };
  const llms: { close(): Promise<void> }[] = [];
  afterAll(async () => { for (const llm of llms) await llm.close(); });
  const setup = async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: faux.getModel().id }, schema: () => '', check });
    llms.push(llm);
    return { faux, llm };
  };
  const call = (source: string) => fauxAssistantMessage([fauxToolCall('check_query', { source })], { stopReason: 'toolUse' });

  it('a source that compiles at runtime but has a type error is refused; the fixed one passes on attempt 2', async () => {
    // Evaluates and compiles fine at runtime, but is not type-correct TypeScript.
    const runtimeOk = "const label: number = 'parts';\nexport default from(entity_ots_component).map(c => ({ id: c.entityId }))";
    const typed = 'export default from(entity_ots_component).map(c => ({ id: c.entityId }))';
    expect(() => prepare(runtimeOk, scope, { autoLimit: false })).not.toThrow();
    expect(errors(runtimeOk)).toHaveLength(1);
    const { faux, llm } = await setup();
    let feedback = '';
    faux.setResponses([call(runtimeOk), ((ctx: { messages: unknown[] }) => { feedback = JSON.stringify(ctx.messages.at(-1)); return call(typed); }) as never]);
    expect(await llm.chat.send({ chatId: null, text: 'x', source: '' })).toMatchObject({ ok: true, turn: { source: typed, attempts: 2 } });
    expect(feedback).toMatch(/types error: 1:7 Type 'string' is not assignable to type 'number'/);
  });

  it('a type-correct source passes in one attempt', async () => {
    const { faux, llm } = await setup();
    const good = 'export default from(entity_ots_component).groupBy(c => ({ category: c.category })).aggregate(g => ({ parts: sum(g.countOfParts) }))';
    faux.setResponses([call(good)]);
    expect(await llm.chat.send({ chatId: null, text: 'x', source: '' })).toMatchObject({ ok: true, turn: { source: good, attempts: 1 } });
  });
});
