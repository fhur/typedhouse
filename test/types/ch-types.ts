import { expectTypeOf } from 'expect-type';
import { col, table, type Infer, type Column, type Decimal, type UUID, type IPv4, type IPv6, type AggregateState } from '@chql/core';
export const scalars = table('scalars', {
  u8: col.UInt8, u16: col.UInt16, u32: col.UInt32, i8: col.Int8, i16: col.Int16, i32: col.Int32,
  f32: col.Float32, f64: col.Float64, u64: col.UInt64, u128: col.UInt128, u256: col.UInt256,
  i64: col.Int64, i128: col.Int128, i256: col.Int256, bool: col.Bool, str: col.String,
  fixed: col.FixedString(12), uuid: col.UUID, ip4: col.IPv4, ip6: col.IPv6,
  date: col.Date, date32: col.Date32, dt: col.DateTime(), tz: col.DateTime('UTC'),
  dt0: col.DateTime64(0), dt1: col.DateTime64(1), dt2: col.DateTime64(2), dt3: col.DateTime64(3), dt4: col.DateTime64(4), dt9: col.DateTime64(9),
  dec: col.Decimal(18, 4), d32: col.Decimal32(2), d64: col.Decimal64(3), d128: col.Decimal128(7), d256: col.Decimal256(9),
  json: col.JSON, dynamic: col.Dynamic, variant: col.Variant(col.String, col.UInt64), unknown: col.Unknown('Future'), nothing: col.Nothing,
}, { engine: 'Memory', sortingKey: [], partitionKey: [] });
type ScalarRow = { u8: number; u16: number; u32: number; i8: number; i16: number; i32: number; f32: number; f64: number; u64: bigint; u128: bigint; u256: bigint; i64: bigint; i128: bigint; i256: bigint; bool: boolean; str: string; fixed: string; uuid: UUID; ip4: IPv4; ip6: IPv6; date: Date; date32: Date; dt: Date; tz: Date; dt0: Date; dt1: Date; dt2: Date; dt3: Date; dt4: string; dt9: string; dec: Decimal<18, 4>; d32: Decimal<9, 2>; d64: Decimal<18, 3>; d128: Decimal<38, 7>; d256: Decimal<76, 9>; json: unknown; dynamic: unknown; variant: unknown; unknown: unknown; nothing: never };
expectTypeOf<Infer<typeof scalars>>().toEqualTypeOf<ScalarRow>();
expectTypeOf<Infer<typeof scalars>>().not.toBeAny();
export const structured = table('structured', {
  en: col.Enum8({ one: -1, two: 2 }), en16: col.Enum16({ low: -300, high: 300 }),
  nullable: col.Nullable(col.UInt64), nullOnly: col.Nullable(col.Nothing),
  lc: col.LowCardinality(col.Nullable(col.String)), arr: col.Array(col.Nullable(col.Int64)),
  map: col.Map(col.String, col.UInt64), enumMap: col.Map(col.Enum8({ one: 1, two: 2 }), col.Bool),
  uuidMap: col.Map(col.UUID, col.Float64), intMap: col.Map(col.UInt64, col.Array(col.String)),
  numberMap: col.Map(col.UInt8, col.Bool), tuple: col.Tuple([col.String, col.UInt64]),
  named: col.Tuple({ id: col.String, 'a.b': col.Nullable(col.UInt8) }),
  empty: col.Tuple([]), emptyNamed: col.Tuple({}), agg: col.AggregateFunction('sum', col.UInt64), simple: col.SimpleAggregateFunction('sum', col.UInt64),
}, { engine: 'Memory', sortingKey: [], partitionKey: [] });
expectTypeOf<Infer<typeof structured>>().toEqualTypeOf<{
  en: 'one' | 'two'; en16: 'low' | 'high'; nullable: bigint | null; nullOnly: null; lc: string | null;
  arr: (bigint | null)[]; map: Record<string, bigint>; enumMap: Record<'one' | 'two', boolean>;
  uuidMap: Record<UUID, number>; intMap: Array<[bigint, string[]]>; numberMap: Array<[number, boolean]>;
  tuple: readonly [string, bigint]; named: { id: string; 'a.b': number | null }; empty: readonly []; emptyNamed: readonly [];
  agg: AggregateState<'sum'>; simple: bigint;
}>();
expectTypeOf<Infer<typeof structured>>().not.toBeAny();
const partSpecification = col.Tuple({ id: col.String, mpn: col.Nullable(col.String), manufacturer: col.Nullable(col.String), description: col.Nullable(col.String), package: col.Nullable(col.String), part_type: col.Nullable(col.String) });
const metricMeta = { tenantId: col.String, entityId: col.String, version: col.UInt32, effectiveAt: col.DateTime64(3), insertedAt: col.DateTime64(3) };
export const fixture = table('fixture', { ...metricMeta, part_specifications: col.Array(partSpecification), 'nested.key': col.Array(col.String) }, { engine: 'ReplacingMergeTree', sortingKey: ['tenantId', 'entityId', 'version', 'effectiveAt'], partitionKey: [] });
expectTypeOf<Infer<typeof fixture>>().toEqualTypeOf<{ tenantId: string; entityId: string; version: number; effectiveAt: Date; insertedAt: Date; part_specifications: Array<{ id: string; mpn: string | null; manufacturer: string | null; description: string | null; package: string | null; part_type: string | null }>; 'nested.key': string[] }>();
expectTypeOf<Infer<typeof fixture>>().not.toBeAny();
expectTypeOf(col.UInt64).toEqualTypeOf<Column<bigint, false, { readonly kind: 'scalar'; readonly name: 'UInt64' }>>();
// @ts-expect-error UInt64 descriptors cannot masquerade as numbers.
const invalid: Column<number> = col.UInt64;
void invalid;
