import { expectTypeOf } from 'expect-type';
import {
  argMaxMerge,
  argMaxState,
  argMinMerge,
  argMinState,
  avgMerge,
  avgState,
  col,
  columnExpr,
  countMerge,
  countState,
  from,
  maxMerge,
  maxState,
  minMerge,
  minState,
  quantileExactMerge,
  quantileExactState,
  quantileMerge,
  quantileState,
  sumMerge,
  sumState,
  table,
  uniqExactMerge,
  uniqExactState,
  uniqMerge,
  uniqState,
  type AggregateState,
  type Column,
  type Decimal,
  type Expr,
  type Infer,
  type NodeId,
} from '@typedhouse/core';

type Phantoms<E> = E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;

const g = <T, S extends boolean, D extends import('@typedhouse/core').CHType>(c: Column<T, S, D>) =>
  columnExpr(c, 1 as NodeId, ['x'], 'x', 'grouped');

const u32 = g(col.UInt32);

const f64 = g(col.Float64);

const text = g(col.String);

const maybeText = g(col.Nullable(col.String));

const maybeU32 = g(col.Nullable(col.UInt32));

const lc = g(col.LowCardinality(col.String));

const lcn = g(col.LowCardinality(col.Nullable(col.String)));

const arrayLc = g(col.Array(col.LowCardinality(col.String)));

const decimal = g(col.Decimal(18, 2));

const instant = g(col.DateTime('UTC'));

// Each state names its function and keeps its operand descriptors.
expectTypeOf(countState()).not.toBeAny();
expectTypeOf(sumState(u32).ir.type.fn).toEqualTypeOf<'sum'>();
expectTypeOf(maxState(u32).ir.type.fn).toEqualTypeOf<'max'>();
expectTypeOf(minState(u32).ir.type.fn).toEqualTypeOf<'min'>();
expectTypeOf(avgState(u32).ir.type.fn).toEqualTypeOf<'avg'>();
expectTypeOf(uniqState(text).ir.type.fn).toEqualTypeOf<'uniq'>();
expectTypeOf(uniqExactState(text).ir.type.fn).toEqualTypeOf<'uniqExact'>();
expectTypeOf(argMaxState(text, u32).ir.type.fn).toEqualTypeOf<'argMax'>();
expectTypeOf(argMinState(text, instant).ir.type.fn).toEqualTypeOf<'argMin'>();
expectTypeOf(quantileState(0.9)(f64).ir.type.fn).toEqualTypeOf<'quantile(0.9)'>();
expectTypeOf(quantileExactState(0.5)(u32).ir.type.fn).toEqualTypeOf<'quantileExact(0.5)'>();
expectTypeOf(quantileState(1)(f64).ir.type.fn).toEqualTypeOf<'quantile(1.)'>();
expectTypeOf(quantileState(0)(f64).ir.type.fn).toEqualTypeOf<'quantile(0.)'>();
declare const dynamicLevel: number;
expectTypeOf(quantileState(dynamicLevel)(f64).ir.type.fn).toEqualTypeOf<`quantile(${number})`>();

for (const state of [
  sumState(u32),
  maxState(u32),
  minState(u32),
  avgState(u32),
  uniqState(text),
  uniqExactState(text),
  argMaxState(text, u32),
  argMinState(text, u32),
  quantileState(0.5)(u32),
  quantileExactState(0.5)(u32),
])
  expectTypeOf(state).not.toBeAny();

// LowCardinality is dropped at every depth, as at runtime.
expectTypeOf(maxState(lc).ir.type.args[0].name).toEqualTypeOf<'String'>();
expectTypeOf(maxState(lcn).ir.type.args[0].kind).toEqualTypeOf<'Nullable'>();
expectTypeOf(maxState(lcn).ir.type.args[0].inner.name).toEqualTypeOf<'String'>();
expectTypeOf(minState(arrayLc).ir.type.args[0].inner.name).toEqualTypeOf<'String'>();

