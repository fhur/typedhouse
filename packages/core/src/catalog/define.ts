import { setOperand } from '../subquery.js';
import type { CHType } from '../ch-type.js';
import { Expr, defaultType, operand, type Constant, type DescribedExpr } from '../expr.js';
import { userContract } from '../user-functions.js';
import type { UserFunctionContract } from '../ir.js';
import { exprNode, type FunctionMetadata, type AggregateMetadata, type ArgumentPolicy } from '../ir.js';
import type { Column, Mode } from '../types.js';
import { isNullable, nullable, type Argument, type Matched, unwrap } from './matchers.js';

export type Surface = 'exp' | 'week' | 'membership' | 'between' | 'comparison' | 'boolean' | 'not' | 'arithmetic' | 'divide' | 'nullTest' | 'ifNull' | 'length' | 'empty' | 'startsWith' | 'has' | 'hasAny' | 'arrayElement' | 'element';
export interface Definition<A extends readonly Argument[] = readonly Argument[], R = unknown> {
  readonly name: string;
  readonly sqlName?: string;
  readonly args: A;
  readonly argumentPolicies?: readonly ArgumentPolicy[];
  /** Closed standalone policy; not permission for arbitrary variadic functions. */
  readonly repeatedArgs?: 'temporalGreatest' | 'stringMultiIf';
  readonly returns: Column<R> | 'arg0' | ((args: readonly CHType[], values: readonly unknown[]) => CHType);
  readonly tsReturns?: string;
  readonly nullable?: 'propagate' | 'never';
  readonly deterministic: boolean;
  readonly origin?: 'typed' | 'user';
  readonly js?: never;
  readonly surface?: Surface;
}
export interface AggregateDefinition<A extends readonly Argument[] = readonly Argument[], R = unknown> extends Definition<A, R> {
  readonly linear: boolean;
  readonly params?: readonly Column[];
}
type Input<T, M extends Mode> = T | null | Constant<T | null> | Expr<T | null, string, M>;
type Inputs<A extends readonly Argument[], M extends Mode> = { [K in keyof A]: Input<Matched<A[K]>, M> };
type ValueOf<T> = T extends Expr<infer V, string, Mode> ? V : T;
type Result<R, A extends readonly unknown[]> = null extends ValueOf<A[number]> ? R | null : R;
type FirstExpr<A extends readonly unknown[]> = A extends readonly [infer H, ...infer T] ? H extends Constant<unknown> ? FirstExpr<T> : H extends Expr<unknown, string, Mode> ? H : FirstExpr<T> : never;
type Name<A extends readonly unknown[]> = [FirstExpr<A>] extends [never] ? never : FirstExpr<A> extends Expr<unknown, infer N, Mode> ? N : never;
type CallMode<A extends readonly unknown[]> = [FirstExpr<A>] extends [never] ? 'row' : FirstExpr<A> extends Expr<unknown, string, infer M> ? M : 'row';
type ReturnValue<R, S, I extends readonly unknown[]> = S extends 'arg0' ? ValueOf<I[0]> : S extends Column<infer V> ? V : R;
type FunctionName<I extends readonly unknown[], F extends string> = [Name<I>] extends [never] ? F : Name<I>;
type FunctionResult<R, P, S, I extends readonly unknown[], F extends string> = S extends Column<unknown, boolean, infer D> ?
  DescribedExpr<P extends 'never' ? ReturnValue<R, S, I> : Result<ReturnValue<R, S, I>, I>, FunctionName<I, F>, CallMode<I>,
    P extends 'never' ? D : null extends ValueOf<I[number]> ? D extends { kind: 'Nullable' } ? D : { readonly kind: 'Nullable'; readonly inner: D } : D> :
  Expr<P extends 'never' ? ReturnValue<R, S, I> : Result<ReturnValue<R, S, I>, I>, FunctionName<I, F>, CallMode<I>>;
