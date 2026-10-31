// Tester type-level probes for slice 4a (outer joins). Positive assertions only; observed lies are pinned with comments.
import { expectTypeOf } from 'expect-type';
import { col, from, fullJoin, join, leftJoin, rightJoin, table, type Column, type Infer, type OuterDescriptor, type Query } from '@typedhouse/core';
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const t = table('t', { id: col.UInt32, s: col.String, n: col.Nullable(col.Int64), lcn: col.LowCardinality(col.Nullable(col.String)), tup: col.Tuple({ x: col.UInt8, y: col.String }), m: col.Map(col.String, col.Nullable(col.UInt64)), d: col.Decimal256(10), dt: col.DateTime64(3, 'UTC'), ip: col.IPv6, fs: col.FixedString(2), safLc: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)), safU: col.SimpleAggregateFunction('anyLast', col.UInt64) }, meta);
const q = from(t);
type T = Infer<typeof t>;
const lj = leftJoin({ a: q }, { b: q }).on(r => r.a.id.eq(r.b.id));
type B = Infer<typeof lj>['b'];
expectTypeOf<Infer<typeof lj>>().not.toBeAny();
expectTypeOf<B['n']>().toEqualTypeOf<bigint | null>();          // already Nullable: idempotent
expectTypeOf<B['lcn']>().toEqualTypeOf<string | null>();        // LC(Nullable) unchanged
expectTypeOf<B['tup']>().toEqualTypeOf<{ x: number; y: string }>(); // Tuple: server default, never null
expectTypeOf<B['m']>().toEqualTypeOf<T['m']>();
expectTypeOf<B['d']>().toEqualTypeOf<T['d'] | null>();
expectTypeOf<B['dt']>().toEqualTypeOf<Date | null>();
expectTypeOf<B['ip']>().toEqualTypeOf<T['ip'] | null>();
expectTypeOf<B['fs']>().toEqualTypeOf<string | null>();
expectTypeOf<B['safU']>().toEqualTypeOf<bigint | null>();
// col.SimpleAggregateFunction is an erased descriptor, so ValueFallback gives string | null, which matches the server
// (LowCardinality(Nullable(String)), NULL when unmatched). Fix round 1: the runtime descriptor, previously the declared
// SimpleAggregateFunction(max, LowCardinality(String)), is now LowCardinality(Nullable(String)), so type and descriptor agree.
expectTypeOf<B['safLc']>().toEqualTypeOf<string | null>();
// element() on a non-wrapped Tuple from the null side: non-null, as the server returns the default.
const el = lj.map(r => ({ x: r.b.tup.element('x') }));
expectTypeOf<Infer<typeof el>>().toEqualTypeOf<{ x: number }>();
// Idempotence: left over left wraps the nested side once; right composed under left.
const ll = leftJoin({ a: q }, { bc: leftJoin({ b: q }, { c: q }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.b.id));
expectTypeOf<Infer<typeof ll>['bc']['c']>().toEqualTypeOf<B>();
expectTypeOf<Infer<typeof ll>['bc']['b']>().toEqualTypeOf<B>();
const rl = leftJoin({ a: q }, { bc: rightJoin({ b: q }, { c: q }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.c.id));
expectTypeOf<Infer<typeof rl>['bc']>().toEqualTypeOf<{ b: B; c: B }>();
expectTypeOf<Infer<typeof rl>['a']>().toEqualTypeOf<T>();
const ff = fullJoin({ x: q }, { y: join({ p: q, r: q }).on(r => r.p.id.eq(r.r.id)) }).on(r => r.x.id.eq(r.y.p.id));
expectTypeOf<Infer<typeof ff>>().toEqualTypeOf<{ x: B; y: { p: B; r: B } }>();
// The ON row already carries the wrapped types (an ON comparing a wrapped key still type-checks).
leftJoin({ a: q }, { b: q }).on(r => { expectTypeOf(r.b.id.ifNull(0)).not.toBeAny(); return r.a.n.eq(r.b.n); });
// Generic helper: an erased descriptor (ValueFallback). Arrays and objects keep, scalars/Date gain null.
function viaHelper<R extends { id: number }>(input: Query<R>) { return leftJoin({ a: q }, { g: input }).on(r => r.a.id.eq((r.g as { id: typeof r.a.id }).id)); }
const generic = viaHelper(from(t));
expectTypeOf<Infer<typeof generic>['a']>().toEqualTypeOf<T>();
expectTypeOf(generic).not.toBeAny();
// Re-verification (fix round 1): a concrete SAF(f, LowCardinality(T)) column through a real join — value, row-proxy
// descriptor and erased fallback all match the server's LowCardinality(Nullable(T)).
type SafMinLc = { readonly kind: 'SimpleAggregateFunction'; readonly fn: 'min'; readonly inner: { readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'scalar'; readonly name: 'UInt32' } } };
const safTable = table('saf', { id: col.UInt32, c: col.SimpleAggregateFunction('min', col.LowCardinality(col.UInt32)) as unknown as Column<number, false, SafMinLc>, e: col.SimpleAggregateFunction('min', col.LowCardinality(col.UInt32)) }, meta);
const sj = leftJoin({ a: q }, { s: from(safTable) }).on(r => r.a.id.eq(r.s.id));
expectTypeOf<Infer<typeof sj>['s']>().toEqualTypeOf<{ id: number | null; c: number | null; e: number | null }>();
expectTypeOf<typeof sj.row.s.c.ir.type>().toMatchTypeOf<{ readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: 'UInt32' } } }>();
expectTypeOf<OuterDescriptor<SafMinLc>>().toEqualTypeOf<{ readonly kind: 'LowCardinality'; readonly inner: { readonly kind: 'Nullable'; readonly inner: SafMinLc['inner']['inner'] } }>();
const inner = join({ a: q, s: from(safTable) }).on(r => r.a.id.eq(r.s.id));
expectTypeOf<Infer<typeof inner>['s']['c']>().toEqualTypeOf<number>();
