import { expect, it } from 'vitest';
import { col, table, from, join, sum, sumState, sumMerge, unionAll } from '../src/index.js';

it('retains descriptor twins, names and modes across renamed projections and join spreads', () => {
  const q = from(table('proxy_regression', {
    id: col.String, countOfParts: col.UInt64, version: col.UInt32, value: col.Float64,
    payload: col.Array(col.Tuple({ label: col.Nullable(col.String), n: col.UInt32 })),
  }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const a = q.map(r => ({ id: r.id, count: r.countOfParts }));
  const b = a.map(r => ({ id: r.id, count: r.count.plus(1n) }));
  const c = join({ a: b, b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, count: r.a.count }));
  const d = c.map(r => ({ id: r.id, count: r.count.plus(1n) }));
  const e = join({ a: d, b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, count: r.a.count }));
  const f = e.map(r => ({ id: r.id, count: r.count.plus(1n) }));
  expect(f.row.count.ir.type).toEqual(col.UInt64.type);
  expect([f.row.count.name, f.row.count.mode]).toEqual(['count', 'row']);
  const hinted = q.final().sample(0.1).final();
  expect(hinted.ir).toMatchObject({ kind: 'Scan', final: true, sample: 0.1 });
  const spread = join({ left: hinted, right: q }).on(r => r.left.id.eq(r.right.id)).map(r => ({ ...r.left }));
  const copied = spread.map(r => ({ ...r })).map(r => ({ ...r }));
  const totals = copied.aggregate(g => {
    expect(g.value.mode).toBe('grouped');
    const float = sum(g.value), integer = sum(g.version);
    expect([float.mode, integer.mode]).toEqual(['agg', 'agg']);
    return { float, integer };
  });
  expect(totals.ir.kind).toBe('Aggregate');
  expect(totals.row.float.ir.type).toEqual(col.Float64.type);
  expect(totals.row.integer.ir.type).toEqual(col.UInt64.type);
  const tuples = copied.map(r => ({ labels: r.payload.element('label'), first: r.payload.arrayElement(1).element('label') }));
  expect(tuples.row.labels.ir.type).toEqual(col.Array(col.Nullable(col.String)).type);
  expect(tuples.row.first.ir.type).toEqual(col.Nullable(col.String).type);
  const states = copied.aggregate(g => ({ state: sumState(g.value) })).map(r => ({ renamed: r.state }));
  expect(states.row.renamed.ir.type).toEqual(col.AggregateFunction('sum', col.Float64).type);
  const merged = unionAll(states, states).aggregate(g => ({ value: sumMerge(g.renamed) }));
  expect(merged.row.value.ir.type).toEqual(col.Float64.type);
  expect(merged.caps.live).toBe(false);
});

it('preserves structural descriptors and frozen runtime twins through projection and grouping', () => {
  const source = table('proxy_structural', {
    tuple: col.Tuple([col.UInt64, col.Nullable(col.String)]),
    named: col.NamedTuple([['nested', col.Array(col.Tuple({ price: col.Decimal(18, 4), status: col.Enum8({ open: 1, closed: 2 }) }))]]),
    decimal: col.Decimal(18, 4), status: col.LowCardinality(col.Enum16({ open: 1, closed: 2 })),
    date: col.DateTime64(3, 'UTC'), precise: col.DateTime64(6), opaque: col.Unknown('FutureType'),
  }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const copied = from(source).map(r => ({ ...r })).map(r => ({ ...r }));
  for (const [key, expression] of Object.entries(copied.row)) {
    expect(expression.ir.type).toStrictEqual(source.columns[key]);
    expect(Object.isFrozen(expression.ir.type)).toBe(true);
  }
  expect(Object.isFrozen(copied.row)).toBe(true);
  expect(Object.isFrozen(copied.row.tuple.ir.type.items)).toBe(true);
  expect(Object.isFrozen(copied.row.status.ir.type.inner.values)).toBe(true);
  const nested = copied.map(r => r.named.element('nested')).map(r => ({ prices: r.named.element('price') }));
  expect(nested.row.prices.ir.type).toEqual(col.Array(col.Decimal(18, 4)).type);
  const grouped = copied.groupBy(r => ({ status: r.status, tuple: r.tuple })).aggregate(g => ({ n: sum(g.decimal) }));
  expect(grouped.row.status.ir.type).toStrictEqual(source.columns.status);
  expect(grouped.row.tuple.ir.type).toStrictEqual(source.columns.tuple);
  expect(grouped.row.n.ir.type).toEqual(col.Decimal(38, 4).type);
});
