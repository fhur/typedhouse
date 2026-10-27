import { from, table, col, count } from '@chql/core';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.where(r => r.id); // expect: TS2322 Type 'bigint' is not assignable to type 'boolean | null'.
q.map(r => ({ nested: { id: r.id } })); // expect: TS2353 'id' does not exist in type 'Expr<unknown, string, "row">'.
q.where(() => count().eq(1n)); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.map(() => ({ n: count() })); // expect: TS2322 Type 'Expr<bigint, "count", "agg">' is not assignable to type 'Expr<unknown, string, "row">'.
q.live(); // expect: TS2339 Property 'live' does not exist
q.changes(); // expect: TS2339 Property 'changes' does not exist
const structural = from(table('s', { specs: col.Array(col.Tuple({ name: col.String })), ids: col.Array(col.UInt64) }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).map(r => ({ ...r })).limit(1);
structural.map(r => ({ missing: r.specs.element('missing') })); // expect: TS2345 Argument of type '"missing"' is not assignable to parameter of type '"name"'.
structural.where(r => r.ids.has(1)); // expect: TS2345 Argument of type 'number' is not assignable
structural.map(r => ({ n: r.specs.arrayElement('1') })); // expect: TS2345 Argument of type 'string' is not assignable
