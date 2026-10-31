import { from, table, col, leftJoin, rightJoin, fullJoin, type Query } from '@typedhouse/core';
const components = from(table('components', { entityId: col.String, tags: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const availability = from(table('availability', { entityId: col.String, market_stock_total: col.Float64, version: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
leftJoin({ c: components }, { a: availability }).on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ stock: r.a.market_stock_total.toFixed(2) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
const nullable: Query<{ entityId: string; stock: number }> = leftJoin({ c: components }, { a: availability }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ entityId: r.a.entityId, stock: r.a.market_stock_total.ifNull(0) })); // expect: TS2322 entityId: string | null
rightJoin({ a: availability }, { c: components }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ v: r.a.version.toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
fullJoin({ a: availability }, { c: components }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ tags: r.c.tags, n: r.a.market_stock_total.toFixed(1) })); // expect: TS2339 Property 'toFixed' does not exist on type 'DescribedExpr<number | null
leftJoin({ c: components, d: components }, { a: availability }); // expect: TS2345 outer_join_arity
leftJoin({ c: components }, {}); // expect: TS2345 outer_join_arity // expect-ts7: TS2741 Property 'outer_join_arity' is missing
leftJoin({ c: components }, { c: availability }); // expect: TS2345 outer_join_alias
rightJoin({ a: availability }, { c: components, d: components }); // expect: TS2345 outer_join_arity
fullJoin({ a: availability, c: components }); // expect: TS2554 Expected 2 arguments, but got 1.
leftJoin({ c: components }, { a: availability }, { d: components }); // expect: TS2554 Expected 2 arguments, but got 3.
leftJoin({ c: components }, { a: availability }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ v: r.a.version })).map(r => ({ v: r.v.toFixed(0) })); // expect: TS2339 Property 'toFixed' does not exist on type 'Expr<number | null
