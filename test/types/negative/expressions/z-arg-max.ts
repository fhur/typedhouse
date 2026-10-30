import { from, table, col, argMax, argMaxIf, max, val } from '@typedhouse/core';
const q = from(table('t', { n: col.UInt32, v: col.Nullable(col.UInt32), text: col.String, lc: col.LowCardinality(col.String), date: col.Date, decimal: col.Decimal64(2), array: col.Array(col.UInt32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.aggregate(g => argMax(g.n)); // expect: TS2554 Expected 2 arguments, but got 1.
q.aggregate(g => argMax(g.n, g.v)); // expect: TS2345 is not assignable to parameter of type
q.aggregate(g => argMax(g.n, g.text)); // expect: TS2345 is not assignable to parameter of type
q.aggregate(g => argMax(g.lc, g.n)); // expect: TS2345 is not assignable to parameter of type 'never'.
q.aggregate(g => argMax(g.decimal, g.n)); // expect: TS2345 is not assignable to parameter of type 'never'.
q.aggregate(g => argMax(g.date, g.n)); // expect: TS2345 is not assignable to parameter of type 'ArgMaxValue'.
q.aggregate(g => argMax(g.array, g.n)); // expect: TS2345 is not assignable to parameter of type 'ArgMaxValue'.
q.aggregate(g => argMax(q.row.n, g.n)); // expect: TS2345 is not assignable to parameter of type 'ArgMaxValue'.
q.aggregate(g => argMax(g.n, max(g.n))); // expect: TS2345 Type '"agg"' is not assignable to type '"grouped"'. // expect-ts7: TS2345 is not assignable to parameter of type 'ArgMaxVersion'.
q.aggregate(g => argMaxIf(g.n, g.n, g.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.aggregate(g => argMaxIf(g.n, g.n, q.row.n.gt(0))); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.map(r => argMax(val(1), val(2))); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.aggregate(g => argMax(g.n, g.n).plus(g.n)); // expect: TS2769 Type '"grouped"' is not assignable to type '"agg"'. // expect-ts7: TS2769 ExprOperand<number | null, string, "agg">
