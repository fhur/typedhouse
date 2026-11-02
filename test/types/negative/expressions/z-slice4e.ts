import { from, table, col, leftJoin } from '@typedhouse/core';
// Slice 4e: ifNull over LowCardinality(Nullable(T)) is T, so the result exposes T's methods only; a cross-family fallback stays rejected.
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const q = from(table('t', { id: col.UInt32, ls: col.LowCardinality(col.Nullable(col.String)), lu: col.LowCardinality(col.Nullable(col.UInt32)), lc: col.LowCardinality(col.String) }, meta));
q.map(r => ({ x: r.lu.ifNull(3).toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number, "lu"
q.map(r => ({ x: r.ls.ifNull(1) })); // expect: TS2769 No overload matches this call.
leftJoin({ a: q }, { b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ x: r.b.lc.ifNull(0) })); // expect: TS2769 No overload matches this call.
