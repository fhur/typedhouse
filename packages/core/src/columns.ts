import { scalarNames, type CHType, type ScalarName } from './ch-type.js';
import type {
  AggregateState,
  Column,
  Decimal,
  EnumNames,
  MapValue,
  NamedTupleValue,
  ScalarStringKey,
  ScalarValue,
  TupleValue,
  Value,
} from './types.js';

/** Freeze runtime twins recursively so descriptors can safely be shared by IR nodes. */
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }

  return value;
}

function descriptor<T, S extends boolean = false, D extends CHType = CHType>(
  type: D,
): Column<T, S, D> {
  return immutable({ type });
}

const scalars = Object.fromEntries(
  scalarNames.map(name => [name, descriptor({ kind: 'scalar', name })]),
) as {
  [N in ScalarName]: Column<
    ScalarValue<N>,
    ScalarStringKey<N>,
    { readonly kind: 'scalar'; readonly name: N }
  >;
};

type EnumDescriptor<V, B extends 8 | 16> = {
  readonly kind: 'Enum';
  readonly bits: B;
  readonly values: { readonly name: EnumNames<V>; readonly value: number }[];
};

type TupleItems<C> = C extends readonly Column[]
  ? { -readonly [K in keyof C]: { readonly type: C[K] extends Column ? C[K]['type'] : never } }
  : keyof C extends never
    ? []
    : {
        [K in keyof C]: C[K] extends Column
          ? { readonly name: `${K & (string | number)}`; readonly type: C[K]['type'] }
          : never;
      }[keyof C][];

type TupleDescriptor<C> = { readonly kind: 'Tuple'; readonly items: TupleItems<C> };

type NamedTupleDescriptor<C extends readonly (readonly [string, Column])[]> = {
  readonly kind: 'Tuple';
  readonly items: {
    -readonly [K in keyof C]: { readonly name: C[K][0]; readonly type: C[K][1]['type'] };
  };
};

type TemporalValue<P extends number> = number extends P
  ? Date | string
  : P extends 0 | 1 | 2 | 3
    ? Date
    : string;

type TemporalType<P extends number, Z> = {
  readonly kind: 'DateTime64';
  readonly precision: P;
} & (Z extends string ? { readonly tz: Z } : { readonly tz?: never });

/** Describe DateTime64 without an explicit timezone. Precision 0–3 decodes as Date;
 * higher precision decodes as a string to preserve sub-millisecond digits.
 */
function dateTime64<P extends number>(
  precision: P,
): Column<TemporalValue<P>, false, TemporalType<P, undefined>>;
// Explicit P prevents inference of defaulted Z: keep its zone conservative, not absent or literal.
/** Describe DateTime64 with a timezone; retain its literal zone for temporal operations.
 * Precision 0–3 decodes as Date, higher precision as a lossless string.
 */
function dateTime64<P extends number, Z extends string | undefined = string | undefined>(
  precision: P,
  tz: Z,
): Column<TemporalValue<P>, false, TemporalType<P, Z>>;
function dateTime64(precision: number, tz?: string): Column<Date | string> {
  return descriptor({ kind: 'DateTime64', precision, ...(tz === undefined ? {} : { tz }) });
}

/** Immutable ClickHouse descriptors for `table()`, `val()`, `cast()`, and `.as()`.
 * Scalars such as `col.String`, `col.Bool`, and `col.UInt64` are ready-made values;
 * parameterized types use constructors. Descriptors do not create database columns.
 * UInt64/Int64 and wider integers decode as bigint; smaller integers and floats as number.
 * @example
 * ```ts
 * val(3n, col.UInt64);
 * val([], col.Array(col.String));
 * ```
 */