type SameMode<A extends readonly unknown[]> = { [K in keyof A]: A[K] extends Constant<unknown> ? A[K] : A[K] extends Expr<unknown, string, infer M> ? M extends CallMode<A> ? A[K] : never : A[K] };
export interface DefinedFunction<A extends readonly Argument[], R, P extends 'propagate' | 'never' = 'propagate', S = unknown, F extends string = string> {
  <const I extends Inputs<A, Mode>>(...args: I & SameMode<I>): FunctionResult<R, P, S, I, F>;
  readonly definition: Definition<A, R>;
}
/** Metadata is copied explicitly: executable matchers/resolvers never enter the owned IR snapshot. */
export function metadata(def: Definition): FunctionMetadata {
  return { ...(def.repeatedArgs ? { repeatedArgs: def.repeatedArgs } : {}), name: def.name, ...(def.sqlName === undefined ? {} : { sqlName: def.sqlName }), deterministic: def.deterministic, origin: def.origin ?? 'user', ...(def.argumentPolicies ? { argumentPolicies: Object.freeze([...def.argumentPolicies]) } : {}) };
}
const unknownType: CHType = { kind: 'Unknown', raw: 'unresolved' };
export function resolveReturn(def: Definition, args: readonly unknown[]): CHType {
  // JS sibling operands inherit the first typed argument for return calculation only.
  // Their actual Param nodes remain unresolved and distinct.
  const sibling = args.find((a): a is Expr<unknown, string, Mode> => a instanceof Expr && a.ir.type !== null)?.ir.type;
  const resolved = args.map((a, index) => {
    const policy = def.argumentPolicies?.[index];
    if (!(a instanceof Expr) && policy && policy !== 'sibling') {
      const receiver = sibling ? unwrap(sibling) : unknownType;
      if (policy === 'constantSelector' || policy === 'dayUnit' || policy === 'utcZone') return { kind: 'scalar', name: 'String' } as const;
      if (policy === 'numericIndex') return { kind: 'scalar', name: 'Int64' } as const;
      if (policy === 'array') return receiver;
      if (policy === 'arrayElement' && receiver.kind === 'Array') return receiver.inner;
    }
    return a instanceof Expr ? a.ir.type ?? (a.ir.kind === 'Param' && a.ir.value === null ? nullable(sibling ?? unknownType) : unknownType) : a === null
    ? nullable(sibling ?? unknownType)
    : sibling ? (sibling.kind === 'Nullable' ? sibling.inner : sibling) : defaultType(a) ?? unknownType;
  });
  const returns = def.returns;
  let type = typeof returns === 'function' ? returns(resolved, args.map(a => a instanceof Expr ? undefined : a)) : returns === 'arg0' ? resolved[0] ?? unknownType : returns.type;
  if (def.nullable !== 'never' && resolved.some(isNullable)) type = nullable(type);
  return type;
}
export function invoke(def: Definition, args: readonly unknown[], contract?: UserFunctionContract): Expr<unknown, string, Mode> {
  const first = def.surface === 'between' && args[0] instanceof Expr ? args[0]
    : args.find((arg): arg is Expr<unknown, string, Mode> => arg instanceof Expr && arg.ir.kind !== 'Param');
  let type = contract?.returns ?? resolveReturn(def, args);
  if (contract?.nullable === 'propagate' && args.some(a => a === null || a instanceof Expr && (a.ir.kind === 'Param' && a.ir.value === null || a.ir.type !== null && isNullable(a.ir.type)))) type = nullable(type);
  return new Expr(exprNode({ kind: 'Call', fn: { ...metadata(def), ...(contract ? { user: contract } : {}) }, args: args.map((arg, i) => def.argumentPolicies?.[i] === 'set' ? setOperand(arg) : operand(arg)), type }), (first?.name ?? (def.origin === 'typed' ? undefined : def.name)) as string, first?.mode ?? 'row');
}
export function defineFunction<const A extends readonly Argument[], R, const S extends Definition<A, R>['returns'], P extends 'propagate' | 'never' = 'propagate', const F extends string = string>(definition: Definition<A, R> & { readonly name: F; readonly returns: S; readonly nullable?: P }): DefinedFunction<A, R, P, S, F> {
  const def = Object.freeze({ ...definition, args: Object.freeze([...definition.args]) as unknown as A, ...(definition.argumentPolicies ? { argumentPolicies: Object.freeze([...definition.argumentPolicies]) } : {}) });
  if (typeof def.returns === 'function' && !def.tsReturns) throw new Error(`tsReturns required: ${def.name}`);
  const contract = def.origin === 'typed' ? undefined : userContract(def);
  return Object.freeze(Object.assign((...args: readonly unknown[]) => invoke(def, args, contract), { definition: def })) as unknown as DefinedFunction<A, R, P, S, F>;
}
type AggregateName<I extends readonly unknown[], F extends string> = [Name<I>] extends [never] ? F : Name<I>;
export interface DefinedAggregate<A extends readonly Argument[], R, P extends 'propagate' | 'never' = 'propagate', S = unknown, F extends string = string> {
  <const I extends Inputs<A, 'grouped'>>(...args: I): Expr<P extends 'never' ? ReturnValue<R, S, I> : Result<ReturnValue<R, S, I>, I>, AggregateName<I, F>, 'agg'>;
  readonly definition: AggregateDefinition<A, R>;
}
export function aggregateCall(def: AggregateDefinition, args: readonly unknown[], params: readonly unknown[] = [], combinators: readonly ('If' | 'State' | 'Merge')[] = [], rootName?: 'first'): Expr<unknown, string, 'agg'> {
  const first = rootName === 'first'
    ? args[0] instanceof Expr && args[0].ir.kind !== 'Param' ? args[0] : undefined
    : args.find((a): a is Expr<unknown, string, Mode> => a instanceof Expr && a.ir.kind !== 'Param');
  const fn: AggregateMetadata = { ...metadata(def), linear: def.linear };
  const type = combinators.includes('State')
    ? { kind: 'AggregateFunction' as const, fn: def.name, args: args.map(a => a instanceof Expr ? a.ir.type ?? unknownType : defaultType(a) ?? unknownType) }
    : resolveReturn(def, combinators.includes('If') ? args.slice(0, -1) : args);
  return new Expr(exprNode({ kind: 'Agg', fn, args: args.map(operand), params: params.map((p, index) => exprNode({ kind: 'Param', value: p, type: def.params?.[index]?.type ?? defaultType(p) })), combinators, type }), first?.name ?? def.name, 'agg');
}
type ParamInputs<P extends readonly Column[]> = { [K in keyof P]: P[K] extends Column<infer T> ? T extends bigint ? bigint | number : T : never };
export function defineAggregate<const A extends readonly Argument[], R, const S extends Definition<A, R>['returns'], const P extends readonly Column[], const F extends string, N extends 'propagate' | 'never' = 'propagate'>(definition: AggregateDefinition<A, R> & { name: F; returns: S; params: P; nullable?: N }): (...params: ParamInputs<P>) => DefinedAggregate<A, R, N, S, F>;
export function defineAggregate<const A extends readonly Argument[], R, const S extends Definition<A, R>['returns'], const F extends string, N extends 'propagate' | 'never' = 'propagate'>(definition: AggregateDefinition<A, R> & { name: F; returns: S; nullable?: N }): DefinedAggregate<A, R, N, S, F>;
export function defineAggregate(definition: AggregateDefinition): unknown {
  const def = Object.freeze({ ...definition, args: Object.freeze([...definition.args]), ...(definition.params ? { params: Object.freeze([...definition.params]) } : {}) });
  if (typeof def.returns === 'function' && !def.tsReturns) throw new Error(`tsReturns required: ${def.name}`);
  const create = (params: readonly unknown[]) => Object.freeze(Object.assign((...args: readonly unknown[]) => aggregateCall(def, args, params), { definition: def }));
  return def.params ? (...params: readonly unknown[]) => create(params) : create([]);
}
