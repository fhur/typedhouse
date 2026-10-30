import { expect, it } from 'vitest';
import { col, columnExpr, from, table, relNode, flatOutput, val, type Rel } from '@typedhouse/core';
import { emitNaive } from '../src/index.js';
const t = table('t`', { id: col.UInt32, a: col.Array(col.Tuple({ label: col.String })) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [], source: { kind: 'test' } });
it('retains immutable scan hints, source capabilities and exact descriptors', () => {
  const q = from(t), hinted = q.sample(0.25).final();
  expect(Object.isFrozen(hinted)).toBe(true);
  expect(hinted.caps.live).toBe(true);
  expect(hinted.row.a.ir.type).toEqual(t.columns.a);
  expect(hinted.ir.kind === 'Scan' && hinted.ir.table.source).toEqual({ kind: 'test' });
  expect(emitNaive(hinted.ir).sql).toBe('SELECT `id`, `a` FROM `t\\`` FINAL SAMPLE 0.25');
  expect(emitNaive(q.ir).sql).not.toContain('FINAL');
  expect('final' in hinted.where(r => r.id.eq(1))).toBe(false);
  expect('sample' in hinted.arrayJoin(r => r.a, 'v')).toBe(false);
  for (const sample of [0, -1, 1.01, NaN, Infinity, '0.1; DROP']) {
    expect(() => emitNaive({ ...q.ir, sample } as Rel)).toThrow(/invalid_scan_hint at root.sample/);
  }
  expect(() => emitNaive({ ...q.ir, final: 'yes' } as unknown as Rel)).toThrow(/invalid_scan_hint at root.final/);
});
it('retains child descriptors and Params through separate array join nodes', () => {
  const q = from(t), shared = val(['x'], col.Array(col.String));
  const expanded = q.map(r => ({ ...r, b: shared })).arrayJoin(() => shared, 'v').leftArrayJoin(r => r.a, 'pair');
  expect(expanded.row.pair.ir.type).toEqual(t.columns.a.inner);
  expect(expanded.ir.kind === 'ArrayJoin' && expanded.ir.input.kind).toBe('ArrayJoin');
  expect(expanded.ir.kind === 'ArrayJoin' && expanded.ir.input.kind === 'ArrayJoin' && expanded.ir.input.expr).toBe(shared.ir);
  const compiled = emitNaive(expanded.ir);
  expect(compiled.params).toEqual({ p0: "['x']" });
  expect(compiled.sql.match(/\{p0:Array\(String\)\}/g)).toHaveLength(2);
  expect(Object.isFrozen(expanded.ir)).toBe(true);
  expect(Object.keys(compiled.columns)).toEqual(['id', 'a', 'b', 'v', 'pair']);
});
it('rejects malformed array join shape, scope, mode and aliases with node paths', () => {
  const q = from(t), valid = q.arrayJoin(r => r.a, 'v').ir;
  if (valid.kind !== 'ArrayJoin') throw new Error('expected ArrayJoin');
  const { id: _id, ...fields } = valid;
  const check = (changes: object, error: RegExp) => expect(() => emitNaive({ ...valid, ...changes } as Rel)).toThrow(error);
  check({ alias: 'a' }, /duplicate_column at root.alias/);
  check({ alias: 'x\0' }, /invalid_array_join_alias at root.alias/);
  check({ left: 'yes' }, /invalid_array_join at root.left/);
  check({ expr: q.row.id.ir }, /invalid_array_join_expression at root.expr/);
  check({ expr: from(t).row.a.ir }, /unbound_column at root.expr/);
  check({ expr: columnExpr({ type: t.columns.a }, q.ir.id, ['a'], 'a', 'grouped').ir }, /invalid_expression_mode at root.expr/);
  const output = flatOutput([['id', col.UInt32.type], ['a', t.columns.a], ['v', col.String.type]]);
  expect(() => emitNaive(relNode({ ...fields, output, columns: output.columns }))).toThrow(/invalid_output at root/);
  expect(() => (q.arrayJoin as Function)(() => q.row.id, 'v')).toThrow(/invalid_array_join_expression/);
  expect(() => (q.arrayJoin as Function)(() => q.row.a, 'a')).toThrow(/duplicate_column/);
});
