import { col } from '../columns.js';
import { defineFunction } from './define.js';
import { anyType } from './matchers.js';
export const comparison = [
  ['eq', 'equals'], ['ne', 'notEquals'], ['lt', 'less'], ['le', 'lessOrEquals'], ['gt', 'greater'], ['ge', 'greaterOrEquals'],
].map(([name, sqlName]) => defineFunction({ name: name!, sqlName: sqlName!, args: [anyType, anyType], returns: col.Bool, deterministic: true, origin: 'typed', surface: 'comparison' }).definition);
