import { col } from '../columns.js';
import { print, type CHType, type ScalarName } from '../ch-type.js';
import { defineFunction } from './define.js';
import { anyType, isNullable, nullable, unwrap } from './matchers.js';
/** Least common numeric type, not arithmetic promotion (which grows widths). */
function commonType(left: CHType, right: CHType): CHType {
  const a = unwrap(left), b = unwrap(right);
  if (print(a) === print(b)) return a;
  if (a.kind === 'scalar' && a.name === 'Nothing') return b;
  if (b.kind === 'scalar' && b.name === 'Nothing') return a;
  if (a.kind === 'scalar' && b.kind === 'scalar' && /^(U?Int|Float)/.test(a.name) && /^(U?Int|Float)/.test(b.name)) {
    const names = [a.name, b.name];
    const bits = names.map(n => Number(n.replace(/\D/g, '')));
    if (names.some(n => n.startsWith('Float'))) {
      const wide = names.some((n, i) => n === 'Float64' || (!n.startsWith('Float') && bits[i]! > 24));
      return { kind: 'scalar', name: wide ? 'Float64' : 'Float32' };
    }
    const signed = names.some(n => n.startsWith('Int'));
    const required = Math.max(...bits.map((n, i) => signed && names[i]!.startsWith('UInt') ? n + 1 : n));
    const width = [8, 16, 32, 64, 128, 256].find(n => n >= required);
    if (width) return { kind: 'scalar', name: `${signed ? 'Int' : 'UInt'}${width}` as ScalarName };
  }
  // Unsupported common types remain explicit, never a guessed first-operand type.
  return { kind: 'Unknown', raw: `common(${print(a)}, ${print(b)})` };
}
export const nullHandling = [
  ...['isNull', 'isNotNull'].map(name => defineFunction({ name, args: [anyType], returns: col.Bool, nullable: 'never', deterministic: true, origin: 'typed', surface: 'nullTest' }).definition),
  defineFunction({ name: 'ifNull', args: [anyType, anyType], returns: (args: readonly CHType[]) => {
    const first = args[0]!;
    if (!isNullable(first)) return first;
    const fallback = args[1]!;
    const result = commonType(first, fallback);
    return isNullable(fallback) ? nullable(result) : result;
  }, tsReturns: 'IfNullResult<T, N, M, D, U, B>', nullable: 'never', deterministic: true, origin: 'typed', surface: 'ifNull' }).definition,
];
