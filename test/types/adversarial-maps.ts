import { expectTypeOf } from 'expect-type';
import { col, table, type Decimal, type Infer } from '@typedhouse/core';
// Deliberately distinguish ClickHouse string-like keys from values decoded to TS strings.
// The runtime-to-phantom bridge asserts the complete exact row type for these cases.
export const adversarialMaps = table('adversarial_maps', {
  decimal: col.Map(col.Decimal(18, 4), col.UInt8),
  preciseTime: col.Map(col.DateTime64(9), col.UInt8),
  fixed: col.Map(col.FixedString(12), col.UInt8),
  lowCardinality: col.Map(col.LowCardinality(col.String), col.UInt8),
  numericEnum: col.Enum8({ 0: 1, 42: 2, ordinary: 3 }),
  numericEnumMap: col.Map(col.Enum16({ 0: 1, 42: 2 }), col.UInt8),
}, { engine: 'Memory', sortingKey: [], partitionKey: [] });
expectTypeOf<Infer<typeof adversarialMaps>>().toEqualTypeOf<{
  decimal: Array<[Decimal<18, 4>, number]>;
  preciseTime: Array<[string, number]>;
  fixed: Record<string, number>;
  lowCardinality: Record<string, number>;
  numericEnum: '0' | '42' | 'ordinary';
  numericEnumMap: Record<'0' | '42', number>;
}>();
expectTypeOf<Infer<typeof adversarialMaps>>().not.toBeAny();
const symbolKey = Symbol('not an enum label');
const symbolEnum8 = col.Enum8({ 0: 1, [-2]: 2, ordinary: 3, [symbolKey]: 4 });
const symbolEnum16 = col.Enum16({ 0: 1, [-2]: 2, ordinary: 3, [symbolKey]: 4 });
expectTypeOf<Infer<typeof symbolEnum8>>().toEqualTypeOf<'0' | '-2' | 'ordinary'>();
expectTypeOf<Infer<typeof symbolEnum16>>().toEqualTypeOf<'0' | '-2' | 'ordinary'>();
expectTypeOf<Infer<typeof symbolEnum8>>().not.toBeAny();
expectTypeOf<Infer<typeof symbolEnum16>>().not.toBeAny();
const wrapped = table('wrapped', {
  decimal: col.Map(col.LowCardinality(col.Decimal(18, 4)), col.String),
  enum: col.Map(col.LowCardinality(col.Enum8({ a: 1, b: 2 })), col.UInt8),
}, { engine: 'Memory', sortingKey: [], partitionKey: [] });
expectTypeOf<Infer<typeof wrapped>>().toEqualTypeOf<{
  decimal: Array<[Decimal<18, 4>, string]>;
  enum: Record<'a' | 'b', number>;
}>();
expectTypeOf<Infer<typeof wrapped>>().not.toBeAny();
