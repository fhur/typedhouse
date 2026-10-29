import { expectTypeOf } from 'expect-type';
import { col, columnExpr, from, greatest, max, table, val, type DescribedExpr, type Expr, type Infer, type NodeId } from '@chql/core';
import { componentsLatest } from '../../packages/compiler/test/fixtures/corpus/components-latest.js';
type Result = { entityId: string; category: string | null; stockTotal: number; stockP50: number; leadDays: number; stockIndex: number; asOf: Date };
expectTypeOf<Infer<typeof componentsLatest>>().toEqualTypeOf<Result>();
expectTypeOf<Infer<typeof componentsLatest>>().not.toBeAny();
const mapped = componentsLatest.map(r => ({ ...r, asOf: r.asOf })).where(r => r.asOf.gt(new Date())).orderBy(r => r.asOf).thenBy(r => r.entityId);
expectTypeOf<Infer<typeof mapped>>().toEqualTypeOf<Result>();
const id = 1 as NodeId;
const a = columnExpr(col.DateTime64(1, 'Europe/Amsterdam'), id, ['a'], 'a', 'row');
const b = columnExpr(col.DateTime64(3, 'Europe/Amsterdam'), id, ['b'], 'b', 'row');
const c = columnExpr(col.DateTime64(2, 'Europe/Amsterdam'), id, ['c'], 'c', 'row');
const result = greatest(a, b, c);
expectTypeOf(result).toEqualTypeOf<DescribedExpr<Date, 'a', 'row', { readonly kind: 'DateTime64'; readonly precision: 3 } & { readonly tz: 'Europe/Amsterdam' }>>();
expectTypeOf(result).not.toBeAny();
const q = from(table('dates', { a: col.DateTime64(1), b: col.DateTime64(2) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const single = q.map(r => greatest(r.a, r.b));
expectTypeOf<Infer<typeof single>>().toEqualTypeOf<{ a: Date }>();
const aggregated = q.aggregate(g => {
  const grouped = greatest(g.a, g.b);
  expectTypeOf(grouped.mode).toEqualTypeOf<'grouped'>();
  const agg = greatest(max(g.a), max(g.b));
  expectTypeOf(agg.mode).toEqualTypeOf<'agg'>();
  return { grouped: max(grouped), agg };
});
expectTypeOf<Infer<typeof aggregated>>().toEqualTypeOf<{ grouped: Date; agg: Date }>();
const constant = greatest(val(new Date(), col.DateTime64(0)), val(new Date(), col.DateTime64(1)));
expectTypeOf(constant.name).toEqualTypeOf<never>();
expectTypeOf(constant.mode).toEqualTypeOf<'row'>();
const erased: Expr<Date, 'a'> = a;
// @ts-expect-error decoded Date alone is not descriptor evidence
void greatest(erased, b);

// Finite interpolations reduce to concrete literal keys; no timezone allowlist.
const etc = val(new Date(0), col.DateTime64(1, 'Etc/GMT+1'));
const etcHigh = val(new Date(0), col.DateTime64(3, 'Etc/GMT+1'));
expectTypeOf(greatest(etc, etcHigh).ir.type.tz).toEqualTypeOf<'Etc/GMT+1'>();
const utcLiteral = val(new Date(0), col.DateTime64(3, 'UTC'));
expectTypeOf(greatest(utcLiteral, utcLiteral).ir.type.tz).toEqualTypeOf<'UTC'>();
function literalZone<const Z extends string>(zone: Z) { return col.DateTime64(3, zone); }
const interpolated: `Etc/GMT+${1}` = 'Etc/GMT+1';
const inferred = val(new Date(0), literalZone(interpolated));
const inferredPair = [inferred, inferred] as const;
expectTypeOf(greatest(...inferredPair).ir.type.tz).toEqualTypeOf<'Etc/GMT+1'>();
expectTypeOf(greatest(...inferredPair).ir.type.precision).toEqualTypeOf<3>();

const fixed: readonly [typeof a, typeof b, typeof c] = [a, b, c];
expectTypeOf(greatest(...fixed).ir.type.precision).toEqualTypeOf<3>();
// Generic wrappers remain usable when the actual tuple and descriptors are proved.
function knownPair<T>(context: T, first: typeof a, second: typeof b) {
  return { context, result: greatest(first, second) };
}
expectTypeOf(knownPair('context', a, b).result.ir.type.precision).toEqualTypeOf<3>();
const explicit = col.DateTime64<3>(3, 'UTC');
expectTypeOf(explicit.type.precision).toEqualTypeOf<3>();
expectTypeOf(explicit.type.tz).toEqualTypeOf<string | undefined>();
expectTypeOf(col.DateTime64<3>(3).type.tz).toEqualTypeOf<undefined>();
expectTypeOf(col.DateTime64(3, 'UTC').type.tz).toEqualTypeOf<'UTC'>();
expectTypeOf(col.DateTime64(3, undefined).type.tz).toEqualTypeOf<undefined>();
function optionalZone(zone?: string) { return col.DateTime64<3>(3, zone); }
expectTypeOf(optionalZone().type.tz).toEqualTypeOf<string | undefined>();
function genericPrecision<P extends number>(precision: P, zone?: string) { return col.DateTime64<P>(precision, zone); }
expectTypeOf(genericPrecision(3).type.precision).toEqualTypeOf<3>();
expectTypeOf(genericPrecision(3).type.tz).toEqualTypeOf<string | undefined>();
