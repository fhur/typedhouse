import { expect, it } from 'vitest';
import { col, from, table, val, uniqExact, uniqExactIf, aggregateDefinitions } from '../src/index.js';
const q = from(table('strings', { value: col.Nullable(col.String), selected: col.Nullable(col.Bool) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('retains UInt64, value naming, agg mode, immutable nodes and exact metadata', () => {
  const result = q.aggregate(g => {
    const exact = uniqExact(g.value);
    expect(exact.name).toBe('value');
    expect(exact.mode).toBe('agg');
    expect(exact.ir.type).toEqual(col.UInt64.type);
    expect(Object.isFrozen(exact.ir)).toBe(true);
    return { exact, selected: uniqExactIf(g.value, g.selected) };
  });
  expect(result.row.selected.ir.type).toEqual(col.UInt64.type);
  expect(aggregateDefinitions.find(d => d.name === 'uniqExact')).toMatchObject({ deterministic: true, linear: false, nullable: 'never' });
});
it('names constants by function, never predicate; retains shared Param identity', () => {
  const value = val("'\\\n\0日本語");
  const result = q.aggregate(g => {
    const a = uniqExactIf(value, g.selected), b = uniqExact(value);
    expect(a.name).toBe('uniqExact');
    if (a.ir.kind !== 'Agg' || b.ir.kind !== 'Agg') throw new Error('Agg');
    expect(a.ir.args[0]).toBe(value.ir);
    expect(b.ir.args[0]).toBe(value.ir);
    expect(a.ir.combinators).toEqual(['If']);
    expect(Object.isFrozen(a.ir.args)).toBe(true);
    return { a, b };
  });
  expect(result.ir.columns).toEqual({ a: col.UInt64.type, b: col.UInt64.type });
  expect(q.aggregate(() => uniqExact(val(null, col.Nullable(col.String)))).row.uniqExact.ir.type).toEqual(col.UInt64.type);
});
