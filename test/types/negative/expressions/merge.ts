import { sumMerge, type Grouped, type AggregateState } from '@chql/core';
declare const x: Grouped<AggregateState<'max'>, 'x'>;
sumMerge(x); // expect: TS2345 Argument of type 'Grouped<AggregateState<"max">, "x">' is not assignable
