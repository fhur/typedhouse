import type { CHType } from '../ch-type.js';
import { col } from '../columns.js';
import type { Constant, DescribedExpr, Expr } from '../expr.js';
import type { AggregateState, Decimal, Grouped } from '../types.js';
import type {
  AvgDescriptor,
  AvgInputDescriptor,
  ArgMaxOperand,
  ArgMaxValueDescriptor,
  ArgMaxVersionDescriptor,
  DescriptorValue,
  MaxDescriptor,
  ResolvedExpr,
  SumDescriptor,
  SumPrecision,
} from './descriptor-types.js';
import { aggregateCall, type AggregateDefinition } from './define.js';
import { anyType, isNullable, nullable, numeric, unwrap } from './matchers.js';

export type Numeric = number | bigint | Decimal;

/** Width-erased number may represent an integer (sum -> bigint) or a float. */
export type SumResult<T> = T extends number ? number | bigint : T extends Decimal ? Decimal : T;

type DescriptorSum<D extends CHType, T> = CHType extends D
  ? SumResult<T>
  : D extends { kind: 'Nullable' | 'LowCardinality'; inner: infer I extends CHType }
    ? DescriptorSum<I, T>
    : D extends { kind: 'Decimal'; precision: infer P; scale: infer S extends number }
      ? Decimal<SumPrecision<P>, S> | Extract<T, null>
      : D extends { kind: 'scalar'; name: infer N }
        ? N extends 'Float32' | 'Float64'
          ? number | Extract<T, null>
          : N extends `UInt${number}` | `Int${number}`
            ? bigint | Extract<T, null>
            : SumResult<T>
        : SumResult<T>;

type OperandSum<E extends AggregateOperand<Numeric | null>> = DescriptorSum<
  E['ir']['type'] & CHType,
  OperandValue<E>
>;

const argMaxVersion = Object.freeze({
  match: (t: CHType) =>
    t.kind === 'scalar' && /^(U?Int(8|16|32|64|128|256)|Float(32|64))$/.test(t.name),
});

// DateTime64 above millisecond precision decodes as a string, not a Date, so it stays outside the version surface.
const argMaxTemporalVersion = (t: CHType): boolean =>
  t.kind === 'DateTime' ||
  (t.kind === 'DateTime64' && [0, 1, 2, 3].includes(t.precision)) ||
  (t.kind === 'scalar' && (t.name === 'Date' || t.name === 'Date32' || t.name === 'DateTime'));

const argMaxValue = Object.freeze({
  match: (t: CHType): boolean => {
    const base = t.kind === 'Nullable' ? t.inner : t;

    return (
      argMaxVersion.match(base) ||
      (base.kind === 'scalar' && (base.name === 'String' || base.name === 'Bool'))
    );
  },
});

const anyVersion = Object.freeze({
  match: (t: CHType) => argMaxVersion.match(t) || argMaxTemporalVersion(t),
});

const numericOrNullable = Object.freeze({
  match: (t: CHType) => argMaxVersion.match(t.kind === 'Nullable' ? t.inner : t),
});

const maxReturns = (args: readonly CHType[]): CHType =>
  isNullable(args[0]!) ? nullable(unwrap(args[0]!)) : unwrap(args[0]!);

const exactString = Object.freeze({
  match: (t: CHType): boolean => {
    const base = t.kind === 'Nullable' ? t.inner : t;
    return base.kind === 'scalar' && base.name === 'String';
  },
});

