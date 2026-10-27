import { expectTypeOf } from 'expect-type';
import { Expr, cast, col, count, countIf, defineAggregate, defineFunction, max, maxIf, maxState, countMerge, stringLike, sum, sumIf, sumState, val, type DescribedConstant, type DescribedExpr, type AggExpr, type AggregateState, type Grouped, type GroupedRow, type Infer, type Row } from '@chql/core';
const forTenant = (tenantId: string) => <R extends { tenantId: string }>(r: Row<R>) => r.tenantId.eq(tenantId);
expectTypeOf(forTenant('acme')({ tenantId: val('acme') as Expr<string, 'tenantId'> })).toEqualTypeOf<Expr<boolean, 'tenantId'>>();
function genericVersion<R extends { version: number }>(r: Row<R>, v: Expr<number, 'version'>) { return r.version.eq(v); }
void genericVersion;
declare const r: Row<{ stock: bigint; nullable: number | null; name: string }>;
declare const g: GroupedRow<{ stock: bigint; nullable: number | null; name: string }>;
expectTypeOf(r.stock.gt(3n)).toEqualTypeOf<Expr<boolean, 'stock'>>();
expectTypeOf(r.stock.gt(3n)).not.toBeAny();
expectTypeOf(r.nullable.gt(0)).toEqualTypeOf<Expr<boolean | null, 'nullable'>>();
expectTypeOf(r.nullable.ifNull(0)).toEqualTypeOf<Expr<number, 'nullable'>>();
expectTypeOf(r.nullable.ifNull(null)).toEqualTypeOf<Expr<number | null, 'nullable'>>();
expectTypeOf(g.stock.gt(3n).not()).toEqualTypeOf<Grouped<boolean, 'stock'>>();
expectTypeOf(sum(g.stock)).toEqualTypeOf<AggExpr<bigint, 'stock'>>();
expectTypeOf(sum(g.stock).divide(sum(g.stock))).toEqualTypeOf<AggExpr<number, 'stock'>>();
expectTypeOf(count()).toEqualTypeOf<AggExpr<bigint, 'count'>>();
expectTypeOf(countIf(g.stock.gt(3n))).toEqualTypeOf<AggExpr<bigint, 'stock'>>();
expectTypeOf(max(g.nullable)).toEqualTypeOf<AggExpr<number | null, 'nullable'>>();
expectTypeOf(sumState(g.stock)).toEqualTypeOf<AggExpr<AggregateState<'sum'>, 'stock'>>();
expectTypeOf(r.stock.plus(val(1n))).toEqualTypeOf<Expr<bigint, 'stock'>>();
expectTypeOf(g.stock.plus(val(1n))).toEqualTypeOf<Grouped<bigint, 'stock'>>();
expectTypeOf(cast(g.stock, col.Float64)).toEqualTypeOf<DescribedExpr<number, 'stock', 'grouped', typeof col.Float64.type>>();
expectTypeOf(g.stock.as(col.String)).toEqualTypeOf<DescribedExpr<string, 'stock', 'grouped', typeof col.String.type>>();
expectTypeOf<Infer<typeof r>>().toEqualTypeOf<{ stock: bigint; nullable: number | null; name: string }>();
expectTypeOf<Infer<typeof r.stock>>().toEqualTypeOf<{ stock: bigint }>();
const distance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
expectTypeOf(distance(r.name, 'abc')).toEqualTypeOf<Expr<bigint, 'name'>>();
expectTypeOf(distance(g.name, 'abc')).toEqualTypeOf<Grouped<bigint, 'name'>>();
expectTypeOf(distance('abc', g.name)).toEqualTypeOf<Grouped<bigint, 'name'>>();
expectTypeOf(distance(val('abc'), g.name)).toEqualTypeOf<Grouped<bigint, 'name'>>();
const identity = defineFunction({ name: 'identity', args: [stringLike], returns: 'arg0', deterministic: true });
expectTypeOf(identity(g.name)).toEqualTypeOf<Grouped<string, 'name'>>();
expectTypeOf(identity(g.name)).not.toBeAny();
declare const nullableName: Grouped<string | null, 'name'>;
const nullableAggregate = defineAggregate({ name: 'nullableAggregate', args: [stringLike], returns: col.UInt64, deterministic: true, linear: false });
expectTypeOf(nullableAggregate(nullableName)).toEqualTypeOf<AggExpr<bigint | null, 'name'>>();
expectTypeOf(nullableAggregate(nullableName)).not.toBeAny();
const neverAggregate = defineAggregate({ name: 'neverAggregate', args: [stringLike], returns: col.UInt64, nullable: 'never', deterministic: true, linear: false });
expectTypeOf(neverAggregate(nullableName)).toEqualTypeOf<AggExpr<bigint, 'name'>>();
const identityAggregate = defineAggregate({ name: 'identityAggregate', args: [stringLike], returns: 'arg0', deterministic: true, linear: false });
expectTypeOf(identityAggregate(nullableName)).toEqualTypeOf<AggExpr<string | null, 'name'>>();
declare function phantoms<E>(value: E): E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;
const declaredConstant = val(1n).as(col.UInt64);
expectTypeOf(declaredConstant).toEqualTypeOf<DescribedConstant<typeof col.UInt64>>();
expectTypeOf(declaredConstant).not.toBeAny();
expectTypeOf(phantoms(sum(declaredConstant))).toEqualTypeOf<AggExpr<bigint, 'sum'>>();
expectTypeOf(phantoms(max(declaredConstant))).toEqualTypeOf<AggExpr<bigint, 'max'>>();
expectTypeOf(countIf(val(true))).toEqualTypeOf<AggExpr<bigint, 'count'>>();
expectTypeOf(phantoms(sumIf(declaredConstant, val(true)))).toEqualTypeOf<AggExpr<bigint, 'sum'>>();
expectTypeOf(phantoms(sumIf(declaredConstant, g.stock.gt(0n)))).toEqualTypeOf<AggExpr<bigint, 'stock'>>();
expectTypeOf(phantoms(maxIf(declaredConstant, g.stock.gt(0n)))).toEqualTypeOf<AggExpr<bigint, 'stock'>>();
expectTypeOf(sumState(declaredConstant)).toEqualTypeOf<DescribedExpr<AggregateState<'sum'>, 'sum', 'agg', { readonly kind: 'AggregateFunction'; readonly fn: 'sum'; readonly args: [typeof declaredConstant.ir.type & import('@chql/core').CHType] }>>();
expectTypeOf(maxState(declaredConstant)).toEqualTypeOf<DescribedExpr<AggregateState<'max'>, 'max', 'agg', { readonly kind: 'AggregateFunction'; readonly fn: 'max'; readonly args: [typeof declaredConstant.ir.type & import('@chql/core').CHType] }>>();
expectTypeOf(countMerge(val({ __aggregateState: 'count' }, col.AggregateFunction('count')))).toEqualTypeOf<AggExpr<bigint, 'count'>>();
// @ts-expect-error declaring a row column does not turn it into a constant
sum(r.stock.as(col.UInt64));
// @ts-expect-error If predicates still reject real row-mode columns
sumIf(declaredConstant, r.stock.gt(0n));
// @ts-expect-error State still rejects real row-mode columns
maxState(r.stock);
// Width-erased number is intentionally conservative, not falsely Float64.
expectTypeOf(sum(g.nullable)).toEqualTypeOf<AggExpr<number | bigint | null, 'nullable'>>();
// @ts-expect-error grouped and row modes cannot mix
r.stock.plus(g.stock);
// @ts-expect-error JS number is not a UInt64 operand
r.stock.gt(3);
// @ts-expect-error numeric methods require numeric receiver
r.name.multiply('x');
// @ts-expect-error grouped argument required
sum(r.stock);
// @ts-expect-error explicit UInt64 parameters require bigint
val(3, col.UInt64);
// @ts-expect-error a non-null String descriptor cannot describe null
val(null, col.String);
// @ts-expect-error scalar user function cannot mix modes
distance(g.name, r.name);
