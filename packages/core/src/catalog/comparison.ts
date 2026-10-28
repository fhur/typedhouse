import { col } from '../columns.js';
import { defineFunction } from './define.js';
import { anyType } from './matchers.js';
const binary = [
  ['eq', 'equals'], ['ne', 'notEquals'], ['lt', 'less'], ['le', 'lessOrEquals'], ['gt', 'greater'], ['ge', 'greaterOrEquals'],
].map(([name, sqlName]) => defineFunction({ name: name!, sqlName: sqlName!, args: [anyType, anyType], returns: col.Bool, deterministic: true, origin: 'typed', surface: 'comparison' }).definition);
export const comparison = [...binary, ...['in', 'notIn'].map(name => defineFunction({
  name, args: [anyType, anyType], argumentPolicies: ['sibling', 'set'],
  returns: (args: readonly import('../ch-type.js').CHType[]) => args[0]?.kind === 'Nullable' ? { kind: 'Nullable' as const, inner: col.Bool.type } : col.Bool.type,
  tsReturns: 'Expr<NullResult<T, boolean>, N, M>', nullable: 'never', deterministic: true, origin: 'typed', surface: 'membership',
}).definition)];
