import { col } from '../columns.js';
import { defineFunction } from './define.js';
import { anyType, unwrap, type Matcher } from './matchers.js';
/** The range envelope matches serializable comparison operands: no Decimal,
 * Enum/address strings, Date32/DateTime or sub-millisecond timestamps yet. */
const rangeInput: Matcher<number | bigint | string | Date> = { match: type => {
  const t = unwrap(type);
  return t.kind === 'FixedString' || (t.kind === 'DateTime64' && [0, 1, 2, 3].includes(t.precision)) ||
    (t.kind === 'scalar' && /^(U?Int(8|16|32|64|128|256)|Float(32|64)|String|Date)$/.test(t.name));
} };
const binary = [
  ['eq', 'equals'], ['ne', 'notEquals'], ['lt', 'less'], ['le', 'lessOrEquals'], ['gt', 'greater'], ['ge', 'greaterOrEquals'],
].map(([name, sqlName]) => defineFunction({ name: name!, sqlName: sqlName!, args: [anyType, anyType], returns: col.Bool, deterministic: true, origin: 'typed', surface: 'comparison' }).definition);
export const comparison = [...binary, defineFunction({
  name: 'between', args: [rangeInput, rangeInput, rangeInput], returns: col.Bool,
  deterministic: true, origin: 'typed', surface: 'between',
}).definition, ...['in', 'notIn'].map(name => defineFunction({
  name, args: [anyType, anyType], argumentPolicies: ['sibling', 'set'],
  returns: (args: readonly import('../ch-type.js').CHType[]) => args[0]?.kind === 'Nullable' ? { kind: 'Nullable' as const, inner: col.Bool.type } : col.Bool.type,
  tsReturns: 'Expr<NullResult<T, boolean>, N, M>', nullable: 'never', deterministic: true, origin: 'typed', surface: 'membership',
}).definition)];
