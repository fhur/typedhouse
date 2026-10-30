import { from, table, col, columnExpr } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt32, names: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.where(r => r.id.eq(1)).final(); // expect: TS2339 Property 'final' does not exist
q.map(r => r.id).sample(0.1); // expect: TS2339 Property 'sample' does not exist
q.limit(1).final(); // expect: TS2339 Property 'final' does not exist
q.distinct().sample(0.1); // expect: TS2339 Property 'sample' does not exist
q.orderBy(r => r.id).final(); // expect: TS2339 Property 'final' does not exist
q.arrayJoin(r => r.names, 'name').final(); // expect: TS2339 Property 'final' does not exist
q.leftArrayJoin(r => r.names, 'name').thenBy(); // expect: TS2339 Property 'thenBy' does not exist
q.arrayJoin(r => r.id, 'item'); // expect: TS2322 Type 'number' is not assignable to type 'readonly unknown[]'.
q.arrayJoin(r => r.names, 'id'); // expect: TS2345 Argument of type '"id"' is not assignable
const grouped = columnExpr(col.Array(col.String), q.ir.id, ['names'], 'names', 'grouped');
q.arrayJoin(() => grouped, 'item'); // expect: TS2322 Type '"grouped"' is not assignable to type '"row"'.
