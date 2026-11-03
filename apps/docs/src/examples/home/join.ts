import { col, from, join, table, type Infer, type Row } from '@typedhouse/core';

const orders = table(
  'orders',
  { id: col.UInt32, status: col.String, customerId: col.UInt32, amount: col.Float64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);
const customers = table(
  'customers',
  { id: col.UInt32, name: col.String, plan: col.String, active: col.Bool },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
// A business rule is just a typed function
const isEnterprise = (c: Row<Infer<typeof customers>>) =>
  c.plan.eq('enterprise').and(c.active);

const paid = from(orders).where(o => o.status.eq('paid'));

export default join({ o: paid, c: from(customers) })
  .on(r => r.o.customerId.eq(r.c.id))
  .where(r => isEnterprise(r.c))
  .map(r => ({ order: r.o.id, customer: r.c.name }));
// #endregion
