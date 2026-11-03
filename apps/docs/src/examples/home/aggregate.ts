import { col, count, from, sum, table } from '@typedhouse/core';

const events = table(
  'events',
  { tenant: col.String, category: col.String, id: col.UInt32, amount: col.Float64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
const acme = from(events).where(e => e.tenant.eq('acme'));

export default acme
  .groupBy(e => ({ category: e.category }))
  .aggregate(e => ({ total: count(), revenue: sum(e.amount) }))
  .orderBy(e => e.revenue.desc());
// #endregion
