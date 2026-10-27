import { print, type CHType, type FlatColumns } from '@chql/core';
export function decoder(type: CHType): (value: unknown) => unknown {
  const invalid = (value: unknown): never => { throw new Error(`decode_invalid: ${print(type)}: ${String(value)}`); };
  if (type.kind === 'Nullable') { const inner = decoder(type.inner); return v => v === null ? null : inner(v); }
  if (type.kind === 'LowCardinality') return decoder(type.inner);
  if (type.kind === 'scalar' && type.name === 'String') return v => typeof v === 'string' ? v : invalid(v);
  if (type.kind === 'scalar' && type.name === 'UInt64') return v => {
    if (typeof v !== 'string' || !/^\d+$/.test(v)) return invalid(v);
    const n = BigInt(v); return n < 1n << 64n ? n : invalid(v);
  };
  if (type.kind === 'DateTime64' && type.precision <= 3) return v => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)) return invalid(v);
    const day = new Date(`${v.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== v.slice(0, 10) || Number(v.slice(11, 13)) >= 24) return invalid(v);
    const date = new Date(v); return Number.isFinite(date.getTime()) ? date : invalid(v);
  };
  throw new Error(`decode_unsupported: ${print(type)}`);
}
export function rowDecoder(columns: FlatColumns): (row: unknown) => Record<string, unknown> {
  const entries = Object.entries(columns).map(([name, type]) => [name, decoder(type)] as const);
  return row => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('decode_invalid_row');
    return Object.fromEntries(entries.map(([name, decode]) => {
      if (!Object.hasOwn(row, name)) throw new Error(`decode_missing_column: ${name}`);
      return [name, decode((row as Record<string, unknown>)[name])];
    }));
  };
}
