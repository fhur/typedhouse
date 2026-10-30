import { from, table, col, quantile, quantileIf, val, scalar } from '@typedhouse/core';
const q = from(table('t', { n: col.UInt32, lc: col.LowCardinality(col.UInt32), date: col.Date, decimal: col.Decimal64(2), text: col.String, flag: col.Bool }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
quantile(); // expect: TS2554 Expected 1 arguments, but got 0.
quantile('0.5'); // expect: TS2345 is not assignable to parameter of type 'number'.
quantile(val(0.5)); // expect: TS2345 is not assignable to parameter of type 'number'.
quantile(q.row.n); // expect: TS2345 is not assignable to parameter of type 'number'.
quantile(scalar(q.aggregate(g => quantile(0.5)(g.n)))); // expect: TS2345 is not assignable to parameter of type 'number'.
q.aggregate(() => quantile(0.5)()); // expect: TS2554 Expected 1 arguments, but got 0.
q.aggregate(g => quantile(0.5)(g.lc)); // expect: TS2345 is not assignable to parameter of type 'never'.
q.aggregate(g => quantile(0.5)(g.date)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => quantile(0.5)(g.decimal)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => quantile(0.5)(g.text)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(() => quantile(0.5)(q.row.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => quantile(0.5)(quantile(0.5)(g.n))); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<number | bigint | null>'.
q.aggregate(g => quantileIf(0.5)(g.n, g.n)); // expect: TS2345 is not assignable to parameter of type 'AggregateOperand<boolean | null>'.
q.map(() => quantile(0.5)(val(1))); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
