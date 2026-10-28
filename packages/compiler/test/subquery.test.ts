import { expect, it } from 'vitest';
import { col, table, from, count, sum, scalar, val, exprNode, relNode, flatOutput, type ExprNode, type Rel } from '@chql/core';
import { emitNaive } from '../src/index.js';
function fields<T extends { readonly id: unknown }>(node: T): Omit<T, 'id'> { const { id: _id, ...rest } = node; return rest; }
const q = from(table('s', { stock: col.Float64, id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
function project(e: ExprNode): Rel {
  const output = flatOutput([['result', e.type!]]);
  return relNode({ kind: 'Project', input: q.ir, exprs: { result: e }, output, columns: output.columns });
}
it('inlines independently scoped aggregates and shares Params by identity in textual order', () => {
  const p = val(3, col.Float64);
  const scoped = q.where(r => r.stock.gt(p));
  const total = scoped.aggregate(g => sum(g.stock));
  const result = scoped.map(r => ({ share: r.stock.divide(scalar(total)), shared: p, equal: val(3, col.Float64) }));
  const before = JSON.stringify(result.ir, (_, v: unknown) => typeof v === 'bigint' ? String(v) : v);
  const plan = emitNaive(result.ir);
  expect(plan.sql).toContain('(SELECT sum(');
  expect(plan.sql).not.toContain('LIMIT 1');
  expect(plan.params).toEqual({ p0: '3', p1: '3' });
  expect(plan.sql.match(/\{p0:Float64\}/g)).toHaveLength(3);
  expect(Object.keys(plan.nodes).some(k => k.includes('.rel'))).toBe(true);
  expect(JSON.stringify(result.ir, (_, v: unknown) => typeof v === 'bigint' ? String(v) : v)).toBe(before);
  const nested = q.map(() => scalar(total)).aggregate(g => sum(g.stock));
  expect(emitNaive(q.map(() => scalar(nested)).ir).sql.match(/SELECT sum/g)).toHaveLength(2);
});
it('rejects forged usage, descriptor, cardinality, output and foreign scope', () => {
  const e = scalar(q.aggregate(() => count())).ir;
  if (e.kind !== 'Subquery') throw new Error('fixture');
  expect(() => emitNaive(project(exprNode({ ...fields(e), usage: 'in' })))).toThrow('invalid_subquery_usage');
  expect(() => emitNaive(project(exprNode({ ...fields(e), type: col.UInt64.type })))).toThrow('invalid_expression_type');
  expect(() => emitNaive(project(exprNode({ ...fields(e), rel: q.ir })))).toThrow('scalar_cardinality');
  const total = q.aggregate(g => sum(g.stock)).ir;
  const foreign = from(table('foreign', { stock: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const captured = foreign.aggregate(() => sum(exprForForeignScope()));
  function exprForForeignScope() {
    let captured!: Parameters<Parameters<typeof foreign.aggregate>[0]>[0]['stock'];
    q.aggregate(g => { captured = g.stock; return sum(g.stock); });
    return captured;
  }
  expect(() => emitNaive(q.map(() => scalar(captured)).ir)).toThrow(/unbound_column|invalid_expression_mode/);
  const wrong = relNode({ ...fields(total), columns: { stock: col.String.type } });
  expect(() => emitNaive(project(exprNode({ ...fields(e), rel: wrong })))).toThrow('invalid_output');
  const grouped = q.groupBy(r => r.id).aggregate(g => sum(g.stock));
  expect(() => emitNaive(project(exprNode({ ...fields(e), rel: grouped.ir })))).toThrow('scalar_cardinality');
});
it('validates inner aggregate expressions and captured row scopes even behind scalar arithmetic', () => {
  const total = q.aggregate(() => count()).ir;
  const output = flatOutput([['count', col.String.type]]);
  const forged = relNode({ ...fields(total), output, columns: output.columns });
  const e = scalar(q.aggregate(() => count())).ir;
  if (e.kind !== 'Subquery') throw new Error('fixture');
  expect(() => emitNaive(project(exprNode({ ...fields(e), rel: forged, type: col.Nullable(col.String).type })))).toThrow(/invalid_output.*root.exprs.result.rel.count/);
  const foreign = from(table('other', { stock: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const captured = foreign.where(() => q.row.stock.gt(0)).aggregate(g => sum(g.stock));
  expect(() => emitNaive(q.map(r => r.stock.divide(scalar(captured))).ir)).toThrow(/unbound_column.*\.rel.input.pred/);
  const wrongUsage = exprNode({ ...fields(e), usage: 'in' });
  const predicate = q.row.id.eq(scalar(q.aggregate(() => count()))).ir;
  if (predicate.kind !== 'Call') throw new Error('fixture');
  expect(() => emitNaive(project(exprNode({ ...fields(predicate), args: [predicate.args[0]!, wrongUsage] })))).toThrow('invalid_subquery_usage');
});
it('rejects scalar expressions placed in grouped/aggregate scope and recursive graphs', () => {
  const total = q.aggregate(() => count()).ir;
  const e = scalar(q.aggregate(() => count())).ir;
  const badAgg = exprNode({ ...fields(total.aggs.count!), kind: 'Agg', fn: { name: 'sum', deterministic: true, linear: true, origin: 'typed' }, args: [e], params: [], combinators: [], type: col.Nullable(col.UInt64).type });
  const output = flatOutput([['count', badAgg.type]]);
  expect(() => emitNaive(relNode({ ...fields(total), aggs: { count: badAgg }, columns: output.columns, output }))).toThrow('invalid_expression_mode');
  const cyclic = { ...total };
  const sub = { ...e, kind: 'Subquery' as const, usage: 'scalar' as const, rel: cyclic };
  const cycleOutput = flatOutput([['result', sub.type!]]);
  cyclic.input = { kind: 'Project', id: q.ir.id, input: q.ir, exprs: { result: sub }, output: cycleOutput, columns: cycleOutput.columns };
  expect(() => emitNaive(cyclic)).toThrow('cyclic_ir');
});
