import type { CHType } from '../ch-type.js';
import { col } from '../columns.js';
import type { Constant, DescribedExpr, Expr } from '../expr.js';
import type { AggregateState, Decimal, Grouped } from '../types.js';
import type { DescriptorValue, MaxDescriptor, ResolvedExpr, SumDescriptor, SumPrecision } from './descriptor-types.js';
import { aggregateCall, type AggregateDefinition } from './define.js';
import { anyType, isNullable, nullable, numeric, unwrap } from './matchers.js';

export type Numeric = number | bigint | Decimal;
/** Width-erased number may represent an integer (sum -> bigint) or a float. */
export type SumResult<T> = T extends number ? number | bigint : T extends Decimal ? Decimal : T;
type DescriptorSum<D extends CHType, T> = CHType extends D ? SumResult<T> :
  D extends { kind: 'Nullable' | 'LowCardinality'; inner: infer I extends CHType } ? DescriptorSum<I, T> :
  D extends { kind: 'Decimal'; precision: infer P; scale: infer S extends number } ? Decimal<SumPrecision<P>, S> | Extract<T, null> :
  D extends { kind: 'scalar'; name: infer N } ? N extends 'Float32' | 'Float64' ? number | Extract<T, null> :
    N extends `UInt${number}` | `Int${number}` ? bigint | Extract<T, null> : SumResult<T> : SumResult<T>;
type OperandSum<E extends AggregateOperand<Numeric | null>> = DescriptorSum<E['ir']['type'] & CHType, OperandValue<E>>;
export const aggregateDefinitions: readonly AggregateDefinition[] = [
  { name: 'count', args: [], returns: col.UInt64, nullable: 'never', deterministic: true, origin: 'typed', linear: true },
  { name: 'sum', args: [numeric], returns: (args: readonly CHType[]) => {
    const t = unwrap(args[0]!);
    if (t.kind === 'Decimal') return { ...t, precision: t.precision > 38 ? 76 : 38 };
    if (t.kind === 'scalar' && t.name.startsWith('Float')) return col.Float64.type;
    if (t.kind === 'scalar' && /^(U?Int)(128|256)$/.test(t.name)) return t;
    return t.kind === 'scalar' && t.name.startsWith('UInt') ? col.UInt64.type : col.Int64.type;
  }, tsReturns: 'SumResult<T>', nullable: 'propagate', deterministic: true, origin: 'typed', linear: true },
  { name: 'max', args: [anyType], returns: (args: readonly CHType[]) => isNullable(args[0]!) ? nullable(unwrap(args[0]!)) : unwrap(args[0]!), tsReturns: 'T', nullable: 'never', deterministic: true, origin: 'typed', linear: false },
].map(d => Object.freeze(d)) as readonly AggregateDefinition[];

