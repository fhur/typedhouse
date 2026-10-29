import { expectTypeOf } from 'expect-type';
import { col, table, from, join, sum, sumState, sumMerge, scalar, unionAll, type Infer, type Query, type TableQuery, type AggregateState, type Decimal, type CHType } from '@chql/core';

const q = from(table('proxy_regression', {
  id: col.String, countOfParts: col.UInt64, version: col.UInt32, value: col.Float64,
  payload: col.Array(col.Tuple({ label: col.Nullable(col.String), n: col.UInt32 })),
}, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
// Original minimal TS2590: rename, arithmetic, join-spread, repeat twice.
const a = q.map(r => ({ id: r.id, count: r.countOfParts }));
const b = a.map(r => ({ id: r.id, count: r.count.plus(1n) }));
const c = join({ a: b, b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, count: r.a.count }));
const d = c.map(r => ({ id: r.id, count: r.count.plus(1n) }));
const e = join({ a: d, b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, count: r.a.count }));
const f = e.map(r => ({ id: r.id, count: r.count.plus(1n) }));
expectTypeOf<Infer<typeof f>>().toEqualTypeOf<{ id: string; count: bigint }>();
expectTypeOf<Infer<typeof f>>().not.toBeAny();
expectTypeOf(f.row.count.ir.type.name).toEqualTypeOf<'UInt64'>();
expectTypeOf(f.row.count.name).toEqualTypeOf<'count'>();
expectTypeOf(f.row.count.mode).toEqualTypeOf<'row'>();

