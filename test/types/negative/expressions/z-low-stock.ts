import { col, columnExpr, exp, uniq, sum, type NodeId } from '@chql/core';
const id = 1 as NodeId;
const text = columnExpr(col.String, id, ['text'], 'text', 'row');
const n = columnExpr(col.Float64, id, ['n'], 'n', 'row');
const grouped = columnExpr(col.Float64, id, ['n'], 'n', 'grouped');
const wide = columnExpr(col.UInt128, id, ['wide'], 'wide', 'row');
const wrapped = columnExpr(col.LowCardinality(col.String), id, ['wrapped'], 'wrapped', 'grouped');
exp(text); // expect: TS2345 parameter of type 'Expr<number | bigint | null, string, Mode>'
exp(wide); // expect: TS2345 parameter of type 'never'
text.exp(); // expect: TS2684 method's 'this' of type 'never'
wide.exp(); // expect: TS2684 method's 'this' of type 'never'
uniq(text); // expect: TS2345 parameter of type 'AggregateOperand<string | null>'
uniq(grouped); // expect: TS2345 parameter of type 'AggregateOperand<string | null>'
uniq(wrapped); // expect: TS2345 parameter of type 'never'
n.divide(grouped.plus(1)); // expect: TS2769 ExprOperand<number | null, string, "row">
sum(grouped).divide(grouped.plus(1)); // expect: TS2769 ExprOperand<number | null, string, "agg">
n.plus('wrong'); // expect: TS2769 Argument of type 'string' is not assignable // expect-ts7: TS2769 Argument of type '"wrong"' is not assignable
