import type { CHType, TableDef } from '@typedhouse/core';

export interface EncodedInsert {
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/** Validation errors deliberately contain locations, never input values. */
export class InsertValidationError extends Error {
  readonly code: string;
  readonly table: string;
  readonly row?: number;
  readonly path?: string;
  constructor(code: string, table: string, row?: number, path?: string) {
    super(`Insert validation failed (${code})`);
    this.name = 'InsertValidationError';
    this.code = code;
    this.table = table;
    if (row !== undefined) this.row = row;
    if (path !== undefined) this.path = path;
  }
}

type Fail = (code: string, path?: string) => never;
const integer = /^(U?Int)(8|16|32|64|128|256)$/;
const supportedScalars = new Set(['Float32', 'Float64', 'Bool', 'String', 'UUID', 'Date', 'Date32', 'DateTime']);

// Inspect the entire descriptor before examining values: null and [] cannot
// accidentally make an unsupported nested type writable.
function supported(type: CHType, ancestors = new Set<CHType>()): boolean {
  if (ancestors.has(type) || ancestors.size > 128) return false;
  ancestors.add(type);
  try {
    switch (type.kind) {
      case 'scalar': return integer.test(type.name) || supportedScalars.has(type.name);
      case 'DateTime': return true;
      case 'DateTime64': return Number.isInteger(type.precision) && type.precision >= 0 && type.precision <= 3;
      case 'Decimal': return Number.isInteger(type.precision) && type.precision >= 1 && type.precision <= 76 && Number.isInteger(type.scale) && type.scale >= 0 && type.scale <= type.precision;
      case 'Enum': {
        const bound = type.bits === 8 ? 128 : type.bits === 16 ? 32768 : 0;
        return type.values.length > 0 && new Set(type.values.map(v => v.name)).size === type.values.length && new Set(type.values.map(v => v.value)).size === type.values.length && type.values.every(v => typeof v.name === 'string' && Number.isInteger(v.value) && v.value >= -bound && v.value < bound);
      }
      case 'Nullable': case 'LowCardinality': case 'Array': return supported(type.inner, ancestors);
      case 'Tuple': {
        const names = type.items.map(item => item.name);
        return (names.every(name => name === undefined) || (names.every(name => typeof name === 'string') && new Set(names).size === names.length)) && type.items.every(item => supported(item.type, ancestors));
      }
      default: return false;
    }
  } finally { ancestors.delete(type); }
}

function record(value: unknown, fail: Fail, path?: string): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return fail('INVALID_RECORD', path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return fail('INVALID_RECORD', path);
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_RECORD', path);
    if (key === 'toJSON' && typeof descriptor.value === 'function') return fail('INVALID_RECORD', path);
  }
  return descriptors;
}

function array(value: unknown, fail: Fail, path?: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail('INVALID_ARRAY', path);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return fail('INVALID_ARRAY', path);
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_ARRAY', path);
    result.push(descriptor.value);
  }
  return result;
}

function dateMillis(value: unknown, fail: Fail, path: string): number {
  if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) return fail('INVALID_VALUE', path);
  const ms = Date.prototype.getTime.call(value);
  if (!Number.isFinite(ms)) return fail('INVALID_VALUE', path);
  return ms;
}

function encode(type: CHType, value: unknown, fail: Fail, path: string, ancestors: Set<object>): unknown {
  if (value !== null && typeof value === 'object') {
    if (ancestors.has(value)) return fail('CYCLIC_VALUE', path);
    ancestors.add(value);
    try { return encodeValue(type, value, fail, path, ancestors); }
    finally { ancestors.delete(value); }
  }
  return encodeValue(type, value, fail, path, ancestors);
}

