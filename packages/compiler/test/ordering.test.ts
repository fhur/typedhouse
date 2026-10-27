import { expect, it } from 'vitest';
import { col, table, from, val, relNode, flatOutput, count, type SortKey } from '@chql/core';
import { emitNaive } from '../src/index.js';
const t = table('t', { id: col.UInt64, name: col.Nullable(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
it('emits explicit scoped sort/distinct columns and parameters in SQL occurrence order', () => {
  const shared = val(2n, col.UInt64);
  const input = from(t).map(r => ({ id: r.id.plus(shared), name: r.name }));
  const q = input.orderBy(r => r.id.plus(shared).desc()).thenBy(r => r.name.asc().nullsFirst());
  const compiled = emitNaive(q.ir);
  expect(compiled.sql).toBe('SELECT `__chql_input`.`id`, `__chql_input`.`name` FROM (SELECT plus(`__chql_input`.`id`, {p0:UInt64}) AS `id`, `__chql_input`.`name` AS `name` FROM (SELECT `id`, `name` FROM `t`) AS `__chql_input`) AS `__chql_input` ORDER BY plus(`__chql_input`.`id`, {p0:UInt64}) DESC, `__chql_input`.`name` ASC NULLS FIRST');
  expect(compiled.params).toEqual({ p0: '2' });
  expect(emitNaive(q.map(r => r.name).distinct().ir).sql).toContain('SELECT DISTINCT `__chql_input`.`name` FROM (SELECT');
  expect(emitNaive(q.limit(1).ir).sql).toMatch(/ORDER BY .*\) LIMIT 1$/);
  expect(emitNaive(input.limit(1).orderBy(r => r.id).ir).sql).toMatch(/LIMIT 1\) AS `__chql_input` ORDER BY `__chql_input`.`id` ASC$/);
});
it('rebinds sort-row expressions without cloning shared Params or legitimizing foreign refs', () => {
  const shared = val(2n, col.UInt64);
  const q = from(t).orderBy(r => r.id.plus(shared));
  const appended = q.thenBy(r => r.id.plus(shared).desc());
  if (appended.ir.kind !== 'Sort' || appended.ir.keys[1]!.expr.kind !== 'Call') throw new Error('wrong graph');
  expect(appended.ir.keys[1]!.expr.args[1]).toBe(shared.ir);
  expect(emitNaive(appended.ir).params).toEqual({ p0: '2' });
  const replacement = appended.orderBy(() => appended.row.id.plus(shared));
  expect(emitNaive(replacement.ir).sql).toContain('ORDER BY plus(`__chql_input`.`id`, {p0:UInt64}) ASC');
  expect(() => emitNaive(q.thenBy(() => from(t).row.id).ir)).toThrow(/unbound_column/);
});
it('rejects malformed sort keys, schema mismatch, aggregation and foreign bindings by named paths', () => {
  const q = from(t), other = from(t);
  const build = (keys: readonly SortKey[]) => relNode({ kind: 'Sort', input: q.ir, output: q.ir.output, keys });
  for (const keys of [[], [null], [{ expr: q.row.id.ir, dir: 'ASC' }], [{ expr: q.row.id.ir, dir: 'asc', nulls: 'random' }]]) {
    expect(() => emitNaive(build(keys as readonly SortKey[]))).toThrow(/invalid_sort_key at root.keys/);
  }
  expect(() => emitNaive(build([{ expr: other.row.id.ir, dir: 'asc' }]))).toThrow(/unbound_column at root.keys\[0\].expr/);
  expect(() => emitNaive(build([{ expr: count().ir, dir: 'asc' }]))).toThrow(/invalid_aggregate_placement at root.keys\[0\].expr/);
  for (const kind of ['Sort', 'Distinct'] as const) expect(() => emitNaive(relNode({ kind, input: q.ir, output: flatOutput([['wrong', col.String.type]]), keys: [] }))).toThrow(/invalid_output at root/);
});
