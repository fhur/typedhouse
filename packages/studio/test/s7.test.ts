import { rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createModels, fauxProvider } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { parseCHType } from '@typedhouse/core';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { checkChartSpec } from '../server/chart.js';
import { editorSchema, editorScope, prepare, schemaScope } from '../server/eval.js';
import { createLlm, type Llm } from '../server/llm.js';
import { defaultSavedStore } from '../server/server.js';
import { toChartData } from '../web/chart-data.js';
import { chartHeading, viewAfterGeneration } from '../web/rules.js';

const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
const table = (name: string, columns = [column('id', 'UInt32', 1)]) => ({ name, engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns });

describe('F13: table bindings never shadow core exports', () => {
  const schema: DatabaseSchema = { functions: [], tables: [table('from'), table('count'), table('from_table'), table('events', [column('amount', 'Float64', 1)])] };

  it('renames colliding bindings deterministically and keeps db.<name>', () => {
    const { source, bindings } = editorSchema(schema);
    expect(Object.fromEntries(bindings)).toEqual({ count: 'count_table', events: 'events', from: 'from_table2', from_table: 'from_table' });
    expect(source).toContain('const from_table2 = table("from"');
    expect(source).toContain('const count_table = table("count"');
    expect(source).toMatch(/^ {2}from: from_table2,$/m);
    expect(source).toMatch(/^ {2}count: count_table,$/m);
    expect(source).not.toMatch(/^const (from|count) = /m);
    // Same input, same names.
    expect(Object.fromEntries(editorSchema(schema).bindings)).toEqual(Object.fromEntries(bindings));
  });

  it('core functions keep working next to tables named from and count', () => {
    const scope = editorScope(schemaScope(schema));
    expect(prepare('export default from(from_table2).aggregate(() => ({ n: count() }))', scope, { autoLimit: false }).compiled.sql).toMatch(/count\(\).*FROM\s+`from`/s);
    expect(prepare('export default from(db.count)', scope, { autoLimit: false }).compiled.sql).toContain('`count`');
    expect(prepare('export default from(events).map(e => ({ total: e.amount }))', scope, { autoLimit: false }).rowType).toBe('{ total: number }');
  });
});

describe('F15: selecting a model needs credentials', () => {
  let llm: Llm | undefined;
  afterEach(async () => { await llm?.close(); llm = undefined; });

  it('refuses a model whose provider has no credential, with a clear error', async () => {
    const models = builtinModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: faux.getModel().id }, schema: () => '', check: () => ({ ok: true, sql: '', rowType: '' }) });
    const env = { ...process.env };
    delete process.env['OPENAI_API_KEY'];
    try {
      expect(await llm.selectModel({ provider: 'openai-codex', modelId: 'gpt-6-sol' })).toEqual({ ok: false, error: expect.stringMatching(/No credentials for openai-codex/) });
      expect(llm.status).toMatchObject({ provider: faux.provider.id });
      expect(await llm.selectModel({ provider: faux.provider.id, modelId: faux.getModel().id })).toEqual({ ok: true });
    } finally { Object.assign(process.env, env); }
  });

  it('unknown models are refused before the credential check', async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: faux.getModel().id }, schema: () => '', check: () => ({ ok: true, sql: '', rowType: '' }) });
    expect(await llm.selectModel({ provider: faux.provider.id, modelId: 'nope' })).toEqual({ ok: false, error: expect.stringMatching(/Unknown model/) });
  });
});

describe('F11 and the chart heading', () => {
  it('a generation keeps the current tab, except an empty Chart tab goes to Table', () => {
    expect(viewAfterGeneration('table', false)).toBe('table');
    expect(viewAfterGeneration('sql', false)).toBe('sql');
    expect(viewAfterGeneration('chart', true)).toBe('chart');
    expect(viewAfterGeneration('chart', false)).toBe('table');
  });

  it('takes the title out of the spec for the HTML heading', () => {
    expect(chartHeading({ mark: 'line', title: 'Daily revenue', encoding: {} })).toEqual({ eyebrow: 'Line · Vega-Lite', title: 'Daily revenue', spec: { mark: 'line', encoding: {} } });
    expect(chartHeading({ mark: { type: 'bar' }, title: { text: 'A', subtitle: 'b' } })).toMatchObject({ eyebrow: 'Bar · Vega-Lite', title: 'A', subtitle: 'b', spec: { mark: { type: 'bar' } } });
    expect(chartHeading({ layer: [] })).toEqual({ eyebrow: 'Layered · Vega-Lite', spec: { layer: [] } });
  });
});

