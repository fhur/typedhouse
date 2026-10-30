import { defineFunction } from '@chql/core'; // expect: TS2305 has no exported member 'defineFunction'
import { defineAggregate } from '@chql/core'; // expect: TS2305 has no exported member 'defineAggregate'
import { extendExpr } from '@chql/core'; // expect: TS2305 has no exported member 'extendExpr'
import type { ExprMethods } from '@chql/core'; // expect: TS2305 has no exported member 'ExprMethods'
import type { DefinedFunction } from '@chql/core'; // expect: TS2305 has no exported member 'DefinedFunction'
import type { DefinedAggregate } from '@chql/core'; // expect: TS2305 has no exported member 'DefinedAggregate'
import type * as Core from '@chql/core';
type CustomMatcher = Core.Matcher; // expect: TS2694 has no exported member 'Matcher'
import type { UserFunctionContract } from '@chql/core'; // expect: TS2305 has no exported member 'UserFunctionContract'
