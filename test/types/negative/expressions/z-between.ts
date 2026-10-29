import { col, columnExpr, sum, val, type NodeId } from '@chql/core';
const id = 1 as NodeId;
const n = columnExpr(col.UInt32, id, ['n'], 'n', 'row');
const big = columnExpr(col.UInt64, id, ['big'], 'big', 'row');
const g = columnExpr(col.UInt32, id, ['n'], 'n', 'grouped');
const date = columnExpr(col.DateTime64(3), id, ['at'], 'at', 'row');
const precision = columnExpr(col.DateTime64(9), id, ['at'], 'at', 'row');
const decimal = columnExpr(col.Decimal64(2), id, ['d'], 'd', 'row');
const text = columnExpr(col.String, id, ['s'], 's', 'row');
big.between(1, 2n); // expect: TS2345 Argument of type '1' is not assignable
big.between(1n, 2); // expect: TS2345 Argument of type '2' is not assignable
n.between(big, 2); // expect: TS2345 ExprOperand<number | null, string, "row">
date.between('2026-01-01', new Date()); // expect: TS2345 Argument of type '"2026-01-01"' is not assignable
n.between(g, 3); // expect: TS2345 ExprOperand<number | null, string, "row">
g.between(1, n); // expect: TS2345 ExprOperand<number, string, "grouped">
sum(g).between(g, 3n); // expect: TS2345 ExprOperand<bigint | null, string, "agg">
precision.between('a', 'b'); // expect: TS2684 method's 'this' of type 'never'
decimal.between('a', 'b'); // expect: TS2684 method's 'this' of type 'never'
text.between(precision, 'b'); // expect: TS2345 parameter of type 'string'
n.between({ ...n }, 2); // expect: TS2345 Property 'brand' is missing
n.between(1, { ...val(2) }); // expect: TS2345 Property 'brand' is missing
const mixedDescriptor = Math.random() > 0.5 ? col.DateTime64(3) : col.DateTime64(9);
const mixed = columnExpr(mixedDescriptor, id, ['mixed'], 'mixed', 'row');
mixed.between(new Date(), new Date()); // expect: TS2684 method's 'this' of type 'never'
text.between('a', mixed); // expect: TS2345 parameter of type 'string | null'
