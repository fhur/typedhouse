import { Expr } from './expr.js';
import { relNode, type Rel, type ExprNode } from './ir.js';
import { joinOutput, type JoinKind } from './output.js';
import type { CHType } from './ch-type.js';
import { Query, rowOf, deterministic, rebindSort, type Caps, type ExpressionCaps, type Projection, type ValidProjection, type ProjectionRow } from './query.js';
import type { Infer, Mode, Row } from './types.js';
import type { ExprValue } from './expr.js';
import type { ResolvedExpr } from './catalog/descriptor-types.js';

type Input = Pick<Query<unknown, Caps, unknown>, 'ir' | 'row' | '_rowType' | 'caps'>;
type Rows<I extends Record<string, Input>> = { readonly [K in keyof I]: I[K]['row'] | ({} extends Pick<I, K> ? undefined : never) };
type Values<I extends Record<string, Input>> = { -readonly [K in keyof I]: Infer<I[K]> | ({} extends Pick<I, K> ? undefined : never) };
type AtLeastTwo<I> = { [K in keyof I]: Exclude<keyof I, K> extends never ? false : true }[keyof I] extends true ? keyof I extends never ? { readonly join_input_count: never } : unknown : { readonly join_input_count: never };
type JoinCaps<I extends Record<string, Input>> = { readonly live: false extends { [K in keyof I]: I[K]['caps']['live'] extends false ? false : never }[keyof I] ? false : boolean };

/** The homomorphic side-spread overload preserves generic R without conditional Infer<Row<R>>. */
export class JoinQuery<R, C extends Caps, Proxy> extends Query<R, C, Proxy, true> {
  override map<P extends Projection | Expr<unknown, string>>(projection: (row: this['row']) => P & ValidProjection<P>): Query<Infer<P>, ExpressionCaps<C>, ProjectionRow<P>>;
  override map<S>(projection: (row: this['row']) => Row<S>): Query<S, ExpressionCaps<C>>;
  override map(projection: (row: this['row']) => unknown): unknown { return super.map(projection as (row: this['row']) => Projection); }
}

/** Alias occurrences bind through the Join id and full path, even for shared inputs. */
export class JoinBuilder<I extends Record<string, Input>, R = Rows<I>, V = Values<I>> {
  readonly inputs: readonly (readonly [string, Rel])[];
  readonly caps: JoinCaps<I>;
  constructor(inputs: I, readonly kind: Exclude<JoinKind, 'cross'> = 'inner') {
    const entries = Object.entries(inputs);
    if (entries.length < 2 || Object.getOwnPropertySymbols(inputs).length) throw new Error('join_input_count');
    if (entries.some(([alias, q]) => alias.includes('\0') || !(q instanceof Query))) throw new Error('invalid_join_input');
    this.inputs = Object.freeze(entries.map(([alias, q]) => Object.freeze([alias, q.ir] as const)));
    this.caps = Object.freeze({ live: entries.every(([, q]) => q.caps.live) }) as JoinCaps<I>;
    Object.freeze(this);
  }
  on(f: (row: R) => Expr<boolean | null, string, 'row'> | readonly Expr<boolean | null, string, 'row'>[]): JoinQuery<V, JoinCaps<I>, R> {
    // Reserve an occurrence scope before evaluating the callback. The final Join
    // explicitly records this scope; input Rel identities remain shared.
    const output = joinOutput(this.kind, this.inputs);
    const scope = relNode({ kind: 'Join', joinKind: this.kind, inputs: this.inputs, on: [], output });
    const result = f(rowOf(scope) as R);
    const predicates = Array.isArray(result) ? result : [result];
    if (predicates.some(e => !(e instanceof Expr) || e.mode !== 'row')) throw new Error('invalid_join_predicate');
    // ON keeps the reserved scope; residuals bind the output of each new Filter.
    const split = (e: ExprNode): readonly ExprNode[] => e.kind === 'Call' && e.fn.origin === 'typed' && e.fn.name === 'and' ? e.args.flatMap(split) : [e];
    const conjuncts = predicates.flatMap(e => split(e.ir));
    const equalities = conjuncts.filter(e => e.kind === 'Call' && e.fn.origin === 'typed' && e.fn.name === 'eq');
    // An outer join's ON decides null extension, not row survival: no residual can move above it.
    if (this.kind !== 'inner' && equalities.length !== conjuncts.length) throw new Error('join_condition_not_equi: an outer join condition must be an equality between columns');
    const ir = relNode({ kind: 'Join', joinKind: this.kind, inputs: this.inputs, on: equalities, output: scope.output, scope: scope.id });
    let resultRel: Rel = ir;
    for (const e of conjuncts.filter(e => !equalities.includes(e))) {
      resultRel = relNode({ kind: 'Filter', input: resultRel, pred: rebindSort(e, scope, resultRel), output: scope.output });
    }
    return new JoinQuery(resultRel, { live: this.caps.live && predicates.every(e => deterministic(e.ir)) } as JoinCaps<I>);
  }
}
export function join<const I extends Record<string, Input>>(inputs: I & AtLeastTwo<I>): JoinBuilder<I> { return new JoinBuilder<I>(inputs); }

