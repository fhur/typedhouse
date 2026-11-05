import { col, columnExpr, from, join, max, table, unionAll, type NodeId } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { createClient } from '@typedhouse/client';
const q = from(table('t', { id: col.UInt64, cat: col.String }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] }));
const client = createClient();
const pending = q.limitBy(r => r.cat);
const taken = pending.take(1);
const paged = taken.offset(1);
// The intermediate is not a query.
pending.where; // expect: TS2339 Property 'where' does not exist
pending.map; // expect: TS2339 Property 'map' does not exist
pending.limit; // expect: TS2339 Property 'limit' does not exist
pending.orderBy; // expect: TS2339 Property 'orderBy' does not exist
pending.ir; // expect: TS2339 Property 'ir' does not exist
pending.row; // expect: TS2339 Property 'row' does not exist
pending.toSQL; // expect: TS2339 Property 'toSQL' does not exist
pending.offset; // expect: TS2339 Property 'offset' does not exist
compile(pending); // expect: TS2345 is not assignable to parameter
client.run(pending); // expect: TS2345 is not assignable to parameter // expect-ts7: TS2739 is missing the following properties
join({ a: pending, b: q }); // expect: TS2739 is missing the following properties
unionAll(pending, q); // expect: TS2345 is not assignable to parameter // expect-ts7: TS2739 is missing the following properties
// take and offset each run once, in that order, directly after the previous step.
taken.take; // expect: TS2339 Property 'take' does not exist
paged.take; // expect: TS2339 Property 'take' does not exist
paged.offset; // expect: TS2339 Property 'offset' does not exist
taken.where(r => r.id.eq(1n)).offset; // expect: TS2339 Property 'offset' does not exist
taken.map(r => r.id).offset; // expect: TS2339 Property 'offset' does not exist
taken.limit(1).offset; // expect: TS2339 Property 'offset' does not exist
taken.orderBy(r => r.id).offset; // expect: TS2339 Property 'offset' does not exist
taken.distinct().offset; // expect: TS2339 Property 'offset' does not exist
taken.cte().offset; // expect: TS2339 Property 'offset' does not exist
// It is not a sort.
taken.thenBy; // expect: TS2339 Property 'thenBy' does not exist
paged.thenBy; // expect: TS2339 Property 'thenBy' does not exist
q.orderBy(r => r.id).limitBy(r => r.cat).take(1).thenBy; // expect: TS2339 Property 'thenBy' does not exist
// Keys are row expressions.
q.limitBy(r => r.cat.asc()); // expect: TS2322 is not assignable to type
const orderings = [q.row.cat.asc()];
q.limitBy(() => orderings); // expect: TS2322 is not assignable to type
const grouped = columnExpr(col.UInt64, 1 as NodeId, ['id'], 'id', 'grouped');
// Not count(): on TS 5.5 that would cache the failed relation and shorten ordering.ts's diagnostic.
q.limitBy(() => max(grouped)); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.limitBy(() => grouped); // expect: TS2322 Type '"grouped"' is not assignable to type '"row"'.
q.limitBy(() => 'cat'); // expect: TS2322 is not assignable to type
q.limitBy(() => 1); // expect: TS2322 is not assignable to type
q.limitBy(() => ({ cat: q.row.cat })); // expect: TS2322 is not assignable to type
q.limitBy(() => undefined); // expect: TS2322 is not assignable to type
q.limitBy(r => r.missing); // expect: TS2339 Property 'missing' does not exist
// Counts are numbers; bigint is not a limit.
pending.take(1n); // expect: TS2345 is not assignable to parameter
pending.take(); // expect: TS2554 Expected 1 arguments
taken.offset('1'); // expect: TS2345 is not assignable to parameter
taken.offset(); // expect: TS2554 Expected 1 arguments
