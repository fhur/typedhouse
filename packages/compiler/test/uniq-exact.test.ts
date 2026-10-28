import { expect, it } from 'vitest';
import { uniqExact, uniqExactIf, from, table, col, val, exprNode, relNode, flatOutput, columnExpr, unionAll, scalar, type Query } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
const q = from(table('strings', { value: col.String, selected: col.Nullable(col.Bool) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('emits exact/If with shared not value-deduplicated Params through union and scalar', () => {
  const hostile = "'\\\n\0日本語 {p0:String} --", p = val(hostile);
  const result = q.aggregate(g => ({ a: uniqExact(p), b: uniqExactIf(p, g.selected), c: uniqExact(val(hostile)) }));
  const snapshot = JSON.stringify(result.ir);
  for (const emit of [compile, emitNaive]) {
    const plan = emit(unionAll(result, result).ir);
    expect(plan.params).toEqual({ p0: hostile, p1: hostile });
    expect(plan.sql).not.toContain(hostile);
    expect(plan.sql).toContain('uniqExactIf({p0:String}');
    expect(emit(q.map(() => scalar(q.aggregate(g => uniqExact(g.value)))).ir).columns.value).toEqual(col.Nullable(col.UInt64).type);
  }
  expect(JSON.stringify(result.ir)).toBe(snapshot);
});
it('validates descriptor-erased generic operands rather than trusting decoded strings', () => {
  const generic = (input: Query<{ value: string }>) => input.aggregate(g => uniqExact(g.value));
  for (const descriptor of [col.FixedString(3), col.DateTime64(6), col.LowCardinality(col.String)]) {
    const erased = generic(from(table('erased', { value: descriptor }, { engine: 'Memory', sortingKey: [], partitionKey: [] })));
    for (const emit of [compile, emitNaive]) expect(() => emit(erased.ir)).toThrow(/incompatible_operands at root.aggs.value/);
  }
  for (const emit of [compile, emitNaive]) expect(emit(generic(q.map(r => ({ value: r.value }))).ir).columns).toEqual({ value: col.UInt64.type });
});
it('authoritatively rejects unsupported descriptors, forged metadata/results, modes, arity and combinators in both backends', () => {
  const root = q.aggregate(g => ({ x: uniqExact(g.value) })).ir;
  const { id: _r, ...fields } = root;
  if (root.aggs.x?.kind !== 'Agg') throw new Error('Agg');
  const { id: _a, ...agg } = root.aggs.x;
  const check = (changes: Partial<typeof agg>, error: RegExp) => {
    const output = flatOutput([['x', changes.type ?? agg.type]]);
    for (const emit of [compile, emitNaive]) expect(() => emit(relNode({ ...fields, output, columns: output.columns, aggs: { x: exprNode({ ...agg, ...changes }) } }))).toThrow(error);
  };
  check({ args: [] }, /invalid_argument_arity at root.aggs.x/);
  check({ args: [...agg.args, ...agg.args] }, /invalid_argument_arity/);
  check({ params: [val(1).ir] }, /unsupported_aggregate_combinator/);
  check({ type: col.Nullable(col.UInt64).type }, /invalid_expression_type/);
  check({ fn: { ...agg.fn, linear: true } }, /invalid_function_metadata/);
  check({ fn: { ...agg.fn, deterministic: false } }, /invalid_function_metadata/);
  check({ fn: { ...agg.fn, sqlName: 'unsafe' } }, /invalid_function_metadata/);
  for (const combinators of [['State'], ['Merge'], ['If', 'If']] as const) check({ combinators }, /unsupported_aggregate_combinator/);
  check({ args: [q.row.value.ir] }, /invalid_expression_mode/);
  check({ args: [root.aggs.x] }, /incompatible_operands|invalid_aggregate_placement/);
  check({ combinators: ['If'], args: [...agg.args, val(1).ir] }, /invalid_predicate/);
  for (const type of [col.UInt64.type, col.FixedString(3).type, col.DateTime64(6).type, col.Decimal64(2).type, col.LowCardinality(col.String).type, col.Array(col.String).type, col.Nullable(col.FixedString(3)).type]) check({ args: [exprNode({ kind: 'Param', value: 'bad', type })] }, /incompatible_operands/);
  if (q.ir.kind !== 'Scan') throw new Error('Scan');
  const foreign = from(q.ir.table);
  const ref = columnExpr(col.String, foreign.ir.id, ['value'], 'value', 'grouped');
  for (const emit of [compile, emitNaive]) expect(() => emit(q.aggregate(() => uniqExact(ref)).ir)).toThrow(/unbound_column/);
});
