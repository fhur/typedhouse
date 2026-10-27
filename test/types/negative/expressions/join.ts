import { from, table, col, join, count } from '@chql/core';
const q = from(table('t', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
join({ a: q }); // expect: TS2345 join_input_count
const empty = {};
join(empty); // expect: TS2345 join_input_count // expect-ts7: TS2741 Property 'join_input_count' is missing
join({ a: q, b: q }).on(() => count().eq(1n).as(col.Bool)); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
join({ a: q, b: q }).on(r => r.a.id); // expect: TS2322 Type 'number' is not assignable to type 'boolean | null'.
join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ side: r.a })); // expect: TS2769 is missing the following properties from type 'Expr<
join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.eq(1)); // expect: TS2339 Property 'eq' does not exist
