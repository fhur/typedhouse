import { col, columnExpr, maxMerge, sumState, val, type NodeId } from '@typedhouse/core';
const sumStateColumn = columnExpr(col.AggregateFunction('sum', col.Float64), 1 as NodeId, ['s'], 's', 'grouped');
maxMerge(sumStateColumn); // expect: TS2345 Argument of type 'DescribedExpr<AggregateState<"sum">
val([['1.25', null]], col.Map(col.Decimal64(2), col.Nullable(col.String))); // expect: TS2322 Type 'string' is not assignable to type 'Decimal<18, 2>'.
sumState(val('not numeric', col.String)); // expect: TS2345 Argument of type 'DescribedConstant<Column<string
val([{ id: 1 }], col.Array(col.Tuple({ id: col.UInt64 }))); // expect: TS2322 Type 'number' is not assignable to type 'bigint'.
val({ labels: { key: 1 } }, col.Tuple({ labels: col.Map(col.String, col.UInt64) })); // expect: TS2322 Type 'number' is not assignable to type 'bigint'.
