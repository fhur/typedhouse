import { expect, it } from 'vitest';
import { col, table, from, val, Expr, exprNode, type ExprNode } from '@typedhouse/core';
import { emitNaive } from '../src/index.js';
import { serializeParameter, parameterWireType } from '../src/parameters.js';
const t = table('t', { n: col.UInt32, names: col.Array(col.String), specs: col.Array(col.Tuple({ text: col.Nullable(col.String) })) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
it('resolves argument-specific Params without mutation or value deduplication', () => {
  const shared = val(['x'], col.Array(col.String));
  const q = from(t).where(r => r.names.hasAny([])).map(r => ({ a: r.names.has('x'), b: r.names.hasAny(shared), c: r.names.hasAny(shared), d: r.specs.arrayElement(-1).element('text'), e: r.names.has('x') }));
  const compiled = emitNaive(q.ir);
  expect(compiled.params).toEqual({ p0: 'x', p1: "['x']", p2: '-1', p3: 'text', p4: 'x', p5: '[]' });
  expect(compiled.sql).toContain('{p2:Int64}');
  expect(compiled.sql).toContain('{p3:String}');
  expect(compiled.sql.match(/\{p1:Array\(String\)\}/g)).toHaveLength(2);
  if (q.ir.kind !== 'Project' || q.ir.exprs.d?.kind !== 'Call') throw new Error('unexpected graph');
  expect(q.ir.exprs.d.args[1]?.type).toBeNull();
  expect(compiled.columns.d).toEqual(col.Nullable(col.String).type);
});
it('preserves nullable operand evidence without consuming parameter numbers', () => {
  const absent = val(null, col.Nullable(col.Int32));
  const fallback = val(4294967295, col.UInt32);
  const compiled = emitNaive(from(t).map(() => ({ a: absent.ifNull(fallback), b: absent, c: absent.ifNull(fallback) })).ir);
  expect(compiled.sql.match(/CAST\(NULL AS Nullable\(Int32\)\)/g)).toHaveLength(3);
  expect(compiled.sql.match(/\{p0:UInt32\}/g)).toHaveLength(2);
  expect(compiled.params).toEqual({ p0: '4294967295' });
  expect(compiled.columns.a).toEqual(col.Int64.type);
  expect(compiled.columns.b).toEqual(col.Nullable(col.Int32).type);
});
it('rejects forged catalog metadata, result descriptors, selectors, arity and operands with paths', () => {
  const q = from(t);
  const original = q.row.names.has('x').ir;
  if (original.kind !== 'Call') throw new Error('expected Call');
  const { id: _id, ...good } = original;
  const badCalls: ExprNode[] = [
    exprNode({ ...good, fn: { ...good.fn, sqlName: 'evil); DROP TABLE t' } }),
    exprNode({ ...good, fn: { ...good.fn, deterministic: false } }),
    exprNode({ ...good, type: col.String.type }),
    exprNode({ ...good, args: [] }),
    exprNode({ ...good, args: [good.args[0]!, val(1n).ir] }),
  ];
  for (const ir of badCalls) {
    const bad = new Expr<unknown, 'bad'>(ir, 'bad', 'row');
    expect(() => emitNaive(q.map(() => ({ bad })).ir)).toThrow(/at root.exprs.bad/);
  }
  expect(() => emitNaive(q.map(r => ({ bad: r.specs.arrayElement(1.5) })).ir)).toThrow(/param_incompatible.*args\[1\]/);
  expect(() => emitNaive(q.map(r => ({ bad: r.specs.arrayElement(Number.MAX_SAFE_INTEGER + 1) })).ir)).toThrow(/param_incompatible/);
});
it('encodes recursive arrays, range checks their elements, and preserves UTC nested wire types', () => {
  expect(serializeParameter(true, col.Bool.type)).toBe('1');
  expect(serializeParameter(false, col.Bool.type)).toBe('0');
  expect(serializeParameter([[true, false, null], []], col.Array(col.Array(col.Nullable(col.Bool))).type)).toBe('[[true,false,NULL],[]]');
  expect(serializeParameter([true, false], col.Array(col.LowCardinality(col.Bool)).type)).toBe('[true,false]');
  expect(() => serializeParameter([1], col.Array(col.Bool).type)).toThrow(/param_incompatible/);
  expect(serializeParameter([[1n, null], []], col.Array(col.Array(col.Nullable(col.Int64))).type)).toBe('[[1,NULL],[]]');
  expect(serializeParameter(["a'\\\n\0"], col.Array(col.String).type)).toBe("['a\\'\\\\\\n\\0']");
  expect(() => serializeParameter([256], col.Array(col.UInt8).type)).toThrow(/param_incompatible/);
  expect(() => serializeParameter([1], col.Array(col.UInt64).type)).toThrow(/param_incompatible/);
  expect(() => serializeParameter([null], col.Array(col.String).type)).toThrow(/param_incompatible/);
  expect(parameterWireType(col.Array(col.DateTime64(3, 'Asia/Tokyo')).type)).toEqual(col.Array(col.DateTime64(3, 'UTC')).type);
});
