import { from, table, col, join } from '@typedhouse/core';
// Slice 4f: hiddenColumns are shadow-only; a hidden name is never a row field, on a scan or a join side.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [], hiddenColumns: ['hidden'] } as const;
const q = from(table('xm', { id: col.UInt32, v: col.String }, meta));
q.map(r => ({ x: r.hidden })); // expect: TS2339 Property 'hidden' does not exist on type
join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ x: r.b.hidden })); // expect: TS2339 Property 'hidden' does not exist on type
q.where(r => r.hidden.gt(1)); // expect: TS2339 Property 'hidden' does not exist on type