interface Count {
  (): Expr<bigint, 'count', 'agg'>;
}
type AggregateOperand<T> = Grouped<T, string> | Constant<T>;
type OperandValue<E> = E extends Expr<infer T, string, 'row' | 'grouped'> ? T : never;
type OperandName<E, F extends string> = E extends Constant<unknown> ? F : E extends Grouped<unknown, infer N> ? [N] extends [never] ? F : N : F;
interface CountIf { <E extends AggregateOperand<boolean | null>>(predicate: E): Expr<bigint, OperandName<E, 'count'>, 'agg'> }
type ResultDescriptor<D, F> = CHType extends D ? CHType : F extends 'sum' ? SumDescriptor<D> : MaxDescriptor<D>;
interface Sum { <E extends AggregateOperand<Numeric | null>>(value: E): ResolvedExpr<OperandSum<E>, OperandName<E, 'sum'>, 'agg', ResultDescriptor<E['ir']['type'], 'sum'>> }
interface SumIf { <E extends AggregateOperand<Numeric | null>, P extends AggregateOperand<boolean | null>>(value: E, predicate: P): ResolvedExpr<OperandSum<E>, OperandName<E, OperandName<P, 'sum'>>, 'agg', ResultDescriptor<E['ir']['type'], 'sum'>> }
interface Max { <E extends AggregateOperand<unknown>>(value: E): ResolvedExpr<OperandValue<E>, OperandName<E, 'max'>, 'agg', ResultDescriptor<E['ir']['type'], 'max'>> }
interface MaxIf { <E extends AggregateOperand<unknown>, P extends AggregateOperand<boolean | null>>(value: E, predicate: P): ResolvedExpr<OperandValue<E>, OperandName<E, OperandName<P, 'max'>>, 'agg', ResultDescriptor<E['ir']['type'], 'max'>> }
type StateResult<E extends { readonly ir: { readonly type: CHType | null } }, F extends string> = CHType extends E['ir']['type'] ? Expr<AggregateState<F>, OperandName<E, F>, 'agg'> : DescribedExpr<AggregateState<F>, OperandName<E, F>, 'agg', { readonly kind: 'AggregateFunction'; readonly fn: F; readonly args: [E['ir']['type'] & CHType] }>;
interface State<F extends string> { <E extends AggregateOperand<unknown>>(value: E): StateResult<E, F> }
interface SumState { <E extends AggregateOperand<Numeric | null>>(value: E): StateResult<E, 'sum'> }
type MergeResult<E extends AggregateOperand<unknown>, F, R> = E['ir']['type'] extends { kind: 'AggregateFunction'; args: readonly [infer D extends CHType, ...CHType[]] } ?
  F extends 'sum' ? DescriptorSum<D, DescriptorValue<D>> : F extends 'max' ? DescriptorValue<D> : R : R;
type MergeDescriptor<E extends AggregateOperand<unknown>, F> = F extends 'sum' | 'max' ? E['ir']['type'] extends { kind: 'AggregateFunction'; args: readonly [infer D extends CHType, ...CHType[]] } ? ResultDescriptor<D, F> : CHType : CHType;
interface Merge<F extends string, R> { <E extends AggregateOperand<AggregateState<F>>>(state: E): ResolvedExpr<MergeResult<E, F, R>, OperandName<E, F>, 'agg', MergeDescriptor<E, F>> }
/** Combinators are constructed from each base definition, not separate catalog entries. */
export function deriveAggregate(def: AggregateDefinition) {
  return Object.freeze({
    base: (...args: readonly unknown[]) => aggregateCall(def, args),
    If: (...args: readonly unknown[]) => aggregateCall(def, args, [], ['If']),
    State: (...args: readonly unknown[]) => aggregateCall(def, args, [], ['State']),
    Merge: (...args: readonly unknown[]) => {
      const first = args[0];
      const state = first && typeof first === 'object' && 'ir' in first ? (first as Expr<unknown>).ir.type : null;
      const result = aggregateCall(def, args, [], ['Merge']);
      if (state?.kind !== 'AggregateFunction') return result;
      // Return resolution consumes the state's argument descriptors, not the opaque state descriptor.
      const returns = def.returns;
      let type = typeof returns === 'function' ? returns(state.args, []) : returns === 'arg0' ? state.args[0]! : returns.type;
      if (def.nullable !== 'never' && state.args.some(isNullable)) type = nullable(type);
      return result.as({ type });
    },
  });
}
const derived = aggregateDefinitions.map(deriveAggregate);
export const count = derived[0]!.base as Count;
export const countIf = derived[0]!.If as CountIf;
export const countState = derived[0]!.State as () => Expr<AggregateState<'count'>, 'count', 'agg'>;
export const countMerge = derived[0]!.Merge as Merge<'count', bigint>;
export const sum = derived[1]!.base as Sum;
export const sumIf = derived[1]!.If as SumIf;
export const sumState = derived[1]!.State as SumState;
export const sumMerge = derived[1]!.Merge as Merge<'sum', Numeric | null>;
export const max = derived[2]!.base as Max;
export const maxIf = derived[2]!.If as MaxIf;
export const maxState = derived[2]!.State as State<'max'>;
export const maxMerge = derived[2]!.Merge as Merge<'max', unknown>;
