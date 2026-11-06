import { col, count, from, join, leftJoin, scalar, table, unionAll } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt64, cat: col.String }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] }));
const settled = q.settings({ max_threads: 1 });
const ids = q.map(r => r.id).settings({ max_threads: 1 });
const counted = q.aggregate(() => ({ c: count() })).settings({ max_threads: 1 });
// The result is terminal: every other method is absent.
settled.where; // expect: TS2339 Property 'where' does not exist
settled.limit; // expect: TS2339 Property 'limit' does not exist
settled.settings; // expect: TS2339 Property 'settings' does not exist
settled.map; // expect: TS2339 Property 'map' does not exist
settled.orderBy; // expect: TS2339 Property 'orderBy' does not exist
settled.groupBy; // expect: TS2339 Property 'groupBy' does not exist
settled.aggregate; // expect: TS2339 Property 'aggregate' does not exist
settled.count; // expect: TS2339 Property 'count' does not exist
settled.distinct; // expect: TS2339 Property 'distinct' does not exist
settled.cte; // expect: TS2339 Property 'cte' does not exist
settled.limitBy; // expect: TS2339 Property 'limitBy' does not exist
settled.row; // expect: TS2339 Property 'row' does not exist
// It is not a query input.
join({ a: settled, b: q }); // expect: TS2741 Property 'row' is missing
leftJoin({ a: q }, { b: ids }); // expect: TS2741 Property 'row' is missing
unionAll(settled, q); // expect: TS2345 is not assignable to parameter // expect-ts7: TS2741 Property 'row' is missing
unionAll(q, settled); // expect: TS2345 is not assignable to parameter
q.where(r => r.id.in(ids)); // expect: TS2769 No overload matches this call
scalar(counted); // expect: TS2345 is not assignable to parameter
// Only the allowlist, with the type each key takes.
q.settings({ join_algorithm: 'hash' }); // expect: TS2353 Object literal may only specify known properties
q.settings({ limit: 2 }); // expect: TS2353 Object literal may only specify known properties
q.settings({ final: 1 }); // expect: TS2353 Object literal may only specify known properties
q.settings({ join_use_nulls: 0 }); // expect: TS2353 Object literal may only specify known properties
q.settings({ date_time_output_format: 'simple' }); // expect: TS2353 Object literal may only specify known properties
q.settings({ max_threads: '2' }); // expect: TS2322 is not assignable to type
q.settings({ max_threads: undefined }); // expect: TS2379 is not assignable to parameter
q.settings({ max_execution_time: 1n }); // expect: TS2322 is not assignable to type
q.settings({ log_comment: 1 }); // expect: TS2322 is not assignable to type
q.settings(); // expect: TS2554 Expected 1 arguments
// A grouped query has no result yet.
q.groupBy(r => r.cat).settings; // expect: TS2339 Property 'settings' does not exist
