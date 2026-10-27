import type { CHType, ScalarName } from './ch-type.js';
import type { TableDef } from './table.js';
import type { DescribedExpr, Expr } from './expr.js';
export type Mode = 'row' | 'grouped' | 'agg';
export type Grouped<T, N extends string = never> = Expr<T, N, 'grouped'>;
export type AggExpr<T, N extends string = never> = Expr<T, N, 'agg'>;
export type Row<R, C extends Partial<Record<keyof R, Column>> = {}> = { readonly [K in keyof R]: C[K] extends Column ? DescribedExpr<R[K], K & string, 'row', C[K]['type']> : Expr<R[K], K & string> };
export type GroupedRow<R, C extends Partial<Record<keyof R, Column>> = {}> = { readonly [K in keyof R]: C[K] extends Column ? DescribedExpr<R[K], K & string, 'grouped', C[K]['type']> : Grouped<R[K], K & string> };
export type Nullable<R> = { [K in keyof R]: R[K] | null };

declare const nodeIdBrand: unique symbol;
/** Identity is allocated monotonically across expression and relational nodes. */
export type NodeId = number & { readonly [nodeIdBrand]: 'NodeId' };

export type Decimal<P extends number = number, S extends number = number> = string & { __p: P; __s: S };
export type UUID = string & { readonly __brand: 'UUID' };
export type IPv4 = string & { readonly __brand: 'IPv4' };
export type IPv6 = string & { readonly __brand: 'IPv6' };
export type AggregateState<F extends string = string> = { readonly __aggregateState: F };
declare const valueType: unique symbol;
/** The phantom is never materialized; `type` is its runtime twin. */
declare const stringKeyType: unique symbol;
export interface Column<T = unknown, StringKey extends boolean = boolean, D extends CHType = CHType> {
  readonly type: D;
  readonly [valueType]?: T;
  /** CH string-likeness, independent of the decoded value (e.g. Decimal is a string). */
  readonly [stringKeyType]?: StringKey;
}
/** Object.entries stringifies numeric keys and omits symbol keys. */
export type EnumNames<V> = `${Extract<keyof V, string | number>}`;
export type Value<C> = C extends Column<infer T> ? T : never;
export type Infer<O> = O extends TableDef<infer R> ? R : O extends Column<infer T> ? T :
  O extends Expr<infer T, infer N, Mode> ? { [K in N]: T } :
  { -readonly [K in keyof O]: O[K] extends Expr<infer T, string, Mode> ? T : never };
export type ScalarValue<N extends ScalarName> =
  N extends 'UInt8' | 'UInt16' | 'UInt32' | 'Int8' | 'Int16' | 'Int32' | 'Float32' | 'Float64' ? number :
  N extends 'UInt64' | 'UInt128' | 'UInt256' | 'Int64' | 'Int128' | 'Int256' ? bigint :
  N extends 'Bool' ? boolean : N extends 'String' ? string : N extends 'UUID' ? UUID :
  N extends 'IPv4' ? IPv4 : N extends 'IPv6' ? IPv6 :
  N extends 'Date' | 'Date32' | 'DateTime' ? Date : N extends 'Nothing' ? never : unknown;
export type ScalarStringKey<N extends ScalarName> = N extends 'String' | 'UUID' | 'IPv4' | 'IPv6' ? true : false;
export type MapValue<K, V, StringKey extends boolean> = StringKey extends true ? Record<K & string, V> : Array<[K, V]>;
export type TupleValue<C extends Readonly<Record<string, Column>> | readonly Column[]> =
  C extends readonly Column[] ? { readonly [K in keyof C]: Value<C[K]> } : keyof C extends never ? readonly [] : { -readonly [K in keyof C]: Value<C[K]> };
/** Ordered entries retain SQL tuple positions while inferring a named decoded object. */
export type NamedTupleValue<C extends readonly (readonly [string, Column])[]> =
  C extends readonly [] ? readonly [] : { [E in C[number] as E[0]]: Value<E[1]> };
export type ColumnsRow<C extends Record<string, Column>> = { -readonly [K in keyof C]: Value<C[K]> };