export const aggregateDefinitions: readonly AggregateDefinition[] = [
  {
    name: 'count',
    args: [],
    returns: col.UInt64,
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: true,
  },
  {
    name: 'sum',
    args: [numeric],
    returns: (args: readonly CHType[]) => {
      const t = unwrap(args[0]!);
      if (t.kind === 'Decimal') return { ...t, precision: t.precision > 38 ? 76 : 38 };
      if (t.kind === 'scalar' && t.name.startsWith('Float')) return col.Float64.type;
      if (t.kind === 'scalar' && /^(U?Int)(128|256)$/.test(t.name)) return t;
      return t.kind === 'scalar' && t.name.startsWith('UInt') ? col.UInt64.type : col.Int64.type;
    },
    tsReturns: 'SumResult<T>',
    nullable: 'propagate',
    deterministic: true,
    origin: 'typed',
    linear: true,
  },
  {
    name: 'max',
    args: [anyType],
    returns: maxReturns,
    tsReturns: 'T',
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
  {
    name: 'argMax',
    args: [argMaxValue, anyVersion],
    returns: 'arg0',
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
  {
    name: 'avg',
    args: [numericOrNullable],
    returns: col.Float64,
    nullable: 'propagate',
    deterministic: true,
    origin: 'typed',
    linear: true,
  },
  {
    name: 'quantile',
    params: [col.Float64],
    args: [numericOrNullable],
    returns: col.Float64,
    nullable: 'propagate',
    deterministic: false,
    origin: 'typed',
    linear: false,
  },
  {
    name: 'uniqExact',
    args: [exactString],
    returns: col.UInt64,
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
  {
    name: 'uniq',
    args: [exactString],
    returns: col.UInt64,
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
  // `derived[n]` and `aggregateDefinitions[5]` below are positional: append here, never insert above.
  {
    name: 'min',
    args: [anyType],
    returns: maxReturns,
    tsReturns: 'T',
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
  {
    name: 'argMin',
    args: [argMaxValue, anyVersion],
    returns: 'arg0',
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
  // Picks an input element rather than interpolating, so it returns the input type: Float64 would corrupt UInt64 above 2^53.
  {
    name: 'quantileExact',
    params: [col.Float64],
    args: [numericOrNullable],
    returns: 'arg0',
    nullable: 'never',
    deterministic: true,
    origin: 'typed',
    linear: false,
  },
].map(d => Object.freeze(d)) as readonly AggregateDefinition[];

interface Count {
  (): Expr<bigint, 'count', 'agg'>;
}

type AggregateOperand<T> = Grouped<T, string> | Constant<T>;

type OperandValue<E> = E extends Expr<infer T, string, 'row' | 'grouped'> ? T : never;

type OperandName<E, F extends string> =
  E extends Constant<unknown>
    ? F
    : E extends Grouped<unknown, infer N>
      ? [N] extends [never]
        ? F
        : N
      : F;

type ExactInput<S extends 'String' | 'Bool'> =
  | { readonly kind: 'scalar'; readonly name: S }
  | { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: S } };

// Non-distributive: every retained alternative must belong to the bounded family.
type ExactOperand<D, S extends 'String' | 'Bool'> = CHType extends D
  ? unknown
  : [D] extends [ExactInput<S>]
    ? unknown
    : never;

type ExactResult<E> = DescribedExpr<
  bigint,
  OperandName<E, 'uniqExact'>,
  'agg',
  { readonly kind: 'scalar'; readonly name: 'UInt64' }
>;

interface Uniq {
  <E extends AggregateOperand<string | null>>(
    value: E & ExactOperand<E['ir']['type'], 'String'>,
  ): DescribedExpr<
    bigint,
    OperandName<E, 'uniq'>,
    'agg',
    { readonly kind: 'scalar'; readonly name: 'UInt64' }
  >;
}

interface UniqExact {
  <E extends AggregateOperand<string | null>>(
    value: E & ExactOperand<E['ir']['type'], 'String'>,
  ): ExactResult<E>;
}

interface UniqExactIf {
  <E extends AggregateOperand<string | null>, P extends AggregateOperand<boolean | null>>(
    value: E & ExactOperand<E['ir']['type'], 'String'>,
    predicate: P & ExactOperand<P['ir']['type'], 'Bool'>,
  ): ExactResult<E>;
}

interface CountIf {
  <E extends AggregateOperand<boolean | null>>(
    predicate: E,
  ): Expr<bigint, OperandName<E, 'count'>, 'agg'>;
}

type ResultDescriptor<D, F> = CHType extends D
  ? CHType
  : F extends 'sum'
    ? SumDescriptor<D>
    : MaxDescriptor<D>;

interface Sum {
  <E extends AggregateOperand<Numeric | null>>(
    value: E,
  ): ResolvedExpr<
    OperandSum<E>,
    OperandName<E, 'sum'>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'sum'>
  >;
}

interface SumIf {
  <E extends AggregateOperand<Numeric | null>, P extends AggregateOperand<boolean | null>>(
    value: E,
    predicate: P,
  ): ResolvedExpr<
    OperandSum<E>,
    OperandName<E, OperandName<P, 'sum'>>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'sum'>
  >;
}

interface Avg {
  <E extends AggregateOperand<number | bigint | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], AvgInputDescriptor>,
  ): ResolvedExpr<
    number | Extract<OperandValue<E>, null>,
    OperandName<E, 'avg'>,
    'agg',
    AvgDescriptor<E['ir']['type']>
  >;
}

interface AvgIf {
  <E extends AggregateOperand<number | bigint | null>, P extends AggregateOperand<boolean | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], AvgInputDescriptor>,
    predicate: P,
  ): ResolvedExpr<
    number | Extract<OperandValue<E>, null>,
    OperandName<E, OperandName<P, 'avg'>>,
    'agg',
    AvgDescriptor<E['ir']['type']>
  >;
}

interface Quantile {
  <E extends AggregateOperand<number | bigint | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], AvgInputDescriptor>,
  ): ResolvedExpr<
    number | Extract<OperandValue<E>, null>,
    OperandName<E, 'quantile'>,
    'agg',
    AvgDescriptor<E['ir']['type']>
  >;
}

