import type { Expr } from '@chql/core';
declare const x: Expr<string, 'x'>;
x.multiply('x'); // expect: TS2769 The 'this' context
