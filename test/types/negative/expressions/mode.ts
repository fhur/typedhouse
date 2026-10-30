import type { Expr, Grouped } from '@typedhouse/core';
declare const x: Expr<bigint, 'x'>;
declare const g: Grouped<bigint, 'g'>;
x.plus(g); // expect: TS2769 Argument of type 'Grouped<bigint, "g">' is not assignable
