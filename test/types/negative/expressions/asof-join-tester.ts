import { asofJoin, asofLeftJoin, col, from, table } from '@typedhouse/core';
const l = from(table('l', { id: col.UInt32, k: col.String, ts: col.DateTime('UTC') }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const r = from(table('r', { id: col.UInt32, k: col.String, ts: col.DateTime('UTC'), arr: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const pending = asofJoin({ t: l }, { q: r }).on(x => x.t.k.eq(x.q.k));
const query = pending.asof(x => x.t.ts.ge(x.q.ts));
pending.orderBy; // expect: TS2339 Property 'orderBy' does not exist on type 'AsofJoinPending
pending.limit; // expect: TS2339 Property 'limit' does not exist on type 'AsofJoinPending
pending.groupBy; // expect: TS2339 Property 'groupBy' does not exist on type 'AsofJoinPending
pending.caps; // expect: TS2339 Property 'caps' does not exist on type 'AsofJoinPending
pending._rowType; // expect: TS2339 Property '_rowType' does not exist on type 'AsofJoinPending
asofJoin({ t: l }, { q: r }).where; // expect: TS2339 Property 'where' does not exist on type 'AsofJoinBuilder
asofJoin({ t: l }, { q: r }).toSQL; // expect: TS2339 Property 'toSQL' does not exist on type 'AsofJoinBuilder
query.on; // expect: TS2339 Property 'on' does not exist on type 'JoinQuery
pending.asof(x => x.t.nope.ge(x.q.ts)); // expect: TS2339 Property 'nope' does not exist on type
pending.asof(x => x.z.ts.ge(x.q.ts)); // expect: TS2339 Property 'z' does not exist on type
asofJoin({ t: l }, { q: r }).on(x => x.z.k.eq(x.q.k)); // expect: TS2339 Property 'z' does not exist on type
asofLeftJoin({ t: l }, { q: r }).on(x => x.t.k.eq(x.q.k)).asof(x => x.t.ts.ge(x.q.ts)).map(x => ({ n: x.q.arr.length() })).map(x => ({ bad: x.n.toFixed(1) })); // expect: TS2339 Property 'toFixed' does not exist on type