describe('F7, F8, F9: column names with dots, brackets and backslashes', () => {
  const columns = [{ name: 'c.entityId', type: 'String' }, { name: 'parts', type: 'UInt64' }, { name: 'a\\b', type: 'String' }];

  it('titles default to the plain column name; explicit titles are kept', () => {
    const checked = checkChartSpec({ mark: 'bar', encoding: { x: { field: 'c.entityId' }, y: { field: 'parts', title: 'Parts' }, tooltip: [{ field: 'c.entityId' }] } }, columns);
    expect(checked).toMatchObject({ ok: true, spec: { encoding: { x: { field: 'c\\.entityId', title: 'c.entityId' }, y: { field: 'parts', title: 'Parts' }, tooltip: [{ field: 'c\\.entityId', title: 'c.entityId' }] } } });
  });

  it('escapes object-form repeat and raw backslash names', () => {
    const repeat = checkChartSpec({ repeat: { row: ['c.entityId'] }, spec: { mark: 'bar', encoding: { x: { field: { repeat: 'row' } } } } }, columns);
    expect(repeat).toMatchObject({ ok: true, spec: { repeat: { row: ['c\\.entityId'] } } });
    const slash = checkChartSpec({ mark: 'bar', encoding: { x: { field: 'a\\b' } } }, columns);
    expect(slash).toMatchObject({ ok: true, spec: { encoding: { x: { field: 'a\\\\b', title: 'a\\b' } } } });
  });

  it('renders headless: the axis title is the plain name and the bars are drawn (F7)', async () => {
    const vl = await import('vega-lite');
    const vega = await import('vega');
    const checked = checkChartSpec({ mark: 'bar', encoding: { x: { field: 'c.entityId', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } }, columns);
    if (!checked.ok) throw new Error(checked.message);
    const rows = toChartData([{ c: { entityId: 'cmp_1' }, parts: 3n }, { c: { entityId: 'cmp_2' }, parts: 5n }],
      [{ name: 'c.entityId', path: ['c', 'entityId'], type: 'String' }, { name: 'parts', path: ['parts'], type: 'UInt64' }]);
    const compiled = vl.compile({ ...checked.spec, data: { values: rows } } as never).spec;
    const view = new vega.View(vega.parse(compiled), { renderer: 'none' });
    const svg = await view.toSVG();
    view.finalize();
    expect(svg).toContain('>c.entityId<');
    expect(svg).not.toContain('c\\.entityId');
    expect(svg).toContain('cmp_2');
    expect((svg.match(/role="graphics-symbol"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('F18: without a data dir, saved queries never touch the real home', () => {
  // F19: the process 'exit' hook that removes these does not run when vitest tears its workers down.
  const created: string[] = [];
  afterAll(async () => { await Promise.all(created.map(dir => rm(dir, { recursive: true, force: true }))); });
  it('defaults to a fresh temp directory', async () => {
    const a = defaultSavedStore();
    const b = defaultSavedStore();
    created.push(dirname(a.path), dirname(b.path));
    expect(a.path.startsWith(tmpdir())).toBe(true);
    expect(a.path.startsWith(join(homedir(), '.typedhouse'))).toBe(false);
    expect(a.path).not.toBe(b.path);
    expect(await a.save({ name: 'x', prompt: '', source: '' })).toEqual({ ok: true });
    expect((await stat(a.path)).isFile()).toBe(true);
    expect(await b.list()).toEqual({ ok: true, queries: [] });
  });
});
