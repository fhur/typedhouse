import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { col, createKnownFunctions, parseCHType, type CHType, type Column, type KnownFunctionCatalog, type KnownFunctions } from '@typedhouse/core';
import fc from 'fast-check';
import { renderColumn, renderSchema, renderFunctions } from '../src/render.js';
import type { DatabaseSchema } from '../src/introspect.js';
const fixture: DatabaseSchema = { tables: [{ name: '__proto__', engine: 'Memory', sortingKey: [], partitionKey: [], primaryKey: [], columns: [{ name: 'odd\n*/"', type: parseCHType('DateTime64(9)'), position: 1, defaultKind: 'ALIAS', comment: '*/\nhello' }] }], functions: [{ name: '__proto__', isAggregate: false, deterministic: null, aliasTo: '' }] };
it('round-trips hostile ordered tuple names through executable generated source', () => {
  fc.assert(fc.property(fc.uniqueArray(fc.oneof(fc.string(), fc.constantFrom('42', '0', '__proto__', 'constructor', '\"], globalThis.pwned = true, [\"', '\n\t`\\')), { minLength: 1, maxLength: 12 }), names => {
    const tuple: CHType = { kind: 'Tuple', items: names.map((name, i) => ({ name, type: { kind: 'scalar', name: i % 2 ? 'UInt64' : 'String' } })) };
    const type: CHType = { kind: 'Map', key: { kind: 'scalar', name: 'String' }, value: { kind: 'Array', inner: tuple } };
    const before = structuredClone(type);
    const generated = new Function('col', `return ${renderColumn(type)};`)(col) as Column;
    expect(generated.type).toEqual(before);
    expect(type).toEqual(before);
    expect(Object.isFrozen(generated.type)).toBe(true);
  }), { seed: 20261028, numRuns: 300 });
});
it('is repeatable, content sensitive and prototype-safe', () => {
  const first = renderSchema(fixture);
  expect(first).toBe(renderSchema(structuredClone(fixture)));
  expect(first).toContain('["__proto__"]: __proto__');
  expect(first).toContain('precision > 3 maps to string');
  expect(renderFunctions(fixture)).toContain('["__proto__"]:');
  const changed = structuredClone(fixture); changed.tables[0]!.columns[0]!.comment = 'changed';
  expect(first.split('\n')[0]).not.toBe(renderSchema(changed).split('\n')[0]);
});
it('imports callable namespaces from rendered metadata with hostile properties and aliases', async () => {
  const functions = ['__proto__', 'constructor', 'default', 'bad);SELECT 1', 'alias', 'sum'].map(name => ({ name, isAggregate: name === 'sum', deterministic: null, aliasTo: name === 'alias' ? 'original' : '' }));
  const text = renderFunctions({ tables: [], functions });
  const ts = await import('typescript');
  const javascript = ts.default.transpileModule(text, { compilerOptions: { target: ts.default.ScriptTarget.ES2022, module: ts.default.ModuleKind.ESNext } }).outputText;
  // Import the actual emitted module; supply the same factory rather than a fake wrapper.
  const body = javascript.replace("import { createKnownFunctions } from '@typedhouse/core';", 'const createKnownFunctions = globalThis.__typedhouseKnownFactory;');
  const host = globalThis as typeof globalThis & { __typedhouseKnownFactory?: typeof createKnownFunctions };
  host.__typedhouseKnownFactory = createKnownFunctions;
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`) as KnownFunctions<KnownFunctionCatalog> & { functions: KnownFunctionCatalog };
    expect(Object.keys(module.fn)).toEqual(['__proto__', 'alias', 'bad);SELECT 1', 'constructor', 'default']);
    expect(Object.keys(module.agg)).toEqual(['sum']);
    expect(module.functions.alias).toEqual({ isAggregate: false, deterministic: null, aliasTo: 'original' });
    expect(Object.getPrototypeOf(module.fn)).toBeNull();
    expect(text).toBe(renderFunctions({ tables: [], functions: [...functions].reverse() }));
  } finally { delete host.__typedhouseKnownFactory; }
});
it('hashes exactly the emitted body', () => {
  for (const rendered of [renderSchema(fixture), renderFunctions(fixture)]) {
    const end = rendered.indexOf('\n');
    expect(rendered.slice(0, end)).toContain(createHash('sha256').update(rendered.slice(end + 1)).digest('hex'));
  }
});
it('orders columns by position and preserves metadata safely', () => {
  const input = structuredClone(fixture);
  input.tables[0]!.columns.push({ name: '__proto__', type: parseCHType('UInt64'), position: 0, comment: '*/\n', defaultKind: 'DEFAULT' });
  const rendered = renderSchema(input);
  expect(rendered.indexOf('["__proto__"]: col.UInt64')).toBeLessThan(rendered.indexOf('col.DateTime64(9)'));
  expect(rendered).toContain('"defaultKind":"DEFAULT"');
  expect(input.tables[0]!.columns[0]!.position).toBe(1);
});
it('sorts table/function inputs without mutating them', () => {
  const second = structuredClone(fixture); second.tables[0]!.name = 'aaa'; second.functions[0]!.name = 'aaa';
  const combined = { tables: [...fixture.tables, ...second.tables], functions: [...fixture.functions, ...second.functions] };
  expect(renderSchema(combined)).toBe(renderSchema({ ...combined, tables: [...combined.tables].reverse() }));
  expect(renderFunctions(combined)).toBe(renderFunctions({ ...combined, functions: [...combined.functions].reverse() }));
});
it('generates descriptive, valid, unique row aliases for arbitrary table names', () => {
  const names = ['ipn_offer', '_pg_bridge_test', '123_items', '!!!', '你好', 'foo-bar', 'foo_bar', 'component', 'entity_ots_component'];
  const schema = { tables: names.map(name => ({ ...fixture.tables[0]!, name })), functions: [] };
  const rendered = renderSchema(schema);
  expect(rendered).toContain('export type Row$IpnOffer = Infer<typeof ipn_offer>;');
  expect(rendered).toContain('export type Row$PgBridgeTest =');
  expect(rendered).toContain('export type Row$123Items = Infer<typeof _123_items>;');
  expect(rendered).toContain('export type Row$EntityOtsComponent =');
  expect(rendered).toContain('export type ComponentRow = Row$EntityOtsComponent;');
  expect(rendered).toContain('"foo-bar": foo_bar,');
  expect(rendered).toContain('export type Row$Component = Infer<typeof component>;');
  expect(rendered).toContain('export type Row$FooBar2 =');
  expect(rendered.indexOf('const ipn_offer = table(')).toBeLessThan(rendered.indexOf('export type Row$IpnOffer'));
  expect(rendered.indexOf('export type Row$IpnOffer')).toBeLessThan(rendered.indexOf('export const db =')); 
  const aliases = [...rendered.matchAll(/export type (\S+) =/g)].map(match => match[1]!);
  expect(new Set(aliases).size).toBe(aliases.length);
  expect(aliases.every(alias => /^[A-Za-z_$][\w$]*$/.test(alias))).toBe(true);
  expect(rendered).toBe(renderSchema({ ...schema, tables: [...schema.tables].reverse() }));
});
it('avoids keyword, import and normalized binding collisions', () => {
  const names = ['class', 'table', 'table2', 'db', 'col', 'Infer', 'foo-bar', 'foo_bar', '__proto__'];
  const rendered = renderSchema({ tables: names.map(name => ({ ...fixture.tables[0]!, name })), functions: [] });
  expect(rendered).toContain('const class2 = table("class",');
  expect(rendered).toContain('const table3 = table("table",');
  expect(rendered).toContain('const db2 = table("db",');
  expect(rendered).toContain('const foo_bar = table("foo-bar",');
  expect(rendered).toContain('  foo_bar: foo_bar2,');
  expect(rendered).toContain('  ["__proto__"]: __proto__,');
});
it('keeps descriptive aliases stable when unrelated tables are added', () => {
  const table = { ...fixture.tables[0]!, name: 'ipn_offer' };
  const alias = 'export type Row$IpnOffer = Infer<typeof ipn_offer>;';
  expect(renderSchema({ tables: [table], functions: [] })).toContain(alias);
  expect(renderSchema({ tables: [fixture.tables[0]!, table], functions: [] })).toContain(alias);
});
it.each([
  ['String', 'col.String'], ['DateTime', 'col.DateTime()'], ["DateTime('UTC')", 'col.DateTime("UTC")'],
  ['DateTime64(3)', 'col.DateTime64(3)'], ['Decimal64(4)', 'col.Decimal(18, 4)'],
  ['FixedString(2)', 'col.FixedString(2)'], ["Enum8('a' = 1)", 'col.Enum8({ a: 1 })'],
  ["Enum16('b' = 2)", 'col.Enum16({ b: 2 })'], ['Nullable(String)', 'col.Nullable(col.String)'],
  ['LowCardinality(String)', 'col.LowCardinality(col.String)'], ['Array(UInt64)', 'col.Array(col.UInt64)'],
  ['Map(String, UInt64)', 'col.Map(col.String, col.UInt64)'], ['Tuple(String, UInt8)', 'col.Tuple([col.String, col.UInt8])'],
  ['Tuple(id String)', 'col.NamedTuple([["id", col.String]])'],
  ['Tuple(`42` String, `0` UInt64, z UInt8)', 'col.NamedTuple([["42", col.String], ["0", col.UInt64], ["z", col.UInt8]])'], ['Variant(String, UInt64)', 'col.Variant(col.String, col.UInt64)'],
  ['Dynamic', 'col.Dynamic'], ['FutureType(7)', 'col.Unknown("FutureType(7)")'],
  ['AggregateFunction(sum, UInt64)', 'col.AggregateFunction("sum", col.UInt64)'],
  ['SimpleAggregateFunction(sum, UInt64)', 'col.SimpleAggregateFunction("sum", col.UInt64)'],
])('renders %s', (type, result) => expect(renderColumn(parseCHType(type))).toBe(result));
