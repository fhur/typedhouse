import { col } from '../columns.js';
import type { Definition } from './define.js';
import { byteString, stringOrArray } from './matchers.js';
export const strings: readonly Definition[] = Object.freeze([
  { name: 'length', args: [stringOrArray], returns: col.UInt64, surface: 'length', deterministic: true, origin: 'typed' },
  ...(['empty', 'notEmpty'] as const).map(name => ({ name, args: [stringOrArray], returns: col.Bool, surface: 'empty' as const, deterministic: true, origin: 'typed' as const })),
  { name: 'startsWith', args: [byteString, byteString], returns: col.Bool, surface: 'startsWith', deterministic: true, origin: 'typed' },
]);
