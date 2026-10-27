import { expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalKey, col, type CHType } from '../src/index.js';
const key = (value: unknown, type: CHType = col.Unknown('future').type) => canonicalKey({ value }, [['value', type]]);
it('frames strings and distinguishes all supported primitive kinds and denormals', () => {
  const values = [null, undefined, '', 'null', 'undefined', 'NaN', '1', 1, 1n, true, false, NaN, Infinity, -Infinity, [], {}, ['a', 'b'], ['a,b'], new Date(0), '1970-01-01T00:00:00.000Z'];
  expect(new Set(values.map(v => key(v))).size).toBe(values.length);
  expect(key(-0)).toBe(key(0)); expect(key(Number.NaN)).toBe(key(NaN));
});
it('normalizes decimal spelling but retains precision and scale in the key', () => {
  const d = col.Decimal(18, 4).type;
  expect(key('+001.2000', d)).toBe(key('1.2', d));
  expect(key('-0.000', d)).toBe(key('0', d));
  expect(key('1.2', d)).not.toBe(key('1.2', col.Decimal(9, 4).type));
  expect(() => key('nan', d)).toThrow('decimal');
});
it('recurses through arrays, wrappers and named/numeric/prototype tuples', () => {
  const type = col.Array(col.NamedTuple([['42', col.UInt64], ['0', col.Decimal(18, 4)], ['__proto__', col.Nullable(col.String)]] )).type;
  expect(key([{ ['__proto__']: null, 0: '01.00', 42: 3n }], type)).toBe(key([{ 42: 3n, 0: '1', ['__proto__']: null }], type));
  expect(key([1n, 'x'], col.Tuple([col.UInt64, col.String]).type)).not.toBe(key([2n, 'x'], col.Tuple([col.UInt64, col.String]).type));
});
it('sorts map entries while retaining duplicate-pair multiplicity', () => {
  const type = col.Map(col.UInt64, col.String).type;
  expect(key([[2n, 'b'], [1n, 'a']], type)).toBe(key([[1n, 'a'], [2n, 'b']], type));
  expect(key([[1n, 'a'], [1n, 'a']], type)).not.toBe(key([[1n, 'a']], type));
  const stringMap = col.Map(col.String, col.UInt64).type;
  expect(key({ z: 1n, ['__proto__']: 2n }, stringMap)).toBe(key({ ['__proto__']: 2n, z: 1n }, stringMap));
});
it('rejects holes, inherited indices and decorations in both map array levels', () => {
  const type = col.Map(col.String, col.UInt64).type;
  const inheritedPair = new Array(2);
  Object.setPrototypeOf(inheritedPair, { 0: 'x', 1: 1n });
  const disguisedHole = Object.assign(new Array(1), { extra: ['x', 1n] });
  const symbolPair = Object.assign(['x', 1n], { [Symbol('extra')]: 2n });
  const hiddenPair = Object.defineProperty(['x', 1n], 'extra', { value: 2n });
  for (const invalid of [[new Array(2)], [inheritedPair], disguisedHole, [symbolPair], [hiddenPair], Object.assign([], { extra: 1 })]) {
    expect(() => key(invalid, type)).toThrow(/canonicalKey:/);
  }
});
it('accepts null-prototype map records and preserves every own string field', () => {
  const type = col.Map(col.String, col.UInt64).type;
  const record: object = Object.create(null);
  Object.defineProperty(record, '__proto__', { value: 3n, enumerable: true });
  Object.defineProperty(record, 'hidden', { value: 4n });
  expect(key(record, type)).toBe(key([['hidden', 4n], ['__proto__', 3n]], type));
  expect(key(record, type)).not.toBe(key({ ['__proto__']: 3n }, type));
});
it('encodes passthrough objects deterministically, rejecting unsupported values', () => {
  expect(key({ z: [1, { b: 2, a: 3 }], a: null })).toBe(key({ a: null, z: [1, { a: 3, b: 2 }] }));
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const invalid of [cycle, Symbol(), () => 1, new Map(), new Date(NaN), Array(2), { [Symbol()]: 1 }]) expect(() => key(invalid)).toThrow();
  expect(() => canonicalKey({}, [['missing', col.String.type]])).toThrow('missing');
});
it('includes hidden passthrough record fields recursively regardless of enumerability', () => {
  const record: object = Object.create(null);
  Object.defineProperty(record, '__proto__', { value: { hidden: 3n } });
  Object.defineProperty(record, '42', { value: 4n });
  expect(key(record)).toBe(key({ 42: 4n, ['__proto__']: { hidden: 3n } }));
  expect(key(record)).not.toBe(key({}));
  const cycle = Object.defineProperty({}, 'self', { get() { return cycle; } });
  expect(() => key(cycle)).toThrow('cyclic');
  expect(() => key(Object.defineProperty({}, 'hidden', { value: Symbol() }))).toThrow(TypeError);
});
it('validates all passthrough array properties while accepting hidden dense indices', () => {
  expect(key(Object.defineProperty([1n], '0', { enumerable: false }))).toBe(key([1n]));
  const disguisedHole = Object.defineProperty(new Array(1), 'hidden', { value: 1n });
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, { 0: 1n });
  for (const invalid of [
    Object.defineProperty([], 'hidden', { value: 1n }),
    Object.defineProperty([1n], 'hidden', { value: 2n }),
    Object.defineProperty([], Symbol('hidden'), { value: 1n }),
    disguisedHole, inherited,
  ]) expect(() => key(invalid)).toThrow(TypeError);
});
it('preserves explicit column order and UTC instants', () => {
  const row = { 42: 'x', 0: 1n };
  expect(canonicalKey(row, [['42', col.String.type], ['0', col.UInt64.type]])).not.toBe(canonicalKey(row, [['0', col.UInt64.type], ['42', col.String.type]]));
  expect(key(new Date('2026-01-01T01:00:00+01:00'))).toBe(key(new Date('2026-01-01T00:00:00Z')));
});
it('has no delimiter/string collisions over 3000 deterministic pairs', () => {
  fc.assert(fc.property(fc.array(fc.string()), fc.array(fc.string()), (a, b) => {
    expect(key(a) === key(b)).toBe(JSON.stringify(a) === JSON.stringify(b));
  }), { seed: 20261027, numRuns: 3000 });
});
it('is invariant under object-key insertion order for arbitrary nested JSON', () => {
  fc.assert(fc.property(fc.dictionary(fc.string(), fc.jsonValue()), object => {
    expect(key(object)).toBe(key(Object.fromEntries(Object.entries(object).reverse())));
  }), { seed: 20261028, numRuns: 1000 });
});
