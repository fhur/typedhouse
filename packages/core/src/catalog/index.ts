import { comparison } from './comparison.js';
import { booleans } from './boolean.js';
import { arithmetic } from './arithmetic.js';
import { nullHandling } from './null-handling.js';
export const methodCatalog = Object.freeze([...comparison, ...booleans, ...arithmetic, ...nullHandling]);
export * from './define.js';
export * from './matchers.js';
export * from './aggregate.js';
