import { print, type CHType } from '../ch-type.js';
import type { Column, Decimal } from '../types.js';
export interface Matcher<T = unknown> { readonly match: (type: CHType) => boolean; readonly value?: T }
export type Argument = Column | Matcher;
export type Matched<A> = A extends Column<infer T> ? T : A extends Matcher<infer T> ? T : never;
export function unwrap(type: CHType): CHType {
  return type.kind === 'Nullable' || type.kind === 'LowCardinality' ? unwrap(type.inner) : type;
}
export const anyType: Matcher = Object.freeze({ match: () => true });
export const numeric: Matcher<number | bigint | Decimal> = Object.freeze({ match: (t: CHType) => {
  const type = unwrap(t);
  return type.kind === 'Decimal' || (type.kind === 'scalar' && /^(U?Int|Float)/.test(type.name));
} });
export const stringLike: Matcher<string> = Object.freeze({ match: (t: CHType) => {
  const type = unwrap(t);
  return type.kind === 'FixedString' || type.kind === 'Enum' || (type.kind === 'scalar' && ['String', 'UUID', 'IPv4', 'IPv6'].includes(type.name));
} });
export const boolean: Matcher<boolean> = Object.freeze({ match: (t: CHType) => { const type = unwrap(t); return type.kind === 'scalar' && type.name === 'Bool'; } });
export const dateLike: Matcher<Date | string> = Object.freeze({ match: (t: CHType) => {
  const type = unwrap(t);
  return type.kind === 'DateTime' || type.kind === 'DateTime64' || (type.kind === 'scalar' && ['Date', 'Date32', 'DateTime'].includes(type.name));
} });
export function arrayOf<A extends Argument>(element: A): Matcher<Matched<A>[]> {
  return Object.freeze({ match: (type: CHType) => {
    const t = unwrap(type);
    return t.kind === 'Array' && ('match' in element ? element.match(t.inner) : print(element.type) === print(t.inner));
  } });
}
/** Byte string functions do not accept Enum or address types, despite their decoded strings. */
export const byteString: Matcher<string> = Object.freeze({ match: (type: CHType) => { const t = unwrap(type); return t.kind === 'FixedString' || (t.kind === 'scalar' && t.name === 'String'); } });
export const stringOrArray: Matcher<string | unknown[]> = Object.freeze({ match: (type: CHType) => byteString.match(type) || arrayOf(anyType).match(type) });
export const tupleLike: Matcher<object> = Object.freeze({ match: (type: CHType) => { const t = unwrap(type); return t.kind === 'Tuple' || (t.kind === 'Array' && tupleLike.match(t.inner)); } });
export function isNullable(type: CHType): boolean { return type.kind === 'Nullable' || (type.kind === 'LowCardinality' && isNullable(type.inner)); }
export function nullable(type: CHType): CHType { return isNullable(type) ? type : { kind: 'Nullable', inner: type }; }