interface QuantileIf {
  <E extends AggregateOperand<number | bigint | null>, P extends AggregateOperand<boolean | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], AvgInputDescriptor>,
    predicate: P,
  ): ResolvedExpr<
    number | Extract<OperandValue<E>, null>,
    OperandName<E, 'quantile'>,
    'agg',
    AvgDescriptor<E['ir']['type']>
  >;
}

interface QuantileExact {
  <E extends AggregateOperand<number | bigint | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], AvgInputDescriptor>,
  ): ResolvedExpr<
    OperandValue<E>,
    OperandName<E, 'quantileExact'>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'max'>
  >;
}

interface QuantileExactIf {
  <E extends AggregateOperand<number | bigint | null>, P extends AggregateOperand<boolean | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], AvgInputDescriptor>,
    predicate: P,
  ): ResolvedExpr<
    OperandValue<E>,
    OperandName<E, 'quantileExact'>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'max'>
  >;
}

interface Max {
  <E extends AggregateOperand<unknown>>(
    value: E,
  ): ResolvedExpr<
    OperandValue<E>,
    OperandName<E, 'max'>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'max'>
  >;
}

interface MaxIf {
  <E extends AggregateOperand<unknown>, P extends AggregateOperand<boolean | null>>(
    value: E,
    predicate: P,
  ): ResolvedExpr<
    OperandValue<E>,
    OperandName<E, OperandName<P, 'max'>>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'max'>
  >;
}

interface Min {
  <E extends AggregateOperand<unknown>>(
    value: E,
  ): ResolvedExpr<
    OperandValue<E>,
    OperandName<E, 'min'>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'min'>
  >;
}

interface MinIf {
  <E extends AggregateOperand<unknown>, P extends AggregateOperand<boolean | null>>(
    value: E,
    predicate: P,
  ): ResolvedExpr<
    OperandValue<E>,
    OperandName<E, OperandName<P, 'min'>>,
    'agg',
    ResultDescriptor<E['ir']['type'], 'min'>
  >;
}

type ArgMaxValue = AggregateOperand<number | bigint | string | boolean | null>;

type ArgMaxVersion = AggregateOperand<number | bigint | Date>;

