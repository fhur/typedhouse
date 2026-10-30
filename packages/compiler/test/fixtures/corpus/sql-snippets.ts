import { col, from, sql } from '@typedhouse/core';
import { db } from './low-stock.js';

export const snippetDistance = from(db.entity_off_the_shelf_part).map(p => ({
  mpn: p.mpn,
  distance: sql`editDistance(${p.mpn}, ${'GRM155'})`.as(col.UInt64),
}));
