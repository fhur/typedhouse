import type { ExampleDefinition } from '../../lib/examples';
import filter from './filter';
import filterSource from './filter.ts?raw';
import compose from './compose';
import composeSource from './compose.ts?raw';
import aggregate from './aggregate';
import aggregateSource from './aggregate.ts?raw';
import join from './join';
import joinSource from './join.ts?raw';

/** Homepage "How it compiles" examples, in tab order. Each file is self-contained and runs in the playground unchanged. */
export const homeExamples: readonly ExampleDefinition[] = [
  {
    id: 'filter',
    label: 'Filter & sort',
    filename: 'top-purchases.ts',
    query: filter,
    source: filterSource,
    lead: 'Only what you map is selected.',
    note: 'The query reads two columns, so the SQL selects two columns. The optimizing compiler never emits SELECT *.',
  },
  {
    id: 'compose',
    label: 'Compose',
    filename: 'purchases.ts',
    query: compose,
    source: composeSource,
    lead: 'Two queries, one SELECT.',
    note: 'Extending acme does not nest a subquery. The compiler merges both filters into a single WHERE clause.',
  },
  {
    id: 'aggregate',
    label: 'Aggregate',
    filename: 'by-category.ts',
    query: aggregate,
    source: aggregateSource,
    lead: 'Types follow ClickHouse.',
    note: 'count() returns UInt64, so total is a bigint in TypeScript. The tenant filter stays a WHERE, applied before grouping.',
  },
  {
    id: 'join',
    label: 'Join',
    filename: 'pro-events.ts',
    query: join,
    source: joinSource,
    lead: 'Filters move to where they are cheapest.',
    note: 'You filtered on plan after the join. The compiler pushed that filter into the accounts subquery, so fewer rows reach the join.',
  },
];

export const heroExample = homeExamples[1]!;