export const col = {
  ...scalars,
  /** Fixed-width byte string of `n` bytes, not `n` Unicode characters. */
  FixedString: <N extends number>(
    n: N,
  ): Column<string, true, { readonly kind: 'FixedString'; readonly n: N }> =>
    descriptor({ kind: 'FixedString', n }),
  /** Second-precision timestamp decoded as Date, optionally carrying a ClickHouse timezone. */
  DateTime: (
    tz?: string,
  ): Column<Date, false, { readonly kind: 'DateTime'; readonly tz?: string }> =>
    descriptor({ kind: 'DateTime', ...(tz === undefined ? {} : { tz }) }),
  /** Fractional timestamp: precision 0–3 decodes as Date; higher precision as a string. */
  DateTime64: dateTime64,
  /** Exact decimal with total digit precision and fractional scale; values use the branded Decimal type. */
  Decimal: <P extends number, S extends number>(
    precision: P,
    scale: S,
  ): Column<
    Decimal<P, S>,
    false,
    { readonly kind: 'Decimal'; readonly precision: P; readonly scale: S }
  > => descriptor({ kind: 'Decimal', precision, scale }),
  /** Exact 32-bit decimal (9 digits of precision) with the given fractional scale. */
  Decimal32: <S extends number>(
    scale: S,
  ): Column<
    Decimal<9, S>,
    false,
    { readonly kind: 'Decimal'; readonly precision: 9; readonly scale: S }
  > => descriptor({ kind: 'Decimal', precision: 9, scale }),
  /** Exact 64-bit decimal (18 digits of precision) with the given fractional scale. */
  Decimal64: <S extends number>(
    scale: S,
  ): Column<
    Decimal<18, S>,
    false,
    { readonly kind: 'Decimal'; readonly precision: 18; readonly scale: S }
  > => descriptor({ kind: 'Decimal', precision: 18, scale }),
  /** Exact 128-bit decimal (38 digits of precision) with the given fractional scale. */
  Decimal128: <S extends number>(
    scale: S,
  ): Column<
    Decimal<38, S>,
    false,
    { readonly kind: 'Decimal'; readonly precision: 38; readonly scale: S }
  > => descriptor({ kind: 'Decimal', precision: 38, scale }),
  /** Exact 256-bit decimal (76 digits of precision) with the given fractional scale. */
  Decimal256: <S extends number>(
    scale: S,
  ): Column<
    Decimal<76, S>,
    false,
    { readonly kind: 'Decimal'; readonly precision: 76; readonly scale: S }
  > => descriptor({ kind: 'Decimal', precision: 76, scale }),
  /** Map enum labels to 8-bit codes; decoded values are the label union, not numeric codes. */
  Enum8: <const V extends Record<string, number>>(
    values: V,
  ): Column<EnumNames<V>, true, EnumDescriptor<V, 8>> =>
    descriptor({
      kind: 'Enum',
      bits: 8,
      values: Object.entries(values).map(([name, value]) => ({
        name: name as EnumNames<V>,
        value,
      })),
    }),
  /** Map enum labels to 16-bit codes; decoded values are the label union, not numeric codes. */
  Enum16: <const V extends Record<string, number>>(
    values: V,
  ): Column<EnumNames<V>, true, EnumDescriptor<V, 16>> =>
    descriptor({
      kind: 'Enum',
      bits: 16,
      values: Object.entries(values).map(([name, value]) => ({
        name: name as EnumNames<V>,
        value,
      })),
    }),
  /** Add SQL NULL to a descriptor's values; use `isNull()` rather than equality to test it. */
  Nullable: <T, D extends CHType>(
    inner: Column<T, boolean, D>,
  ): Column<T | null, false, { readonly kind: 'Nullable'; readonly inner: D }> =>
    descriptor({ kind: 'Nullable', inner: inner.type }),
  /** Describe dictionary-encoded values without changing their decoded JavaScript type. */
  LowCardinality: <T, S extends boolean, D extends CHType>(
    inner: Column<T, S, D>,
  ): Column<T, S, { readonly kind: 'LowCardinality'; readonly inner: D }> =>
    descriptor({ kind: 'LowCardinality', inner: inner.type }),
  /** Describe an array of the inner type; expand with `arrayJoin()` or inspect with expression methods. */
  Array: <T, D extends CHType>(
    inner: Column<T, boolean, D>,
  ): Column<T[], false, { readonly kind: 'Array'; readonly inner: D }> =>
    descriptor({ kind: 'Array', inner: inner.type }),
  /** Describe ClickHouse key/value pairs; decoded maps use the client's MapValue representation. */
  Map: <K, V, S extends boolean, KD extends CHType, VD extends CHType>(
    key: Column<K, S, KD>,
    value: Column<V, boolean, VD>,
  ): Column<MapValue, false, { readonly kind: 'Map'; readonly key: KD; readonly value: VD }> =>
    descriptor({ kind: 'Map', key: key.type, value: value.type }),
  /** Describe positional fields with a descriptor array, or named fields with an object.
   * Use `NamedTuple()` when explicit field order matters, especially for integer-like names.
   */
  Tuple: <const C extends Readonly<Record<string, Column>> | readonly Column[]>(
    items: C,
  ): Column<TupleValue<C>, false, TupleDescriptor<C>> =>
    descriptor({
      kind: 'Tuple',
      items: (Array.isArray(items)
        ? (items as readonly Column[]).map(c => ({ type: c.type }))
        : Object.entries(items).map(([name, c]: [string, Column]) => ({
            name,
            type: c.type,
          }))) as TupleItems<C>,
    }),
  /** Describe named tuple fields in explicit SQL order, including integer-like field names.
   * @example
   * ```ts
   * col.NamedTuple([['mpn', col.String], ['quantity', col.UInt32]]);
   * ```
   */
  NamedTuple: <const C extends readonly (readonly [string, Column])[]>(
    items: C,
  ): Column<NamedTupleValue<C>, false, NamedTupleDescriptor<C>> =>
    descriptor({
      kind: 'Tuple',
      items: items.map(([name, c]) => ({ name, type: c.type })) as NamedTupleDescriptor<C>['items'],
    }),
  /** Describe a Variant of several types; decoded values remain unknown to TypeScript. */
  Variant: (...items: Column[]): Column<unknown, false> =>
    descriptor({ kind: 'Variant', items: items.map(c => c.type) }),
  /** Describe a dynamically typed column without asserting a decoded value type. */
  Dynamic: descriptor<unknown>({ kind: 'Dynamic' }),
  /** Preserve an unsupported ClickHouse type spelling without claiming typed DSL support. */
  Unknown: (raw: string): Column<unknown, false> => descriptor({ kind: 'Unknown', raw }),
  /** Describe an opaque aggregate state and its argument types, not the finalized result.
   * For example, `col.AggregateFunction('sum', col.UInt64)` can feed `sumMerge()`.
   */
  AggregateFunction: <F extends string, const C extends readonly Column[]>(
    fn: F,
    ...args: C
  ): Column<
    AggregateState<F>,
    false,
    {
      readonly kind: 'AggregateFunction';
      readonly fn: F;
      readonly args: { -readonly [K in keyof C]: C[K]['type'] };
    }
  > =>
    descriptor({
      kind: 'AggregateFunction',
      fn,
      args: args.map(c => c.type) as { -readonly [K in keyof C]: C[K]['type'] },
    }),
  /** Describe a SimpleAggregateFunction column whose decoded value follows the inner descriptor. */
  SimpleAggregateFunction: <C extends Column>(fn: string, inner: C): Column<Value<C>, false> =>
    descriptor({ kind: 'SimpleAggregateFunction', fn, inner: inner.type }),
};

Object.freeze(col);
