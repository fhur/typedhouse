import { expectTypeOf } from 'expect-type';
import { col, from, leftJoin, table, val, type ExprValue, type Infer } from '@typedhouse/core';

// Slice 4e: ifNull over LowCardinality(Nullable(T)) is T (not T | null) with a LowCardinality(T) descriptor (24.8 `meta`).
type S = { readonly kind: 'scalar'; readonly name: 'String' };

type U32 = { readonly kind: 'scalar'; readonly name: 'UInt32' };

type Lc<D> = { readonly kind: 'LowCardinality'; readonly inner: D };

type N<D> = { readonly kind: 'Nullable'; readonly inner: D };

const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] } as const;

const t = from(
  table(
    't',
    {
      id: col.UInt32,
      s: col.String,
      ns: col.Nullable(col.String),
      ls: col.LowCardinality(col.Nullable(col.String)),
      lu: col.LowCardinality(col.Nullable(col.UInt32)),
      lc: col.LowCardinality(col.String),
    },
    meta,
  ),
);

const r = t.row;

// Value (exact) and descriptor (structural: column descriptors carry a CHType intersection) are checked separately.
const e0 = r.ls.ifNull('z');
expectTypeOf<ExprValue<typeof e0>>().toEqualTypeOf<string>();
expectTypeOf<typeof e0.ir.type>().toMatchTypeOf<Lc<S>>();
expectTypeOf<typeof e0.ir.type>().not.toMatchTypeOf<Lc<N<unknown>>>();
const e1 = r.lu.ifNull(3);
expectTypeOf<ExprValue<typeof e1>>().toEqualTypeOf<number>();
expectTypeOf<typeof e1.ir.type>().toMatchTypeOf<Lc<U32>>();
expectTypeOf<typeof e1.ir.type>().not.toMatchTypeOf<Lc<N<unknown>>>();
const e2 = r.ls.ifNull(r.s);
expectTypeOf<ExprValue<typeof e2>>().toEqualTypeOf<string>();
expectTypeOf<typeof e2.ir.type>().toMatchTypeOf<Lc<S>>();
expectTypeOf<typeof e2.ir.type>().not.toMatchTypeOf<Lc<N<unknown>>>();
// An untyped val() fallback carries no literal descriptor (pre-existing, as for Nullable receivers): value only.
const e3 = r.ls.ifNull(val('k'));
expectTypeOf<ExprValue<typeof e3>>().toEqualTypeOf<string>();
const e4 = r.ls.ifNull(r.ns);
expectTypeOf<ExprValue<typeof e4>>().toEqualTypeOf<string | null>();
expectTypeOf<typeof e4.ir.type>().toMatchTypeOf<Lc<N<S>>>();
expectTypeOf<typeof e4.ir.type>().not.toMatchTypeOf<N<unknown>>();
const e5 = r.ls.ifNull(null);
expectTypeOf<ExprValue<typeof e5>>().toEqualTypeOf<string | null>();
expectTypeOf<typeof e5.ir.type>().toMatchTypeOf<Lc<N<S>>>();
expectTypeOf<typeof e5.ir.type>().not.toMatchTypeOf<N<unknown>>();

// Neighbours unchanged: Nullable(T) drops to T, plain LowCardinality(T) is returned as declared.
const n0 = r.ns.ifNull('z'),
  n1 = r.lc.ifNull('z');

expectTypeOf<ExprValue<typeof n0>>().toEqualTypeOf<string>();
expectTypeOf<typeof n0.ir.type>().toMatchTypeOf<S>();
expectTypeOf<typeof n0.ir.type>().not.toMatchTypeOf<N<unknown> | Lc<unknown>>();
expectTypeOf<ExprValue<typeof n1>>().toEqualTypeOf<string>();
expectTypeOf<typeof n1.ir.type>().toMatchTypeOf<Lc<S>>();
expectTypeOf<typeof n1.ir.type>().not.toMatchTypeOf<Lc<N<unknown>>>();

const plain = t.map(x => ({
  a: x.ls.ifNull('z'),
  b: x.lu.ifNull(0),
  c: x.ls.ifNull(x.ns),
  d: x.ls.isNull(),
  e: x.ls.eq('a'),
}));

expectTypeOf<Infer<typeof plain>>().toEqualTypeOf<{
  a: string;
  b: number;
  c: string | null;
  d: boolean;
  e: boolean | null;
}>();

// Through leftJoin: LowCardinality(String) on the null-extended side becomes LowCardinality(Nullable(String)); ifNull restores string.
const b = from(
  table('b', { id: col.UInt32, lc: col.LowCardinality(col.String), s: col.String }, meta),
);

const lj = leftJoin({ a: t }, { b })
  .on(x => x.a.id.eq(x.b.id))
  .map(x => ({ id: x.a.id, lc: x.b.lc.ifNull('none'), raw: x.b.lc, c: x.b.lc.ifNull(x.b.s) }));

expectTypeOf<Infer<typeof lj>>().toEqualTypeOf<{
  id: number;
  lc: string;
  raw: string | null;
  c: string | null;
}>();
