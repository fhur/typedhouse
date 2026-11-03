import { col, from, table } from '@typedhouse/core';

const events = table(
  'events',
  { tenant: col.String, category: col.String, id: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
// A shared base query, reused by every report
const acme = from(events)
  .where(e => e.tenant.eq('acme'));

export default acme
  .where(e => e.category.eq('purchase'))
  .map(e => ({ id: e.id }));
// #endregion
