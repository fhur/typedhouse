import fc from 'fast-check';
import { expect, it } from 'vitest';
import { parseCHType, print, scalarNames, type CHType } from '../src/index.js';
const options = { seed: 20261027, numRuns: 2000 };
it('never throws on arbitrary strings; Unknown preserves bytes', () => {
  fc.assert(fc.property(fc.string({ maxLength: 3000 }), s => {
    const t = parseCHType(s);
    if (t.kind === 'Unknown') expect(print(t)).toBe(s);
    else expect(parseCHType(print(t))).toEqual(t);
  }), { ...options, numRuns: 10000 });
});
function types(depth: number): fc.Arbitrary<CHType> {
  const leaf: fc.Arbitrary<CHType> = fc.oneof(
    fc.constantFrom(...scalarNames.filter(n => n !== 'DateTime')).map(name => ({ kind: 'scalar' as const, name })),
    fc.string().map(tz => ({ kind: 'DateTime' as const, tz })),
    fc.integer({ min: 0, max: 9 }).map(precision => ({ kind: 'DateTime64' as const, precision })),
    fc.integer({ min: 1, max: 1000 }).map(n => ({ kind: 'FixedString' as const, n })),
    fc.array(fc.record({ name: fc.string(), value: fc.integer({ min: -128, max: 127 }) }), { maxLength: 5 }).map(values => ({ kind: 'Enum' as const, bits: 8 as const, values })),
    fc.constant({ kind: 'Decimal' as const, precision: 18, scale: 4 }), fc.constant({ kind: 'Dynamic' as const }),
  );
  if (!depth) return leaf;
  const child = types(depth - 1);
  return fc.oneof(leaf,
    fc.tuple(fc.constantFrom('Array' as const, 'Nullable' as const, 'LowCardinality' as const), child).map(([kind, inner]) => ({ kind, inner })),
    fc.tuple(child, child).map(([key, value]) => ({ kind: 'Map' as const, key, value })),
    fc.array(child, { maxLength: 3 }).map(items => ({ kind: 'Variant' as const, items })),
    fc.array(child, { maxLength: 3 }).map(items => ({ kind: 'Tuple' as const, items: items.map(type => ({ type })) })),
    fc.array(fc.record({ name: fc.string(), type: child }), { maxLength: 3 }).map(items => ({ kind: 'Tuple' as const, items })),
    fc.array(child, { maxLength: 3 }).map(args => ({ kind: 'AggregateFunction' as const, fn: 'sum', args })),
    child.map(inner => ({ kind: 'SimpleAggregateFunction' as const, fn: 'sum', inner })),
  );
}
it('recursive valid ASTs survive print/parse, including arbitrary quoted punctuation', () => {
  fc.assert(fc.property(types(4), t => { expect(parseCHType(print(t))).toEqual(t); }), options);
});
it('preserves arbitrary ASCII controls and delimiters in nested tuple identifiers', () => {
  const characters = [...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)), '`', '\\', "'", ',', ')', 'é', '😀'];
  fc.assert(fc.property(fc.array(fc.constantFrom(...characters), { minLength: 1, maxLength: 40 }), parts => {
    const type: CHType = { kind: 'Array', inner: { kind: 'Tuple', items: [{ name: parts.join(''), type: { kind: 'scalar', name: 'UInt64' } }] } };
    expect(parseCHType(print(type))).toEqual(type);
  }), options);
});
it.each(['Tuple(`unfinished\\', 'Tuple(`unfinished String)', 'Tuple(`ok` String) trailing', 'Tuple(`ok` String, Future(1))'])('preserves malformed identifier/type input %s', raw => {
  expect(parseCHType(raw)).toEqual({ kind: 'Unknown', raw });
});
it('valid type prefixes followed by garbage are not partially accepted', () => {
  fc.assert(fc.property(types(2), t => { const raw = print(t) + ' trailing!'; expect(parseCHType(raw)).toEqual({ kind: 'Unknown', raw }); }), options);
});
