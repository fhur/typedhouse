import { from, table, col, scalar, count } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.cte().final(); // expect: TS2339 Property 'final' does not exist
q.cte().sample(0.1); // expect: TS2339 Property 'sample' does not exist
q.orderBy(r => r.id).cte().thenBy; // expect: TS2339 Property 'thenBy' does not exist
scalar(q.aggregate(() => count()).cte()); // expect: TS2345 Types of property 'ir' are incompatible
