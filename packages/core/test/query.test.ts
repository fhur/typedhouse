import { expect, it } from 'vitest';
import { col, table, from, registerCompiler } from '../src/index.js';
import { emitNaive } from '@chql/compiler';
const t = table('t', { id: col.UInt64, tuple: col.Tuple({ name: col.String }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
it('binds immutable rows to each immediate input and preserves descriptors', () => {
  const q = from(t); const filtered = q.where(r => r.id.eq(1n));
  const projected = filtered.map(r => ({ renamed: r.tuple }));
  const limited = projected.limit(2);
  expect(Object.isFrozen(q.row)).toBe(true);
  expect(q.row.id.ir).toMatchObject({ kind: 'ColumnRef', rel: q.ir.id, path: ['id'] });
  expect(filtered.row.id.ir).toMatchObject({ rel: filtered.ir.id });
  expect(limited.row.renamed.ir).toMatchObject({ rel: limited.ir.id, type: t.columns.tuple });
  expect(limited.row.renamed.element('name').ir.type).toEqual(col.String.type);
  expect(q.ir.kind).toBe('Scan');
  expect(q.caps.live).toBe(false);
});
it('computes capabilities and uses explicit compiler attachment', () => {
  const live = from(table('live', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [], source: { kind: 'test' } }));
  expect(live.where(r => r.id.eq(2n)).caps.live).toBe(true);
  expect(live.map(r => ({ id: r.id })).limit(1).caps.live).toBe(true);
  registerCompiler(emitNaive);
  expect(from(t).limit(1).toSQL().sql).toContain('LIMIT 1');
});
