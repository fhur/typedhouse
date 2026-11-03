/** The only data source a chart may name; the client binds the current result rows to it. */
export const CHART_DATA = 'table';

export interface ChartColumn { name: string; type: string }
export type ChartCheck = { ok: true; spec: Record<string, unknown> } | { ok: false; message: string };

/** Vega-Lite reads `.` and `[]` in a field as a nested path; a column literally named `e.name` must be `e\\.name`. */
const escapeField = (name: string) => name.replace(/[.[\]\\]/g, '\\$&');

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = (field: string) => field.replace(/\\(.)/g, '$1');

/** Names a transform step adds, so later steps and encodings may reference them. */
function created(step: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') out.push(v);
  };
  add(step['as']);
  for (const key of ['aggregate', 'window', 'joinaggregate']) {
    const ops = step[key];
    if (Array.isArray(ops)) for (const op of ops) if (isObject(op)) add(op['as']);
  }
  if ('fold' in step && step['as'] === undefined) out.push('key', 'value');
  if ('timeUnit' in step || 'bin' in step) add(step['as']);
  return out;
}

/** Field references a transform step reads. */
function read(step: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') out.push(v);
  };
  for (const key of ['groupby', 'fold', 'field', 'pivot', 'value', 'sort']) add(step[key]);
  for (const key of ['aggregate', 'window', 'joinaggregate']) {
    const ops = step[key];
    if (Array.isArray(ops)) for (const op of ops) if (isObject(op)) add(op['field']);
  }
  const sort = step['sort'];
  if (Array.isArray(sort)) for (const s of sort) if (isObject(s)) add(s['field']);
  return out;
}

/**
 * Validates a model-written Vega-Lite spec against the result columns. It must be a JSON object; it may not
 * carry data (no `values`, `url`, `datasets`, or a `name` other than {@link CHART_DATA}, at any depth), so
 * the chart always shows the studio's rows; and every `field` must be a result column or a name an earlier
 * transform created with `as`. Returns the spec with `data: { name: 'table' }` set at the top level.
 */
export function checkChartSpec(input: unknown, columns: readonly ChartColumn[]): ChartCheck {
  let spec = input;
  if (typeof spec === 'string') {
    try { spec = JSON.parse(spec) as unknown; } catch (error) { return { ok: false, message: `The spec is not valid JSON: ${(error as Error).message}` }; }
  }
  if (!isObject(spec)) return { ok: false, message: 'The spec must be a Vega-Lite JSON object.' };
  if ('datasets' in spec) return { ok: false, message: 'Do not include datasets: the chart is bound to the query result.' };

  const known = new Set(columns.map(c => c.name));
  const unknown = new Set<string>();
  const problems: string[] = [];

  // Model-supplied data is refused at any depth (layers, concat, lookup transforms...); only a top-level
  // `{ name: 'table' }` is tolerated, and it is replaced by the studio's binding below.
  const findData = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, i) => findData(item, `${path}[${i}]`)); return; }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const topLevelTable = path === 'spec' && key === 'data' && isObject(value) && Object.keys(value).length === 1 && value['name'] === CHART_DATA;
      if ((key === 'data' || key === 'datasets') && !topLevelTable) problems.push(`${path}.${key}: do not set data (no values, url, generators or names); the chart is bound to the query result.`);
      findData(value, `${path}.${key}`);
    }
  };
  findData(spec, 'spec');

  const visit = (node: unknown, names: Set<string>, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, i) => visit(item, names, `${path}[${i}]`)); return; }
    if (!isObject(node)) return;
    // Transforms run in order; each may use names created by earlier ones.
    let scope = names;
    if (Array.isArray(node['transform'])) {
      scope = new Set(names);
      for (const step of node['transform']) {
        if (!isObject(step)) continue;
        for (const field of read(step)) if (!scope.has(field) && !scope.has(plain(field))) unknown.add(field);
        for (const name of created(step)) scope.add(name);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'transform' || key === 'data') continue;
      if (key === 'field' && typeof value === 'string' && !scope.has(value) && !scope.has(plain(value))) unknown.add(value);
      visit(value, scope, `${path}.${key}`);
    }
  };
  visit(spec, known, 'spec');

  if (unknown.size) problems.push(`Unknown field(s): ${[...unknown].join(', ')}. Result columns: ${columns.map(c => `${c.name} (${c.type})`).join(', ') || 'none'}.`);
  if (problems.length) return { ok: false, message: problems.join('\n') };
  const { data: _data, ...rest } = spec;
  return { ok: true, spec: { ...escapeColumnFields(rest, columns), data: { name: CHART_DATA } } };
}

/**
 * Field references that name a result column with `.`, `[` or `]` are escaped (`e.name` → `e\\.name`), so the
 * model can write column names naturally and Vega reads them as flat keys, matching `toChartData`. Names a
 * transform creates (`as`) are left alone; field lists in transforms (groupby, fold, ...) are escaped too.
 */
function escapeColumnFields(spec: Record<string, unknown>, columns: readonly ChartColumn[]): Record<string, unknown> {
  const special = new Set(columns.map(c => c.name).filter(name => /[.[\]\\]/.test(name)));
  if (!special.size) return spec;
  const fix = (field: unknown) => (typeof field === 'string' && special.has(plain(field)) ? escapeField(plain(field)) : field);
  const LIST_KEYS = new Set(['groupby', 'fold', 'pivot', 'value', 'repeat']);
  const walk = (node: unknown, key?: string): unknown => {
    if (Array.isArray(node)) return node.map(item => (key && LIST_KEYS.has(key) ? fix(item) : walk(item)));
    if (!isObject(node)) return key === 'field' || (key && LIST_KEYS.has(key)) ? fix(node) : node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
  };
  return walk(spec) as Record<string, unknown>;
}
