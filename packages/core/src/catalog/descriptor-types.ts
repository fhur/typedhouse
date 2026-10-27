import type { CHType, ScalarName } from '../ch-type.js';
import type { DescribedExpr, Expr } from '../expr.js';
import type { Decimal, Mode, ScalarValue } from '../types.js';

/** Sum promotes Decimal32/64/128 storage to Decimal128, and Decimal256 to itself.
 * A nonliteral precision can occupy either storage class. */
export type SumPrecision<P> = number extends P ? 38 | 76 : P extends
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
  20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 ? 38 : 76;

/** Type-level twins of unwrap/nullable and the bounded catalog's resolvers. */
export type Unwrapped<D> = CHType extends D ? CHType : D extends { kind: 'Nullable' | 'LowCardinality'; inner: infer I } ? Unwrapped<I> : D;
type IsNullable<D> = CHType extends D ? boolean : D extends { kind: 'Nullable' } ? true : D extends { kind: 'LowCardinality'; inner: infer I } ? IsNullable<I> : false;
type WithNull<D, B> = B extends true ? { readonly kind: 'Nullable'; readonly inner: D } : D;
export type MaxDescriptor<D> = WithNull<Unwrapped<D>, IsNullable<D>>;
type SumBase<D> = D extends { kind: 'Decimal'; precision: infer P; scale: infer S } ? { readonly kind: 'Decimal'; readonly precision: SumPrecision<P>; readonly scale: S } :
  D extends { kind: 'scalar'; name: infer N } ? { readonly kind: 'scalar'; readonly name: N extends 'Float32' | 'Float64' ? 'Float64' : N extends 'UInt128' | 'UInt256' | 'Int128' | 'Int256' ? N : N extends `UInt${number}` ? 'UInt64' : 'Int64' } : CHType;
export type SumDescriptor<D> = WithNull<SumBase<Unwrapped<D>>, IsNullable<D>>;
type TupleItem = { readonly name?: string; readonly type: CHType };
type TupleDecoded<I extends readonly TupleItem[]> = I extends readonly [] ? readonly [] :
  I[number] extends { readonly name: string } ? { [E in I[number] as E['name'] & string]: DescriptorValue<E['type']> } :
  { readonly [K in keyof I]: DescriptorValue<I[K]['type']> };
/** Classify the CH key, not its decoded value: Decimal and DateTime64(>3)
 * decode to strings but use pair arrays rather than string-key Records. */
type StringKeyDescriptor<D> = CHType extends D ? boolean :
  D extends { kind: 'LowCardinality'; inner: infer I } ? StringKeyDescriptor<I> :
  D extends { kind: 'FixedString' | 'Enum' } | { kind: 'scalar'; name: 'String' | 'UUID' | 'IPv4' | 'IPv6' } ? true : false;
type MapDecoded<K, V> = StringKeyDescriptor<K> extends true ? Record<DescriptorValue<K> & string, DescriptorValue<V>> : Array<[DescriptorValue<K>, DescriptorValue<V>]>;
export type DescriptorValue<D> = CHType extends D ? unknown :
  D extends { kind: 'Nullable'; inner: infer I } ? DescriptorValue<I> | null :
  D extends { kind: 'LowCardinality' | 'SimpleAggregateFunction'; inner: infer I } ? DescriptorValue<I> :
  D extends { kind: 'Array'; inner: infer I } ? DescriptorValue<I>[] :
  D extends { kind: 'Map'; key: infer K; value: infer V } ? MapDecoded<K, V> :
  D extends { kind: 'scalar'; name: infer N extends ScalarName } ? ScalarValue<N> :
  D extends { kind: 'Decimal'; precision: infer P extends number; scale: infer S extends number } ? Decimal<P, S> :
  D extends { kind: 'DateTime' } ? Date :
  D extends { kind: 'DateTime64'; precision: infer P } ? P extends 0 | 1 | 2 | 3 ? Date : number extends P ? Date | string : string :
  D extends { kind: 'FixedString' } ? string :
  D extends { kind: 'Enum'; values: readonly { name: infer N extends string }[] } ? N :
  D extends { kind: 'Tuple'; items: infer I extends readonly TupleItem[] } ? TupleDecoded<I> : unknown;
export type ResolvedExpr<T, N extends string, M extends Mode, D> = CHType extends D ? Expr<T, N, M> : [D] extends [CHType] ? DescribedExpr<T, N, M, D> : Expr<T, N, M>;

/** Structural access is driven by retained descriptors, never by decoded object/string shape. */
export type StructuralReceiver<D, Family extends 'string' | 'array' | 'either'> = CHType extends D ? unknown :
  Unwrapped<D> extends { kind: 'Array' } ? Family extends 'string' ? never : unknown :
  Unwrapped<D> extends { kind: 'FixedString' } | { kind: 'scalar'; name: 'String' } ? Family extends 'array' ? never : unknown : never;
