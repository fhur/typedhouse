import { from, table, col, avg, avgIf, val } from '@chql/core';
const q = from(table('t', { n: col.UInt32, text: col.String, lc: col.LowCardinality(col.UInt32), date: col.Date, decimal: col.Decimal64(2), array: col.Array(col.UInt32), flag: col.Bool }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.aggregate(() => avg()); // expect: TS2554 Expected 1 arguments, but got 0.
q.aggregate(g => avg(g.lc)); // expect: TS2345 is not assignable to parameter of type 'never'.
q.aggregate(g => avg(g.text)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => avg(g.decimal)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => avg(g.date)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => avg(g.array)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => avg(g.flag)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(() => avg(q.row.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => avg(avg(g.n))); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => avgIf(g.n, g.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.aggregate(g => avgIf(g.n, q.row.flag)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.map(() => avg(val(1))); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.aggregate(g => avg(g.n).plus(g.n)); // expect: TS2769 is not assignable to parameter of type 'Operand<number, "agg">'.
