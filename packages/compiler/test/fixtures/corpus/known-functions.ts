import { col, from } from '@typedhouse/core';
import { db } from './low-stock.js';
import { fn, agg } from '../../../../codegen/test/snapshots/functions.js';
export const knownHash = from(db.entity_ots_component).map(c => ({ h: fn.cityHash64(c.entityId).as(col.UInt64) }));
export const knownUnique = from(db.entity_ots_component).aggregate(g => ({ n: agg.uniqExact(g.entityId).as(col.UInt64) }));
