import { col, columnExpr, greatest, max, val, type DescribedExpr, type Expr, type Mode, type NodeId } from '@typedhouse/core';
const id = 1 as NodeId;
const a = columnExpr(col.DateTime64(1), id, ['a'], 'a', 'row');
const b = columnExpr(col.DateTime64(3), id, ['b'], 'b', 'row');
const grouped = columnExpr(col.DateTime64(3), id, ['b'], 'b', 'grouped');
const nullable = columnExpr(col.Nullable(col.DateTime64(3)), id, ['b'], 'b', 'row');
const high = columnExpr(col.DateTime64(9), id, ['b'], 'b', 'row');
const utc = columnExpr(col.DateTime64(3, 'UTC'), id, ['b'], 'b', 'row');
const amsterdam = columnExpr(col.DateTime64(3, 'Europe/Amsterdam'), id, ['b'], 'b', 'row');
const erased: Expr<Date, 'a'> = a;
// Fixed-tuple evidence now fails closed to never when inference falls back to the open constraint.
greatest(); // expect: TS2345 parameter of type 'never'
greatest(a); // expect: TS2345 parameter of type 'never'
greatest(a, val(1)); // expect: TS2345 parameter of type 'never'
greatest(a, val('x')); // expect: TS2345 parameter of type 'never'
greatest(a, nullable); // expect: TS2345 parameter of type 'never'
greatest(a, high); // expect: TS2345 parameter of type 'never'
greatest(a, new Date()); // expect: TS2345 parameter of type 'never'
greatest(a, erased); // expect: TS2345 parameter of type 'never'
greatest(a, val(new Date())); // expect: TS2345 parameter of type 'never'
greatest(utc, amsterdam); // expect: TS2345 never
greatest(a, utc); // expect: TS2345 never
greatest(a, grouped); // expect: TS2345 never
greatest(grouped, a); // expect: TS2345 never
greatest(a, { ...b }); // expect: TS2345 parameter of type 'never'
const zone: string = 'UTC';
const dynamic = columnExpr(col.DateTime64(3, zone), id, ['b'], 'b', 'row');
greatest(dynamic, dynamic); // expect: TS2345 never
greatest(max(grouped), grouped); // expect: TS2345 never
greatest(a, max(grouped)); // expect: TS2345 never
const maybeZone = columnExpr(col.DateTime64(3, Math.random() > 0.5 ? 'UTC' : 'Europe/Amsterdam'), id, ['b'], 'b', 'row');
greatest(maybeZone, maybeZone); // expect: TS2345 never
const uncertainPrecision = columnExpr(col.DateTime64(Math.random() > 0.5 ? 1 : 3), id, ['b'], 'b', 'row');
greatest(uncertainPrecision, uncertainPrecision); // expect: TS2345 never
// Independent review reproducer: absent high-precision tail previously promised 3 at runtime 1.
const rest: [typeof a, typeof a, ...typeof b[]] = [a, a];
greatest(...rest); // expect: TS2345 never
const optional: [typeof a, typeof a, (typeof b)?] = [a, a];
greatest(...optional); // expect: TS2345 undefined
const restMode: [typeof a, typeof a, ...typeof grouped[]] = [a, a];
greatest(...restMode); // expect: TS2345 never
const restZone: [typeof a, typeof a, ...typeof utc[]] = [a, a];
greatest(...restZone); // expect: TS2345 never
const unionPrecision: [typeof a, typeof a] | [typeof b, typeof b] = Math.random() ? [a, a] : [b, b];
greatest(...unionPrecision); // expect: TS2345 never
const unionMode: [typeof a, typeof a] | [typeof grouped, typeof grouped] = Math.random() ? [a, a] : [grouped, grouped];
greatest(...unionMode); // expect: TS2345 never
const unionZone: [typeof utc, typeof utc] | [typeof amsterdam, typeof amsterdam] = Math.random() ? [utc, utc] : [amsterdam, amsterdam];
greatest(...unionZone); // expect: TS2345 never
const explicit = val(new Date(), col.DateTime64<3>(3, 'UTC'));
greatest(explicit, explicit); // expect: TS2345 never
const optionalZone = (zone?: string) => val(new Date(), col.DateTime64<3>(3, zone));
greatest(optionalZone(), optionalZone()); // expect: TS2345 TemporalType<3, string | undefined>
const widePrecision = val(new Date(), col.DateTime64<number>(3));
greatest(widePrecision, widePrecision); // expect: TS2345 parameter of type 'never'
const optionalLiteralZone = val(new Date(), col.DateTime64(3, Math.random() ? 'UTC' : undefined));
greatest(optionalLiteralZone, optionalLiteralZone); // expect: TS2345 never
const optionalMode: [typeof a, typeof a, (typeof grouped)?] = [a, a];
greatest(...optionalMode); // expect: TS2345 undefined
const optionalZoneTuple: [typeof a, typeof a, (typeof utc)?] = [a, a];
greatest(...optionalZoneTuple); // expect: TS2345 undefined
// Exact independent-review reproduction: identical pattern types need not mean identical values.
function patternedZones(first: `Etc/GMT+${number}`, second: `Etc/GMT+${number}`) {
  return greatest(val(new Date(0), col.DateTime64(3, first)), val(new Date(0), col.DateTime64(3, second))); // expect: TS2345 never
}
patternedZones('Etc/GMT+1', 'Etc/GMT+2');
patternedZones('Etc/GMT+1', 'Etc/GMT+1'); // Equal actual values still do not prove the parameter types singleton.
function bigintZones(zone: `Etc/GMT+${bigint}`) {
  const operand = val(new Date(0), col.DateTime64(3, zone));
  greatest(operand, operand); // expect: TS2345 never
}
function stringZones(zone: `Europe/${string}`) {
  const operand = val(new Date(0), col.DateTime64(3, zone));
  greatest(operand, operand); // expect: TS2345 never
}
function nestedZones(zone: `Prefix/${`Etc/GMT+${number}`}/Suffix`) {
  const operand = val(new Date(0), col.DateTime64(3, zone));
  greatest(operand, operand); // expect: TS2345 never
}
function patternUnion(zone: 'UTC' | `Etc/GMT+${number}`) {
  const operand = val(new Date(0), col.DateTime64(3, zone));
  greatest(operand, operand); // expect: TS2345 never
}
function optionalPattern(zone?: `Etc/GMT+${number}`) {
  const operand = val(new Date(0), col.DateTime64(3, zone));
  greatest(operand, operand); // expect: TS2345 never
}
function finiteZoneUnion(zone: `Etc/GMT+${1 | 2}`) {
  const operand = val(new Date(0), col.DateTime64(3, zone));
  greatest(operand, operand); // expect: TS2345 never
}
function unresolvedZone<const Z extends string>(zone: Z) {
  greatest(val(new Date(0), col.DateTime64(3, zone)), val(new Date(0), col.DateTime64(3, zone))); // expect: TS2345 Single<
}
function unresolvedPrecision<P extends 0 | 1 | 2 | 3>(operand: DescribedExpr<Date, 'a', 'row', { readonly kind: 'DateTime64'; readonly precision: P; readonly tz?: never }>) {
  greatest(operand, operand); // expect: TS2345 Single<P>
}
function unresolvedMode<M extends Mode>(operand: DescribedExpr<Date, 'a', M, { readonly kind: 'DateTime64'; readonly precision: 3; readonly tz?: never }>) {
  greatest(operand, operand); // expect: TS2345 Single<M>
}
function unproved<A extends [typeof a, typeof a, ...typeof b[]]>(operands: A) {
  greatest(...operands); // expect: TS2345 Fixed<A>
}
