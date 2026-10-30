import { col, columnExpr, dateDiff, multiIf, now, val, type Expr, type Mode, type NodeId } from '@chql/core';
const id = 1 as NodeId;
const day = columnExpr(col.DateTime64(3), id, ['d'], 'd', 'row');
const ok = columnExpr(col.Bool, id, ['ok'], 'ok', 'row');
const group = columnExpr(col.Bool, id, ['ok'], 'ok', 'grouped');
const nullable = columnExpr(col.Nullable(col.String), id, ['s'], 's', 'row');
const erased: Expr<Date, 'd'> = day;
dateDiff('hour', day, now()); // expect: TS2345 '"day"'
dateDiff('day', erased, now()); // expect: TS2345 Temporal
dateDiff('day', new Date(), now()); // expect: TS2345 Temporal
dateDiff('day', val(new Date()), now()); // expect: TS2345 Temporal
dateDiff('day', columnExpr(col.Nullable(col.Date), id, ['d'], 'd', 'row'), now()); // expect: TS2345 Temporal
dateDiff('day', columnExpr(col.DateTime64(9), id, ['d'], 'd', 'row'), now()); // expect: TS2345 Temporal
dateDiff('day', day, columnExpr(col.Date, id, ['d'], 'd', 'grouped')); // expect: TS2345 never
now('UTC'); // expect: TS2554 Expected 0 arguments
multiIf(); // expect: TS2345 never
multiIf([ok, 1], 'no'); // expect: TS2345 never
multiIf([ok, nullable], 'no'); // expect: TS2345 never
multiIf([ok, 'yes'], null); // expect: TS2345 never
multiIf([true, 'yes'], 'no'); // expect: TS2345 never
multiIf([ok, 'yes'] as const, [group, 'no'] as const, 'other'); // expect: TS2345 never
const open: [readonly [typeof ok, string], ...[typeof ok, string][], string] = [[ok, 'yes'], 'no'];
multiIf(...open); // expect: TS2345 never
const optional: [readonly [typeof ok, string], string?] = [[ok, 'yes']];
multiIf(...optional); // expect: TS2345 never
const union: [readonly [typeof ok, string], string] | [readonly [typeof group, string], string] = Math.random() ? [[ok, 'yes'], 'no'] : [[group, 'yes'], 'no'];
multiIf(...union); // expect: TS2345 never
function genericMode<M extends Mode>(condition: Expr<boolean, 'ok', M>) {
  multiIf([condition, 'yes'], 'no'); // expect: TS2345 Single
}
const groupText = columnExpr(col.String, id, ['s'], 's', 'grouped');
multiIf([ok, groupText] as const, 'no'); // expect: TS2345 never
const mixedBranch = Math.random() ? 'string' : groupText;
multiIf([ok, mixedBranch] as const, 'no'); // expect: TS2345 never
multiIf([ok, val('unproven')] as const, 'no'); // expect: TS2345 never
const optionalPair: readonly [typeof ok, string?] = [ok];
multiIf(optionalPair, 'no'); // expect: TS2345 never
function genericTuple<A extends readonly [readonly [typeof ok, string], ...[typeof ok, string][], string]>(args: A) {
  multiIf(...args); // expect: TS2345 Fixed
}
