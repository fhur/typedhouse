import { expect, it } from 'vitest';
import { quantile, quantileIf, from, table, col, val, exprNode, relNode, flatOutput, columnExpr, unionAll, scalar } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
const q = from(table('q', { n: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('numbers level Params before operands and filters, sharing only graph identity', () => {
  const median = quantile(0.5), operand = val(8);
  const result = q.where(r => r.n.gt(1)).aggregate(() => {
    const shared = median(operand);
    return { a: shared, b: shared, c: median(operand), d: quantileIf(0)(operand, val(true)) };
  });
  const compiled = emitNaive(result.ir);
  expect(compiled.params).toEqual({ p0: '0.5', p1: '8', p2: '0.5', p3: '0', p4: '1', p5: '1' });
  expect(compiled.sql).toContain('quantile({p0:Float64})({p1:Float64})');
  expect(compiled.sql.match(/quantile\(\{p0:Float64\}\)/g)).toHaveLength(2);
  expect(emitNaive(unionAll(result, result).ir).params).toEqual(compiled.params);
  const nested = q.map(() => ({ x: scalar(q.aggregate(g => median(g.n))) }));
  expect(emitNaive(nested.ir).params).toEqual({ p0: '0.5' });
  expect(nested.row.x.ir.type).toEqual(col.Nullable(col.Float64).type);
});
it('rejects hostile JS level payloads before SQL and accepts boundary Float64 levels in both backends', () => {
  for (const level of ['0.5)(x); SELECT 1 --', '0.5', null, undefined, true, 1n, {}, [0.5]]) {
    const query = q.aggregate(g => quantile(level as number)(g.n));
    for (const emit of [compile, emitNaive]) expect(() => emit(query.ir)).toThrow(/invalid_quantile_level at root.aggs.n/);
  }
  expect(() => q.aggregate(g => quantile(new Number(0.5) as number)(g.n))).toThrow('IR: unsupported owned object');
  for (const level of [-0, Number.MIN_VALUE, 0.25, 1 - Number.EPSILON, 1]) {
    const query = q.aggregate(g => quantile(level)(g.n));
    for (const emit of [compile, emitNaive]) {
      const result = emit(query.ir);
      expect(result.params).toEqual({ p0: String(level) });
      expect(result.parameterTypes).toEqual({ p0: col.Float64.type });
      expect(result.sql).toContain('quantile({p0:Float64})(');
    }
  }
});
it('rejects forged levels, metadata, descriptors, arity, combinators and foreign operands with paths', () => {
  const root = q.aggregate(g => ({ x: quantile(0.5)(g.n) })).ir;
  const { id: _r, ...fields } = root;
  if (root.aggs.x?.kind !== 'Agg') throw new Error('Agg');
  const { id: _a, ...agg } = root.aggs.x;
  const check = (changes: Partial<typeof agg>, error: RegExp) => {
    const output = flatOutput([['x', changes.type ?? agg.type]]);
    expect(() => emitNaive(relNode({ ...fields, output, columns: output.columns, aggs: { x: exprNode({ ...agg, ...changes }) } }))).toThrow(error);
  };
  for (const level of [-1, 1.01, NaN, Infinity, -Infinity]) expect(() => emitNaive(q.aggregate(g => quantile(level)(g.n)).ir)).toThrow(/invalid_quantile_level at root.aggs.n/);
  for (const params of [[], [val(0.5).ir, val(0.5).ir]]) check({ params }, /invalid_aggregate_parameters at root.aggs.x/);
  for (const level of [val('0.5').ir, val(0, col.UInt8).ir, val(null, col.Nullable(col.Float64)).ir, q.row.n.ir, val(0.5).plus(0).ir, scalar(q.aggregate(g => quantile(0.5)(g.n))).ir]) check({ params: [level] }, /invalid_aggregate_parameter_type at root.aggs.x/);
  check({ args: [] }, /invalid_argument_arity at root.aggs.x/);
  check({ type: col.UInt64.type }, /invalid_expression_type at root.aggs.x/);
  check({ fn: { ...agg.fn, linear: true } }, /invalid_function_metadata/);
  check({ fn: { ...agg.fn, deterministic: true } }, /invalid_function_metadata/);
  check({ fn: { ...agg.fn, sqlName: 'unsafe' } }, /invalid_function_metadata/);
  for (const combinators of [['State'], ['Merge'], ['If', 'If']] as const) check({ combinators }, /unsupported_aggregate_combinator/);
  check({ args: [q.row.n.ir] }, /invalid_expression_mode/);
  check({ args: [root.aggs.x] }, /invalid_aggregate_placement/);
  if (q.ir.kind !== 'Scan') throw new Error('Scan');
  const foreign = from(q.ir.table);
  const ref = columnExpr(col.UInt32, foreign.ir.id, ['n'], 'n', 'grouped');
  expect(() => emitNaive(q.aggregate(() => quantile(0.5)(ref)).ir)).toThrow(/unbound_column/);
  expect(() => emitNaive(q.aggregate(g => quantileIf(0.5)(g.n, ref.gt(0))).ir)).toThrow(/unbound_column/);
  for (const type of [col.String.type, col.Bool.type, col.Date.type, col.Decimal64(2).type, col.LowCardinality(col.UInt32).type, col.Array(col.UInt32).type]) check({ args: [exprNode({ kind: 'Param', value: 1, type })] }, /incompatible_operands/);
  expect(Object.isFrozen(root.aggs.x.params)).toBe(true);
  expect(Object.isFrozen(root.aggs.x.params[0])).toBe(true);
});