/** Cartesian product: no ON stage and no null extension. */
export function crossJoin<const I extends Record<string, Input>>(inputs: I & AtLeastTwo<I>): JoinQuery<Values<I>, JoinCaps<I>, Rows<I>> {
  const builder = new JoinBuilder<I>(inputs);
  const ir = relNode({ kind: 'Join', joinKind: 'cross', inputs: builder.inputs, on: [], output: { shape: 'nested', inputs: builder.inputs.map(([alias, rel]) => [alias, rel.output] as const) } });
  return new JoinQuery(ir, builder.caps);
}

/** Descriptor-faithful null extension (24.8, join_use_nulls = 1): only kinds that can sit inside
 * Nullable gain `| null`; LowCardinality(T) becomes LowCardinality(Nullable(T)); Array, Map, Tuple,
 * Variant, Dynamic, JSON, AggregateFunction and already-Nullable columns keep their type and the
 * server's default. An erased descriptor decides by the decoded value, which agrees for every kind. */
type InsideNullable<D> = D extends { readonly kind: 'scalar'; readonly name: infer N } ? N extends 'JSON' ? false : true
  : D extends { readonly kind: 'FixedString' | 'DateTime' | 'DateTime64' | 'Decimal' | 'Enum' } ? true
  : D extends { readonly kind: 'SimpleAggregateFunction'; readonly inner: infer I } ? InsideNullable<I> : false;
/** LowCardinality(T), or SimpleAggregateFunction(f, LowCardinality(T)) whose SAF wrapper the server drops. */
type LowCardinalityOf<D> = D extends { readonly kind: 'LowCardinality'; readonly inner: infer I } ? [I]
  : D extends { readonly kind: 'SimpleAggregateFunction'; readonly inner: { readonly kind: 'LowCardinality'; readonly inner: infer I } } ? [I] : never;
type Extends<D> = [LowCardinalityOf<D>] extends [never] ? InsideNullable<D> : LowCardinalityOf<D> extends [infer I] ? InsideNullable<I> : false;
export type OuterDescriptor<D> = CHType extends D ? D : Extends<D> extends true
  ? [LowCardinalityOf<D>] extends [never] ? { readonly kind: 'Nullable'; readonly inner: D } : LowCardinalityOf<D> extends [infer I] ? { readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'Nullable'; readonly inner: I } } : D
  : D;