interface ArgMax {
  <E extends ArgMaxValue, V extends ArgMaxVersion>(
    value: E & ArgMaxOperand<E['ir']['type'], ArgMaxValueDescriptor>,
    version: V & ArgMaxOperand<V['ir']['type'], ArgMaxVersionDescriptor>,
  ): ResolvedExpr<OperandValue<E>, OperandName<E, 'argMax'>, 'agg', E['ir']['type']>;
}

interface ArgMaxIf {
  <E extends ArgMaxValue, V extends ArgMaxVersion, P extends AggregateOperand<boolean | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], ArgMaxValueDescriptor>,
    version: V & ArgMaxOperand<V['ir']['type'], ArgMaxVersionDescriptor>,
    predicate: P,
  ): ResolvedExpr<OperandValue<E>, OperandName<E, 'argMax'>, 'agg', E['ir']['type']>;
}

interface ArgMin {
  <E extends ArgMaxValue, V extends ArgMaxVersion>(
    value: E & ArgMaxOperand<E['ir']['type'], ArgMaxValueDescriptor>,
    version: V & ArgMaxOperand<V['ir']['type'], ArgMaxVersionDescriptor>,
  ): ResolvedExpr<OperandValue<E>, OperandName<E, 'argMin'>, 'agg', E['ir']['type']>;
}

interface ArgMinIf {
  <E extends ArgMaxValue, V extends ArgMaxVersion, P extends AggregateOperand<boolean | null>>(
    value: E & ArgMaxOperand<E['ir']['type'], ArgMaxValueDescriptor>,
    version: V & ArgMaxOperand<V['ir']['type'], ArgMaxVersionDescriptor>,
    predicate: P,
  ): ResolvedExpr<OperandValue<E>, OperandName<E, 'argMin'>, 'agg', E['ir']['type']>;
}

type StateResult<
  E extends { readonly ir: { readonly type: CHType | null } },
  F extends string,
> = CHType extends E['ir']['type']
  ? Expr<AggregateState<F>, OperandName<E, F>, 'agg'>
  : DescribedExpr<
      AggregateState<F>,
      OperandName<E, F>,
      'agg',
      {
        readonly kind: 'AggregateFunction';
        readonly fn: F;
        readonly args: [E['ir']['type'] & CHType];
      }
    >;

interface State<F extends string> {
  <E extends AggregateOperand<unknown>>(value: E): StateResult<E, F>;
}

interface SumState {
  <E extends AggregateOperand<Numeric | null>>(value: E): StateResult<E, 'sum'>;
}

type MergeResult<E extends AggregateOperand<unknown>, F, R> = E['ir']['type'] extends {
  kind: 'AggregateFunction';
  args: readonly [infer D extends CHType, ...CHType[]];
}
  ? F extends 'sum'
    ? DescriptorSum<D, DescriptorValue<D>>
    : F extends 'max'
      ? DescriptorValue<D>
      : R
  : R;

type MergeDescriptor<E extends AggregateOperand<unknown>, F> = F extends 'sum' | 'max'
  ? E['ir']['type'] extends {
      kind: 'AggregateFunction';
      args: readonly [infer D extends CHType, ...CHType[]];
    }
    ? ResultDescriptor<D, F>
    : CHType
  : CHType;

interface Merge<F extends string, R> {
  <E extends AggregateOperand<AggregateState<F>>>(
    state: E,
  ): ResolvedExpr<MergeResult<E, F, R>, OperandName<E, F>, 'agg', MergeDescriptor<E, F>>;
}

/** Combinators are constructed from each base definition, not separate catalog entries. */
function deriveAggregate(def: AggregateDefinition, rootName?: 'first') {
  return Object.freeze({
    base: (...args: readonly unknown[]) => aggregateCall(def, args, [], [], rootName),
    If: (...args: readonly unknown[]) => aggregateCall(def, args, [], ['If'], rootName),
    State: (...args: readonly unknown[]) => aggregateCall(def, args, [], ['State'], rootName),
    Merge: (...args: readonly unknown[]) => {
      const first = args[0];

      const state =
        first && typeof first === 'object' && 'ir' in first
          ? (first as Expr<unknown>).ir.type
          : null;

      const result = aggregateCall(def, args, [], ['Merge'], rootName);
      if (state?.kind !== 'AggregateFunction') return result;
      // Return resolution consumes the state's argument descriptors, not the opaque state descriptor.
      const returns = def.returns;

      let type =
        typeof returns === 'function'
          ? returns(state.args, [])
          : returns === 'arg0'
            ? state.args[0]!
            : returns.type;

      if (def.nullable !== 'never' && state.args.some(isNullable)) type = nullable(type);
      return result.as({ type });
    },
  });
}