function encodeValue(type: CHType, value: unknown, fail: Fail, path: string, ancestors: Set<object>): unknown {
  const invalid = (): never => fail('INVALID_VALUE', path);
  switch (type.kind) {
    // Unwrapping is not descent into a value; do not flag the same object twice.
    case 'LowCardinality': return encodeValue(type.inner, value, fail, path, ancestors);
    case 'Nullable': return value === null ? null : encodeValue(type.inner, value, fail, path, ancestors);
    case 'Array': return array(value, fail, path).map((v, i) => encode(type.inner, v, fail, `${path}[${i}]`, ancestors));
    case 'Tuple': {
      if (type.items.every(item => item.name === undefined)) {
        const values = array(value, fail, path);
        if (values.length !== type.items.length) return invalid();
        return type.items.map((item, i) => encode(item.type, values[i], fail, `${path}[${i}]`, ancestors));
      }
      const descriptors = record(value, fail, path);
      if (Object.keys(descriptors).length !== type.items.length) return invalid();
      const result: Record<string, unknown> = Object.create(null);
      for (const item of type.items) {
        const name = item.name!;
        if (!Object.hasOwn(descriptors, name)) return invalid();
        result[name] = encode(item.type, descriptors[name]!.value, fail, `${path}.${name}`, ancestors);
      }
      return result;
    }
    case 'Decimal': {
      if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return invalid();
      const [whole = '', fraction = ''] = value.replace(/^-/, '').split('.');
      if (whole.replace(/^0+/, '').length > type.precision - type.scale || fraction.length > type.scale) return invalid();
      return value;
    }
    case 'Enum': return typeof value === 'string' && type.values.some(item => item.name === value) ? value : invalid();
    case 'DateTime': {
      const ms = dateMillis(value, fail, path);
      return ms >= 0 && ms <= 4294967295000 && ms % 1000 === 0 ? ms / 1000 : invalid();
    }
    case 'DateTime64': {
      const ms = dateMillis(value, fail, path);
      if (ms < Date.UTC(1900, 0, 1) || ms >= Date.UTC(2300, 0, 1) || ms % (10 ** (3 - type.precision)) !== 0) return invalid();
      // Send ticks (units of 10^-precision s since the epoch) as a JSON number, like DateTime's
      // seconds. Text is not safe: ClickHouse 24.8 best_effort parsing flips the fraction of
      // pre-1970 instants (1969-12-31T23:59:59.999Z is stored as -1999 ms instead of -1).
      // Ticks are integers below 2^53 across 1900..2299, so the number is exact.
      return ms / 10 ** (3 - type.precision);
    }
    case 'scalar': {
      const match = integer.exec(type.name);
      if (match) {
        const bits = Number(match[2]);
        const unsigned = match[1] === 'UInt';
        if (bits <= 32) {
          const min = unsigned ? 0 : -(2 ** (bits - 1));
          const max = unsigned ? 2 ** bits - 1 : 2 ** (bits - 1) - 1;
          return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : invalid();
        }
        const bound = 1n << BigInt(unsigned ? bits : bits - 1);
        return typeof value === 'bigint' && value >= (unsigned ? 0n : -bound) && value < bound ? value.toString() : invalid();
      }
      switch (type.name) {
        case 'String': return typeof value === 'string' ? value : invalid();
        case 'UUID': return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : invalid();
        case 'Bool': return typeof value === 'boolean' ? value : invalid();
        case 'Float32': case 'Float64': {
          if (typeof value !== 'number' || !Number.isFinite(value) || (type.name === 'Float32' && Math.abs(value) > 3.4028234663852886e38)) return invalid();
          // JSON.stringify(-0) is "0"; ClickHouse reads the quoted "-0" as negative zero.
          return Object.is(value, -0) ? '-0' : value;
        }
        case 'DateTime': return encodeValue({ kind: 'DateTime' }, value, fail, path, ancestors);
        case 'Date': case 'Date32': {
          const ms = dateMillis(value, fail, path);
          const min = type.name === 'Date' ? 0 : Date.UTC(1900, 0, 1);
          const max = type.name === 'Date' ? 65535 * 86400000 : Date.UTC(2299, 11, 31);
          return ms >= min && ms <= max && ms % 86400000 === 0 ? new Date(ms).toISOString().slice(0, 10) : invalid();
        }
        default: return fail('UNSUPPORTED_TYPE', path);
      }
    }
    default: return fail('UNSUPPORTED_TYPE', path);
  }
}

/** Fully validates and snapshots a batch, retaining per-row DEFAULT omissions. */
export function encodeInsert(data: { readonly table: TableDef; readonly rows: readonly Readonly<Record<string, unknown>>[] }): EncodedInsert {
  const { table, rows } = data;
  const fail: Fail = (code, path) => { throw new InsertValidationError(code, table.name, undefined, path); };
  if (Array.isArray(rows) && rows.length === 0) return { table: table.name, columns: [], rows: [] };
  const input = array(rows, fail);
  const hidden = new Set(table.hiddenColumns ?? []);
  const columns = Object.keys(table.columns).filter(name => !hidden.has(name) && !['ALIAS', 'MATERIALIZED'].includes(Object.hasOwn(table.columnMetadata ?? {}, name) ? table.columnMetadata![name]!.defaultKind ?? '' : ''));
  if (columns.length === 0) return fail('NO_WRITABLE_COLUMNS');
  const writable = new Set(columns);
  const defaults = new Set(columns.filter(name => Object.hasOwn(table.columnMetadata ?? {}, name) && table.columnMetadata![name]!.defaultKind === 'DEFAULT'));
  const supportedColumns = new Set(columns.filter(name => supported(table.columns[name]!)));
  for (const name of columns) if (!defaults.has(name) && !supportedColumns.has(name)) fail('UNSUPPORTED_TYPE', name);
  const encodedRows = input.map((row, index) => {
    const rowFail: Fail = (code, path) => { throw new InsertValidationError(code, table.name, index, path); };
    const descriptors = record(row, rowFail);
    for (const name of Object.keys(descriptors)) {
      if (!writable.has(name)) rowFail('NON_WRITABLE_COLUMN', name);
      if (!supportedColumns.has(name)) rowFail('UNSUPPORTED_TYPE', name);
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const name of columns) {
      if (!Object.hasOwn(descriptors, name)) {
        if (!defaults.has(name)) rowFail('MISSING_COLUMN', name);
      } else result[name] = encode(table.columns[name]!, descriptors[name]!.value, rowFail, name, new Set());
    }
    return result;
  });
  return { table: table.name, columns, rows: encodedRows };
}
