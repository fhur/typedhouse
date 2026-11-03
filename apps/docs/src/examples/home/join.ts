import { col, from, join, table } from '@typedhouse/core';

const events = table(
  'events',
  { tenant: col.String, id: col.UInt32, accountId: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);
const accounts = table(
  'accounts',
  { id: col.UInt32, name: col.String, plan: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

// #region example
const acme = from(events).where(e => e.tenant.eq('acme'));

export default join({ e: acme, a: from(accounts) })
  .on(r => r.e.accountId.eq(r.a.id))
  .map(r => ({ id: r.e.id, account: r.a.name, plan: r.a.plan }))
  .where(r => r.plan.eq('pro'));
// #endregion