expectTypeOf(
  minState(g(col.SimpleAggregateFunction('max', col.LowCardinality(col.String)))).ir.type,
).not.toBeAny();

const named = maxState(
  g(
    col.NamedTuple([
      ['a', col.LowCardinality(col.String)],
      ['b', col.UInt8],
    ]),
  ),
);

expectTypeOf(named.ir.type.args[0].items[0].type.name).toEqualTypeOf<'String'>();
expectTypeOf(named.ir.type.args[0].items[0].name).toEqualTypeOf<'a'>();
const keyed = maxState(g(col.Map(col.LowCardinality(col.String), col.LowCardinality(col.UInt8))));
expectTypeOf(keyed.ir.type.args[0].key.name).toEqualTypeOf<'String'>();
expectTypeOf(keyed.ir.type.args[0].value.name).toEqualTypeOf<'UInt8'>();

// Merging a state read from a rollup column gives the base function's result.
const state = <F extends string, const C extends readonly Column[]>(fn: F, ...args: C) =>
  columnExpr(col.AggregateFunction(fn, ...args), 1 as NodeId, ['s'], 's', 'grouped');

expectTypeOf<Phantoms<ReturnType<typeof mergedCount>>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();

function mergedCount() {
  return countMerge(state('count'));
}

const sumU = sumMerge(state('sum', col.UInt32));
expectTypeOf<Phantoms<typeof sumU>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();
expectTypeOf(sumU.ir.type.name).toEqualTypeOf<'UInt64'>();
expectTypeOf(sumU).not.toBeAny();
const sumN = sumMerge(state('sum', col.Nullable(col.UInt32)));
expectTypeOf<Phantoms<typeof sumN>>().toEqualTypeOf<Expr<bigint | null, 's', 'agg'>>();
const sumD = sumMerge(state('sum', col.Decimal(18, 2)));
expectTypeOf<Phantoms<typeof sumD>>().toEqualTypeOf<Expr<Decimal<38, 2>, 's', 'agg'>>();

const maxS = maxMerge(state('max', col.String));
expectTypeOf<Phantoms<typeof maxS>>().toEqualTypeOf<Expr<string, 's', 'agg'>>();
const minD = minMerge(state('min', col.Date));
expectTypeOf<Phantoms<typeof minD>>().toEqualTypeOf<Expr<Date, 's', 'agg'>>();
const minA = minMerge(state('min', col.Array(col.LowCardinality(col.String))));
expectTypeOf(minA.ir.type.inner.name).toEqualTypeOf<'String'>();
expectTypeOf(minA.ir.type.kind).toEqualTypeOf<'Array'>();

const argMaxN = argMaxMerge(state('argMax', col.Nullable(col.String), col.UInt32));
expectTypeOf<Phantoms<typeof argMaxN>>().toEqualTypeOf<Expr<string | null, 's', 'agg'>>();
const argMinU = argMinMerge(state('argMin', col.UInt32, col.Date));
expectTypeOf<Phantoms<typeof argMinU>>().toEqualTypeOf<Expr<number, 's', 'agg'>>();
expectTypeOf(argMinU.ir.type.name).toEqualTypeOf<'UInt32'>();

const avgU = avgMerge(state('avg', col.UInt32));
expectTypeOf<Phantoms<typeof avgU>>().toEqualTypeOf<Expr<number, 's', 'agg'>>();
const avgN = avgMerge(state('avg', col.Nullable(col.UInt32)));
expectTypeOf<Phantoms<typeof avgN>>().toEqualTypeOf<Expr<number | null, 's', 'agg'>>();

const uniqed = uniqMerge(state('uniq', col.Nullable(col.String)));
expectTypeOf<Phantoms<typeof uniqed>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();
expectTypeOf(uniqed.ir.type.name).toEqualTypeOf<'UInt64'>();
const exact = uniqExactMerge(state('uniqExact', col.String));
expectTypeOf<Phantoms<typeof exact>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();

