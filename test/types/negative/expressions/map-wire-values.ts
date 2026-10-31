import { col, type Infer } from '@typedhouse/core';
const descriptor = col.Map(col.UInt64, col.Int64);
declare const value: Infer<typeof descriptor>;
const integer: bigint = value['42']; // expect: TS2322 Type 'unknown' is not assignable to type 'bigint'.
const pairs: Array<[bigint, bigint]> = value; // expect: TS2740 is missing the following properties from type
const dates = col.Map(col.String, col.Date);
declare const dateValues: Infer<typeof dates>;
const date: Date = dateValues['x']; // expect: TS2322 Type 'unknown' is not assignable to type 'Date'.
