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
function descriptor<T, S extends boolean = false>(type: CHType): Column<T, S> { return immutable({ type }); }
const scalars = Object.fromEntries(scalarNames.map(name => [name, descriptor({ kind: 'scalar', name })])) as { [N in ScalarName]: Column<ScalarValue<N>, ScalarStringKey<N>> };
export const col = {
  ...scalars,
  FixedString: (n: number): Column<string, true> => descriptor({ kind: 'FixedString', n }),
  DateTime: (tz?: string): Column<Date, false> => descriptor({ kind: 'DateTime', ...(tz === undefined ? {} : { tz }) }),
  DateTime64: <P extends number>(precision: P, tz?: string): Column<number extends P ? Date | string : P extends 0 | 1 | 2 | 3 ? Date : string, false> => descriptor({ kind: 'DateTime64', precision, ...(tz === undefined ? {} : { tz }) }),
  Decimal: <P extends number, S extends number>(precision: P, scale: S): Column<Decimal<P, S>, false> => descriptor({ kind: 'Decimal', precision, scale }),
  Decimal32: <S extends number>(scale: S): Column<Decimal<9, S>, false> => descriptor({ kind: 'Decimal', precision: 9, scale }),
  Decimal64: <S extends number>(scale: S): Column<Decimal<18, S>, false> => descriptor({ kind: 'Decimal', precision: 18, scale }),
  Decimal128: <S extends number>(scale: S): Column<Decimal<38, S>, false> => descriptor({ kind: 'Decimal', precision: 38, scale }),
  Decimal256: <S extends number>(scale: S): Column<Decimal<76, S>, false> => descriptor({ kind: 'Decimal', precision: 76, scale }),
  Enum8: <const V extends Record<string, number>>(values: V): Column<EnumNames<V>, true> => descriptor({ kind: 'Enum', bits: 8, values: Object.entries(values).map(([name, value]) => ({ name, value })) }),
  Enum16: <const V extends Record<string, number>>(values: V): Column<EnumNames<V>, true> => descriptor({ kind: 'Enum', bits: 16, values: Object.entries(values).map(([name, value]) => ({ name, value })) }),
  Nullable: <T>(inner: Column<T>): Column<T | null, false> => descriptor({ kind: 'Nullable', inner: inner.type }),
  LowCardinality: <T, S extends boolean>(inner: Column<T, S>): Column<T, S> => descriptor({ kind: 'LowCardinality', inner: inner.type }),
  Array: <T>(inner: Column<T>): Column<T[], false> => descriptor({ kind: 'Array', inner: inner.type }),
  Map: <K, V, S extends boolean>(key: Column<K, S>, value: Column<V>): Column<MapValue<K, V, S>, false> => descriptor({ kind: 'Map', key: key.type, value: value.type }),
  Tuple: <const C extends Readonly<Record<string, Column>> | readonly Column[]>(items: C): Column<TupleValue<C>, false> => descriptor({ kind: 'Tuple', items: Array.isArray(items) ? (items as readonly Column[]).map(c => ({ type: c.type })) : Object.entries(items).map(([name, c]: [string, Column]) => ({ name, type: c.type })) }),
  /** Unlike object enumeration, entries preserve even integer-like field names in SQL order. */
  NamedTuple: <const C extends readonly (readonly [string, Column])[]>(items: C): Column<NamedTupleValue<C>, false> => descriptor({ kind: 'Tuple', items: items.map(([name, c]) => ({ name, type: c.type })) }),
  Variant: (...items: Column[]): Column<unknown, false> => descriptor({ kind: 'Variant', items: items.map(c => c.type) }),
  Dynamic: descriptor<unknown>({ kind: 'Dynamic' }),
  Unknown: (raw: string): Column<unknown, false> => descriptor({ kind: 'Unknown', raw }),
  AggregateFunction: <F extends string>(fn: F, ...args: Column[]): Column<AggregateState<F>, false> => descriptor({ kind: 'AggregateFunction', fn, args: args.map(c => c.type) }),
  SimpleAggregateFunction: <C extends Column>(fn: string, inner: C): Column<Value<C>, false> => descriptor({ kind: 'SimpleAggregateFunction', fn, inner: inner.type }),
};
Object.freeze(col);
