import type { CHType } from '../ch-type.js';
import { col } from '../columns.js';
import type { Definition } from './define.js';
import { anyType, arrayOf, numeric, tupleLike, unwrap, byteString } from './matchers.js';
function arrayElement(args: readonly CHType[]): CHType {
  const array = args[0] && unwrap(args[0]);
  if (array?.kind !== 'Array') throw new Error('arrayElement requires Array');
  return array.inner;
}
function field(type: CHType, key: unknown): CHType {
  const t = unwrap(type);
  if (t.kind === 'Array') return { kind: 'Array', inner: field(t.inner, key) };
  if (t.kind !== 'Tuple' || typeof key !== 'string' || !t.items.every(item => item.name !== undefined)) throw new Error('element requires named Tuple and primitive selector');
  const item = t.items.find(item => item.name === key);
  if (!item) throw new Error(`Unknown tuple field: ${key}`);
  return item.type;
}
export const arrays: readonly Definition[] = Object.freeze([
  { name: 'has', args: [arrayOf(anyType), anyType], argumentPolicies: ['sibling', 'arrayElement'], returns: col.Bool, nullable: 'never', surface: 'has', deterministic: true, origin: 'typed' },
  { name: 'hasAny', args: [arrayOf(anyType), arrayOf(anyType)], argumentPolicies: ['sibling', 'array'], returns: col.Bool, nullable: 'never', surface: 'hasAny', deterministic: true, origin: 'typed' },
  { name: 'arrayElement', args: [arrayOf(anyType), numeric], argumentPolicies: ['sibling', 'numericIndex'], returns: arrayElement, tsReturns: 'ArrayElementResult<T, N, M, D>', nullable: 'never', surface: 'arrayElement', deterministic: true, origin: 'typed' },
  { name: 'element', sqlName: 'tupleElement', args: [tupleLike, byteString], argumentPolicies: ['sibling', 'constantSelector'], returns: (args, values) => field(args[0]!, values[1]), tsReturns: 'ElementResult<N, M, D, K>', nullable: 'never', surface: 'element', deterministic: true, origin: 'typed' },
]);
