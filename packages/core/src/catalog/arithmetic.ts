import type { CHType, ScalarName } from '../ch-type.js';
import { col } from '../columns.js';
import { defineFunction } from './define.js';
import { numeric, unwrap } from './matchers.js';
/** ClickHouse integer widths grow once up to 64 bits; large integers retain their width. */
export function promote(args: readonly CHType[]): CHType {
  const types = args.map(unwrap);
  const decimals = types.filter((t): t is Extract<CHType, { kind: 'Decimal' }> => t.kind === 'Decimal');
  if (decimals.length) {
    const precision = Math.max(...decimals.map(t => t.precision));
    return { kind: 'Decimal', precision: precision <= 9 ? 9 : precision <= 18 ? 18 : precision <= 38 ? 38 : 76, scale: Math.max(...decimals.map(t => t.scale)) };
  }
  const names = types.map(t => t.kind === 'scalar' ? t.name : 'Float64');
  if (names.some(n => n.startsWith('Float'))) return col.Float64.type;
  const bits = Math.max(...names.map(n => Number(n.replace(/\D/g, '')) || 64));
  return { kind: 'scalar', name: `${names.some(n => n.startsWith('Int')) ? 'Int' : 'UInt'}${bits < 64 ? bits * 2 : bits}` as ScalarName };
}
export const arithmetic = [
  ...['plus', 'minus', 'multiply'].map(name => defineFunction({ name, args: [numeric, numeric], returns: (args: readonly CHType[]) => {
    const result = promote(args);
    if (name === 'minus' && result.kind === 'scalar' && result.name.startsWith('UInt')) return { kind: 'scalar' as const, name: result.name.slice(1) as ScalarName };
    if (name === 'multiply' && result.kind === 'Decimal') return { ...result, scale: args.map(unwrap).reduce((sum, t) => sum + (t.kind === 'Decimal' ? t.scale : 0), 0) };
    return result;
  }, tsReturns: `ArithmeticResult<T, N, M, D, U, B, '${name}'>`, deterministic: true, origin: 'typed', surface: 'arithmetic' }).definition),
  defineFunction({ name: 'divide', args: [numeric, numeric], returns: (args: readonly CHType[]) => {
    const promoted = promote(args);
    const first = unwrap(args[0]!);
    return promoted.kind === 'Decimal' ? { ...promoted, scale: first.kind === 'Decimal' ? first.scale : 0 } : col.Float64.type;
  }, tsReturns: "ArithmeticResult<T, N, M, D, U, B, 'divide'>", deterministic: true, origin: 'typed', surface: 'divide' }).definition,
];
