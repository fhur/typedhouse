import { from, greatest, join, type Row } from '@chql/core';
import { cIndices, components, db, forTenant, isActive, latest, type ComponentRow } from './low-stock.js';

const inCategory = (path: string) => (c: Row<ComponentRow>) => c.category.startsWith(path);
const availability = from(db.metric_group_ots_component_market_availability);
const latestAvailability = latest(availability.final().where(forTenant('acme')));
const latestIndices = latest(cIndices.final().where(forTenant('acme')));
export const componentsLatest = join({
  c: components.where(forTenant('acme')).where(isActive).where(inCategory('Passives')),
  a: latestAvailability,
  i: latestIndices,
})
  .on(r => [r.c.entityId.eq(r.a.entityId), r.c.entityId.eq(r.i.entityId)])
  .map(r => ({
    entityId: r.c.entityId,
    category: r.c.category,
    stockTotal: r.a.market_stock_total,
    stockP50: r.a.market_stock_p50,
    leadDays: r.a.market_lead_time_p50_days,
    stockIndex: r.i.stock_index,
    asOf: greatest(r.a.effectiveAt, r.i.effectiveAt),
  }));
export const query = componentsLatest;
