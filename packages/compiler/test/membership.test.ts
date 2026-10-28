import { expect, it } from 'vitest';
import { Expr, col, table, from, val, countIf, scalar, count, exprNode, relNode, flatOutput, type ExprNode } from '@chql/core';
import { emitNaive } from '../src/index.js';
const q = from(table('membership', { id: col.String, n: col.Nullable(col.Int64) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
function fields<T extends { readonly id: unknown }>(n: T): Omit<T, 'id'> { const { id: _id, ...f } = n; return f; }
function project(e: ExprNode) { const output = flatOutput([['result', e.type!]]); return relNode({ kind: 'Project', input: q.ir, exprs: { result: e }, output, columns: output.columns }); }
it('adversarial validation rejects nested captures and non-set positions without allocating parameters', () => {
  const inner = q.map(r => r.id);
  const captured = inner.map(() => ({ id: q.row.id }));
  expect(() => emitNaive(q.map(r => r.id.in(captured).not()).ir)).toThrow(/unbound_column.*args\[0\].args\[1\].rel.exprs.id/);
  const member = q.row.id.in(inner).ir;
  if (member.kind !== 'Call') throw new Error('fixture');
  const set = member.args[1]!;
  const equality = q.row.id.eq('x').ir;
  if (equality.kind !== 'Call') throw new Error('fixture');
  expect(() => emitNaive(project(exprNode({ ...fields(equality), args: [q.row.id.ir, set] })))).toThrow('invalid_subquery_usage');
  const boolSet = q.map(r => r.id.in(inner));
  expect(() => emitNaive(q.map(r => r.id.eq('x').in(boolSet)).ir)).not.toThrow();
  const wrong = exprNode({ ...fields(member), args: [q.row.id.ir, exprNode({ kind: 'Param', value: ['x'], type: col.Array(col.Nullable(col.String)).type })] });
  expect(() => emitNaive(project(wrong))).toThrow('invalid_set_operand');
  q.aggregate(g => {
    const capturedGrouped = inner.map(() => ({ id: new Expr<string, 'id'>(g.id.ir, 'id', 'row') }));
    expect(() => emitNaive(q.map(r => r.id.in(capturedGrouped)).ir)).toThrow('invalid_expression_mode');
    return countIf(g.id.in(inner));
  });
});
it('parameterizes empty/duplicate arrays and independently scoped sets with shared/equal Params', () => {
  const p = val('hostile\'`{p8:String}', col.String);
  const inner = q.where(r => r.id.eq(p)).map(r => r.id).distinct().orderBy(r => r.id).limit(2, 1);
  const result = q.map(r => ({ a: r.id.in(inner), b: r.n.notIn([]), p, equal: val('hostile\'`{p8:String}', col.String) }));
  const before = JSON.stringify(result.ir);
  const plan = emitNaive(result.ir);
  expect(plan.sql).toContain('in(');
  expect(plan.sql).toContain('LIMIT 2 OFFSET 1');
  expect(plan.sql).not.toContain('LIMIT 1');
  expect(plan.params).toEqual({ p0: 'hostile\'`{p8:String}', p1: '[]', p2: 'hostile\'`{p8:String}' });
  expect(plan.sql.match(/\{p0:String\}/g)).toHaveLength(2);
  expect(JSON.stringify(result.ir)).toBe(before);
  expect(emitNaive(q.aggregate(g => countIf(g.id.in(inner))).ir).sql).toContain('countIf(in(');
  expect(emitNaive(q.map(r => r.n.in([2n, 2n])).ir).params).toEqual({ p0: '[2,2]' });
});
it('rejects cycles, forged set schemas, unsupported descriptors and grouped receiver captures', () => {
  const inner = q.map(r => r.id).ir;
  if (inner.kind !== 'Project') throw new Error('fixture');
  const member = q.row.id.in(q.map(r => r.id)).ir;
  if (member.kind !== 'Call') throw new Error('fixture');
  const set = member.args[1]!;
  if (set.kind !== 'Subquery') throw new Error('fixture');
  const output = flatOutput([['id', col.Int64.type]]);
  const forged = relNode({ ...fields(inner), output, columns: output.columns });
  const wrong = exprNode({ ...fields(member), args: [q.row.n.ir, exprNode({ ...fields(set), rel: forged, type: col.Int64.type })], type: col.Nullable(col.Bool).type });
  expect(() => emitNaive(project(wrong))).toThrow('nested_projection at root.exprs.result.args[1].rel.exprs.id');
  const cyclic = { ...inner };
  const cycleSet = { ...set, rel: cyclic, type: col.Bool.type };
  const cycleCall = { ...member, args: [q.row.id.ir, cycleSet] };
  // Keep valid local descriptors so traversal, not a shape mismatch, finds the cycle.
  const cyclicMember = { ...cycleCall, args: [q.row.id.eq('x').ir, cycleSet] };
  cyclic.exprs = { id: cyclicMember };
  cyclic.output = flatOutput([['id', col.Bool.type]]);
  cyclic.columns = cyclic.output.columns;
  expect(() => emitNaive(cyclic)).toThrow('cyclic_ir');
  const unsupported = from(table('unsupported', { date: col.DateTime64(9) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  expect(() => emitNaive(unsupported.map(r => r.date.in(['x'])).ir)).toThrow('unsupported_membership_type');
  q.aggregate(g => { expect(() => emitNaive(project(g.id.in(['x']).ir))).toThrow('invalid_expression_mode'); return countIf(g.id.in(['x'])); });
});
it('rejects standalone set usage, scalar-in-set position, bad shape/type/metadata and inner scope', () => {
  const member = q.row.id.in(q.map(r => r.id)).ir;
  if (member.kind !== 'Call') throw new Error('fixture');
  const set = member.args[1]!;
  if (set.kind !== 'Subquery') throw new Error('fixture');
  expect(() => emitNaive(project(set))).toThrow('invalid_subquery_usage');
  expect(() => emitNaive(project(exprNode({ ...fields(member), args: [member.args[0]!, scalar(q.aggregate(() => count())).ir] })))).toThrow('invalid_subquery_usage');
  expect(() => emitNaive(project(exprNode({ ...fields(member), args: [member.args[0]!, exprNode({ ...fields(set), rel: q.ir })] })))).toThrow('set_column_count');
  expect(() => emitNaive(project(exprNode({ ...fields(member), args: [member.args[0]!, exprNode({ ...fields(set), type: col.Int64.type })] })))).toThrow('invalid_expression_type');
  expect(() => emitNaive(project(exprNode({ ...fields(member), fn: { ...member.fn, argumentPolicies: [] } })))).toThrow('invalid_function_metadata');
  expect(() => emitNaive(project(exprNode({ ...fields(member), args: [member.args[0]!, exprNode({ kind: 'Param', value: [null], type: null })] })))).toThrow('param_incompatible');
  const other = q.map(r => r.id);
  const captured = other.where(() => q.row.id.eq('x'));
  expect(() => emitNaive(q.map(r => r.id.in(captured)).ir)).toThrow(/unbound_column.*\.rel.pred/);
  const numeric = q.row.n.in([1n]).ir;
  if (numeric.kind !== 'Call') throw new Error('fixture');
  expect(() => emitNaive(project(exprNode({ ...fields(member), args: [member.args[0]!, numeric.args[1]!] })))).toThrow('param_incompatible');
});
