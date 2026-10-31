import { expect, it } from 'vitest';
import { col, count, from, join, table } from '../src/index.js';

const source = from(table('grouped_count', { key: col.Nullable(col.String), n: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));

it('uses the ordinary aggregate path and retains keys and UInt64 descriptors', () => {
  const grouped = source.groupBy(r => ({ key: r.key, n: r.n }));
  const shortcut = grouped.count();
  const explicit = grouped.aggregate(() => ({ count: count() }));
  expect(shortcut.ir).toMatchObject({ kind: 'Aggregate' });
  if (shortcut.ir.kind !== 'Aggregate' || explicit.ir.kind !== 'Aggregate') throw new Error('expected aggregates');
  expect(shortcut.ir.aggs.count).toEqual({ ...explicit.ir.aggs.count, id: shortcut.ir.aggs.count!.id });
  expect(shortcut.ir.keys).toEqual(explicit.ir.keys);
  expect(shortcut.ir.output).toEqual(explicit.ir.output);
  expect(shortcut.caps).toEqual(explicit.caps);
  expect(shortcut.row.count.ir.type).toEqual(col.UInt64.type);
  expect(shortcut.row.key.ir.type).toEqual(col.Nullable(col.String).type);
  expect(shortcut.where(r => r.count.gt(1n)).orderBy(r => r.count).limit(2).ir.kind).toBe('Limit');
});

it('supports scalar keys and grouping nested join inputs', () => {
  expect(source.groupBy(r => r.key).count().row.count.ir.type).toEqual(col.UInt64.type);
  const grouped = join({ a: source, b: source }).on(r => r.a.n.eq(r.b.n))
    .groupBy(r => ({ key: r.a.key })).count();
  expect(grouped.row.key.ir.type).toEqual(col.Nullable(col.String).type);
  expect(grouped.row.count.ir.type).toEqual(col.UInt64.type);
});
