import { expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalKey, col, exprNode } from '../src/index.js';

it('does not trust inherited graph brands on mutable owned values', () => {
  const genuine = exprNode({ kind: 'Param', type: null, value: 1n });
  const inherited: object = Object.create(genuine);
  Object.defineProperty(inherited, 'payload', { value: { mutable: 1 }, enumerable: true });
  // Non-plain objects are rejected everywhere else in the owned-value snapshot.
  // Accepting this by identity would retain a mutable caller-owned object.
  expect(() => exprNode({ kind: 'Param', type: null, value: inherited })).toThrow(/IR:/);
});

it('does not trust a reflected graph brand copied to a caller-owned object', () => {
  const genuine = exprNode({ kind: 'Param', type: null, value: 1n });
  const impostor = { payload: { mutable: 1 } };
  for (const symbol of Object.getOwnPropertySymbols(genuine)) {
    Object.defineProperty(impostor, symbol, Object.getOwnPropertyDescriptor(genuine, symbol)!);
  }
  expect(() => exprNode({ kind: 'Param', type: null, value: impostor })).toThrow(/IR:/);
});

it.each(['Param', 'Literal'] as const)('%s preserves supported non-enumerable map fields when taking ownership', kind => {
  const value = Object.defineProperty({ visible: 1n }, 'hidden', { value: 2n });
  const type = col.Map(col.String, col.UInt64).type;
  const before = canonicalKey({ value }, [['value', type]]);
  const node = exprNode({ kind, type, value });
  expect(canonicalKey({ value: node.value }, [['value', type]])).toBe(before);
  expect(node.value).not.toBe(value);
});

it('preserves dense non-enumerable map indices through parameter snapshots', () => {
  const pair = Object.defineProperty(['x', 2n], '1', { enumerable: false });
  const value = Object.defineProperty([pair], '0', { enumerable: false });
  const type = col.Map(col.String, col.UInt64).type;
  const before = canonicalKey({ value }, [['value', type]]);
  const node = exprNode({ kind: 'Param', type, value });
  expect(canonicalKey({ value: node.value }, [['value', type]])).toBe(before);
});

it('retains genuine nested graph sharing under arbitrary mutable container replacement', () => {
  fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 30 }), values => {
    const node = exprNode({ kind: 'Param', type: null, value: values });
    const containers = values.map(() => ({ edges: [node, node] }));
    const holder = exprNode({ kind: 'Param', type: null, value: containers });
    containers.splice(0);
    values.push(42);
    const owned = holder.value as { edges: unknown[] }[];
    expect(owned).toHaveLength(values.length - 1);
    for (const item of owned) {
      expect(item.edges[0]).toBe(node);
      expect(item.edges[1]).toBe(node);
      expect(Object.isFrozen(item.edges)).toBe(true);
    }
    expect(node.value).toHaveLength(values.length - 1);
  }), { seed: 20261102, numRuns: 300 });
});

it.each([col.Unknown('future'), col.JSON, col.Variant(col.String, col.UInt64), col.Dynamic])('does not silently discard hidden passthrough data for $type.kind', descriptor => {
  const columns = [['value', descriptor.type]] as const;
  const key = (value: unknown) => canonicalKey({ value }, columns);
  for (const [value, empty] of [
    [Object.defineProperty({}, 'hidden', { value: 1n }), {}],
    [Object.defineProperty([], 'hidden', { value: 1n }), []],
  ]) {
    const captured = exprNode({ kind: 'Param', type: descriptor.type, value }).value;
    // Either encode all accepted data or reject the unsupported representation.
    // A successful key equal to the empty value loses information.
    let actual: string;
    try { actual = key(captured); } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      continue;
    }
    expect.soft(actual).not.toBe(key(empty));
  }
});

it('captures hidden getter-backed Date map entries exactly once', () => {
  let reads = 0;
  const date = new Date(0);
  const value = Object.defineProperty({}, 'hidden', { get() { reads++; return date; } });
  const type = col.Map(col.String, col.DateTime64(3)).type;
  const node = exprNode({ kind: 'Param', type, value });
  expect(reads).toBe(1);
  date.setTime(1000);
  const owned = node.value as { hidden: Date };
  owned.hidden.setTime(2000);
  expect(canonicalKey({ value: owned }, [['value', type]])).toBe(canonicalKey({ value: { hidden: new Date(0) } }, [['value', type]]));
  expect(reads).toBe(1);
});

