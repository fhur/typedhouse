import { from, table, col, scalar, count } from '@chql/core';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.materialize().final(); // expect: TS2339 Property 'final' does not exist
q.materialize().sample(0.1); // expect: TS2339 Property 'sample' does not exist
q.orderBy(r => r.id).materialize().thenBy; // expect: TS2339 Property 'thenBy' does not exist
scalar(q.aggregate(() => count()).materialize()); // expect: TS2345 Types of property 'ir' are incompatible
