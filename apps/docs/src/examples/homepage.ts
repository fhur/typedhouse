import { col, from, table } from '@typedhouse/core';

const events = table(
  'events',
  { tenant: col.String, category: col.String, id: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const base = from(events)
  .where(e => e.tenant.eq('acme'));
const query = base
  .where(e =>
    e.category.eq('purchase'))
  .map(e => ({ id: e.id }))
  .orderBy(e => e.id)
  .limit(10);

export default query;
