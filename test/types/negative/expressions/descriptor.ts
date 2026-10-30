import { val, col } from '@typedhouse/core';
val(null, col.String); // expect: TS2345 Argument of type 'null' is not assignable
