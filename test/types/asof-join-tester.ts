import { expectTypeOf } from 'expect-type';
import {
  asofJoin,
  asofLeftJoin,
  col,
  count,
  from,
  sql,
  table,
  type Decimal,
  type Infer,
  type Query,
} from '@typedhouse/core';

// D10 Tester: output types the Worker's file does not pin.
const opts = { engine: 'MergeTree', sortingKey: [], partitionKey: [] } as const;

const l = from(
  table(
    'l',
    {
      id: col.UInt32,
      k: col.String,
      ts: col.DateTime('UTC'),
      nts: col.Nullable(col.DateTime('UTC')),
    },
    opts,
  ),
);

const r = from(
  table(
    'r',
    {
      id: col.UInt32,
      k: col.String,
      ts: col.DateTime('UTC'),
      nts: col.Nullable(col.DateTime('UTC')),
      nu: col.Nullable(col.UInt32),
      lc: col.LowCardinality(col.String),
      lcn: col.LowCardinality(col.Nullable(col.String)),
      arr: col.Array(col.String),
      mp: col.Map(col.String, col.UInt8),
      tup: col.Tuple({ a: col.UInt8, b: col.Nullable(col.String) }),
      saf: col.SimpleAggregateFunction('max', col.UInt32),
      en: col.Enum8({ a: 1, b: 2 }),
      dec: col.Decimal(9, 2),
      u64: col.UInt64,
      dt64: col.DateTime64(3, 'UTC'),
      b: col.Bool,
    },
    opts,
  ),
);

const outer = asofLeftJoin({ t: l }, { q: r })
  .on(x => x.t.k.eq(x.q.k))
  .asof(x => x.t.ts.ge(x.q.ts));

const outerRow = outer.map(x => ({
  id: x.q.id,
  nts: x.q.nts,
  nu: x.q.nu,
  lc: x.q.lc,
  lcn: x.q.lcn,
  arr: x.q.arr,
  mp: x.q.mp,
  tup: x.q.tup,
  en: x.q.en,
  dec: x.q.dec,
  u64: x.q.u64,
  dt64: x.q.dt64,
  b: x.q.b,
}));

type OuterRow = Infer<typeof outerRow>;

expectTypeOf<OuterRow['id']>().toEqualTypeOf<number | null>();
expectTypeOf<OuterRow['nts']>().toEqualTypeOf<Date | null>();
expectTypeOf<OuterRow['nu']>().toEqualTypeOf<number | null>();
expectTypeOf<OuterRow['lc']>().toEqualTypeOf<string | null>();
expectTypeOf<OuterRow['lcn']>().toEqualTypeOf<string | null>();
expectTypeOf<OuterRow['arr']>().toEqualTypeOf<string[]>();
expectTypeOf<OuterRow['en']>().toEqualTypeOf<'a' | 'b' | null>();
expectTypeOf<OuterRow['dec']>().toEqualTypeOf<Decimal<9, 2> | null>();
expectTypeOf<OuterRow['u64']>().toEqualTypeOf<bigint | null>();
expectTypeOf<OuterRow['dt64']>().toEqualTypeOf<Date | null>();
expectTypeOf<OuterRow['b']>().toEqualTypeOf<boolean | null>();

// A map and a tuple keep their type and the server's default.
expectTypeOf<OuterRow['mp']>().not.toBeNullable();
expectTypeOf<OuterRow['tup']>().not.toBeNullable();
expectTypeOf<OuterRow['tup']>().toHaveProperty('a');

// The left side is untouched on asofLeftJoin, and the whole row keeps its nested shape.
const whole = outer.map(x => ({ id: x.t.id, nts: x.t.nts }));
expectTypeOf<Infer<typeof whole>>().toEqualTypeOf<{ id: number; nts: Date | null }>();

// The row of the join itself: left as declared, right with null extension.
type WholeRow = Infer<typeof outer>;

expectTypeOf<WholeRow['t']['id']>().toEqualTypeOf<number>();
expectTypeOf<WholeRow['q']['id']>().toEqualTypeOf<number | null>();
expectTypeOf<WholeRow['q']['arr']>().toEqualTypeOf<string[]>();

// asofJoin gives the declared types: nothing extended.
const inner = asofJoin({ t: l }, { q: r })
  .on(x => x.t.k.eq(x.q.k))
  .asof(x => x.t.ts.ge(x.q.ts));

const innerRow = inner.map(x => ({ id: x.q.id, nu: x.q.nu, lc: x.q.lc, u64: x.q.u64 }));

expectTypeOf<Infer<typeof innerRow>>().toEqualTypeOf<{
  id: number;
  nu: number | null;
  lc: string;
  u64: bigint;
}>();

// Every comparison method and form: Nullable operands, a snippet, an array of equalities, an equality in AND.
asofJoin({ t: l }, { q: r })
  .on(x => x.t.k.eq(x.q.k))
  .asof(x => x.t.nts.lt(x.q.nts));

asofJoin({ t: l }, { q: r })
  .on(x => x.t.k.eq(x.q.k))
  .asof(x => sql`${x.t.ts} - ${5}`.as(col.DateTime('UTC')).ge(x.q.ts));

asofLeftJoin({ t: l }, { q: r })
  .on(x => [x.t.k.eq(x.q.k), x.t.id.eq(x.q.id)])
  .asof(x => x.t.ts.gt(x.q.ts));

// An ASOF result is an input to the next join, and a right input may be filtered first.
const asInput = inner.map(x => ({ k: x.t.k, ts: x.q.ts }));

asofJoin({ a: asInput }, { b: r.where(x => x.b.eq(true)) })
  .on(x => x.a.k.eq(x.b.k))
  .asof(x => x.a.ts.gt(x.b.ts))
  .map(x => ({ id: x.b.id }));

// The result of map is an ordinary Query.
expectTypeOf(innerRow).toMatchTypeOf<
  Query<{ id: number; nu: number | null; lc: string; u64: bigint }, { live: false }>
>();

// A non-boolean or aggregate condition is a type error. These sit here and not in negative/expressions:
// on 5.5.4 they change the message of a pin in join.ts and query.ts, whose elaboration shares one
// program's relation cache.
const pending = asofJoin({ t: l }, { q: r }).on(x => x.t.k.eq(x.q.k));

// @ts-expect-error a number is not a condition
pending.asof(x => x.t.id);

// @ts-expect-error a timestamp is not a condition
pending.asof(x => x.t.ts);

// @ts-expect-error a string is not a condition
asofJoin({ t: l }, { q: r }).on(x => x.t.k);

// @ts-expect-error an aggregate is not a row condition
pending.asof(() => count().gt(0n));

// @ts-expect-error an aggregate is not a row condition
asofJoin({ t: l }, { q: r }).on(() => count().eq(0n));
