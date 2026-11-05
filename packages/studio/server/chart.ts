/** The only data source a chart may name; the client binds the current result rows to it. */
export const CHART_DATA = 'table';

export interface ChartColumn { name: string; type: string }
export type ChartCheck = { ok: true; spec: Record<string, unknown> } | { ok: false; message: string };

/** Vega-Lite reads `.` and `[]` in a field as a nested path; a column literally named `e.name` must be `e\\.name`. */
const escapeField = (name: string) => name.replace(/[.[\]\\]/g, '\\$&');

/**
 * What can make a browser reach the network or navigate. A chart only ever draws the studio's rows, so none of this has a
 * legitimate use: `url` and `href` (channels, mark and config properties), image marks, and `usermeta` (vega-embed reads
 * loader and config options from it). Of literals, only `url(` (a CSS paint or cursor fetches it) and `javascript:`.
 * Plain address text is fine, in expressions and titles alike: URL columns are common, and `replace(datum.url, 'https://', '')`
 * can't request anything. The Vega expression language has no function that fetches or navigates either.
 *
 * This list can't see an address built at render time ('ur' + 'l(...'). The barrier for those is the server's
 * Content-Security-Policy and the blocking loader in `web/chart.tsx`, so both must stay.
 */
const NETWORK_KEYS = new Set(['url', 'href', 'usermeta', 'embedoptions', 'loader']);
const ADDRESS = /\burl\(|\bjavascript:/i;
const isVegaLiteSchema = (value: unknown) => typeof value === 'string' && /^https:\/\/vega\.github\.io\/schema\/vega-lite\/[\w.-]+\.json$/.test(value);

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
 * the chart always shows the studio's rows; it may not reach the network (see {@link NETWORK_KEYS}) or put a control elsewhere in the page; and every `field` must be a result column or a name an earlier
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

  const OFFLINE = 'charts may not load or link to anything, because they could send rows out';
  const findNetwork = (node: unknown, path: string, inBind = false): void => {
    if (typeof node === 'string') {
      if (ADDRESS.test(node)) problems.push(`${path}: ${OFFLINE}; remove this address.`);
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, i) => findNetwork(item, `${path}[${i}]`, inBind)); return; }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      // A CSS selector: Vega empties that element to put its input there, or listens to one that exists, anywhere in the page.
      if (inBind && key === 'element') { problems.push(`${path}.element: a chart's controls stay inside the chart; remove this.`); continue; }
      // vega-embed picks raw Vega from $schema, which has none of these rules; a Vega-Lite one is only a label.
      if (key === '$schema' && path === 'spec') {
        if (!isVegaLiteSchema(value)) problems.push('spec.$schema: only a Vega-Lite spec is allowed.');
        continue;
      }
      if (NETWORK_KEYS.has(key.toLowerCase()) || key.toLowerCase().endsWith(':href')) { problems.push(`${path}.${key}: ${OFFLINE}.`); continue; }
      if (key === 'mark' && (value === 'image' || (isObject(value) && value['type'] === 'image'))) { problems.push(`${path}.mark: image marks are not allowed; ${OFFLINE}.`); continue; }
      if (ADDRESS.test(key)) problems.push(`${path}: ${OFFLINE}; remove this address.`);
      findNetwork(value, `${path}.${key}`, inBind || key === 'bind');
    }
  };
  findNetwork(spec, 'spec');

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
  // The column a field names: as written (a raw name with a backslash, F9), or after unescaping (`e\.name`).
  const columnOf = (field: unknown) => (typeof field !== 'string' ? undefined : special.has(field) ? field : special.has(plain(field)) ? plain(field) : undefined);
  const fix = (field: unknown) => { const column = columnOf(field); return column === undefined ? field : escapeField(column); };
  // Axis/legend titles default to the field string, which would show the escape (F7): title it with the column name.
  const titled = (def: unknown) => {
    if (!isObject(def) || 'title' in def) return def;
    const column = columnOf(def['field']);
    return column === undefined ? def : { ...def, title: column };
  };
  const LIST_KEYS = new Set(['groupby', 'fold', 'pivot', 'value', 'repeat']);
  const walk = (node: unknown, key?: string): unknown => {
    if (Array.isArray(node)) return node.map(item => (key && LIST_KEYS.has(key) ? fix(item) : walk(item)));
    if (!isObject(node)) return key === 'field' || (key && LIST_KEYS.has(key)) ? fix(node) : node;
    // Object-form repeat (F8): { row: [...], column: [...], layer: [...] }.
    if (key === 'repeat') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, Array.isArray(v) ? v.map(fix) : v]));
    const entries = Object.entries(node).map(([k, v]): [string, unknown] => {
      if (key === 'encoding') v = Array.isArray(v) ? v.map(titled) : titled(v);
      return [k, walk(v, k)];
    });
    return Object.fromEntries(entries);
  };
  return walk(spec) as Record<string, unknown>;
}
