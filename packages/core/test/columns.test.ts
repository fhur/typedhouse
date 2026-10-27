import { expect, it, expectTypeOf } from 'vitest';
import { col, parseCHType, print, scalarNames, table, toTypeScript, type Column, type Infer } from '../src/index.js';
const cases: Array<[Column, string, string]> = [
  [col.FixedString(16), 'FixedString(16)', 'string'],
  [col.DateTime(), 'DateTime', 'Date'], [col.DateTime('UTC'), "DateTime('UTC')", 'Date'],
  ...([0, 1, 2, 3] as const).map(p => [col.DateTime64(p), `DateTime64(${p})`, 'Date'] as [Column, string, string]),
  ...([4, 9] as const).map(p => [col.DateTime64(p), `DateTime64(${p})`, 'string'] as [Column, string, string]),
  [col.Decimal(18, 4), 'Decimal(18, 4)', 'Decimal<18, 4>'],
  [col.Decimal32(2), 'Decimal(9, 2)', 'Decimal<9, 2>'], [col.Decimal64(4), 'Decimal(18, 4)', 'Decimal<18, 4>'],
  [col.Decimal128(7), 'Decimal(38, 7)', 'Decimal<38, 7>'], [col.Decimal256(9), 'Decimal(76, 9)', 'Decimal<76, 9>'],
  [col.Enum8({ 'a b': -1, two: 2 }), "Enum8('a b' = -1, 'two' = 2)", '"a b" | "two"'],
  [col.Enum16({ low: -300 }), "Enum16('low' = -300)", '"low"'],
  [col.Nullable(col.Nothing), 'Nullable(Nothing)', '(never) | null'],
  [col.LowCardinality(col.Nullable(col.String)), 'LowCardinality(Nullable(String))', '(string) | null'],
  [col.Array(col.Nullable(col.Int64)), 'Array(Nullable(Int64))', 'Array<(bigint) | null>'],
  [col.Map(col.String, col.UInt64), 'Map(String, UInt64)', 'Record<string, bigint>'],
  [col.Map(col.UUID, col.Float64), 'Map(UUID, Float64)', 'Record<UUID, number>'],
  [col.Map(col.UInt64, col.Array(col.String)), 'Map(UInt64, Array(String))', 'Array<[bigint, Array<string>]>'],
  [col.Tuple([col.String, col.UInt64]), 'Tuple(String, UInt64)', 'readonly [string, bigint]'],
  [col.Tuple({ 'a.b': col.String, b: col.Nullable(col.UInt8) }), 'Tuple(`a.b` String, b Nullable(UInt8))', '{ "a.b": string; "b": (number) | null }'],
  [col.Tuple([]), 'Tuple()', 'readonly []'],
  [col.Variant(col.String, col.UInt64), 'Variant(String, UInt64)', 'unknown'],
  [col.Dynamic, 'Dynamic', 'unknown'], [col.Unknown('Future(T)'), 'Future(T)', 'unknown'],
  [col.AggregateFunction('sum', col.UInt64), 'AggregateFunction(sum, UInt64)', 'AggregateState<"sum">'],
  [col.SimpleAggregateFunction('sum', col.UInt64), 'SimpleAggregateFunction(sum, UInt64)', 'bigint'],
];
it.each(cases)('descriptor %s matches its runtime twin', (c, sql, ts) => {
  expect(print(c.type)).toBe(sql); expect(c.type).toEqual(parseCHType(sql)); expect(toTypeScript(c.type)).toBe(ts); expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.type)).toBe(true);
});
it('preserves ordered named tuples with exact object inference and immutable runtime twins', () => {
  const entries: [string, Column][] = [['42', col.String], ['0', col.UInt64], ['z', col.UInt8]];
  const tuple = col.NamedTuple([['42', col.String], ['0', col.UInt64], ['z', col.UInt8], ['__proto__', col.Nullable(col.String)]]);
  expectTypeOf<Infer<typeof tuple>>().toEqualTypeOf<{ '42': string; '0': bigint; z: number; __proto__: string | null }>();
  expectTypeOf<Infer<typeof tuple>>().not.toBeAny();
  expect(tuple.type).toEqual(parseCHType('Tuple(`42` String, `0` UInt64, z UInt8, __proto__ Nullable(String))'));
  expect(Object.isFrozen(tuple.type)).toBe(true);
  if (tuple.type.kind !== 'Tuple') throw new Error('Expected tuple');
  expect(Object.isFrozen(tuple.type.items)).toBe(true);
  expect(Object.isFrozen(tuple.type.items[0])).toBe(true);
  const copied = col.NamedTuple(entries);
  entries.reverse();
  expect(print(copied.type)).toBe('Tuple(`42` String, `0` UInt64, z UInt8)');
  const empty = col.NamedTuple([]);
  expectTypeOf<Infer<typeof empty>>().toEqualTypeOf<readonly []>();
  expect(empty.type).toEqual(col.Tuple([]).type);
  const nested = col.Array(tuple);
  expectTypeOf<Infer<typeof nested>>().toEqualTypeOf<{ '42': string; '0': bigint; z: number; __proto__: string | null }[]>();
});
it('covers every scalar mapping', () => {
  const mappings = { UInt8: 'number', UInt16: 'number', UInt32: 'number', UInt64: 'bigint', UInt128: 'bigint', UInt256: 'bigint', Int8: 'number', Int16: 'number', Int32: 'number', Int64: 'bigint', Int128: 'bigint', Int256: 'bigint', Float32: 'number', Float64: 'number', Bool: 'boolean', String: 'string', UUID: 'UUID', IPv4: 'IPv4', IPv6: 'IPv6', Date: 'Date', Date32: 'Date', DateTime: 'Date', JSON: 'unknown', Nothing: 'never' };
  for (const name of scalarNames) { const c = name === 'DateTime' ? col.DateTime() : col[name]; expect(print(c.type)).toBe(name); expect(toTypeScript(c.type)).toBe(mappings[name]); }
});
it('keeps table metadata, aliases and dotted column names', () => {
  const metadata = { engine: 'MergeTree', sortingKey: ['id'], primaryKey: ['id'], partitionKey: [], columnMetadata: { 'nested.key': { defaultKind: 'ALIAS', comment: 'alias', position: 2 } }, source: { kind: 'test' } };
  const t = table('a table', { id: col.UInt64, 'nested.key': col.Array(col.String) }, metadata);
  expect(t).toEqual({ name: 'a table', ...metadata, columns: { id: col.UInt64.type, 'nested.key': col.Array(col.String).type } });
  expect(Object.isFrozen(t.columns)).toBe(true); expect(Object.keys(t.columns)).toEqual(['id', 'nested.key']);
});
