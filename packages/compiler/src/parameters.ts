import { print as printType, type CHType } from '@typedhouse/core';

/** Date values are instants: parse our UTC text in UTC, not the sibling/server timezone.
 * Keep the resolved sibling descriptor on the IR and for identity checks. The
 * placeholder differs; parameterExpression restores its declared SQL metadata.
 */
export function parameterWireType(type: CHType): CHType {
  if (type.kind === 'Nullable' || type.kind === 'LowCardinality' || type.kind === 'Array') return { ...type, inner: parameterWireType(type.inner) };
  if (type.kind === 'DateTime64' && type.precision <= 3) return { ...type, tz: 'UTC' };
  return type;
}

/** UTC text is parsed first; only then restore the SQL descriptor. A temporal
 * cast preserves epoch ticks (including arrays/nullable wrappers), unlike parsing
 * the same text directly in a non-UTC timezone. Both emitters share this path. */
export function parameterExpression(name: string, type: CHType): string {
  const wire = parameterWireType(type);
  const placeholder = `{${name}:${printType(wire)}}`;
  return printType(wire) === printType(type) ? placeholder : `CAST(${placeholder} AS ${printType(type)})`;
}

function arrayLiteral(value: unknown, type: CHType): string {
  if (type.kind === 'LowCardinality') return arrayLiteral(value, type.inner);
  if (type.kind === 'Nullable') return value === null ? 'NULL' : arrayLiteral(value, type.inner);
  const encoded = serializeParameter(value, type);
  // Array text uses Bool words, unlike scalar HTTP parameters (1/0).
  if (type.kind === 'scalar' && type.name === 'Bool') return value ? 'true' : 'false';
  if (type.kind === 'FixedString' || type.kind === 'DateTime64' || (type.kind === 'scalar' && (type.name === 'String' || type.name === 'Date'))) {
    return "'" + encoded.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t').replaceAll('\0', '\\0') + "'";
  }
  return encoded;
}

function temporal(t: CHType): boolean {
  return t.kind === 'DateTime64' || ((t.kind === 'Array' || t.kind === 'Nullable' || t.kind === 'LowCardinality') && temporal(t.inner));
}
function invalidLowCardinality(t: CHType): boolean {
  return t.kind === 'LowCardinality' ? temporal(t.inner) : (t.kind === 'Array' || t.kind === 'Nullable') && invalidLowCardinality(t.inner);
}
/** Values are serialized here, never delegated to the driver's inferred formatter. */
export function serializeParameter(value: unknown, type: CHType): string {
  // CH 24.8 rejects LowCardinality(DateTime64), including Nullable nesting.
  // Use the existing parameter error rather than claim a type that cannot exist.
  if (invalidLowCardinality(type)) throw new Error(`param_incompatible: ${printType(type)}`);
  if (type.kind === 'Array') {
    if (!Array.isArray(value)) throw new Error(`param_incompatible: ${printType(type)}`);
    return '[' + value.map(v => arrayLiteral(v, type.inner)).join(',') + ']';
  }
  if (type.kind === 'LowCardinality') return serializeParameter(value, type.inner);
  if (type.kind === 'Nullable') return value === null ? '\\N' : serializeParameter(value, type.inner);
  if (type.kind === 'FixedString' || (type.kind === 'scalar' && type.name === 'String')) {
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
  } else if (type.kind === 'scalar' && type.name === 'Date') {
    // A Date-only parameter is the UTC calendar day of the supplied instant.
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      const day = value.toISOString().slice(0, 10);
      if (/^\d{4}-\d\d-\d\d$/.test(day) && day >= '1970-01-01' && day <= '2149-06-06') return day;
    }
  } else if (type.kind === 'DateTime64' && type.precision <= 3) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().replace('T', ' ').slice(0, type.precision === 0 ? 19 : 20 + type.precision);
  }
  throw new Error(`param_incompatible: ${printType(type)}`);
}
