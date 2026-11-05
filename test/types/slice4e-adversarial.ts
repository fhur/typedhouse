import { expectTypeOf } from 'expect-type';
import { col, from, leftJoin, table, val, type ExprValue, type Infer } from '@typedhouse/core';

// Slice 4e Tester: TS twin vs the runtime rule (runtime results pinned in packages/compiler/test/slice4e-adversarial.test.ts).
type S = { readonly kind: 'scalar'; readonly name: 'String' };

type F64 = { readonly kind: 'scalar'; readonly name: 'Float64' };

type Lc<D> = { readonly kind: 'LowCardinality'; readonly inner: D };

type N<D> = { readonly kind: 'Nullable'; readonly inner: D };

const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] } as const;

const t = from(
  table(
    't4',
    {
      id: col.UInt32,
      s: col.String,
      ls: col.LowCardinality(col.Nullable(col.String)),
      other: col.LowCardinality(col.Nullable(col.String)),
      lc: col.LowCardinality(col.String),
      lu: col.LowCardinality(col.Nullable(col.UInt32)),
      arr: col.Array(col.LowCardinality(col.Nullable(col.String))),
    },
    meta,
  ),
);

const r = t.row;

const a0 = r.ls.ifNull(r.other); // runtime LowCardinality(Nullable(String))
expectTypeOf<ExprValue<typeof a0>>().toEqualTypeOf<string | null>();
expectTypeOf<typeof a0.ir.type>().toMatchTypeOf<Lc<N<S>>>();
const a1 = r.ls.ifNull(r.lc); // runtime LowCardinality(String)
expectTypeOf<ExprValue<typeof a1>>().toEqualTypeOf<string>();
expectTypeOf<typeof a1.ir.type>().toMatchTypeOf<Lc<S>>();
expectTypeOf<typeof a1.ir.type>().not.toMatchTypeOf<Lc<N<unknown>>>();
const a2 = r.ls.ifNull(r.other.ifNull('q')); // runtime LowCardinality(String)
expectTypeOf<ExprValue<typeof a2>>().toEqualTypeOf<string>();
expectTypeOf<typeof a2.ir.type>().toMatchTypeOf<Lc<S>>();
const a3 = r.ls.ifNull(r.other).ifNull('q'); // runtime LowCardinality(String)
expectTypeOf<ExprValue<typeof a3>>().toEqualTypeOf<string>();
expectTypeOf<typeof a3.ir.type>().toMatchTypeOf<Lc<S>>();
expectTypeOf<typeof a3.ir.type>().not.toMatchTypeOf<Lc<N<unknown>>>();
const a4 = r.lu.ifNull(val(1.5)); // runtime LowCardinality(Float64)
expectTypeOf<ExprValue<typeof a4>>().toEqualTypeOf<number>();
expectTypeOf<typeof a4.ir.type>().toMatchTypeOf<Lc<F64>>();

// Comparisons and null tests keep their pre-4e TS types (deviation 2: server says LowCardinality(Nullable(UInt8))).
const q = t.map(x => ({
  c: x.ls.ifNull('z').eq('a'),
  d: x.ls.eq('a'),
  e: x.ls.isNotNull(),
  f: x.ls.ifNull(x.s).ne(x.other),
}));

expectTypeOf<Infer<typeof q>>().toEqualTypeOf<{
  c: boolean;
  d: boolean | null;
  e: boolean;
  f: boolean | null;
}>();

// ARRAY JOIN element of Array(LowCardinality(Nullable(String))).
const aj = t.arrayJoin(x => x.arr, 'e').map(x => ({ e: x.e.ifNull(x.s), p: x.e.ifNull('z') }));
expectTypeOf<Infer<typeof aj>>().toEqualTypeOf<{ e: string; p: string }>();
// Grouped by the ifNull, alias equal to the column name.
const g = t.groupBy(x => ({ ls: x.ls.ifNull(x.s) })).aggregate(() => ({}));
expectTypeOf<Infer<typeof g>>().toEqualTypeOf<{ ls: string }>();

// SAF(max, LowCardinality(String)) on the null-extended side.
const b = from(
  table(
    'b4',
    { id: col.UInt32, saf: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)) },
    meta,
  ),
);

const sj = leftJoin({ a: t }, { b })
  .on(x => x.a.id.eq(x.b.id))
  .map(x => ({ raw: x.b.saf, v: x.b.saf.ifNull('none') }));

expectTypeOf<Infer<typeof sj>>().toEqualTypeOf<{ raw: string | null; v: string }>();