it('preserves hidden nested decoded values through ownership for arbitrary hostile field names', () => {
  fc.assert(fc.property(fc.string(), fc.bigInt(), fc.integer({ min: -1000000, max: 1000000 }), (name, n, time) => {
    const date = new Date(time);
    const array = Object.defineProperty([n, date], '0', { enumerable: false });
    const original = Object.defineProperty({}, name, { value: array });
    const equivalent = Object.fromEntries([[name, [n, new Date(time)]]]);
    for (const descriptor of [col.Unknown('future'), col.JSON, col.Variant(col.String), col.Dynamic]) {
      const columns = [['value', descriptor.type]] as const;
      const expected = canonicalKey({ value: equivalent }, columns);
      for (const kind of ['Param', 'Literal'] as const) {
        const node = exprNode({ kind, type: descriptor.type, value: original });
        expect(canonicalKey({ value: node.value }, columns)).toBe(expected);
        const captured = node.value as Record<string, [bigint, Date]>;
        captured[name]![1].setTime(time + 1);
        expect(canonicalKey({ value: node.value }, columns)).toBe(expected);
      }
    }
    expect(date.getTime()).toBe(time);
  }), { seed: 20261103, numRuns: 300 });
});

it('allows repeated acyclic values but rejects backedges through hidden fields', () => {
  const child = { n: 1n };
  const value = { a: child, b: child };
  const columns = [['value', col.JSON.type]] as const;
  expect(canonicalKey({ value }, columns)).toBe(canonicalKey({ value: { a: { n: 1n }, b: { n: 1n } } }, columns));
  const node = exprNode({ kind: 'Param', type: col.JSON.type, value });
  child.n = 2n;
  expect(canonicalKey({ value: node.value }, columns)).not.toBe(canonicalKey({ value }, columns));
  Object.defineProperty(child, 'back', { value });
  expect(() => canonicalKey({ value }, columns)).toThrow(/cyclic/);
  expect(() => exprNode({ kind: 'Param', type: null, value })).toThrow(/cyclic/);
});

const mapType = col.Map(col.String, col.UInt64).type;
const mapKey = (value: unknown) => canonicalKey({ value }, [['value', mapType]]);

it.each([
  ['sparse pair array', new Array(1)],
  ['native Map', new Map([['present', 1n]])],
  ['native Set', new Set(['present'])],
  ['symbol-keyed record', { [Symbol('present')]: 1n }],
])('rejects unsupported %s instead of silently encoding an empty typed map', (_name, value) => {
  expect(() => mapKey(value)).toThrow();
});

it('rejects inherited map entries rather than treating a custom object as an empty record', () => {
  const inherited: object = Object.create({ present: 1n });
  expect(() => mapKey(inherited)).toThrow();
});

it('retains nested map multiplicities and normalizes decimal keys without delimiter collisions', () => {
  const type = col.Array(col.Map(col.Decimal(18, 4), col.NamedTuple([
    ['__proto__', col.UInt64], ['42', col.Nullable(col.String)], ['0', col.DateTime64(3)],
  ]))).type;
  const key = (value: unknown) => canonicalKey({ value }, [['value', type]]);
  fc.assert(fc.property(fc.bigInt(), fc.string(), (n, text) => {
    const tuple = { ['__proto__']: n, 42: text, 0: new Date(0) };
    const a = [['01.2000', tuple], ['2.0000', tuple]];
    const b = [['2', { 0: new Date(0), 42: text, ['__proto__']: n }], ['1.2', tuple]];
    expect(key([a])).toBe(key([b]));
    expect(key([a])).not.toBe(key([[...a, a[0]]]));
    expect(key([a])).not.toBe(key([a, []]));
  }), { seed: 20261101, numRuns: 1000 });
});

it('copies top-level Date parameters on every read, not only nested Dates', () => {
  const date = new Date(0);
  const p = exprNode({ kind: 'Param', type: col.DateTime64(3).type, value: date });
  date.setTime(5);
  (p.value as Date).setTime(10);
  expect((p.value as Date).getTime()).toBe(0);
  expect(p.value).not.toBe(p.value);
});
