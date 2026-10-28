import { Expr, type DescribedExpr } from './expr.js';
import { exprNode, type ExprNode, type Rel } from './ir.js';
import { print, type CHType } from './ch-type.js';

type Union<K, Whole = K> = K extends Whole ? [Whole] extends [K] ? false : true : never;
export type OneKey<R> = [keyof R] extends [never] ? never : true extends Union<keyof R> ? never : {} extends Record<keyof R, unknown> ? never : keyof R & string;
type NullableDescriptor<D extends CHType> = D extends { readonly kind: 'Nullable' } ? D : { readonly kind: 'Nullable'; readonly inner: D };
type UnsupportedTemporalDescriptor = { readonly kind: 'DateTime' | 'DateTime64' } | { readonly kind: 'scalar'; readonly name: 'Date32' | 'DateTime' };
// Unretained CHType evidence remains compatible with legacy primitive scalars;
// retained unions reject any unsupported alternative, not only all-unsupported unions.
type UnsupportedTemporal<D> = [CHType] extends [D] ? false : D extends UnsupportedTemporalDescriptor ? true
  : D extends { readonly kind: 'Nullable' | 'LowCardinality'; readonly inner: infer I }
    ? [CHType] extends [I] ? false : I extends UnsupportedTemporalDescriptor ? true : false
    : false;
type TemporalScalarEvidence<R, P> = P extends { readonly [K in OneKey<R>]: { readonly ir: { readonly type: infer D } } }
  ? true extends UnsupportedTemporal<D> ? { readonly unsupported_scalar_temporal_descriptor: never }
    : [Extract<R[OneKey<R>], Date>] extends [never] ? unknown
    : [D] extends [DateMembershipDescriptor] ? unknown : { readonly unsupported_scalar_temporal_descriptor: never }
  : [Extract<R[OneKey<R>], Date>] extends [never] ? unknown : { readonly unsupported_scalar_temporal_descriptor: never };
type Descriptor<P, K extends PropertyKey> = K extends keyof P ? P[K] extends { readonly ir: { readonly type: infer D extends CHType } } ? NullableDescriptor<D> : CHType : CHType;

/** Retained temporal evidence: decoded Date alone also represents unsupported types. */
export type DateMembershipDescriptor = { readonly kind: 'scalar'; readonly name: 'Date' } | { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: 'Date' } };
export type DateSetQuery<R> = SetQuery<R, Date> & { readonly row: { readonly [K in keyof R]: { readonly ir: { readonly type: DateMembershipDescriptor } } } };

export type SetQuery<R, T> = { readonly _rowType: R; readonly ir: Rel } &
  ([OneKey<R>] extends [never] ? { readonly set_column_count: never } :
    [R[OneKey<R>]] extends [NonNullable<T> | null] ? unknown : { readonly incompatible_set_values: never });

/** Set evidence deliberately imposes no scalar cardinality restriction. */
export function setDescriptor(rel: Rel): CHType {
  if (rel.output.shape !== 'flat' || rel.output.order.length !== 1 || Object.keys(rel.output.columns).length !== 1) throw new Error('set_column_count');
  const type = rel.output.columns[rel.output.order[0]!];
  if (!type) throw new Error('invalid_output');
  membershipBase(type);
  return type;
}
export function membershipBase(type: CHType): CHType {
  const inner = type.kind === 'Nullable' ? type.inner : type;
  if (inner.kind !== 'scalar' || !/^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Bool|Date)$/.test(inner.name)) throw new Error('unsupported_membership_type');
  return inner;
}
export function setOperand(value: unknown): ExprNode {
  if (Array.isArray(value)) return exprNode({ kind: 'Param', value, type: null });
  if (!value || typeof value !== 'object' || !('ir' in value)) throw new Error('invalid_set_operand');
  const rel = value.ir as Rel;
  return exprNode({ kind: 'Subquery', rel, usage: 'in', type: setDescriptor(rel) });
}

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
  if (inner.kind !== 'scalar' || !/^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Bool|Date)$/.test(inner.name)) throw new Error('unsupported_scalar_type');
  return type.kind === 'Nullable' ? type : { kind: 'Nullable', inner: type };
}

/** Only a directly built, one-column keyless aggregate is supported in this increment. */
export function scalar<R, P>(query: { readonly _rowType: R; readonly row: P; readonly ir: Extract<Rel, { kind: 'Aggregate' }> } & TemporalScalarEvidence<R, P> & ([OneKey<R>] extends [never] ? { readonly scalar_column_count: never } : unknown)): DescribedExpr<R[OneKey<R>] | null, OneKey<R>, 'row', Descriptor<P, OneKey<R>>> {
  const type = scalarDescriptor(query.ir);
  return new Expr(exprNode({ kind: 'Subquery', rel: query.ir, usage: 'scalar', type }), query.ir.output.order[0] as OneKey<R>, 'row') as DescribedExpr<R[OneKey<R>] | null, OneKey<R>, 'row', Descriptor<P, OneKey<R>>>;
}
