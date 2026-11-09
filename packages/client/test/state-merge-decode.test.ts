import { describe, expect, it } from 'vitest';
import { col, parseCHType, print, type CHType } from '@typedhouse/core';
import { decoder, rowDecoder } from '../src/index.js';

/** D3 Tester: the decoder refuses a state on its own, reached directly, without the compiler. */
const state = col.AggregateFunction('sum', col.UInt64).type;

const refused: [string, CHType][] = [
  ['Map value', { kind: 'Map', key: col.String.type, value: state }],
  ['Map key', { kind: 'Map', key: state, value: col.String.type }],
  ['Map of Array', { kind: 'Map', key: col.String.type, value: { kind: 'Array', inner: state } }],
  [
    'Map of Map',
    {
      kind: 'Map',
      key: col.String.type,
      value: { kind: 'Map', key: col.String.type, value: state },
    },
  ],
  ['Variant', { kind: 'Variant', items: [col.String.type, state] }],
  [
    'Variant of Map',
    {
      kind: 'Variant',
      items: [{ kind: 'Map', key: col.String.type, value: state }],
    },
  ],
  [
    'Map of Variant',
    {
      kind: 'Map',
      key: col.String.type,
      value: { kind: 'Variant', items: [state] },
    },
  ],
  [
    'Nullable Map',
    { kind: 'Nullable', inner: { kind: 'Map', key: col.String.type, value: state } },
  ],
  [
    'LowCardinality Map',
    { kind: 'LowCardinality', inner: { kind: 'Map', key: col.String.type, value: state } },
  ],
  [
    'SimpleAggregateFunction Map',
    {
      kind: 'SimpleAggregateFunction',
      fn: 'max',
      inner: { kind: 'Map', key: col.String.type, value: state },
    },
  ],
  ['Array Map', { kind: 'Array', inner: { kind: 'Map', key: col.String.type, value: state } }],
  [
    'Tuple Map',
    {
      kind: 'Tuple',
      items: [{ name: 'a', type: { kind: 'Map', key: col.String.type, value: state } }],
    },
  ],
  ['Array', { kind: 'Array', inner: state }],
  ['Tuple', { kind: 'Tuple', items: [{ type: state }] }],
  ['Nullable', { kind: 'Nullable', inner: state }],
  ['SimpleAggregateFunction', { kind: 'SimpleAggregateFunction', fn: 'max', inner: state }],
];

describe('refuses a nested state with decode_unsupported', () => {
  it.each(refused)('%s', (_name, type) => {
    expect(() => decoder(type)).toThrow(/decode_unsupported/);
    expect(() => rowDecoder({ x: type })).toThrow(/decode_unsupported/);
  });

  it.each([
    'Map(String, AggregateFunction(uniq, String))',
    'Variant(AggregateFunction(sum, UInt64), String)',
    'Array(Map(String, AggregateFunction(sum, UInt64)))',
    'Tuple(a Map(String, Array(AggregateFunction(sum, UInt64))))',
  ])('parsed server text %s', text => {
    const type = parseCHType(text);
    expect(print(type)).toBe(text);
    expect(() => decoder(type)).toThrow(/decode_unsupported/);
  });
});

describe('a real text the parser cannot model still holds a state', () => {
  it.each([
    'Nested(a AggregateFunction(uniq, String))',
    'AggregateFunction(uniq, Point)',
    'Tuple(a Nested(b AggregateFunction(sum, UInt64)))',
  ])('%s', text => {
    expect(() => decoder(parseCHType(text))).toThrow(/decode_unsupported/);
  });
});

describe('leaves state-free containers exactly as they were', () => {
  it('passes a Map and a Variant through by identity', () => {
    const value = { a: '1' };
    expect(decoder(col.Map(col.String, col.UInt64).type)(value)).toBe(value);
    expect(decoder(col.Map(col.String, col.Array(col.UInt64)).type)(value)).toBe(value);
    expect(decoder(col.Variant(col.String, col.UInt64).type)(value)).toBe(value);
    expect(decoder(col.Dynamic.type)(value)).toBe(value);
    expect(decoder(col.Unknown('Foo(Bar)').type)(value)).toBe(value);
    expect(decoder(col.Unknown('SimpleAggregateFunction(max, Foo)').type)(value)).toBe(value);
  });

  it('still adapts a SimpleAggregateFunction and a Nullable Map', () => {
    expect(decoder(col.SimpleAggregateFunction('sum', col.UInt64).type)('7')).toBe(7n);
    expect(decoder(col.Nullable(col.Map(col.String, col.UInt64) as never).type)(null)).toBe(null);
  });
});
