import { expectTypeOf } from 'expect-type';
import { col, columnExpr, sum, val, type Decimal, type Expr, type NodeId } from '@typedhouse/core';

type Phantoms<E> = E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;
declare function phantoms<E>(value: E): Phantoms<E>;
const d = columnExpr(col.Decimal64(2), 1 as NodeId, ['d'], 'd', 'grouped');
const e = columnExpr(col.LowCardinality(col.Nullable(col.Decimal(19, 3))), 1 as NodeId, ['e'], 'e', 'grouped');
const added = d.plus(e);
expectTypeOf<Phantoms<typeof added>>().toEqualTypeOf<Expr<Decimal<38, 3> | null, 'd', 'grouped'>>();
expectTypeOf(added).not.toBeAny();
expectTypeOf(added.ir.type.inner.precision).toEqualTypeOf<38>();
expectTypeOf(added.ir.type.inner.scale).toEqualTypeOf<3>();
expectTypeOf(phantoms(d.minus(e))).toEqualTypeOf<Expr<Decimal<38, 3> | null, 'd', 'grouped'>>();
expectTypeOf(phantoms(d.multiply(e))).toEqualTypeOf<Expr<Decimal<38, 5> | null, 'd', 'grouped'>>();
expectTypeOf(phantoms(d.divide(e))).toEqualTypeOf<Expr<Decimal<38, 2> | null, 'd', 'grouped'>>();
expectTypeOf(phantoms(e.divide(d))).toEqualTypeOf<Expr<Decimal<38, 3> | null, 'e', 'grouped'>>();
expectTypeOf(phantoms(sum(d).multiply(sum(e)))).toEqualTypeOf<Expr<Decimal<38, 5> | null, 'd', 'agg'>>();
expectTypeOf(phantoms(d.multiply(d).plus(d).divide(d))).toEqualTypeOf<Expr<Decimal<18, 4>, 'd', 'grouped'>>();
const primitive = '1.00' as Decimal<18, 2>;
expectTypeOf(phantoms(d.multiply(primitive))).toEqualTypeOf<Expr<Decimal<18, 4>, 'd', 'grouped'>>();
expectTypeOf(phantoms(d.plus(val(primitive, col.Decimal64(2))))).toEqualTypeOf<Expr<Decimal<18, 2>, 'd', 'grouped'>>();
// Storage transitions use precision, not just the sugar constructors.
const p9 = columnExpr(col.Decimal(9, 0), 1 as NodeId, ['p'], 'p', 'row');
const p10 = columnExpr(col.Decimal(10, 1), 1 as NodeId, ['p'], 'p', 'row');
const p38 = columnExpr(col.Decimal(38, 1), 1 as NodeId, ['p'], 'p', 'row');
const p39 = columnExpr(col.Decimal(39, 2), 1 as NodeId, ['p'], 'p', 'row');
const p76 = columnExpr(col.Decimal(76, 3), 1 as NodeId, ['p'], 'p', 'row');
expectTypeOf(p9.plus(p9).ir.type.precision).toEqualTypeOf<9>();
expectTypeOf(p9.plus(p10).ir.type.precision).toEqualTypeOf<18>();
expectTypeOf(p10.plus(p38).ir.type.precision).toEqualTypeOf<38>();
expectTypeOf(p38.plus(p39).ir.type.precision).toEqualTypeOf<76>();
expectTypeOf(p76.multiply(p39).ir.type.scale).toEqualTypeOf<5>();
// @ts-expect-error precision evidence does not allow mixed modes
p9.plus(d);
// @ts-expect-error Decimal operands remain branded, not arbitrary strings
d.plus('1.00');
