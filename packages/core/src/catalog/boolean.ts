import { col } from '../columns.js';
import { defineFunction } from './define.js';
import { boolean as bool } from './matchers.js';
export const booleans = [
  ...['and', 'or'].map(name => defineFunction({ name, args: [bool, bool], returns: col.Bool, deterministic: true, origin: 'typed', surface: 'boolean' }).definition),
  defineFunction({ name: 'not', args: [bool], returns: col.Bool, deterministic: true, origin: 'typed', surface: 'not' }).definition,
];
