import { from, table, col, leftJoin, rightJoin, fullJoin, join, type Query } from '@typedhouse/core';
// toFixed is on no Expr at all (Expr<number> lacks it too), so each expectation pins the receiver's `number | null`.
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const q = from(table('t', { id: col.UInt32, s: col.String, d: col.Decimal(9, 2), lc: col.LowCardinality(col.String), arr: col.Array(col.String) }, meta));
const lj = leftJoin({ a: q }, { b: q }).on(r => r.a.id.eq(r.b.id));
lj.map(r => ({ x: r.b.id.toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
const plain: Query<{ s: string }> = lj.map(r => ({ s: r.b.lc })); // expect: TS2322 s: string | null
const preserved: Query<{ s: string; arr: string[] }> = lj.map(r => ({ s: r.a.lc, arr: r.b.arr }));
rightJoin({ a: q }, { b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ x: r.a.id.toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
fullJoin({ a: q }, { b: join({ x: q, y: q }).on(r => r.x.id.eq(r.y.id)) }).on(r => r.a.id.eq(r.b.x.id)).map(r => ({ v: r.b.y.id.toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
leftJoin({ a: q }, { bc: leftJoin({ b: q }, { c: q }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.b.id)).map(r => ({ v: r.bc.b.id.toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
leftJoin({ a: q }, { b: q, c: q }); // expect: TS2345 outer_join_arity
fullJoin({ a: q, b: q }, { c: q }); // expect: TS2345 outer_join_arity
rightJoin({ a: q }, { a: q }); // expect: TS2345 outer_join_alias
void preserved;
