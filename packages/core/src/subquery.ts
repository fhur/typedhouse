import { Expr, type DescribedExpr } from './expr.js';
import { exprNode, type Rel } from './ir.js';
import { print, type CHType } from './ch-type.js';

type Union<K, Whole = K> = K extends Whole ? [Whole] extends [K] ? false : true : never;
type OneKey<R> = [keyof R] extends [never] ? never : true extends Union<keyof R> ? never : {} extends Record<keyof R, unknown> ? never : keyof R & string;
type NullableDescriptor<D extends CHType> = D extends { readonly kind: 'Nullable' } ? D : { readonly kind: 'Nullable'; readonly inner: D };
type Descriptor<P, K extends PropertyKey> = K extends keyof P ? P[K] extends { readonly ir: { readonly type: infer D extends CHType } } ? NullableDescriptor<D> : CHType : CHType;

/** ClickHouse 24.8 scalar wrappers expose Nullable even for a keyless aggregate.
 * Keep this conservative runtime/TS twin; do not erase nullability via defaults.
 * Container and less-common descriptor families await independent server evidence.
 */
export function scalarDescriptor(rel: Rel): CHType {
  if (rel.kind !== 'Aggregate' || Object.keys(rel.keys).length !== 0) throw new Error('scalar_cardinality');
  if (rel.output.shape !== 'flat' || rel.output.order.length !== 1 || Object.keys(rel.output.columns).length !== 1 || Object.keys(rel.columns).length !== 1 || Object.keys(rel.aggs).length !== 1) throw new Error('scalar_column_count');
  const name = rel.output.order[0]!;
  const type = rel.output.columns[name];
  if (!type || !Object.hasOwn(rel.columns, name) || !Object.hasOwn(rel.aggs, name) || print(type) !== print(rel.columns[name]!)) throw new Error('invalid_output');
  const inner = type.kind === 'Nullable' ? type.inner : type;
  if (inner.kind !== 'scalar' || !/^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Bool)$/.test(inner.name)) throw new Error('unsupported_scalar_type');
  return type.kind === 'Nullable' ? type : { kind: 'Nullable', inner: type };
}

/** Only a directly built, one-column keyless aggregate is supported in this increment. */
export function scalar<R, P>(query: { readonly _rowType: R; readonly row: P; readonly ir: Extract<Rel, { kind: 'Aggregate' }> } & ([OneKey<R>] extends [never] ? { readonly scalar_column_count: never } : unknown)): DescribedExpr<R[OneKey<R>] | null, OneKey<R>, 'row', Descriptor<P, OneKey<R>>> {
  const type = scalarDescriptor(query.ir);
  return new Expr(exprNode({ kind: 'Subquery', rel: query.ir, usage: 'scalar', type }), query.ir.output.order[0] as OneKey<R>, 'row') as DescribedExpr<R[OneKey<R>] | null, OneKey<R>, 'row', Descriptor<P, OneKey<R>>>;
}