const q90 = quantileMerge(0.9)(state('quantile(0.9)', col.Float64));
expectTypeOf<Phantoms<typeof q90>>().toEqualTypeOf<Expr<number, 's', 'agg'>>();
const qBare = quantileMerge(0.5)(state('quantile', col.UInt32));
expectTypeOf<Phantoms<typeof qBare>>().toEqualTypeOf<Expr<number, 's', 'agg'>>();
const qN = quantileMerge(0.9)(state('quantile(0.9)', col.Nullable(col.Float64)));
expectTypeOf<Phantoms<typeof qN>>().toEqualTypeOf<Expr<number | null, 's', 'agg'>>();
const qx = quantileExactMerge(0.5)(state('quantileExact(0.9)', col.UInt64));
expectTypeOf<Phantoms<typeof qx>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();
expectTypeOf(qx.ir.type.name).toEqualTypeOf<'UInt64'>();
const qxN = quantileExactMerge(0.9)(state('quantileExact(0.9)', col.Nullable(col.UInt32)));
expectTypeOf<Phantoms<typeof qxN>>().toEqualTypeOf<Expr<number | null, 's', 'agg'>>();

// A rollup's stored arguments need not be ones the base function accepts: the result is UInt64 regardless.
const uniqNumeric = uniqMerge(state('uniq', col.UInt64));
expectTypeOf<Phantoms<typeof uniqNumeric>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();
expectTypeOf(uniqNumeric.ir.type.name).toEqualTypeOf<'UInt64'>();
const uniqTwo = uniqMerge(state('uniq', col.String, col.UInt64));
expectTypeOf<Phantoms<typeof uniqTwo>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();
expectTypeOf(uniqTwo.ir.type.name).toEqualTypeOf<'UInt64'>();
const exactTuple = uniqExactMerge(state('uniqExact', col.Tuple([col.String, col.UInt8])));
expectTypeOf<Phantoms<typeof exactTuple>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();
const countOver = countMerge(state('count', col.Nullable(col.UInt64)));
expectTypeOf<Phantoms<typeof countOver>>().toEqualTypeOf<Expr<bigint, 's', 'agg'>>();

for (const merged of [sumU, maxS, minD, argMaxN, argMinU, avgU, uniqed, exact, q90, qx])
  expectTypeOf(merged).not.toBeAny();

// End to end through a query, including the codegen shape of a parametric rollup column.
const rollup = table(
  'rollup',
  {
    k: col.String,
    latency: col.AggregateFunction('quantile(0.9)', col.Float64),
    total: col.AggregateFunction('sum', col.UInt64),
  },
  { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
);

const read = from(rollup)
  .groupBy(r => r.k)
  .aggregate(g => ({ p90: quantileMerge(0.9)(g.latency), total: sumMerge(g.total) }));

expectTypeOf<Infer<typeof read>>().toEqualTypeOf<{ k: string; p90: number; total: bigint }>();
expectTypeOf<Infer<typeof read>>().not.toBeAny();
const counted = from(rollup).count();
expectTypeOf<Infer<typeof counted>>().not.toBeAny();
const plain = from(rollup).map(r => ({ k: r.k }));
expectTypeOf<Infer<typeof plain>>().toEqualTypeOf<{ k: string }>();

const twice = from(
  table(
    'events',
    { k: col.String, u: col.UInt32 },
    { engine: 'Memory', sortingKey: [], partitionKey: [] },
  ),
)
  .groupBy(r => r.k)
  .aggregate(g => ({ state: sumState(g.u) }))
  .aggregate(g => ({ total: sumMerge(g.state) }));

expectTypeOf<Infer<typeof twice>>().toEqualTypeOf<{ total: bigint }>();

expectTypeOf<ReturnType<typeof quantileState<0.9>>>().not.toBeAny();

expectTypeOf<AggregateState<'quantile(0.9)'>>().toMatchTypeOf<
  AggregateState<`quantile(${number})`>
>();

void decimal;
void maybeText;
void maybeU32;
