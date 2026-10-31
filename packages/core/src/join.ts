import { Expr } from './expr.js';
import { relNode, type Rel, type ExprNode } from './ir.js';
import { Query, rowOf, deterministic, rebindSort, type Caps, type ExpressionCaps, type Projection, type ValidProjection, type ProjectionRow } from './query.js';
import type { Infer, Row } from './types.js';

type Input = Pick<Query<unknown, Caps, unknown>, 'ir' | 'row' | '_rowType' | 'caps'>;
type Rows<I extends Record<string, Input>> = { readonly [K in keyof I]: I[K]['row'] | ({} extends Pick<I, K> ? undefined : never) };
type Values<I extends Record<string, Input>> = { -readonly [K in keyof I]: Infer<I[K]> | ({} extends Pick<I, K> ? undefined : never) };
type AtLeastTwo<I> = { [K in keyof I]: Exclude<keyof I, K> extends never ? false : true }[keyof I] extends true ? keyof I extends never ? { readonly join_input_count: never } : unknown : { readonly join_input_count: never };
type JoinCaps<I extends Record<string, Input>> = { readonly live: false extends { [K in keyof I]: I[K]['caps']['live'] extends false ? false : never }[keyof I] ? false : boolean };

/** An inner or cross join whose rows are nested under the input aliases.
 * Use `map()` to select a flat result, or keep aliases while filtering and grouping.
 */
export class JoinQuery<R, C extends Caps, Proxy> extends Query<R, C, Proxy, true> {
  /** Select a flat row from the aliased inputs. Nested objects are not projections.
   * @example
   * ```ts
   * join({ c: from(components).arrayJoin(c => c.matched_part_ids, 'partId'), p: from(parts) })
   *   .on(r => r.c.partId.eq(r.p.entityId))
   *   .map(r => ({ componentId: r.c.entityId, partId: r.p.entityId }));
   * ```
   */
  override map<P extends Projection | Expr<unknown, string>>(projection: (row: this['row']) => P & ValidProjection<P>): Query<Infer<P>, ExpressionCaps<C>, ProjectionRow<P>>;
  /** Select or spread one join side while preserving its column names.
   * @example
   * ```ts
   * join({ c: from(components).arrayJoin(c => c.matched_part_ids, 'partId'), p: from(parts) })
   *   .on(r => r.c.partId.eq(r.p.entityId)).map(r => ({ ...r.c }));
   * ```
   */
  override map<S>(projection: (row: this['row']) => Row<S>): Query<S, ExpressionCaps<C>>;
  override map(projection: (row: this['row']) => unknown): unknown { return super.map(projection as (row: this['row']) => Projection); }
}

/** An aliased inner join awaiting its `on()` predicate.
 * Construct with {@link join}; the aliases distinguish inputs even in self-joins.
 */
export class JoinBuilder<I extends Record<string, Input>> {
  readonly inputs: readonly (readonly [string, Rel])[];
  readonly caps: JoinCaps<I>;
  constructor(inputs: I) {
    const entries = Object.entries(inputs);
    if (entries.length < 2 || Object.getOwnPropertySymbols(inputs).length) throw new Error('join_input_count');
    if (entries.some(([alias, q]) => alias.includes('\0') || !(q instanceof Query))) throw new Error('invalid_join_input');
    this.inputs = Object.freeze(entries.map(([alias, q]) => Object.freeze([alias, q.ir] as const)));
    this.caps = Object.freeze({ live: entries.every(([, q]) => q.caps.live) }) as JoinCaps<I>;
    Object.freeze(this);
  }
  /** Match input rows with a predicate or an array of predicates combined with AND.
   * Equalities must connect two different input aliases, with each later input
   * connected to an earlier input. Put single-side equality filters in `where()`.
   * Other conjuncts filter the joined rows; NULL predicates do not match.
   * This is an inner join, not an outer join with null extension.
   * @example
   * ```ts
   * join({ c: from(components), other: from(components) })
   *   .on(r => r.c.entityId.eq(r.other.entityId));
   * ```
   */
  on(f: (row: Rows<I>) => Expr<boolean | null, string, 'row'> | readonly Expr<boolean | null, string, 'row'>[]): JoinQuery<Values<I>, JoinCaps<I>, Rows<I>> {
    // Reserve an occurrence scope before evaluating the callback. The final Join
    // explicitly records this scope; input Rel identities remain shared.
    const scope = relNode({ kind: 'Join', joinKind: 'inner', inputs: this.inputs, on: [], output: { shape: 'nested', inputs: this.inputs.map(([alias, rel]) => [alias, rel.output] as const) } });
    const result = f(rowOf(scope) as Rows<I>);
    const predicates = Array.isArray(result) ? result : [result];
    if (predicates.some(e => !(e instanceof Expr) || e.mode !== 'row')) throw new Error('invalid_join_predicate');
    // ON keeps the reserved scope; residuals bind the output of each new Filter.
    const split = (e: ExprNode): readonly ExprNode[] => e.kind === 'Call' && e.fn.origin === 'typed' && e.fn.name === 'and' ? e.args.flatMap(split) : [e];
    const conjuncts = predicates.flatMap(e => split(e.ir));
    const equalities = conjuncts.filter(e => e.kind === 'Call' && e.fn.origin === 'typed' && e.fn.name === 'eq');
    const ir = relNode({ kind: 'Join', joinKind: 'inner', inputs: this.inputs, on: equalities, output: scope.output, scope: scope.id });
    let resultRel: Rel = ir;
    for (const e of conjuncts.filter(e => !equalities.includes(e))) {
      resultRel = relNode({ kind: 'Filter', input: resultRel, pred: rebindSort(e, scope, resultRel), output: scope.output });
    }
    return new JoinQuery(resultRel, { live: this.caps.live && predicates.every(e => deterministic(e.ir)) } as JoinCaps<I>);
  }
}
/** Start an inner join of at least two queries, named by object keys.
 * Complete it with `on()`; callbacks then access columns through these aliases.
 * Use {@link crossJoin} for an intentional Cartesian product.
 * @example
 * ```ts
 * join({ c: from(components), other: from(components) })
 *   .on(r => r.c.entityId.eq(r.other.entityId)).map(r => r.c.entityId);
 * ```
 */
export function join<const I extends Record<string, Input>>(inputs: I & AtLeastTwo<I>): JoinBuilder<I> { return new JoinBuilder<I>(inputs); }

/** Combine every row from each of at least two aliased queries.
 * There is no `on()` stage or null extension; an empty input makes the result empty.
 * The result size is the product of input sizes, so filter inputs when appropriate.
 * @example
 * ```ts
 * crossJoin({ c: from(components), totals: from(components).count() })
 *   .map(r => ({ id: r.c.entityId, total: r.totals.count }));
 * ```
 */
export function crossJoin<const I extends Record<string, Input>>(inputs: I & AtLeastTwo<I>): JoinQuery<Values<I>, JoinCaps<I>, Rows<I>> {
  const builder = new JoinBuilder<I>(inputs);
  const ir = relNode({ kind: 'Join', joinKind: 'cross', inputs: builder.inputs, on: [], output: { shape: 'nested', inputs: builder.inputs.map(([alias, rel]) => [alias, rel.output] as const) } });
  return new JoinQuery(ir, builder.caps);
}
