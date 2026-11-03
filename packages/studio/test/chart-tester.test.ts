// Tester (S4 + F1): chart spec validation (bypasses and false positives), chart data conversion, the abort
// fallback for providers that ignore the abort signal, and chart/query concurrency. Faux provider only.
import { describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { parseCHType } from '@typedhouse/core';
import { renderSchema, type DatabaseSchema } from '@typedhouse/codegen';
import { checkChartSpec } from '../server/chart.js';
import { editorScope, prepare, schemaScope, StudioError } from '../server/eval.js';
import { createLlm, type CheckResult } from '../server/llm.js';
import { toChartData } from '../web/chart-data.js';

const columns = [
  { name: 'country', type: 'String' }, { name: 'revenue', type: 'Float64' }, { name: 'qty', type: 'UInt64' },
  { name: 'day', type: 'Date' }, { name: 'e.name', type: 'String' }, { name: 'odd-name', type: 'String' },
];
const enc = (x: string, y = 'revenue') => ({ x: { field: x, type: 'nominal' }, y: { field: y, type: 'quantitative' } });
const ok = (spec: unknown) => checkChartSpec(spec, columns).ok;

describe('checkChartSpec: legitimate specs are accepted', () => {
  it.each([
    ['layer', { layer: [{ mark: 'bar', encoding: enc('country') }, { mark: 'rule', encoding: { y: { field: 'revenue', aggregate: 'mean' } } }] }],
    ['hconcat', { hconcat: [{ mark: 'bar', encoding: enc('country') }, { mark: 'point', encoding: enc('country', 'qty') }] }],
    ['facet', { facet: { field: 'country', type: 'nominal' }, spec: { mark: 'bar', encoding: enc('day') } }],
    ['facet encoding', { mark: 'bar', encoding: { ...enc('day'), facet: { field: 'country', columns: 3 } } }],
    ['repeat', { repeat: ['revenue', 'qty'], spec: { mark: 'bar', encoding: { x: { field: 'country' }, y: { field: { repeat: 'repeat' }, type: 'quantitative' } } } }],
    ['count without field', { mark: 'bar', encoding: { x: { field: 'country' }, y: { aggregate: 'count', type: 'quantitative' } } }],
    ['calculate + aggregate', { transform: [{ calculate: 'datum.revenue * 2', as: 'r2' }, { aggregate: [{ op: 'sum', field: 'r2', as: 's' }], groupby: ['country'] }], mark: 'bar', encoding: enc('country', 's') }],
    ['bin transform', { transform: [{ bin: true, field: 'revenue', as: 'bucket' }], mark: 'bar', encoding: { x: { field: 'bucket' }, y: { aggregate: 'count' } } }],
    ['bin transform with [start,end]', { transform: [{ bin: true, field: 'revenue', as: ['lo', 'hi'] }], mark: 'bar', encoding: { x: { field: 'lo' }, x2: { field: 'hi' }, y: { aggregate: 'count' } } }],
    ['timeUnit transform', { transform: [{ timeUnit: 'yearmonth', field: 'day', as: 'month' }], mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', aggregate: 'sum' } } }],
    ['encoding timeUnit/bin', { mark: 'bar', encoding: { x: { field: 'day', timeUnit: 'month', type: 'ordinal' }, y: { field: 'revenue', bin: true } } }],
    ['window with sort', { transform: [{ window: [{ op: 'rank', as: 'rank' }], sort: [{ field: 'revenue', order: 'descending' }] }, { filter: 'datum.rank <= 5' }], mark: 'bar', encoding: enc('country') }],
    ['joinaggregate', { transform: [{ joinaggregate: [{ op: 'sum', field: 'revenue', as: 'total' }] }, { calculate: 'datum.revenue / datum.total', as: 'share' }], mark: 'bar', encoding: enc('country', 'share') }],
    ['fold with as', { transform: [{ fold: ['revenue', 'qty'], as: ['metric', 'val'] }], mark: 'line', encoding: { x: { field: 'day' }, y: { field: 'val' }, color: { field: 'metric' } } }],
    ['fold default key/value', { transform: [{ fold: ['revenue', 'qty'] }], mark: 'line', encoding: { x: { field: 'day' }, y: { field: 'value' }, color: { field: 'key' } } }],
    ['escaped dotted column', { mark: 'bar', encoding: enc('e\\.name') }],
    ['odd-name column', { mark: 'bar', encoding: enc('odd-name') }],
    ['condition + tooltip array', { mark: 'bar', encoding: { ...enc('country'), color: { condition: { test: 'datum.revenue > 1', value: 'red' }, value: 'gray' }, tooltip: [{ field: 'country' }, { field: 'revenue', format: ',.0f' }] } }],
    ['sort by field', { mark: 'bar', encoding: { x: { field: 'country', sort: { field: 'revenue', op: 'sum', order: 'descending' } }, y: { field: 'revenue' } } }],
    ['$schema url and title', { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title: 'Revenue', mark: 'bar', encoding: enc('country') }],
  ])('%s', (_name, spec) => {
    const result = checkChartSpec(spec, columns);
    expect(result).toMatchObject({ ok: true });
  });
});

describe('checkChartSpec: data and field bypasses are refused', () => {
  it.each([
    ['top-level values', { data: { values: [{ country: 'x' }] }, mark: 'bar', encoding: enc('country') }],
    ['url', { data: { url: 'https://example.com/x.csv' }, mark: 'bar', encoding: enc('country') }],
    ['sequence generator', { data: { sequence: { start: 0, stop: 10 } }, mark: 'bar' }],
    ['datasets', { datasets: { t: [] }, data: { name: 't' }, mark: 'bar' }],
    ['values inside a layer', { layer: [{ data: { values: [1] }, mark: 'bar', encoding: enc('country') }] }],
    ['values inside hconcat', { hconcat: [{ data: { values: [1] }, mark: 'bar', encoding: enc('country') }] }],
    ['url data in a lookup transform', { transform: [{ lookup: 'country', from: { data: { url: 'https://example.com/c.json' }, key: 'id', fields: ['pop'] } }], mark: 'bar', encoding: enc('country') }],
    ['unknown field in a facet', { facet: { field: 'nation' }, spec: { mark: 'bar', encoding: enc('country') } }],
    ['unknown field in a fold', { transform: [{ fold: ['nope'] }], mark: 'bar', encoding: enc('country') }],
    ['unknown field in tooltip array', { mark: 'bar', encoding: { ...enc('country'), tooltip: [{ field: 'secret' }] } }],
    ['unknown groupby', { transform: [{ aggregate: [{ op: 'sum', field: 'revenue', as: 's' }], groupby: ['nation'] }], mark: 'bar', encoding: enc('country', 's') }],
  ])('%s', (_name, spec) => {
    expect(ok(spec)).toBe(false);
  });

  // A flattened join-side or Nested column is keyed "e.name" in the chart data, but Vega-Lite reads an
  // unescaped dotted field as a nested path (datum.e.name), so the chart silently shows `undefined`.
  // Either the check must refuse the unescaped form (asking for "e\\.name") or the data/spec must agree.
  it('a dotted column name is either escaped or refused, never accepted in a form Vega reads as a nested path', () => {
    const result = checkChartSpec({ mark: 'bar', encoding: enc('e.name') }, columns);
    if (result.ok) {
      const x = (result.spec['encoding'] as { x: { field: string } }).x.field;
      expect(x).toBe('e\\.name');
    }
  });
});

describe('toChartData edge cases', () => {
  it('handles extremes, NaN, negative values, Map instances and missing paths', () => {
    const cols = [
      { name: 'big', path: ['big'], type: 'Int128' }, { name: 'neg', path: ['neg'], type: 'Int64' }, { name: 'f', path: ['f'], type: 'Float64' },
      { name: 'dec', path: ['dec'], type: 'Decimal(38, 10)' }, { name: 'm', path: ['m'], type: 'Map(String, UInt64)' },
      { name: 'missing', path: ['a', 'b'], type: 'String' }, { name: 'lc', path: ['lc'], type: 'LowCardinality(Nullable(UInt8))' },
      { name: 's', path: ['s'], type: 'String' },
    ];
    const [row] = toChartData([{
      big: 2n ** 100n, neg: -(2n ** 63n), f: Number.NaN, dec: '-0.0000000001', m: new Map([['k', 1n]]), lc: '7', s: '12',
    }], cols);
    expect(row!['big']).toBe(2 ** 100);
    expect(row!['neg']).toBe(-(2 ** 63));
    expect(Number.isNaN(row!['f'])).toBe(true);
    expect(row!['dec']).toBe(-1e-10);
    expect(row!['missing']).toBeNull();
    expect(row!['lc']).toBe(7);
    expect(row!['s']).toBe('12');
    expect(typeof row!['m']).toBe('string');
  });

  it('a `__proto__`-named column becomes an own data property', () => {
    const [row] = toChartData([JSON.parse('{"__proto__": "p", "n": 1}') as unknown], [{ name: '__proto__', path: ['__proto__'], type: 'String' }, { name: 'n', path: ['n'], type: 'UInt8' }]);
    expect(Object.getOwnPropertyNames(row)).toContain('__proto__');
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  it('converts 50k rows quickly', () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: BigInt(i), v: String(i / 3), d: new Date(i * 1000), s: `s${i}` }));
    const cols = [{ name: 'id', path: ['id'], type: 'UInt64' }, { name: 'v', path: ['v'], type: 'Decimal(18, 4)' }, { name: 'd', path: ['d'], type: 'DateTime' }, { name: 's', path: ['s'], type: 'String' }];
    const started = performance.now();
    expect(toChartData(rows, cols)).toHaveLength(50_000);
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

// ---- generation: F1 abort fallback and concurrency ----
const column = (name: string, type: string, position: number) => ({ name, type: parseCHType(type), position, defaultKind: '', comment: '' });
const schema: DatabaseSchema = { functions: [], tables: [{ name: 'events', engine: 'MergeTree', sortingKey: [], partitionKey: [], primaryKey: [], columns: [column('country', 'String', 1), column('revenue', 'Float64', 2)] }] };
const scope = editorScope(schemaScope(schema));
function check(source: string): CheckResult {
  try { const p = prepare(source, scope, { autoLimit: false }); return { ok: true, sql: p.compiled.sql, rowType: p.rowType }; }
  catch (error) { return error instanceof StudioError ? { ok: false, stage: error.stage, message: error.message } : { ok: false, stage: 'evaluate', message: String(error) }; }
}
const goodQuery = 'export default from(events).map(e => ({ country: e.country }))';
const goodSpec = { mark: 'bar', encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };
const chartInput = { prompt: 'bar of revenue', columns: [{ name: 'country', type: 'String' }, { name: 'revenue', type: 'Float64' }], sample: [{ country: 'DE', revenue: 1 }] };
/** A provider stuck forever that never looks at the abort signal. */
const stuck = (() => new Promise(() => {})) as never;

async function setup(options: { timeoutMs?: number; abortGraceMs?: number } = {}) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const llm = await createLlm({ models, model: { provider: model.provider, modelId: model.id }, schema: () => renderSchema(schema), check, ...options });
  return { faux, llm };
}

describe('F1: providers that ignore abort', () => {
  it('generateQuery returns within timeout + grace and the next generation is accepted', async () => {
    const { faux, llm } = await setup({ timeoutMs: 300, abortGraceMs: 300 });
    faux.setResponses([stuck]);
    const started = Date.now();
    expect(await llm.generateQuery({ prompt: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/timed out|stopped/) });
    expect(Date.now() - started).toBeLessThan(3_000);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('check_query', { source: goodQuery })], { stopReason: 'toolUse' })]);
    expect(await llm.generateQuery({ prompt: 'x' })).toMatchObject({ ok: true, source: goodQuery });
  }, 15_000);

  it('generateChart returns within timeout + grace and the next chart and query are accepted', async () => {
    const { faux, llm } = await setup({ timeoutMs: 300, abortGraceMs: 300 });
    faux.setResponses([stuck]);
    const started = Date.now();
    expect(await llm.generateChart(chartInput)).toMatchObject({ ok: false, spec: null });
    expect(Date.now() - started).toBeLessThan(3_000);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('check_chart', { spec: goodSpec } as never)], { stopReason: 'toolUse' })]);
    expect(await llm.generateChart(chartInput)).toMatchObject({ ok: true });
    faux.setResponses([fauxAssistantMessage([fauxToolCall('check_query', { source: goodQuery })], { stopReason: 'toolUse' })]);
    expect(await llm.generateQuery({ prompt: 'x' })).toMatchObject({ ok: true });
  }, 15_000);

  it('a chart while a query is running is refused, and vice versa, with one model request each', async () => {
    const { faux, llm } = await setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    faux.setResponses([(async () => { await gate; return fauxAssistantMessage([fauxToolCall('check_query', { source: goodQuery })], { stopReason: 'toolUse' }); }) as never]);
    const query = llm.generateQuery({ prompt: 'x' });
    expect(await llm.generateChart(chartInput)).toMatchObject({ ok: false, error: expect.stringMatching(/already running/) });
    release();
    expect(await query).toMatchObject({ ok: true });
    expect(faux.state.callCount).toBe(1);
    await llm.close();
  });
});

