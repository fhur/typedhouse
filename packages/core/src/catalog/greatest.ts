import type { CHType } from '../ch-type.js';
import { Expr, type DescribedExpr, type ExprOperand } from '../expr.js';
import type { Mode } from '../types.js';
import { defineFunction, invoke } from './define.js';

export type TemporalDescriptor = { readonly kind: 'DateTime64'; readonly precision: 0 | 1 | 2 | 3; readonly tz?: string };
type TemporalOperand = ExprOperand<Date, string, Mode> & { readonly ir: { readonly type: TemporalDescriptor } };
type Zone<D> = 'tz' extends keyof D ? D['tz' & keyof D] : undefined;
type IsUnion<T, U = T> = T extends U ? [U] extends [T] ? false : true : never;
type Single<T> = true extends IsUnion<T> ? never : string extends T ? never : unknown;
// Pattern index signatures have no required key: they cannot prove one concrete zone.
// Keep numeric precision and mode singleton checks independent of this string evidence.
type SingleZone<T> = Single<T> & ([T] extends [undefined] ? unknown
  : [T] extends [string] ? {} extends Record<T & string, unknown> ? never : unknown : never);
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? unknown : never : never;
type Checked<A extends readonly TemporalOperand[]> = {
  [K in keyof A]: A[K] & Single<A[K]['ir']['type']['precision']> & SingleZone<Zone<A[K]['ir']['type']>> &
    Equal<Zone<A[K]['ir']['type']>, Zone<A[0]['ir']['type']>> & Single<A[K]['mode']> & Equal<A[K]['mode'], A[0]['mode']>
};
// Only a single, finite, required tuple proves which operands participate.
// A possibly empty rest tail must not contribute its precision to an exact maximum.
type Fixed<A extends readonly TemporalOperand[]> = number extends A['length'] ? never
  : true extends IsUnion<A> ? never : A extends Required<A> ? unknown : never;
type Precision<A extends readonly TemporalOperand[], P = A[number]['ir']['type']['precision']> = 3 extends P ? 3 : 2 extends P ? 2 : 1 extends P ? 1 : 0;
type ResultDescriptor<A extends readonly TemporalOperand[]> = { readonly kind: 'DateTime64'; readonly precision: Precision<A> } &
  (Zone<A[0]['ir']['type']> extends string ? { readonly tz: Zone<A[0]['ir']['type']> } : { readonly tz?: never });

/** Shared authoritative runtime policy, deliberately not the whole CH greatest family. */
export function greatestTemporalType(types: readonly CHType[]): CHType {
  if (types.length < 2) throw new Error('invalid_argument_arity');
  const first = types[0]!;
  if (first.kind !== 'DateTime64') throw new Error('incompatible_operands');
  let precision = 0;
  for (const type of types) {
    if (type.kind !== 'DateTime64' || ![0, 1, 2, 3].includes(type.precision)) throw new Error('incompatible_operands');
    if (type.tz !== first.tz) throw new Error('unsupported_mixed_timezones');
    precision = Math.max(precision, type.precision);
  }
  return { kind: 'DateTime64', precision, ...(first.tz === undefined ? {} : { tz: first.tz }) };
}
export const greatestDefinition = defineFunction({
  name: 'greatest', args: [{ match: (t: CHType) => t.kind === 'DateTime64' && [0, 1, 2, 3].includes(t.precision) }],
  repeatedArgs: 'temporalGreatest', returns: greatestTemporalType, tsReturns: 'ResultDescriptor<A>',
  nullable: 'never', deterministic: true, origin: 'typed',
}).definition;

/** Non-null temporal slice. Descriptor-erased Dates and dynamically uncertain zones are not evidence. */
export function greatest<const A extends readonly [TemporalOperand, TemporalOperand, ...TemporalOperand[]]>(...args: A & Checked<A> & Fixed<A>): DescribedExpr<Date, A[0]['name'], A[0]['mode'], ResultDescriptor<A>>;
export function greatest(...args: readonly Expr<Date, string, Mode>[]): Expr<unknown, string, Mode> {
  if (args.length < 2) throw new Error('invalid_argument_arity');
  if (args.some(a => !(a instanceof Expr))) throw new Error('incompatible_operands');
  if (args.some(a => a.mode !== args[0]!.mode)) throw new Error('invalid_expression_mode');
  const result = invoke(greatestDefinition, args);
  // Unlike general functions, the root is the first operand even when it is a parameter.
  return new Expr(result.ir, args[0]!.name, args[0]!.mode);
}
