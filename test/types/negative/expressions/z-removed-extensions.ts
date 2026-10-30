import { defineFunction } from '@typedhouse/core'; // expect: TS2305 has no exported member 'defineFunction'
import { defineAggregate } from '@typedhouse/core'; // expect: TS2305 has no exported member 'defineAggregate'
import { extendExpr } from '@typedhouse/core'; // expect: TS2305 has no exported member 'extendExpr'
import type { ExprMethods } from '@typedhouse/core'; // expect: TS2305 has no exported member 'ExprMethods'
import type { DefinedFunction } from '@typedhouse/core'; // expect: TS2305 has no exported member 'DefinedFunction'
import type { DefinedAggregate } from '@typedhouse/core'; // expect: TS2305 has no exported member 'DefinedAggregate'
import type * as Core from '@typedhouse/core';
type CustomMatcher = Core.Matcher; // expect: TS2694 has no exported member 'Matcher'
import type { UserFunctionContract } from '@typedhouse/core'; // expect: TS2305 has no exported member 'UserFunctionContract'
