import { expect, it } from 'vitest';
import { col, table, from, val, exprNode, relNode, flatOutput, Expr, type Rel } from '@chql/core';
import { emitNaive, ValidationError } from '../src/index.js';
const t = table('t`\\; DROP TABLE x--', { 'id`\\': col.UInt64, value: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
it('quotes hostile identifiers and parameterizes hostile values', () => {
  const hostile = "x'\\; DROP TABLE t; --\n\0";
  const q = from(t).where(r => r.value.eq(hostile)).map(r => ({ renamed: r['id`\\'] })).limit(10, 2);
  const result = emitNaive(q.ir);
  expect(result.sql).toBe('SELECT `renamed` FROM (SELECT `__chql_input`.`id\\`\\\\` AS `renamed` FROM (SELECT `id\\`\\\\`, `value` FROM (SELECT `id\\`\\\\`, `value` FROM `t\\`\\\\; DROP TABLE x--`) AS `__chql_input` WHERE (`__chql_input`.`value` = {p0:String})) AS `__chql_input`) LIMIT 10 OFFSET 2');
  expect(result.params).toEqual({ p0: hostile });
  expect(result.sql).not.toContain(hostile);
  expect(q.ir.kind).toBe('Limit');
});
it('numbers by emitted occurrence, retains Param identities and does not mutate', () => {
  const shared = val('same');
  const q = from(t).where(r => r.value.eq('same')).map(() => ({ a: shared, b: shared, c: val('same') }));
  const result = emitNaive(q.ir);
  expect(result.sql).toContain('SELECT {p0:String} AS `a`, {p0:String} AS `b`, {p1:String} AS `c`');
  expect(result.params).toEqual({ p0: 'same', p1: 'same', p2: 'same' });
  if (q.ir.kind !== 'Project' || q.ir.input.kind !== 'Filter' || q.ir.input.pred.kind !== 'Call') throw new Error('unexpected graph');
  expect(q.ir.input.pred.args[1]!.type).toBeNull();
  expect(q.ir.exprs['a']).toBe(q.ir.exprs['b']);
});
it('rejects wrong binding, predicate, limits, parameter values and unsupported nodes with paths', () => {
  const a = from(t), b = from(t);
  expect(() => emitNaive(a.where(() => b.row.value.eq('x')).ir)).toThrow(/unbound_column.*root.pred/);
  for (const n of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => emitNaive(a.limit(n).ir)).toThrow(/invalid_limit.*root/);
  const pred = exprNode({ kind: 'Param', type: col.String.type, value: 'no' });
  expect(() => emitNaive(relNode({ kind: 'Filter', input: a.ir, output: a.ir.output, pred }))).toThrow(/invalid_predicate/);
  const bad = new Expr<bigint, 'bad'>(exprNode({ kind: 'Param', type: col.UInt64.type, value: -1n }), 'bad', 'row');
  expect(() => emitNaive(a.map(() => ({ bad })).ir)).toThrow(/param_incompatible/);
  const unsupported = new Expr<bigint, 'bad'>(exprNode({ kind: 'Call', fn: { name: 'unknown_function', origin: 'typed', deterministic: true }, args: [], type: col.UInt64.type }), 'bad', 'row');
  expect(() => emitNaive(a.map(() => ({ bad: unsupported })).ir)).toThrow(/unsupported_expression.*root.exprs.bad/);
  expect(() => emitNaive(relNode({ kind: 'Materialize', input: a.ir, output: a.ir.output }))).toThrow(/unsupported_node/);
  for (const malformed of [null, {}, { kind: 'Filter', output: flatOutput([['x', col.String.type]]) }]) expect(() => emitNaive(malformed as Rel)).toThrow(ValidationError);
});
