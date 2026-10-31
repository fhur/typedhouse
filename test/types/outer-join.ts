import { expectTypeOf } from 'expect-type';
import { from, leftJoin, rightJoin, fullJoin, join, col, table, type Infer, type Query, type OuterDescriptor, type OuterValue } from '@typedhouse/core';
import { components, forTenant, latest, db } from '../../packages/compiler/test/fixtures/corpus/low-stock.js';
const availability = from(db.metric_group_ots_component_market_availability);
const spec = leftJoin({ c: components.where(forTenant('acme')) }, { a: latest(availability.final().where(forTenant('acme'))) })
  .on(r => r.c.entityId.eq(r.a.entityId))
  .map(r => ({ entityId: r.c.entityId, stock: r.a.market_stock_total.ifNull(0) }));
expectTypeOf<Infer<typeof spec>>().toEqualTypeOf<{ entityId: string; stock: number }>();
expectTypeOf(spec).toMatchTypeOf<Query<{ entityId: string; stock: number }>>();
const kinds = table('kinds', { id: col.UInt32, s: col.String, n: col.Nullable(col.Float64), lc: col.LowCardinality(col.String), arr: col.Array(col.String), m: col.Map(col.String, col.UInt64), t: col.Tuple({ a: col.UInt8 }), d: col.Decimal(9, 2), at: col.DateTime64(3), e: col.Enum8({ x: 1 }), u: col.UUID }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const k = from(kinds);
const lj = leftJoin({ a: k }, { b: k }).on(r => r.a.id.eq(r.b.id));
type K = Infer<typeof kinds>;
type B = { id: number | null; s: string | null; n: number | null; lc: string | null; arr: string[]; m: Record<string, bigint>; t: { a: number }; d: K['d'] | null; at: Date | null; e: 'x' | null; u: K['u'] | null };
expectTypeOf<Infer<typeof lj>>().toEqualTypeOf<{ a: K; b: B }>();
type LcType = typeof lj.row.b.lc.ir.type;
expectTypeOf<LcType>().toMatchTypeOf<{ readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: 'String' } } }>();
const rj = rightJoin({ a: k }, { c: k }).on(r => r.a.id.eq(r.c.id));
expectTypeOf<Infer<typeof rj>>().toEqualTypeOf<{ a: B; c: K }>();
// Three-way outer joins compose: the null-extended input may itself be an outer join (wrapping is idempotent).
const rj3 = rightJoin({ ab: leftJoin({ a: k }, { b: k }).on(r => r.a.id.eq(r.b.id)) }, { c: k }).on(r => r.ab.b.id.eq(r.c.id));
expectTypeOf<Infer<typeof rj3>>().toEqualTypeOf<{ ab: { a: B; b: B }; c: K }>();
const fj = fullJoin({ a: k }, { b: k }).on(r => r.a.id.eq(r.b.id)).map(r => ({ x: r.a.s, y: r.b.arr, z: r.b.n.ifNull(0) }));
expectTypeOf<Infer<typeof fj>>().toEqualTypeOf<{ x: string | null; y: string[]; z: number }>();
const nested = leftJoin({ ab: join({ a: k, b: k }).on(r => r.a.id.eq(r.b.id)) }, { c: lj }).on(r => r.ab.a.id.eq(r.c.a.id));
expectTypeOf<Infer<typeof nested>>().toEqualTypeOf<{ ab: { a: K; b: K }; c: { a: B; b: B } }>();
// latest() needs a non-null version: a null-extended side's version is number | null, so it is rejected, not mistyped.
const versions = leftJoin({ c: components }, { a: availability }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ ...r.a }));
expectTypeOf<Infer<typeof versions>['version']>().toEqualTypeOf<number | null>();
// @ts-expect-error version is number | null on the null-extended side
latest(versions);
// Inner joins are unchanged by the outer machinery.
// Fix round 1: a concrete SimpleAggregateFunction(f, LowCardinality(T)) descriptor becomes LowCardinality(Nullable(T)) (24.8 drops the SAF wrapper).
type SafLc = { readonly kind: 'SimpleAggregateFunction'; readonly fn: 'max'; readonly inner: { readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'scalar'; readonly name: 'String' } } };
type SafU = { readonly kind: 'SimpleAggregateFunction'; readonly fn: 'anyLast'; readonly inner: { readonly kind: 'scalar'; readonly name: 'UInt64' } };
type SafLcN = { readonly kind: 'SimpleAggregateFunction'; readonly fn: 'max'; readonly inner: { readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: 'String' } } } };
expectTypeOf<OuterDescriptor<SafLc>>().toEqualTypeOf<{ readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: 'String' } } }>();
expectTypeOf<OuterDescriptor<SafU>>().toEqualTypeOf<{ readonly kind: 'Nullable'; readonly inner: SafU }>();
expectTypeOf<OuterDescriptor<SafLcN>>().toEqualTypeOf<SafLcN>();
expectTypeOf<OuterValue<string, SafLc>>().toEqualTypeOf<string | null>();
expectTypeOf<OuterValue<string | null, SafLcN>>().toEqualTypeOf<string | null>();
