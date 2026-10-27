import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { col, parseCHType, type CHType, type Column } from '@chql/core';
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
  expect(first).toContain('["__proto__"]: table');
  expect(first).toContain('precision > 3 maps to string');
  expect(renderFunctions(fixture)).toContain('["__proto__"]:');
  const changed = structuredClone(fixture); changed.tables[0]!.columns[0]!.comment = 'changed';
  expect(first.split('\n')[0]).not.toBe(renderSchema(changed).split('\n')[0]);
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
