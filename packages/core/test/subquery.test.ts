import { expect, it } from 'vitest';
import { col, table, from, count, sum, max, scalar, scalarDescriptor, print, flatOutput, deterministic, exprNode, Expr } from '../src/index.js';
const q = from(table('s', { stock: col.Float64, n: col.Nullable(col.Int64) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('retains identity, name and immutable nullable descriptor evidence', () => {
  const total = q.aggregate(g => sum(g.stock));
  const e = scalar(total);
  expect(e.ir.kind === 'Subquery' && e.ir.rel).toBe(total.ir);
  expect(e.name).toBe('stock');
  expect(e.mode).toBe('row');
  expect(print(e.ir.type)).toBe('Nullable(Float64)');
  expect(Object.isFrozen(e)).toBe(true);
  expect(Object.isFrozen(e.ir)).toBe(true);
  expect(print(scalar(q.aggregate(g => sum(g.n))).ir.type)).toBe('Nullable(Int64)');
  expect(print(scalar(q.aggregate(() => count())).ir.type)).toBe('Nullable(UInt64)');
  expect(q.map(() => e).caps.live).toBe(false);
});
it('retains Date and Nullable(Date) evidence without widening temporal families', () => {
  const dates = from(table('dates', { day: col.Date, maybe: col.Nullable(col.Date) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  for (const e of [scalar(dates.aggregate(g => max(g.day))), scalar(dates.aggregate(g => max(g.maybe)))]) {
    expect(print(e.ir.type)).toBe('Nullable(Date)');
    expect(e.mode).toBe('row');
    expect(e.ir.kind === 'Subquery' && e.ir.rel.kind).toBe('Aggregate');
    expect(Object.isFrozen(e.ir)).toBe(true);
  }
  for (const descriptor of [col.Date32, col.DateTime(), col.DateTime64(3)]) {
    const total = dates.aggregate(g => max(g.day)).ir;
    const output = flatOutput([['day', descriptor.type]]);
    expect(() => scalarDescriptor({ ...total, output, columns: output.columns })).toThrow('unsupported_scalar_type');
  }
});
it('propagates capability through the complete referenced relation', () => {
  const live = from(table('live', { stock: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [], source: { kind: 'test' } }));
  expect(live.map(() => scalar(live.aggregate(g => sum(g.stock)))).caps.live).toBe(true);
  expect(live.map(() => scalar(q.aggregate(g => sum(g.stock)))).caps.live).toBe(false);
  const nondeterministic = new Expr<number, 'stock'>(exprNode({ kind: 'Call', fn: { name: 'rand', origin: 'known', deterministic: false }, args: [], type: col.Float64.type }), 'stock', 'row');
  const inner = live.map(() => nondeterministic).aggregate(g => sum(g.stock));
  expect(deterministic(scalar(inner).ir)).toBe(false);
  expect(live.map(() => scalar(inner)).caps.live).toBe(false);
});
it('rejects unsupported shape and cardinality at runtime, not LIMIT 1', () => {
  expect(() => scalarDescriptor(q.ir)).toThrow('scalar_cardinality');
  expect(() => scalarDescriptor(q.groupBy(r => r.stock).aggregate(() => count()).ir)).toThrow('scalar_cardinality');
  expect(() => scalarDescriptor(q.aggregate(g => ({ a: sum(g.stock), b: count() })).ir)).toThrow('scalar_column_count');
  const total = q.aggregate(() => count()).ir;
  const output = flatOutput([['count', col.Array(col.UInt64).type]]);
  expect(() => scalarDescriptor({ ...total, output, columns: output.columns })).toThrow('unsupported_scalar_type');
});