// Selector aggregates name from the value operand, not a later version/predicate.
const derived = aggregateDefinitions.map(def =>
  deriveAggregate(
    def,
    def.name === 'argMax' ||
      def.name === 'argMin' ||
      def.name === 'uniqExact' ||
      def.name === 'uniq'
      ? 'first'
      : undefined,
  ),
);

/** Count all input rows as UInt64 (`bigint`), including rows containing NULL.
 * Empty input returns `0n`. Use inside an `aggregate()` callback, or call the query's `.count()` shortcut.
 * @example
 * ```ts
 * from(components).aggregate(() => ({ total: count() }));
 * ```
 */
export const count = derived[0]!.base as Count;

/** Count rows whose grouped predicate is true; false and NULL do not count.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ matched: countIf(c.matched_part_ids.notEmpty()) }));
 * ```
 */
export const countIf = derived[0]!.If as CountIf;

/** Build an opaque count aggregate state, not a finalized bigint.
 * Combine states in a later aggregation with `countMerge()`.
 * @example
 * ```ts
 * from(components).aggregate(() => ({ state: countState() })).aggregate(r => ({ total: countMerge(r.state) }));
 * ```
 */
export const countState = derived[0]!.State as () => Expr<AggregateState<'count'>, 'count', 'agg'>;

/** Merge count aggregate states and finalize their total as UInt64 (`bigint`).
 * The argument must be a grouped AggregateFunction(count) state, not a numeric count.
 * @example
 * ```ts
 * from(components).aggregate(() => ({ state: countState() })).aggregate(r => ({ total: countMerge(r.state) }));
 * ```
 */
export const countMerge = derived[0]!.Merge as Merge<'count', bigint>;

/** Sum grouped numeric values, skipping NULL. Integer sums decode as bigint;
 * floats produce Float64 and Decimal sums retain their scale with widened precision.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ totalParts: sum(c.matched_part_ids.length()) }));
 * ```
 */
export const sum = derived[1]!.base as Sum;

/** Sum numeric values only where the grouped predicate is true; NULL values are skipped.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ total: sumIf(c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export const sumIf = derived[1]!.If as SumIf;

/** Build an opaque numeric sum state for later `sumMerge()` aggregation.
 * This is not the finalized numeric sum.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ state: sumState(c.matched_part_ids.length()) }));
 * ```
 */
export const sumState = derived[1]!.State as SumState;

/** Combine sum states and return the finalized sum, using the state's input descriptor.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ state: sumState(c.matched_part_ids.length()) }))
 *   .aggregate(r => ({ total: sumMerge(r.state) }));
 * ```
 */
export const sumMerge = derived[1]!.Merge as Merge<'sum', Numeric | null>;

/** Return the maximum grouped value, skipping NULL and retaining the value descriptor.
 * An Enum with no zero member fails on empty input without `groupBy`. Float NaN makes the result depend on block and read order:
 * a NaN in the first row gives NaN, and without `groupBy` a NaN starting a later data block hides the rest of it.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ mostParts: max(c.matched_part_ids.length()) }));
 * ```
 */
export const max = derived[2]!.base as Max;

/** Return the maximum among rows whose grouped predicate is true; NULL values are skipped.
 * False and NULL predicates exclude rows. An Enum with no zero member fails when no row qualifies.
 * Float NaN makes the result depend on block and read order: a NaN in the first qualifying row gives NaN, and
 * without `groupBy` a NaN in the first qualifying row of a later data block hides the rest of that block.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ mostParts: maxIf(c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export const maxIf = derived[2]!.If as MaxIf;

/** Build an opaque maximum state rather than a finalized value; consume it with `maxMerge()`.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ state: maxState(c.matched_part_ids.length()) }));
 * ```
 */
