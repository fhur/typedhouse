import { expect, it } from 'vitest';
import { col, from, table, crossJoin, sum } from '../src/index.js';
const metadata = { engine: 'Memory', sortingKey: [], partitionKey: [] };
it('retains immutable input, descriptors, mixed nested proxies and capabilities without stages', () => {
  const source = from(table('t', { id: col.UInt64, xs: col.Array(col.Nullable(col.String)) }, { ...metadata, source: { kind: 'test' } }));
  const nested = crossJoin({ a: source, b: source }).leftArrayJoin(r => r.a.xs, 'item');
  for (const input of [source, nested, source.orderBy(r => r.id), source.aggregate(g => sum(g.id))]) {
    const result = input.materialize();
    expect(result.ir.kind).toBe('Materialize');
    if (result.ir.kind !== 'Materialize') throw new Error('wrong kind');
    expect(result.ir.input).toBe(input.ir);
    expect(result.ir.output).toStrictEqual(input.ir.output);
    expect(result.caps).toBe(input.caps);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ir)).toBe(true);
    expect('final' in result).toBe(false);
    expect('thenBy' in result).toBe(false);
  }
  const fenced = nested.materialize();
  expect(fenced.row.a.id.ir.type).toStrictEqual(nested.row.a.id.ir.type);
  expect(fenced.row.item.ir.type).toStrictEqual(nested.row.item.ir.type);
  expect(fenced.row.item.ir).toMatchObject({ kind: 'ColumnRef', rel: fenced.ir.id, path: ['item'] });
  expect(from(table('offline', { id: col.UInt64 }, metadata)).materialize().caps.live).toBe(false);
});