type ArrayInner<D> = Unwrapped<D> extends { kind: 'Array'; inner: infer I } ? I : CHType;
export type ArrayElementResult<T, N extends string, M extends Mode, D> = ResolvedExpr<CHType extends ArrayInner<D> ? T extends readonly (infer I)[] ? I : unknown : DescriptorValue<ArrayInner<D>>, N, M, ArrayInner<D>>;
type TupleFields<D> = Unwrapped<D> extends { kind: 'Array'; inner: infer I } ? TupleFields<I> : Unwrapped<D> extends { kind: 'Tuple'; items: infer I extends readonly TupleItem[] } ? I[number] extends { name: string } ? I[number] : never : never;
export type ElementKeys<D> = TupleFields<D> extends infer I ? I extends { name: infer K extends string } ? K : never : never;
type FieldDescriptor<D, K> = Unwrapped<D> extends { kind: 'Array'; inner: infer I } ? { readonly kind: 'Array'; readonly inner: FieldDescriptor<I, K> } : Extract<TupleFields<D>, { name: K }> extends { type: infer F } ? F : never;
export type ElementResult<N extends string, M extends Mode, D, K> = ResolvedExpr<DescriptorValue<FieldDescriptor<D, K>>, N, M, FieldDescriptor<D, K>>;
export type StructuralResult<T, N extends string, M extends Mode, S extends 'UInt64' | 'Bool'> = ResolvedExpr<null extends T ? (S extends 'UInt64' ? bigint : boolean) | null : S extends 'UInt64' ? bigint : boolean, N, M, WithNull<{ readonly kind: 'scalar'; readonly name: S }, null extends T ? true : false>>;

type Name<D> = D extends { kind: 'scalar'; name: infer N } ? N : never;
type Bits<N> = N extends `${'UInt' | 'Int' | 'Float'}${infer W extends number}` ? W : never;
type MaxBits<W> = 256 extends W ? 256 : 128 extends W ? 128 : 64 extends W ? 64 : 32 extends W ? 32 : 16 extends W ? 16 : 8;
type Next<W> = W extends 8 ? 16 : W extends 16 ? 32 : W extends 32 ? 64 : W extends 64 ? 128 : W extends 128 ? 256 : never;
type SignedBits<N> = N extends `UInt${infer W extends number}` ? Next<W> : Bits<N>;
type CommonNumber<A, B, N = Name<A> | Name<B>> = Extract<N, `Float${number}`> extends never ?
  Extract<N, `Int${number}`> extends never ? `UInt${MaxBits<Bits<N>>}` : 'UInt256' extends N ? never : `Int${MaxBits<SignedBits<N>>}` :
  'Float64' extends N ? 'Float64' : Extract<N, `${'UInt' | 'Int'}${32 | 64 | 128 | 256}`> extends never ? 'Float32' : 'Float64';
type Common<A, B> = [A] extends [B] ? [B] extends [A] ? A : CommonDifferent<A, B> : CommonDifferent<A, B>;
type CommonDifferent<A, B> = A extends { kind: 'scalar'; name: 'Nothing' } ? B : B extends { kind: 'scalar'; name: 'Nothing' } ? A :
  A extends { kind: 'scalar'; name: `${'UInt' | 'Int' | 'Float'}${number}` } ? B extends { kind: 'scalar'; name: `${'UInt' | 'Int' | 'Float'}${number}` } ?
  [CommonNumber<A, B>] extends [never] ? CHType : { readonly kind: 'scalar'; readonly name: CommonNumber<A, B> } : CHType : CHType;
export type IfNullDescriptor<D, B> = CHType extends D ? CHType : IsNullable<D> extends true ? CHType extends B ? CHType : WithNull<Common<Unwrapped<D>, Unwrapped<B>>, IsNullable<B>> : D;
/** Primitive fallbacks are sibling-typed; null alone carries Nullable(Nothing). */
export type FallbackDescriptor<D, U> = CHType extends D ? CHType : null extends U ? [U] extends [null] ? { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: 'Nothing' } } : WithNull<Unwrapped<D>, true> : Unwrapped<D>;
export type IfNullResult<T, N extends string, M extends Mode, D, U, B, R = IfNullDescriptor<D, B>> =
  ResolvedExpr<CHType extends R ? null extends T ? Exclude<T, null> | U : T : DescriptorValue<R> extends infer V ? unknown extends V ? null extends T ? Exclude<T, null> | U : T : V : never, N, M, R>;