export const maxState = derived[2]!.State as State<'max'>;

/** Merge maximum states and finalize the greatest value using the state's value descriptor.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ state: maxState(c.matched_part_ids.length()) }))
 *   .aggregate(r => ({ mostParts: maxMerge(r.state) }));
 * ```
 */
export const maxMerge = derived[2]!.Merge as Merge<'max', unknown>;

/** Select the value associated with the greatest non-null numeric or date/time version.
 * NULL values are skipped; equal maximal versions have no stable tie breaker.
 * Values are limited to numeric, String, or Bool scalars, optionally nullable.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ id: argMax(c.entityId, c.matched_part_ids.length()) }));
 * ```
 */
export const argMax = derived[3]!.base as ArgMax;

/** Select the value at the greatest version among rows where the predicate is true.
 * As with `argMax()`, NULL values are skipped and tied versions do not pick a stable winner.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ id: argMaxIf(c.entityId, c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export const argMaxIf = derived[3]!.If as ArgMaxIf;

// Binary State/Merge signatures and execution are deliberately not exposed.
/** Compute the Float64 mean of grouped integer or floating-point values (not Decimal).
 * NULL inputs are skipped; empty non-null inputs produce NaN.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ meanParts: avg(c.matched_part_ids.length()) }));
 * ```
 */
export const avg = derived[4]!.base as Avg;

/** Compute the Float64 mean only for rows whose predicate is true.
 * NULL values are skipped; with non-null inputs and no qualifying rows, the result is NaN.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ meanParts: avgIf(c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export const avgIf = derived[4]!.If as AvgIf;

// avg State/Merge execution is deliberately not exposed.
/** Count distinct String values exactly as UInt64 (`bigint`), skipping NULL.
 * Empty or all-null input returns `0n`; other descriptor families are not supported here.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ ids: uniqExact(c.entityId) }));
 * ```
 */
export const uniqExact = derived[6]!.base as UniqExact;

/** Estimate distinct String cardinality as UInt64 (`bigint`), skipping NULL.
 * Use `uniqExact()` when an exact result matters; this is ClickHouse's approximate `uniq`.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ estimatedIds: uniq(c.entityId) }));
 * ```
 */
export const uniq = derived[7]!.base as Uniq;

/** Count distinct non-null Strings exactly among rows whose predicate is true.
 * Empty or all-null qualifying input returns `0n`.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ matchedIds: uniqExactIf(c.entityId, c.matched_part_ids.notEmpty()) }));
 * ```
 */
export const uniqExactIf = derived[6]!.If as UniqExactIf;

// Exact distinct State/Merge and non-String operands are deliberately not exposed.
/** Return the minimum grouped value, skipping NULL and retaining the value descriptor.
 * Empty non-null input returns the type's default (`0`, `''`, 1970-01-01), not NULL; empty or all-null
 * nullable input returns NULL. An Enum with no zero member fails on empty input without `groupBy`.
 * Float NaN makes the result depend on block and read order: a NaN in the first row gives NaN, and without
 * `groupBy` a NaN starting a later data block hides the rest of that block.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ fewestParts: min(c.matched_part_ids.length()) }));
 * ```
 */
export const min = derived[8]!.base as Min;

/** Return the minimum among rows whose grouped predicate is true; NULL values are skipped.
 * False and NULL predicates exclude rows.
 * With no qualifying rows, a non-null value returns the type's default (`0`, `''`, 1970-01-01), not NULL,
 * and a nullable value returns NULL. An Enum with no zero member fails when no row qualifies.
 * Float NaN makes the result depend on block and read order: a NaN in the first qualifying row gives NaN, and
 * without `groupBy` a NaN in the first qualifying row of a later data block hides the rest of that block.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ fewestParts: minIf(c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export const minIf = derived[8]!.If as MinIf;

/** Select the value associated with the smallest non-null numeric or date/time version.
 * NULL values are skipped; equal minimal versions have no stable tie breaker.
 * Values are limited to numeric, String, or Bool scalars, optionally nullable.
 * Empty non-null input returns the value type's default, not NULL; empty or all-null nullable values return
 * NULL. If the first version is a float NaN, the result is the value type's default without `groupBy` and the
 * value from that row with `groupBy`.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ id: argMin(c.entityId, c.matched_part_ids.length()) }));
 * ```
 */
