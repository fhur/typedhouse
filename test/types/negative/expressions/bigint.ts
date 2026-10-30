import type { Expr } from '@typedhouse/core';
declare const x: Expr<bigint, 'x'>;
x.gt(3); // expect: TS2345 Argument of type '3' is not assignable
