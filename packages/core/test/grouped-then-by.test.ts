import { expect, it } from 'vitest';
import { col, count, from, join, sum, table, val } from '../src/index.js';

const source = from(
  table(
    'grouped_then_by',
    {
      price_type: col.String,
      origin: col.Nullable(col.String),
      quantity: col.UInt32,
    },
    { engine: 'Memory', sortingKey: [], partitionKey: [] },
  ),
);

it('appends keys immutably and aggregates the original input', () => {
  const first = source.groupBy(r => r.price_type);
  const second = first.thenBy(r => r.origin);
  const third = second.thenBy(r => ({ size: r.quantity }));
  expect(first.keys.map(([name]) => name)).toEqual(['price_type']);
  expect(second.keys.map(([name]) => name)).toEqual(['price_type', 'origin']);
  expect(third.keys.map(([name]) => name)).toEqual(['price_type', 'origin', 'size']);
  const result = third.aggregate(r => ({ total: sum(r.quantity), count: count() }));
  expect(result.row.price_type.ir.type).toEqual(col.String.type);
  expect(result.row.origin.ir.type).toEqual(col.Nullable(col.String).type);
  expect(result.row.size.ir.type).toEqual(col.UInt32.type);
  expect(result.row.total.ir.type).toEqual(col.UInt64.type);
  expect(result.caps).toEqual(source.caps);
  expect(second.count().row.count.ir.type).toEqual(col.UInt64.type);
});

it('supports nested join inputs, expressions and prototype-shaped aliases', () => {
  const grouped = join({ a: source, b: source })
    .on(r => r.a.price_type.eq(r.b.price_type))
    .groupBy(r => ({ kind: r.a.price_type }))
    .thenBy(r => ({ ['__proto__']: r.b.origin.ifNull('unknown') }))
    .count();

  expect(grouped.row.__proto__.ir.type).toEqual(col.String.type);
  expect(grouped.row.kind.ir.type).toEqual(col.String.type);
});

it('validates duplicate names and unnamed expressions at runtime', () => {
  const grouped = source.groupBy(r => r.price_type);
  // @ts-expect-error duplicate grouping key
  expect(() => grouped.thenBy(r => r.price_type)).toThrow('duplicate_column');
  // @ts-expect-error constants need an explicit alias
  expect(() => grouped.thenBy(() => val(1))).toThrow('unnamed_expression');
});
