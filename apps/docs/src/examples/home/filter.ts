import { col, from, table } from '@typedhouse/core';

const orders = table(
  'orders',
  { id: col.UInt32, status: col.String, country: col.String, amount: col.Float64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
// The ten largest paid orders
export default from(orders)
  .where(o => o.status.eq('paid'))
  .map(o => ({ id: o.id, amount: o.amount }))
  .orderBy(o => o.amount.desc())
  .limit(10);
// #endregion
