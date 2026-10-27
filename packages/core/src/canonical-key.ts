import { print, type CHType } from './ch-type.js';

export type OrderedColumns = readonly (readonly [string, CHType])[];
const frame = (tag: string, parts: readonly string[]): string => tag + parts.map(s => `${s.length}:${s}`).join('');
const own = (o: object, key: string): unknown => {
  if (!Object.hasOwn(o, key)) throw new TypeError(`canonicalKey: missing field ${key}`);
  return (o as Record<string, unknown>)[key];
};
/** Supported passthrough values: null, undefined, primitives, bigint, valid Date,
 * dense arrays and plain string-key objects. Reject cycles, class instances,
 * symbols/functions and sparse arrays, rather than silently losing information.
 * All own string object fields (including hidden fields) sort by UTF-16 code units;
 * enumerability is immaterial. Arrays allow only length and dense own indices.
 * All NaNs are one value; infinities have separate tags; -0 equals +0.
 */
function valueKey(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined': return 'undefined';
    case 'string': return frame('string', [value]);
    case 'boolean': return value ? 'true' : 'false';
    case 'bigint': return frame('bigint', [String(value)]);
    case 'number': return frame('number', [Number.isNaN(value) ? 'NaN' : String(value)]);
    case 'object': break;
    default: throw new TypeError('canonicalKey: unsupported value');
  }
  if (value instanceof Date) return frame('date', [value.toISOString()]);
  if (ancestors.has(value)) throw new TypeError('canonicalKey: cyclic value');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('canonicalKey: symbol keys');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      denseArray(value);
      return frame('array', Array.from({ length: value.length }, (_, i) => valueKey(own(value, String(i)), ancestors)));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('canonicalKey: unsupported object');
    return frame('object', Object.getOwnPropertyNames(value).sort().map(k => frame('entry', [k, valueKey(own(value, k), ancestors)])));
  } finally { ancestors.delete(value); }
}
function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) throw new TypeError('canonicalKey: invalid decimal');
  const negative = value.startsWith('-');
  const [whole = '', fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const tail = fraction.replace(/0+$/, '');
  return (negative && (integer !== '0' || tail !== '') ? '-' : '') + integer + (tail ? '.' + tail : '');
}
/** Arrays must contain only length and dense own indices, enumerable or not.
 * Counting all own keys plus checking each index rejects hidden decorations and
 * holes even when an unrelated property compensates for the missing index.
 */
function denseArray(value: readonly unknown[]): void {
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('canonicalKey: sparse or decorated array');
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) throw new TypeError('canonicalKey: missing array index');
  }
}
function mapPairs(value: unknown): readonly (readonly [unknown, unknown])[] {
  if (Array.isArray(value)) {
    denseArray(value);
    return Array.from({ length: value.length }, (_, i) => {
      const pair = own(value, String(i));
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('canonicalKey: invalid map pair');
      denseArray(pair);
      return [pair[0], pair[1]] as const;
    });
  }
  if (value === null || typeof value !== 'object') throw new TypeError('canonicalKey: expected map');
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('canonicalKey: unsupported map object');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('canonicalKey: symbol map keys');
  // Include non-enumerable own fields too; no accepted record entries disappear.
  return Object.getOwnPropertyNames(value).map(k => [k, own(value, k)] as const);
}
function typed(value: unknown, type: CHType): string {
  if (value === null) return 'null';
  switch (type.kind) {
    case 'Nullable': case 'LowCardinality': case 'SimpleAggregateFunction': return typed(value, type.inner);
    case 'Decimal': return frame('decimal', [decimal(value)]);
    case 'Array':
      if (!Array.isArray(value)) throw new TypeError('canonicalKey: expected array');
      return frame('array', Array.from({ length: value.length }, (_, i) => typed(own(value, String(i)), type.inner)));
    case 'Tuple': {
      if (typeof value !== 'object') throw new TypeError('canonicalKey: expected tuple');
      return frame('tuple', type.items.map((item, i) => typed(own(value, item.name ?? String(i)), item.type)));
    }
    case 'Map': {
      const pairs = mapPairs(value);
      // Map order is immaterial; preserve duplicate pairs and duplicate-key values.
      return frame('map', pairs.map(([k, v]) => frame('pair', [typed(k, type.key), typed(v, type.value)])).sort());
    }
    default: return valueKey(value);
  }
}
/** A row key, not a set comparison: callers must retain multiplicities.
 * Metadata order is explicit (never inferred from numeric object-key enumeration).
 * Decimal lexical equivalents normalize (leading/trailing zeros, sign of zero);
 * type tags retain precision/scale. UTC Dates encode their ISO instant.
 * Unknown/JSON/Variant/Dynamic use the deterministic passthrough encoding above.
 */
export function canonicalKey(row: Readonly<Record<string, unknown>>, columns: OrderedColumns): string {
  return frame('row', columns.map(([name, type]) => frame('column', [name, print(type), typed(own(row, name), type)])));
}
