import { col, sum, sumIf, val, type Expr } from '@typedhouse/core';
declare const value: Expr<bigint, 'value'>;
declare const predicate: Expr<boolean, 'predicate'>;
sum(value.as(col.UInt64)); // expect: TS2345 Argument of type 'DescribedExpr<bigint, "value", "row", { readonly kind: "scalar"; readonly name: "UInt64"; }>' is not assignable
sumIf(val(1n).as(col.UInt64), predicate.as(col.Bool)); // expect: TS2345 Argument of type 'DescribedExpr<boolean, "predicate", "row", { readonly kind: "scalar"; readonly name: "Bool"; }>' is not assignable
