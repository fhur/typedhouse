import { scalarNames, type CHType, type ScalarName } from './ch-type.js';
import type { AggregateState, Column, Decimal, EnumNames, MapValue, NamedTupleValue, ScalarStringKey, ScalarValue, TupleValue, Value } from './types.js';

/** Freeze runtime twins recursively so descriptors can safely be shared by IR nodes. */
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function descriptor<T, S extends boolean = false, D extends CHType = CHType>(type: D): Column<T, S, D> { return immutable({ type }); }
const scalars = Object.fromEntries(scalarNames.map(name => [name, descriptor({ kind: 'scalar', name })])) as { [N in ScalarName]: Column<ScalarValue<N>, ScalarStringKey<N>, { readonly kind: 'scalar'; readonly name: N }> };
type EnumDescriptor<V, B extends 8 | 16> = { readonly kind: 'Enum'; readonly bits: B; readonly values: { readonly name: EnumNames<V>; readonly value: number }[] };
type TupleItems<C> = C extends readonly Column[] ? { -readonly [K in keyof C]: { readonly type: C[K] extends Column ? C[K]['type'] : never } } : keyof C extends never ? [] : { [K in keyof C]: C[K] extends Column ? { readonly name: `${K & (string | number)}`; readonly type: C[K]['type'] } : never }[keyof C][];
type TupleDescriptor<C> = { readonly kind: 'Tuple'; readonly items: TupleItems<C> };
type NamedTupleDescriptor<C extends readonly (readonly [string, Column])[]> = { readonly kind: 'Tuple'; readonly items: { -readonly [K in keyof C]: { readonly name: C[K][0]; readonly type: C[K][1]['type'] } } };
export const col = {
  ...scalars,
  FixedString: <N extends number>(n: N): Column<string, true, { readonly kind: 'FixedString'; readonly n: N }> => descriptor({ kind: 'FixedString', n }),
  DateTime: (tz?: string): Column<Date, false, { readonly kind: 'DateTime'; readonly tz?: string }> => descriptor({ kind: 'DateTime', ...(tz === undefined ? {} : { tz }) }),
  DateTime64: <P extends number>(precision: P, tz?: string): Column<number extends P ? Date | string : P extends 0 | 1 | 2 | 3 ? Date : string, false, { readonly kind: 'DateTime64'; readonly precision: P; readonly tz?: string }> => descriptor({ kind: 'DateTime64', precision, ...(tz === undefined ? {} : { tz }) }),
  Decimal: <P extends number, S extends number>(precision: P, scale: S): Column<Decimal<P, S>, false, { readonly kind: 'Decimal'; readonly precision: P; readonly scale: S }> => descriptor({ kind: 'Decimal', precision, scale }),
  Decimal32: <S extends number>(scale: S): Column<Decimal<9, S>, false, { readonly kind: 'Decimal'; readonly precision: 9; readonly scale: S }> => descriptor({ kind: 'Decimal', precision: 9, scale }),
  Decimal64: <S extends number>(scale: S): Column<Decimal<18, S>, false, { readonly kind: 'Decimal'; readonly precision: 18; readonly scale: S }> => descriptor({ kind: 'Decimal', precision: 18, scale }),
  Decimal128: <S extends number>(scale: S): Column<Decimal<38, S>, false, { readonly kind: 'Decimal'; readonly precision: 38; readonly scale: S }> => descriptor({ kind: 'Decimal', precision: 38, scale }),
  Decimal256: <S extends number>(scale: S): Column<Decimal<76, S>, false, { readonly kind: 'Decimal'; readonly precision: 76; readonly scale: S }> => descriptor({ kind: 'Decimal', precision: 76, scale }),
  Enum8: <const V extends Record<string, number>>(values: V): Column<EnumNames<V>, true, EnumDescriptor<V, 8>> => descriptor({ kind: 'Enum', bits: 8, values: Object.entries(values).map(([name, value]) => ({ name: name as EnumNames<V>, value })) }),
  Enum16: <const V extends Record<string, number>>(values: V): Column<EnumNames<V>, true, EnumDescriptor<V, 16>> => descriptor({ kind: 'Enum', bits: 16, values: Object.entries(values).map(([name, value]) => ({ name: name as EnumNames<V>, value })) }),
  Nullable: <T, D extends CHType>(inner: Column<T, boolean, D>): Column<T | null, false, { readonly kind: 'Nullable'; readonly inner: D }> => descriptor({ kind: 'Nullable', inner: inner.type }),
  LowCardinality: <T, S extends boolean, D extends CHType>(inner: Column<T, S, D>): Column<T, S, { readonly kind: 'LowCardinality'; readonly inner: D }> => descriptor({ kind: 'LowCardinality', inner: inner.type }),
  Array: <T, D extends CHType>(inner: Column<T, boolean, D>): Column<T[], false, { readonly kind: 'Array'; readonly inner: D }> => descriptor({ kind: 'Array', inner: inner.type }),
  Map: <K, V, S extends boolean, KD extends CHType, VD extends CHType>(key: Column<K, S, KD>, value: Column<V, boolean, VD>): Column<MapValue<K, V, S>, false, { readonly kind: 'Map'; readonly key: KD; readonly value: VD }> => descriptor({ kind: 'Map', key: key.type, value: value.type }),
  Tuple: <const C extends Readonly<Record<string, Column>> | readonly Column[]>(items: C): Column<TupleValue<C>, false, TupleDescriptor<C>> => descriptor({ kind: 'Tuple', items: (Array.isArray(items) ? (items as readonly Column[]).map(c => ({ type: c.type })) : Object.entries(items).map(([name, c]: [string, Column]) => ({ name, type: c.type }))) as TupleItems<C> }),
  /** Unlike object enumeration, entries preserve even integer-like field names in SQL order. */
  NamedTuple: <const C extends readonly (readonly [string, Column])[]>(items: C): Column<NamedTupleValue<C>, false, NamedTupleDescriptor<C>> => descriptor({ kind: 'Tuple', items: items.map(([name, c]) => ({ name, type: c.type })) as NamedTupleDescriptor<C>['items'] }),
  Variant: (...items: Column[]): Column<unknown, false> => descriptor({ kind: 'Variant', items: items.map(c => c.type) }),
  Dynamic: descriptor<unknown>({ kind: 'Dynamic' }),
  Unknown: (raw: string): Column<unknown, false> => descriptor({ kind: 'Unknown', raw }),
  AggregateFunction: <F extends string, const C extends readonly Column[]>(fn: F, ...args: C): Column<AggregateState<F>, false, { readonly kind: 'AggregateFunction'; readonly fn: F; readonly args: { -readonly [K in keyof C]: C[K]['type'] } }> => descriptor({ kind: 'AggregateFunction', fn, args: args.map(c => c.type) as { -readonly [K in keyof C]: C[K]['type'] } }),
  SimpleAggregateFunction: <C extends Column>(fn: string, inner: C): Column<Value<C>, false> => descriptor({ kind: 'SimpleAggregateFunction', fn, inner: inner.type }),
};
Object.freeze(col);