describe('generateChart: only a checked spec is ok', () => {
  it('a spec passed as a JSON string, then prose with another spec: ok is the checked one', async () => {
    const { faux, llm } = await setup();
    faux.setResponses([fauxAssistantMessage([fauxToolCall('check_chart', { spec: JSON.stringify(goodSpec) } as never)], { stopReason: 'toolUse' })]);
    const result = await llm.generateChart(chartInput);
    if (result.ok) expect(checkChartSpec(result.spec, chartInput.columns).ok).toBe(true);
    await llm.close();
  });

  it('columns are taken from the request, so a field valid for another request is refused', async () => {
    const { faux, llm } = await setup({});
    const spec = { mark: 'bar', encoding: { x: { field: 'secret_col' } } };
    faux.setResponses(Array.from({ length: 6 }, () => fauxAssistantMessage([fauxToolCall('check_chart', { spec } as never)], { stopReason: 'toolUse' })));
    const result = await llm.generateChart(chartInput);
    expect(result.ok).toBe(false);
    await llm.close();
  });
});

// ---- S4 retest: escaping of dotted/bracketed column names, checked by rendering with vega headless ----
async function axisText(spec: Record<string, unknown>, values: Record<string, unknown>[]): Promise<string[]> {
  const vl = await import('vega-lite');
  const vega = await import('vega');
  const { spec: compiled } = vl.compile({ ...spec, data: { values } } as never);
  const view = new vega.View(vega.parse(compiled), { renderer: 'none' });
  await view.runAsync();
  const svg = await view.toSVG();
  view.finalize();
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]!);
}
const dotCols = [{ name: 'e.name', type: 'String' }, { name: 'n', type: 'UInt64' }, { name: 'arr[0]', type: 'String' }];
const dotRows = [{ 'e.name': 'alpha', n: 3, 'arr[0]': 'p' }, { 'e.name': 'beta', n: 5, 'arr[0]': 'q' }];
const passed = (spec: unknown) => { const r = checkChartSpec(spec, dotCols); if (!r.ok) throw new Error(r.message); return r.spec; };

