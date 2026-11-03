import { col, from, table } from '@typedhouse/core';

const orders = table(
  'orders',
  { id: col.UInt32, status: col.String, country: col.String, amount: col.Float64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
// Define a rule once, reuse it in every report
const paid = from(orders).where(o => o.status.eq('paid'));

export default paid
  .where(o => o.country.eq('DE'))
  .map(o => ({ id: o.id, amount: o.amount }));
// #endregion
