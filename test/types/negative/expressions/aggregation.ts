import { from, table, col, val, count, sum } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.groupBy(r => r.id).where; // expect: TS2339 Property 'where' does not exist
q.groupBy(r => r.id).map; // expect: TS2339 Property 'map' does not exist
q.groupBy(() => val(1, col.UInt8)); // expect: TS2322 unnamed_expression
q.groupBy(r => r.id).aggregate(g => sum(g.id)); // expect: TS2322 duplicate_column
q.aggregate(g => ({ id: g.id })); // expect: TS2322 Type '"grouped"' is not assignable to type '"agg"'.
q.aggregate(() => ({ id: q.row.id })); // expect: TS2322 Type '"row"' is not assignable to type '"agg"'.
q.aggregate(() => sum(count())); // expect: TS2345 Type '"agg"' is not assignable to type '"grouped"'.
q.aggregate(g => sum(g.id).plus(g.id)); // expect: TS2769 Type '"grouped"' is not assignable to type '"agg"'. // expect-ts7: TS2769 ExprOperand<bigint | null, string, "agg">