describe('escaping of dotted and bracketed column names (rendered headless)', () => {
  it('an unescaped dotted field renders the real values', async () => {
    const spec = passed({ mark: 'bar', encoding: { x: { field: 'e.name', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } });
    expect(await axisText(spec, dotRows)).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('an already-escaped field is not double-escaped', async () => {
    const spec = passed({ mark: 'bar', encoding: { x: { field: 'e\\.name', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } });
    expect((spec['encoding'] as { x: { field: string } }).x.field).toBe('e\\.name');
    expect(await axisText(spec, dotRows)).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('a bracketed column name renders', async () => {
    const spec = passed({ mark: 'bar', encoding: { x: { field: 'arr[0]', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } });
    expect(await axisText(spec, dotRows)).toEqual(expect.arrayContaining(['p', 'q']));
  });

  it('sort and tooltip given as objects are escaped', async () => {
    const spec = passed({ mark: 'bar', encoding: { x: { field: 'e.name', type: 'nominal', sort: { field: 'e.name', order: 'descending' } }, y: { field: 'n', type: 'quantitative' }, tooltip: [{ field: 'e.name' }, { field: 'n' }] } });
    const enc = spec['encoding'] as { x: { sort: { field: string } }; tooltip: { field: string }[] };
    expect(enc.x.sort.field).toBe('e\\.name');
    expect(enc.tooltip[0]!.field).toBe('e\\.name');
    const labels = await axisText(spec, dotRows);
    expect(labels.indexOf('beta')).toBeLessThan(labels.indexOf('alpha'));
  });

  it('datum["e.name"] in a calculate expression works alongside the escaped field', async () => {
    const spec = passed({ transform: [{ calculate: "upper(datum['e.name'])", as: 'big' }], mark: 'bar', encoding: { x: { field: 'big', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } });
    expect(await axisText(spec, dotRows)).toEqual(expect.arrayContaining(['ALPHA', 'BETA']));
  });

  it('aggregate/groupby over a dotted column renders', async () => {
    const spec = passed({ transform: [{ aggregate: [{ op: 'sum', field: 'n', as: 'total' }], groupby: ['e.name'] }], mark: 'bar', encoding: { x: { field: 'e.name', type: 'nominal' }, y: { field: 'total', type: 'quantitative' } } });
    expect(await axisText(spec, dotRows)).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('repeat over a dotted column renders', async () => {
    const spec = passed({ repeat: ['e.name'], spec: { mark: 'bar', encoding: { x: { field: { repeat: 'repeat' }, type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } } });
    expect(await axisText(spec, dotRows)).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('a filter transform on a dotted field renders', async () => {
    const spec = passed({ transform: [{ filter: { field: 'e.name', equal: 'beta' } }], mark: 'bar', encoding: { x: { field: 'e.name', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } });
    const labels = await axisText(spec, dotRows);
    expect(labels).toContain('beta');
    expect(labels).not.toContain('alpha');
  });
});

describe('F1: close() after a timeout with a provider that ignores abort', () => {
  it('returns within the abort grace period', async () => {
    const { faux, llm } = await setup({ timeoutMs: 300, abortGraceMs: 300 });
    faux.setResponses([stuck]);
    await llm.generateQuery({ prompt: 'x' });
    const started = Date.now();
    await llm.close();
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 15_000);
});
