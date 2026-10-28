import { col } from '../columns.js';
import { defineFunction } from './define.js';
import type { CHType } from '../ch-type.js';
import type { Matcher } from './matchers.js';

/** Deliberately excludes Date32, DateTime and transparent wrappers. */
const weekInput: Matcher<Date> = Object.freeze({ match: (type: CHType) => {
  const t = type.kind === 'Nullable' ? type.inner : type;
  return (t.kind === 'scalar' && t.name === 'Date') ||
    (t.kind === 'DateTime64' && [0, 1, 2, 3].includes(t.precision));
} });
export const dates = [defineFunction({
  name: 'toStartOfWeek', args: [weekInput], returns: col.Date,
  deterministic: true, origin: 'typed', surface: 'week',
}).definition] as const;
