import { col, columnExpr, val, type NodeId } from '@chql/core';
const array = columnExpr(col.Array(col.UInt64), 1 as NodeId, ['a'], 'a', 'grouped');
const tuple = columnExpr(col.Tuple({ field: col.String }), 1 as NodeId, ['t'], 't', 'grouped');
const row = columnExpr(col.UInt64, 1 as NodeId, ['r'], 'r', 'row');
array.has(1); // expect: TS2345 Argument of type 'number'
array.hasAny([1]); // expect: TS2322 Type 'number' is not assignable to type 'bigint'.
array.has(row); // expect: TS2345 Argument of type 'DescribedExpr<bigint
array.arrayElement('1'); // expect: TS2345 Argument of type 'string'
tuple.element('missing'); // expect: TS2345 Argument of type '"missing"'
row.length(); // expect: TS2684 The 'this' context
columnExpr(col.Decimal64(2), 1 as NodeId, ['d'], 'd', 'row').length(); // expect: TS2684 The 'this' context
columnExpr(col.DateTime64(9), 1 as NodeId, ['d'], 'd', 'row').startsWith('x'); // expect: TS2684 The 'this' context
columnExpr(col.Tuple([col.String]), 1 as NodeId, ['u'], 'u', 'row').element('0'); // expect: TS2345 is not assignable to parameter of type 'never'.
columnExpr(col.Enum8({ a: 1 }), 1 as NodeId, ['e'], 'e', 'row').length(); // expect: TS2684 The 'this' context
columnExpr(col.UUID, 1 as NodeId, ['u'], 'u', 'row').startsWith('x'); // expect: TS2684 The 'this' context
columnExpr(col.Map(col.String, col.String), 1 as NodeId, ['m'], 'm', 'row').element('field'); // expect: TS2345 is not assignable to parameter of type 'never'.
array.arrayElement(row); // expect: TS2345 Argument of type 'DescribedExpr<bigint
const key: string = 'field';
tuple.element(key); // expect: TS2345 Argument of type 'string'
const text = columnExpr(col.String, 1 as NodeId, ['text'], 'text', 'row');
text.startsWith(columnExpr(col.DateTime64(9), 1 as NodeId, ['timestamp'], 'timestamp', 'row')); // expect: TS2345 Argument of type 'DescribedExpr<string
text.startsWith(columnExpr(col.Decimal64(2), 1 as NodeId, ['decimal'], 'decimal', 'row')); // expect: TS2345 Argument of type 'DescribedExpr<Decimal
text.startsWith(columnExpr(col.Enum8({ a: 1 }), 1 as NodeId, ['enum'], 'enum', 'row')); // expect: TS2345 Argument of type 'DescribedExpr<
text.startsWith(columnExpr(col.Array(col.Tuple({ p: col.DateTime64(9) })), 1 as NodeId, ['a'], 'a', 'row').arrayElement(-1).element('p')); // expect: TS2345 Argument of type 'DescribedExpr<string
text.startsWith(val('a', col.Enum8({ a: 1 }))); // expect: TS2345 Argument of type 'DescribedConstant<
text.startsWith(columnExpr(col.String, 1 as NodeId, ['p'], 'p', 'grouped')); // expect: TS2345 Argument of type 'DescribedExpr<string
