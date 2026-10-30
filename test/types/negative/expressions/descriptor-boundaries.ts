import { col, columnExpr, sum, sumMerge, type NodeId } from '@typedhouse/core';
const row = columnExpr(col.Float64, 1 as NodeId, ['stock'], 'stock', 'row');
sum(row); // expect: TS2345 Argument of type 'DescribedExpr<number, "stock", "row", { readonly kind: "scalar"; readonly name: "Float64"; }>' is not assignable
const wrongState = columnExpr(col.AggregateFunction('max', col.Float64), 1 as NodeId, ['state'], 'state', 'grouped');
sumMerge(wrongState); // expect: TS2345 Argument of type 'DescribedExpr<AggregateState<"max">, "state", "grouped", { readonly kind: "AggregateFunction"; readonly fn: "max"; readonly args: [{ readonly kind: "scalar"; readonly name: "Float64"; }]; }>' is not assignable
