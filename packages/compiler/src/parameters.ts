import { print as printType, type CHType } from '@chql/core';

/** Date values are instants: parse our UTC text in UTC, not the sibling/server timezone.
 * Keep the resolved sibling descriptor on the IR and for identity checks; only the
 * wire placeholder differs. This also preserves DateTime64 precision and wrappers.
 */
export function parameterWireType(type: CHType): CHType {
  if (type.kind === 'Nullable' || type.kind === 'LowCardinality') return { ...type, inner: parameterWireType(type.inner) };
  if (type.kind === 'DateTime64' && type.precision <= 3) return { ...type, tz: 'UTC' };
  return type;
}

/** Values are serialized here, never delegated to the driver's inferred formatter. */
export function serializeParameter(value: unknown, type: CHType): string {
  if (type.kind === 'LowCardinality') return serializeParameter(value, type.inner);
  if (type.kind === 'Nullable') return value === null ? '\\N' : serializeParameter(value, type.inner);
  if (type.kind === 'scalar' && type.name === 'String') {
    if (typeof value === 'string') return value;
  } else if (type.kind === 'scalar' && /^(U?Int)(8|16|32|64|128|256)$/.test(type.name)) {
    const bits = Number(type.name.match(/\d+/)![0]);
    const unsigned = type.name.startsWith('U');
    if ((bits >= 64 ? typeof value === 'bigint' : typeof value === 'number' && Number.isSafeInteger(value))) {
      const integer = BigInt(value as number | bigint);
      const bound = 1n << BigInt(unsigned ? bits : bits - 1);
      if (integer >= (unsigned ? 0n : -bound) && integer < bound) return String(integer);
    }
  } else if (type.kind === 'scalar' && (type.name === 'Float32' || type.name === 'Float64')) {
    if (typeof value === 'number') return String(value);
  } else if (type.kind === 'scalar' && type.name === 'Bool') {
    if (typeof value === 'boolean') return value ? '1' : '0';
  } else if (type.kind === 'DateTime64' && type.precision <= 3) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().replace('T', ' ').slice(0, type.precision === 0 ? 19 : 20 + type.precision);
  }
  throw new Error(`param_incompatible: ${printType(type)}`);
}
