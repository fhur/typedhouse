import { from, table, col, crossJoin } from '@chql/core';
const q = from(table('t', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
crossJoin({ a: q }); // expect: TS2345 join_input_count
const empty = {};
crossJoin(empty); // expect: TS2345 join_input_count // expect-ts7: TS2741 Property 'join_input_count' is missing
crossJoin({ a: q, b: q }).on; // expect: TS2339 Property 'on' does not exist
crossJoin({ a: q, b: q }).map(r => ({ side: r.a })); // expect: TS2769 is missing the following properties from type 'Expr<
