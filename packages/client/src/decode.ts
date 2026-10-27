import { print, type CHType, type FlatColumns } from '@chql/core';
export function decoder(type: CHType): (value: unknown) => unknown {
  const invalid = (value: unknown): never => { throw new Error(`decode_invalid: ${print(type)}: ${String(value)}`); };
  if (type.kind === 'Nullable') { const inner = decoder(type.inner); return v => v === null ? null : inner(v); }
  if (type.kind === 'LowCardinality') return decoder(type.inner);
  if (type.kind === 'Array') {
    const inner = decoder(type.inner);
    return v => Array.isArray(v) ? v.map(inner) : invalid(v);
  }
  if (type.kind === 'Tuple') {
    const items = type.items.map(item => ({ name: item.name, decode: decoder(item.type) }));
    const named = items.length > 0 && items.every(item => item.name !== undefined);
    return v => {
      if (named) {
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== items.length) return invalid(v);
        return Object.fromEntries(items.map(item => {
          if (!Object.hasOwn(v, item.name!)) return invalid(v);
          return [item.name!, item.decode((v as Record<string, unknown>)[item.name!])];
        }));
      }
      if (!Array.isArray(v) || v.length !== items.length) return invalid(v);
      return items.map((item, i) => item.decode(v[i]));
    };
  }
  if (type.kind === 'FixedString' || (type.kind === 'scalar' && type.name === 'String')) return v => typeof v === 'string' ? v : invalid(v);
  if (type.kind === 'scalar' && type.name === 'Bool') return v => v === true || v === 1 ? true : v === false || v === 0 ? false : invalid(v);
  if (type.kind === 'scalar' && /^U?Int(8|16|32|64|128|256)$/.test(type.name)) {
    const bits = Number(type.name.match(/\d+/)![0]);
    const unsigned = type.name.startsWith('U');
    const bound = 1n << BigInt(unsigned ? bits : bits - 1);
    return v => {
      if (bits >= 64 ? typeof v !== 'string' || !/^-?\d+$/.test(v) : typeof v !== 'number' || !Number.isSafeInteger(v)) return invalid(v);
      const n = BigInt(v as string | number);
      return n >= (unsigned ? 0n : -bound) && n < bound ? bits >= 64 ? n : Number(n) : invalid(v);
    };
  }
  if (type.kind === 'scalar' && (type.name === 'Float32' || type.name === 'Float64')) return v => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v === 'nan') return NaN;
    if (v === 'inf') return Infinity;
    if (v === '-inf') return -Infinity;
    return invalid(v);
  };
  if (type.kind === 'DateTime64' && type.precision <= 3) return v => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)) return invalid(v);
    const day = new Date(`${v.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== v.slice(0, 10) || Number(v.slice(11, 13)) >= 24) return invalid(v);
    const date = new Date(v); return Number.isFinite(date.getTime()) ? date : invalid(v);
  };
  throw new Error(`decode_unsupported: ${print(type)}`);
}
export function rowDecoder(columns: FlatColumns, paths?: Readonly<Record<string, readonly string[]>>): (row: unknown) => Record<string, unknown> {
  const entries = Object.entries(columns).map(([name, type]) => [name, decoder(type)] as const);
  return row => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('decode_invalid_row');
    const result: Record<string, unknown> = {};
    for (const [name, decode] of entries) {
      if (!Object.hasOwn(row, name)) throw new Error(`decode_missing_column: ${name}`);
      const path = paths?.[name] ?? [name];
      let target = result;
      for (const key of path.slice(0, -1)) {
        if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, { value: {}, enumerable: true });
        target = target[key] as Record<string, unknown>;
      }
      Object.defineProperty(target, path[path.length - 1]!, { value: decode((row as Record<string, unknown>)[name]), enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
}
