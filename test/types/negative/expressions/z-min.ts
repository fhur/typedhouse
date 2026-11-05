import { from, table, col, min, minIf, val } from '@typedhouse/core';
const q = from(table('t', { n: col.UInt32, v: col.Nullable(col.UInt32), text: col.String, flag: col.Bool }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
min(); // expect: TS2554 Expected 1 arguments, but got 0.
q.aggregate(g => minIf(g.n)); // expect: TS2554 Expected 2 arguments, but got 1.
q.aggregate(g => min(g.n, g.n)); // expect: TS2554 Expected 1 arguments, but got 2.
q.aggregate(() => min(q.row.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<unknown>'.
q.aggregate(g => min(min(g.n))); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<unknown>'.
q.aggregate(g => minIf(g.n, g.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.aggregate(g => minIf(g.n, g.text)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.aggregate(g => minIf(g.n, q.row.n.gt(0))); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.map(() => min(val(1))); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