export const argMin = derived[9]!.base as ArgMin;

/** Select the value at the smallest version among rows where the predicate is true.
 * As with `argMin()`, NULL values are skipped and tied versions do not pick a stable winner.
 * False and NULL predicates exclude rows. With no qualifying rows, a non-null value returns its type's
 * default and a nullable value returns NULL. If the first qualifying version is a float NaN, the result is the
 * value from that row, with or without `groupBy`.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ id: argMinIf(c.entityId, c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export const argMinIf = derived[9]!.If as ArgMinIf;

// min and argMin State/Merge execution is deliberately not exposed.
/** Choose a quantile level, then apply the returned aggregate to grouped numeric values.
 * Uses ClickHouse's approximate reservoir quantile, which interpolates and returns Float64; NULLs are skipped.
 * Use `quantileExact()` for an exact result: an input element in the input type.
 * @param level Quantile fraction from 0 to 1 inclusive, for example 0.5 for the median.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ medianParts: quantile(0.5)(c.matched_part_ids.length()) }));
 * ```
 */
export function quantile(level: number): Quantile {
  return ((...args: readonly unknown[]) =>
    aggregateCall(aggregateDefinitions[5]!, args, [level], [], 'first')) as Quantile;
}

/** Choose a quantile level, then aggregate values only where the predicate is true.
 * Like `quantile()`, the result is approximate and NULL values are skipped.
 * Use `quantileExactIf()` for an exact result: an input element in the input type.
 * @param level Quantile fraction from 0 to 1 inclusive.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ medianParts: quantileIf(0.5)(c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export function quantileIf(level: number): QuantileIf {
  return ((...args: readonly unknown[]) =>
    aggregateCall(aggregateDefinitions[5]!, args, [level], ['If'], 'first')) as QuantileIf;
}

/** Choose a quantile level, then return the exact quantile of grouped numeric values.
 * The result is an input element in the input type, never interpolated: level 0.5 of [1, 2, 3, 4] is 3,
 * where `quantile()` estimates 2.5. All values are held in memory, unlike `quantile()`'s bounded sample.
 * NULLs and NaNs are skipped. Empty or all-null nullable input returns NULL; empty non-null input returns
 * the type's default for integers (`0`) and NaN for floats, as does all-NaN input.
 * @param level Quantile fraction from 0 to 1 inclusive, for example 0.5 for the median.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ medianParts: quantileExact(0.5)(c.matched_part_ids.length()) }));
 * ```
 */
export function quantileExact(level: number): QuantileExact {
  return ((...args: readonly unknown[]) =>
    aggregateCall(aggregateDefinitions[10]!, args, [level], [], 'first')) as QuantileExact;
}

/** Choose a quantile level, then return the exact quantile only of rows where the predicate is true.
 * Like `quantileExact()`, the result is an input element in the input type, and NULL and NaN values are skipped.
 * False and NULL predicates exclude rows. With no qualifying rows, a nullable value returns NULL;
 * a non-null value returns `0` for integers and NaN for floats.
 * @param level Quantile fraction from 0 to 1 inclusive.
 * @example
 * ```ts
 * from(components).aggregate(c => ({ medianParts: quantileExactIf(0.5)(c.matched_part_ids.length(), c.entityId.notEmpty()) }));
 * ```
 */
export function quantileExactIf(level: number): QuantileExactIf {
  return ((...args: readonly unknown[]) =>
    aggregateCall(aggregateDefinitions[10]!, args, [level], ['If'], 'first')) as QuantileExactIf;
}
