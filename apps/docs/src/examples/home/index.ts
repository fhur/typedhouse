import type { ExampleDefinition } from '../../lib/examples';
import topPages from './top-pages';
import topPagesSource from './top-pages.ts?raw';
import filter from './filter';
import filterSource from './filter.ts?raw';
import compose from './compose';
import composeSource from './compose.ts?raw';
import join from './join';
import joinSource from './join.ts?raw';

/**
 * Homepage "How it compiles" examples, in tab order. Each file is self-contained and runs in the
 * playground unchanged. The first one is also the hero: it should sell the library at a glance
 * (a recognizable query, fluent syntax, values as parameters, a typed result).
 */
export const homeExamples: readonly ExampleDefinition[] = [
  {
    id: 'top-pages',
    label: 'Top pages',
    filename: 'top-pages.ts',
    query: topPages,
    source: topPagesSource,
    lead: 'Typed from the column to the result.',
    note: 'count() and uniq() return UInt64, so views and visitors arrive as bigint. The date you pass is sent as a typed Date parameter.',
  },
  {
    id: 'filter',
    label: 'Filter & sort',
    filename: 'largest-orders.ts',
    query: filter,
    source: filterSource,
    lead: 'Only what you map is selected.',
    note: 'The query reads two columns, so the SQL selects two columns. The optimizing compiler never emits SELECT *.',
  },
  {
    id: 'compose',
    label: 'Compose',
    filename: 'german-orders.ts',
    query: compose,
    source: composeSource,
    lead: 'Two queries, one SELECT.',
    note: 'Extending paid does not nest a subquery. The compiler merges both filters into a single WHERE clause.',
  },
  {
    id: 'join',
    label: 'Join',
    filename: 'enterprise-orders.ts',
    query: join,
    source: joinSource,
    lead: 'Business rules are just functions.',
    note: 'isEnterprise combines two expressions into one AND. You applied it after the join; the compiler pushed it into the customers subquery, so only matching customers reach the join.',
  },
];

export const heroExample = homeExamples[0]!;
