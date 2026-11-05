import { col, columnExpr, from, join, max, table, unionAll, type NodeId } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt64, cat: col.String, small: col.UInt32 }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] }));
const filtered = q.prewhere(r => r.id.gt(1n));
// Directly on a table scan, once, and scan modifiers come first.
q.where(r => r.id.gt(1n)).prewhere; // expect: TS2339 Property 'prewhere' does not exist
q.map(r => r.id).prewhere; // expect: TS2339 Property 'prewhere' does not exist
q.orderBy(r => r.id).prewhere; // expect: TS2339 Property 'prewhere' does not exist
q.limit(1).prewhere; // expect: TS2339 Property 'prewhere' does not exist
q.distinct().prewhere; // expect: TS2339 Property 'prewhere' does not exist
q.cte().prewhere; // expect: TS2339 Property 'prewhere' does not exist
q.limitBy(r => r.cat).take(1).prewhere; // expect: TS2339 Property 'prewhere' does not exist
join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id)).prewhere; // expect: TS2339 Property 'prewhere' does not exist
unionAll(q, q).prewhere; // expect: TS2339 Property 'prewhere' does not exist
filtered.prewhere; // expect: TS2339 Property 'prewhere' does not exist
filtered.final; // expect: TS2339 Property 'final' does not exist
filtered.sample; // expect: TS2339 Property 'sample' does not exist
filtered.insertMany; // expect: TS2339 Property 'insertMany' does not exist
// The predicate is a boolean row expression.
// Not a bigint: on TS 5.5 that would cache the failed relation and shorten query.ts's diagnostic.
q.prewhere(r => r.small); // expect: TS2322 is not assignable to type
q.prewhere(r => r.cat); // expect: TS2322 is not assignable to type
q.prewhere(() => true); // expect: TS2322 is not assignable to type
q.prewhere(r => r.id.asc()); // expect: TS2740 is missing the following properties // expect-ts7: TS2740 is missing the following properties
const grouped = columnExpr(col.UInt64, 1 as NodeId, ['id'], 'id', 'grouped');
q.prewhere(() => max(grouped).gt(1n)); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.prewhere(() => grouped.gt(1n)); // expect: TS2322 Type '"grouped"' is not assignable to type '"row"'.
q.prewhere(); // expect: TS2554 Expected 1 arguments
