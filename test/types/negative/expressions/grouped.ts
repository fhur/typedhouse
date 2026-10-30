import { sum, type Expr } from '@typedhouse/core';
declare const x: Expr<bigint, 'x'>;
sum(x); // expect: TS2345 Argument of type 'Expr<bigint, "x", "row">' is not assignable
