import { from, join } from '@chql/core';
import { components, db, forTenant } from './low-stock.js';
const availability = from(db.metric_group_ots_component_market_availability);
/** Spec history example with its clock supplied explicitly for reproducible tests. */
export const stockHistory = (since: Date, until: Date, tenant = 'acme') => join({
  c: components.where(forTenant(tenant)).where(c => c.category.startsWith('Passives/Capacitors')),
  a: availability.final().where(forTenant(tenant)).where(a => a.effectiveAt.between(since, until)),
})
  .on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ entityId: r.c.entityId, at: r.a.effectiveAt, version: r.a.version, stock: r.a.market_stock_total }))
  .orderBy(r => r.entityId.asc()).thenBy(r => r.at.asc()).thenBy(r => r.version.asc());
