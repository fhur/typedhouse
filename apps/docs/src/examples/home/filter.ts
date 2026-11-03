import { col, from, table } from '@typedhouse/core';

const events = table(
  'events',
  { tenant: col.String, category: col.String, id: col.UInt32, amount: col.Float64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
export default from(events)
  .where(e => e.category.eq('purchase'))
  .map(e => ({ id: e.id, amount: e.amount }))
  .orderBy(e => e.amount.desc())
  .limit(10);
// #endregion
