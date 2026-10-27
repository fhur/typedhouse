import { from, table, col, count } from '@chql/core';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.where(r => r.id); // expect: TS2322 Type 'bigint' is not assignable to type 'boolean | null'.
q.map(r => ({ nested: { id: r.id } })); // expect: TS2353 'id' does not exist in type 'Expr<unknown, string, "row">'.
q.where(() => count().eq(1n)); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.map(() => ({ n: count() })); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.live(); // expect: TS2339 Property 'live' does not exist
q.changes(); // expect: TS2339 Property 'changes' does not exist
