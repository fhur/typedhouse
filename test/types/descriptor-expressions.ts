import { expectTypeOf } from 'expect-type';
import { col, columnExpr, cast, sum, sumIf, val, type AggExpr, type GroupedRow, type Infer, type NodeId, type Expr } from '@chql/core';

declare function phantoms<E>(value: E): E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;
const f = columnExpr(col.Float64, 1 as NodeId, ['stock'], 'stock', 'grouped');
const i = columnExpr(col.UInt32, 1 as NodeId, ['stock'], 'stock', 'grouped');
const n = columnExpr(col.Nullable(col.Float64), 1 as NodeId, ['stock'], 'stock', 'grouped');
expectTypeOf(phantoms(sum(f))).toEqualTypeOf<AggExpr<number, 'stock'>>();
expectTypeOf(phantoms(sum(i))).toEqualTypeOf<AggExpr<bigint, 'stock'>>();
expectTypeOf(phantoms(sum(n))).toEqualTypeOf<AggExpr<number | null, 'stock'>>();
expectTypeOf(sum(n)).not.toBeAny();
expectTypeOf(phantoms(sumIf(f, val(true)))).toEqualTypeOf<AggExpr<number, 'stock'>>();
expectTypeOf(phantoms(sumIf(n, val(true)))).toEqualTypeOf<AggExpr<number | null, 'stock'>>();
expectTypeOf(phantoms(sum(val(1)))).toEqualTypeOf<AggExpr<number, 'sum'>>();
expectTypeOf(phantoms(sum(val(1, col.UInt32)))).toEqualTypeOf<AggExpr<bigint, 'sum'>>();
expectTypeOf(phantoms(sum(val(null, col.Nullable(col.Float64))))).toEqualTypeOf<AggExpr<number | null, 'sum'>>();
expectTypeOf(phantoms(sum(i.as(col.Float64)))).toEqualTypeOf<AggExpr<number, 'stock'>>();
expectTypeOf(phantoms(sum(cast(f, col.UInt32)))).toEqualTypeOf<AggExpr<bigint, 'stock'>>();
const columns = { f: col.Float32, i: col.Nullable(col.Int16), wrapped: col.LowCardinality(col.Nullable(col.Float64)) };
type Values = { [K in keyof typeof columns]: Infer<typeof columns[K]> };
declare const row: GroupedRow<Values, typeof columns>;
expectTypeOf(phantoms(sum(row.f))).toEqualTypeOf<AggExpr<number, 'f'>>();
expectTypeOf(phantoms(sum(row.i))).toEqualTypeOf<AggExpr<bigint | null, 'i'>>();
expectTypeOf(phantoms(sum(row.wrapped))).toEqualTypeOf<AggExpr<number | null, 'wrapped'>>();
expectTypeOf<Infer<typeof row>>().toEqualTypeOf<Values>();
// @ts-expect-error descriptors do not remove the grouped-only aggregate constraint
sum(columnExpr(col.Float64, 1 as NodeId, ['stock'], 'stock', 'row'));
