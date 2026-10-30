import { from, table, col, scalar, count, sum } from '@typedhouse/core';
const q = from(table('s', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
scalar(q); // expect: TS2345 Types of property 'ir' are incompatible
scalar(q.groupBy(r => r.id).aggregate(() => count())); // expect: TS2345 Types of property 'ir' are incompatible
scalar(q.aggregate(() => ({ a: count(), b: count() }))); // expect: TS2345 scalar_column_count
scalar(q.aggregate(() => count()).limit(1)); // expect: TS2345 Types of property 'ir' are incompatible
q.aggregate(() => ({ n: scalar(q.aggregate(() => count())) })); // expect: TS2322 "row"
q.aggregate(g => ({ n: sum(g.id).plus(scalar(q.aggregate(() => count()))) })); // expect: TS2769 ExprOperand<bigint | null, string, "agg">
