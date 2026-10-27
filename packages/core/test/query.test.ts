import { expect, it } from 'vitest';
import { col, table, from, registerCompiler, Expr, val, count, type Ordering } from '../src/index.js';
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
it('builds immutable ordering and one Sort with appended or replacement keys', () => {
  const q = from(t).map(r => ({ ...r })).where(r => r.id.gt(0n));
  const ascending = q.row.id.asc();
  expect(ascending).not.toBeInstanceOf(Expr);
  expect(Object.isFrozen(ascending)).toBe(true);
  expect(ascending.nullsFirst().nullsLast().nulls).toBe('last');
  expect(ascending.nulls).toBeUndefined();
  const ordered = q.orderBy(r => r.id.desc());
  const appended = ordered.thenBy(r => {
    expect(r).toBe(ordered.row);
    expect(r.id.ir).toMatchObject({ rel: ordered.ir.id });
    return r.tuple.element('name').asc().nullsFirst();
  });
  expect(Object.isFrozen(appended)).toBe(true);
  if (appended.ir.kind !== 'Sort') throw new Error('not Sort');
  expect(appended.ir.input).toBe(q.ir);
  expect(appended.ir.keys[0]!.expr).toBe(ordered.ir.kind === 'Sort' ? ordered.ir.keys[0]!.expr : undefined);
  expect(appended.ir.keys).toHaveLength(2);
  expect(appended.ir.keys[1]!.expr).toMatchObject({ kind: 'Call', args: [{ rel: q.ir.id }, { value: 'name' }] });
  const replaced = appended.orderBy(r => {
    expect(r).toBe(appended.row);
    return r.id;
  });
  expect(replaced.ir).toMatchObject({ input: q.ir, keys: [{ dir: 'asc', expr: { rel: q.ir.id } }] });
  for (const plain of [ordered.where(r => r.id.gt(0n)), ordered.map(r => r.id), ordered.limit(1), ordered.distinct()]) expect('thenBy' in plain).toBe(false);
  expect(() => q.map(() => val(1) as unknown as typeof q.row.id)).toThrow(/unnamed_expression/);
  expect(() => q.orderBy(() => count().asc() as unknown as Ordering)).toThrow(/invalid_sort_expression/);
  expect(q.map(r => r.tuple).distinct().row.tuple.element('name').ir.type).toEqual(col.String.type);
});
it('computes capabilities and uses explicit compiler attachment', () => {
  const live = from(table('live', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [], source: { kind: 'test' } }));
  expect(live.where(r => r.id.eq(2n)).caps.live).toBe(true);
  expect(live.map(r => ({ id: r.id })).limit(1).caps.live).toBe(true);
  registerCompiler(emitNaive);
  expect(from(t).limit(1).toSQL().sql).toContain('LIMIT 1');
});