const hinted = q.final().sample(0.1).final();
const defaultTable: TableQuery<Infer<typeof q>> = hinted;
const defaultQuery: Query<Infer<typeof q>> = hinted;
expectTypeOf(defaultTable).not.toBeAny();
expectTypeOf(defaultQuery).not.toBeAny();
const spread = join({ left: hinted, right: q }).on(r => r.left.id.eq(r.right.id)).map(r => ({ ...r.left }));
const copied = spread.map(r => ({ ...r })).map(r => ({ ...r }));
expectTypeOf<Infer<typeof copied>>().toEqualTypeOf<Infer<typeof q>>();
expectTypeOf<Infer<typeof copied>>().not.toBeAny();
const totals = copied.aggregate(g => ({ float: sum(g.value), integer: sum(g.version) }));
expectTypeOf<Infer<typeof totals>>().toEqualTypeOf<{ float: number; integer: bigint }>();
expectTypeOf<Infer<typeof totals>>().not.toBeAny();
expectTypeOf(totals.row.float.ir.type.name).toEqualTypeOf<'Float64'>();
expectTypeOf(totals.row.integer.ir.type.name).toEqualTypeOf<'UInt64'>();
expectTypeOf(totals.ir.kind).toEqualTypeOf<'Aggregate'>();
const single = copied.aggregate(g => sum(g.value));
const scalarValue = scalar(single);
expectTypeOf(scalarValue.mode).toEqualTypeOf<'row'>();
const tuples = copied.map(r => ({ labels: r.payload.element('label'), first: r.payload.arrayElement(1).element('label') }));
expectTypeOf<Infer<typeof tuples>>().toEqualTypeOf<{ labels: (string | null)[]; first: string | null }>();
expectTypeOf<Infer<typeof tuples>>().not.toBeAny();
expectTypeOf(tuples.row.labels.ir.type.inner.kind).toEqualTypeOf<'Nullable'>();
expectTypeOf(tuples.row.first.ir.type.inner.name).toEqualTypeOf<'String'>();
const states = copied.aggregate(g => ({ state: sumState(g.value) })).map(r => ({ renamed: r.state }));
expectTypeOf<Infer<typeof states>>().toEqualTypeOf<{ renamed: AggregateState<'sum'> }>();
expectTypeOf<Infer<typeof states>>().not.toBeAny();
const merged = unionAll(states, states).aggregate(g => ({ value: sumMerge(g.renamed) }));
expectTypeOf<Infer<typeof merged>>().toEqualTypeOf<{ value: number }>();
expectTypeOf<Infer<typeof merged>>().not.toBeAny();
expectTypeOf(merged.row.value.ir.type.name).toEqualTypeOf<'Float64'>();
const nested = join({ a: copied, b: copied }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.eq(r.b.id)).cte();
const nestedTotals = nested.groupBy(r => r.a.id).aggregate(g => ({ value: sum(g.b.value) }));
expectTypeOf<Infer<typeof nestedTotals>>().toEqualTypeOf<{ id: string; value: number }>();
expectTypeOf<Infer<typeof nestedTotals>>().not.toBeAny();
// Adversarial structural descriptors: preserve mutable descriptor arrays, readonly
// positional decoded tuples, literal unions, brands and intentionally erased types.
const rich = from(table('proxy_structural', {
  tuple: col.Tuple([col.UInt64, col.Nullable(col.String)]),
  named: col.NamedTuple([['nested', col.Array(col.Tuple({ price: col.Decimal(18, 4), status: col.Enum8({ open: 1, closed: 2 }) }))]]),
  decimal: col.Decimal(18, 4),
  status: col.LowCardinality(col.Enum16({ open: 1, closed: 2 })),
  date: col.DateTime64(3, 'UTC'), precise: col.DateTime64(6),
  opaque: col.Unknown('FutureType'),
}, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const richCopy = rich.map(r => ({ ...r })).map(r => ({ ...r }));
expectTypeOf<Infer<typeof richCopy>>().toEqualTypeOf<{
  tuple: readonly [bigint, string | null];
  named: { nested: { price: Decimal<18, 4>; status: 'open' | 'closed' }[] };
  decimal: Decimal<18, 4>; status: 'open' | 'closed'; date: Date; precise: string; opaque: unknown;
}>();
expectTypeOf<Infer<typeof richCopy>>().not.toBeAny();
expectTypeOf(richCopy.row.decimal.ir.type.precision).toEqualTypeOf<18>();
expectTypeOf(richCopy.row.decimal.ir.type.scale).toEqualTypeOf<4>();
expectTypeOf(richCopy.row.status.ir.type.inner.values[0]!.name).toEqualTypeOf<'open' | 'closed'>();
expectTypeOf(richCopy.row.status.ir.type.inner.bits).toEqualTypeOf<16>();
expectTypeOf(richCopy.row.date.ir.type.precision).toEqualTypeOf<3>();
expectTypeOf(richCopy.row.date.ir.type.tz).toEqualTypeOf<string | undefined>();
expectTypeOf(richCopy.row.precise.ir.type.precision).toEqualTypeOf<6>();
expectTypeOf(richCopy.row.opaque.ir.type).toEqualTypeOf<CHType>();
expectTypeOf(richCopy.row.tuple.ir.type.items[0].type.name).toEqualTypeOf<'UInt64'>();
const nestedFields = richCopy.map(r => r.named.element('nested')).map(r => ({ prices: r.named.element('price') }));
expectTypeOf<Infer<typeof nestedFields>>().toEqualTypeOf<{ prices: Decimal<18, 4>[] }>();
expectTypeOf<Infer<typeof nestedFields>>().not.toBeAny();
const richGrouped = richCopy.groupBy(r => ({ status: r.status, tuple: r.tuple })).aggregate(g => ({ n: sum(g.decimal) }));
expectTypeOf(richGrouped.row.status.ir.type.inner.bits).toEqualTypeOf<16>();
expectTypeOf(richGrouped.row.tuple.ir.type.items[1].type.inner.name).toEqualTypeOf<'String'>();
expectTypeOf(copied.caps.live).toEqualTypeOf<false>();
expectTypeOf(copied.orderBy(r => r.id).thenBy(r => r.value).limit(2).row.value.ir.type.name).toEqualTypeOf<'Float64'>();
