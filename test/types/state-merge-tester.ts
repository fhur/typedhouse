import { expectTypeOf } from 'expect-type';
import {
  argMax,
  argMaxMerge,
  argMaxState,
  argMinState,
  avgMerge,
  col,
  columnExpr,
  countMerge,
  from,
  join,
  leftJoin,
  maxMerge,
  maxState,
  minMerge,
  quantileExactMerge,
  quantileMerge,
  sumMerge,
  sumState,
  table,
  uniqExactMerge,
  uniqMerge,
  unionAll,
  type CHType,
  type Column,
  type Decimal,
  type Infer,
  type NodeId,
} from '@typedhouse/core';

/** D3 Tester: type-level attacks, independent of test/types/state-merge.ts. */
const meta = { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const rollup = table(
  'rollup',
  {
    k: col.String,
    n: col.UInt32,
    total: col.AggregateFunction('sum', col.UInt64),
    amount: col.AggregateFunction('sum', col.Decimal(18, 2)),
    wide: col.AggregateFunction('sum', col.Decimal(50, 3)),
    top: col.AggregateFunction('max', col.Nullable(col.UInt32)),
    low: col.AggregateFunction('min', col.Date),
    ids: col.AggregateFunction('uniq', col.UInt64),
    twoIds: col.AggregateFunction('uniqExact', col.String, col.UInt64),
    c: col.AggregateFunction('count', col.UInt64),
    latest: col.AggregateFunction('argMax', col.String, col.DateTime('UTC')),
    p: col.AggregateFunction('quantile(0.9)', col.Float64),
    one: col.AggregateFunction('quantile(1.)', col.Float64),
    px: col.AggregateFunction('quantileExact(0.5)', col.UInt64),
    mean: col.AggregateFunction('avg', col.Nullable(col.Float64)),
    simple: col.SimpleAggregateFunction('max', col.UInt64),
  },
  meta,
);

const q = from(rollup);

const all = q.aggregate(g => ({
  total: sumMerge(g.total),
  amount: sumMerge(g.amount),
  wide: sumMerge(g.wide),
  top: maxMerge(g.top),
  low: minMerge(g.low),
  ids: uniqMerge(g.ids),
  twoIds: uniqExactMerge(g.twoIds),
  c: countMerge(g.c),
  latest: argMaxMerge(g.latest),
  p: quantileMerge(0.5)(g.p),
  one: quantileMerge(1)(g.one),
  px: quantileExactMerge(0.5)(g.px),
  mean: avgMerge(g.mean),
}));

type All = Infer<typeof all>;

expectTypeOf<All>().not.toBeAny();

expectTypeOf<All>().toEqualTypeOf<{
  total: bigint;
  amount: Decimal<38, 2>;
  wide: Decimal<76, 3>;
  top: number | null;
  low: Date;
  ids: bigint;
  twoIds: bigint;
  c: bigint;
  latest: string;
  p: number;
  one: number;
  px: bigint;
  mean: number | null;
}>();

for (const value of [
  null as unknown as All['total'],
  null as unknown as All['top'],
  null as unknown as All['latest'],
  null as unknown as All['p'],
  null as unknown as All['mean'],
])
  expectTypeOf(value).not.toBeAny();

const g = <T, S extends boolean, D extends CHType>(c: Column<T, S, D>) =>
  columnExpr(c, 1 as NodeId, ['x'], 'x', 'grouped');

const lc = g(col.LowCardinality(col.String));

const lcn = g(col.LowCardinality(col.Nullable(col.String)));

const at = g(col.DateTime('UTC'));

// A LowCardinality value is outside argMax's operands, in the state exactly as in the base function.
// @ts-expect-error LowCardinality value
argMaxState(lc, at);

// @ts-expect-error LowCardinality value
argMax(lc, at);

// @ts-expect-error LowCardinality value
argMinState(lcn, at);

const lowCard = table(
  'lc',
  { k: col.String, s: col.LowCardinality(col.String), at: col.DateTime('UTC') },
  { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] },
);

const stated = from(lowCard)
  .groupBy(r => r.k)
  .aggregate(a => ({ m: maxState(a.s) }))
  .aggregate(a => ({ m: maxMerge(a.m) }));

expectTypeOf<Infer<typeof stated>>().toEqualTypeOf<{ m: string }>();

// A fresh state unions with a rollup column of the same stored type.
const stored = table(
  'stored',
  { k: col.String, s: col.AggregateFunction('sum', col.UInt32) },
  meta,
);

const fresh = from(table('src', { k: col.String, v: col.UInt32 }, meta))
  .groupBy(r => r.k)
  .aggregate(a => ({ s: sumState(a.v) }));

const combined = unionAll(from(stored), fresh)
  .groupBy(r => r.k)
  .aggregate(a => ({ s: sumMerge(a.s) }));

expectTypeOf<Infer<typeof combined>>().toEqualTypeOf<{ k: string; s: bigint }>();

// Through a join input.
const joined = join({ a: q, b: from(stored) })
  .on(r => r.a.k.eq(r.b.k))
  .map(r => ({ t: r.a.total, s: r.b.s }))
  .aggregate(a => ({ t: sumMerge(a.t), s: sumMerge(a.s) }));

expectTypeOf<Infer<typeof joined>>().toEqualTypeOf<{ t: bigint; s: bigint }>();

const outer = leftJoin({ a: from(stored) }, { b: q })
  .on(r => r.a.k.eq(r.b.k))
  .map(r => ({ t: r.b.total }))
  .aggregate(a => ({ t: sumMerge(a.t) }));

expectTypeOf<Infer<typeof outer>>().not.toBeAny();

// Wrong function, wrong state, wrong place.
q.aggregate(a => ({
  // @ts-expect-error a sum state is not a max state
  x: maxMerge(a.total),
}));

q.aggregate(a => ({
  // @ts-expect-error a max state is not a sum state
  x: sumMerge(a.top),
}));

q.aggregate(a => ({
  // @ts-expect-error a quantile state is not a quantileExact state
  x: quantileExactMerge(0.5)(a.p),
}));

q.aggregate(a => ({
  // @ts-expect-error a sum state is not a quantile state
  x: quantileMerge(0.5)(a.total),
}));

q.aggregate(a => ({
  // @ts-expect-error a SimpleAggregateFunction stores a value, not a state
  x: maxMerge(a.simple),
}));

q.aggregate(a => ({
  // @ts-expect-error a plain column is not a state
  x: sumMerge(a.n),
}));

// @ts-expect-error a merge is an aggregate, and a map row is not grouped
q.map(r => ({ x: sumMerge(r.total) }));

// @ts-expect-error the level is required
quantileMerge();

// @ts-expect-error the level is a number
quantileMerge('0.5');

// @ts-expect-error the level comes first
quantileMerge(g(col.AggregateFunction('quantile(0.9)', col.Float64)));

// A state has no comparable value in any typed position.
// @ts-expect-error a state has no ordering
q.where(r => r.total.gt(1n));

// @ts-expect-error a state is not a predicate
q.where(r => r.total);