type ValueFallback<T> = T extends readonly unknown[] ? T : T extends Date ? T | null : T extends object ? T : T | null;
export type OuterValue<T, D> = CHType extends D ? ValueFallback<T> : Extends<D> extends true ? T | null : T;
type OuterEntry<E> = E extends Expr<unknown, string, Mode> ? ResolvedExpr<OuterValue<ExprValue<E>, E['ir']['type']>, E['name'], E['mode'], OuterDescriptor<E['ir']['type']>> : E extends undefined ? E : OuterRow<E>;
/** A null-extended input's row proxy: every leaf carries the wrapped descriptor and value. */
export type OuterRow<P> = { readonly [K in keyof P]: OuterEntry<P[K]> };
type OuterLeaf<V, E> = E extends Expr<unknown, string, Mode> ? OuterValue<V, E['ir']['type']> : E extends undefined ? V : OuterValues<V, E>;
export type OuterValues<R, P> = { -readonly [K in keyof R]: K extends keyof P ? OuterLeaf<R[K], P[K]> : R[K] };
type OuterRows<I extends Record<string, Input>, N extends keyof I> = { readonly [K in keyof I]: (K extends N ? OuterRow<I[K]['row']> : I[K]['row']) | ({} extends Pick<I, K> ? undefined : never) };
type OuterJoinValues<I extends Record<string, Input>, N extends keyof I> = { -readonly [K in keyof I]: (K extends N ? OuterValues<Infer<I[K]>, I[K]['row']> : Infer<I[K]>) | ({} extends Pick<I, K> ? undefined : never) };
export type OuterJoinBuilder<I extends Record<string, Input>, N extends keyof I> = JoinBuilder<I, OuterRows<I, N>, OuterJoinValues<I, N>>;
/** One aliased input per argument: record key order is invisible to the type system, so the
 * preserved side is the argument position (spec, Decided: outer joins are binary). */
type One<I> = keyof I extends never ? { readonly outer_join_arity: never } : { [K in keyof I]: Exclude<keyof I, K> extends never ? unknown : { readonly outer_join_arity: never } }[keyof I];
type Disjoint<A, B> = Extract<keyof A, keyof B> extends never ? unknown : { readonly outer_join_alias: never };
function outer(kind: 'left' | 'right' | 'full', args: readonly unknown[]): JoinBuilder<Record<string, Input>> {
  if (args.length !== 2) throw new Error(`outer_join_arity: ${kind}Join takes exactly two inputs, (left, right)`);
  const [left, right] = args as [Record<string, Input>, Record<string, Input>];
  for (const side of [left, right]) {
    if (!side || typeof side !== 'object' || Object.getOwnPropertySymbols(side).length || Object.keys(side).length !== 1) throw new Error(`outer_join_arity: each ${kind}Join argument is a record with exactly one aliased input`);
  }
  if (Object.hasOwn(right, Object.keys(left)[0]!)) throw new Error(`outer_join_alias: ${kind}Join inputs need distinct aliases`);
  return new JoinBuilder({ ...left, ...right }, kind);
}
/** LEFT ALL JOIN: the right input is null-extended. */
export function leftJoin<const L extends Record<string, Input>, const R extends Record<string, Input>>(left: L & One<L>, right: R & One<R> & Disjoint<L, R>): OuterJoinBuilder<L & R, keyof R> {
  return outer('left', [...arguments]) as unknown as OuterJoinBuilder<L & R, keyof R>;
}
/** RIGHT ALL JOIN: the left input is null-extended. */
export function rightJoin<const L extends Record<string, Input>, const R extends Record<string, Input>>(left: L & One<L>, right: R & One<R> & Disjoint<L, R>): OuterJoinBuilder<L & R, keyof L> {
  return outer('right', [...arguments]) as unknown as OuterJoinBuilder<L & R, keyof L>;
}
/** FULL ALL JOIN: both inputs are null-extended. */
export function fullJoin<const L extends Record<string, Input>, const R extends Record<string, Input>>(left: L & One<L>, right: R & One<R> & Disjoint<L, R>): OuterJoinBuilder<L & R, keyof L | keyof R> {
  return outer('full', [...arguments]) as unknown as OuterJoinBuilder<L & R, keyof L | keyof R>;
}
