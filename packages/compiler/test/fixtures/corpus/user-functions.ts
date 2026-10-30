import { col, defineFunction, from, stringLike } from '@chql/core';
import { db } from './low-stock.js';
const editDistance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
const parts = from(db.entity_off_the_shelf_part);
export const userEditDistance = parts.map(p => ({ mpn: p.mpn, distance: editDistance(p.mpn, 'GRM155R61A104KA01D') }));
