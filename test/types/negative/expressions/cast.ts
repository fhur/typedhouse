import { from, table, col, val, cast, count, sum } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.map(() => cast(val(1), col.Float64)); // expect: TS2322 unnamed_expression
q.aggregate(g => ({ id: cast(g.id, col.Float64) })); // expect: TS2322 Type '"grouped"' is not assignable to type '"agg"'.
q.map(() => ({ id: cast(count(), col.Float64) })); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.aggregate(() => sum(cast(q.row.id, col.Float64))); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<Numeric | null>'.
