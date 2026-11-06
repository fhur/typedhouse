import { asofJoin, asofLeftJoin, col, from, join, table } from '@typedhouse/core';
const trades = from(table('trades', { id: col.UInt32, sym: col.String, ts: col.DateTime('UTC') }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const quotes = from(table('quotes', { sym: col.String, ts: col.DateTime('UTC'), bid: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const on = asofJoin({ t: trades }, { q: quotes }).on(r => r.t.sym.eq(r.q.sym));
on.where; // expect: TS2339 Property 'where' does not exist on type 'AsofJoinPending
on.map; // expect: TS2339 Property 'map' does not exist on type 'AsofJoinPending
on.toSQL; // expect: TS2339 Property 'toSQL' does not exist on type 'AsofJoinPending
on.run; // expect: TS2339 Property 'run' does not exist on type 'AsofJoinPending
on.ir; // expect: TS2339 Property 'ir' does not exist on type 'AsofJoinPending
asofJoin({ t: trades }, { q: quotes }).asof; // expect: TS2339 Property 'asof' does not exist on type 'AsofJoinBuilder
asofJoin({ t: trades }, { q: quotes }).map; // expect: TS2339 Property 'map' does not exist on type 'AsofJoinBuilder
on.asof(r => r.t.ts.ge(r.q.ts)).asof; // expect: TS2339 Property 'asof' does not exist on type 'JoinQuery
on.on; // expect: TS2339 Property 'on' does not exist on type 'AsofJoinPending
on.asof(r => [r.t.ts.ge(r.q.ts)]); // expect: TS2740 is missing the following properties from type 'Expr<boolean | null
asofJoin({ t: trades, u: trades }, { q: quotes }); // expect: TS2345 outer_join_arity
asofJoin({ t: trades }, { t: quotes }); // expect: TS2345 outer_join_alias
asofJoin({ t: trades }); // expect: TS2554 Expected 2 arguments, but got 1.
asofLeftJoin({ t: trades }, { q: quotes }, { u: trades }); // expect: TS2554 Expected 2 arguments, but got 3.
asofLeftJoin({ t: trades }, { q: quotes }).on(r => r.t.sym.eq(r.q.sym)).asof(r => r.t.ts.ge(r.q.ts)).map(r => ({ b: r.q.bid.toFixed(1) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
join({ a: on, b: quotes }); // expect: TS2739 Type 'AsofJoinPending
