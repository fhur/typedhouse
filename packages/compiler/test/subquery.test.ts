import { expect, it } from 'vitest';
import { col, table, from, count, sum, max, scalar, scalarDescriptor, val, exprNode, relNode, flatOutput, type ExprNode, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
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
it('validates Date scalar twins, preserves shared parameters and rejects unsupported temporal forgeries', () => {
  const dates = from(table('dates', { day: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const shared = val(new Date('2024-02-29T12:00:00Z'), col.Date);
  const input = dates.where(r => r.day.ge(shared));
  const newest = scalar(input.aggregate(g => max(g.day)));
  const nested = scalar(input.map(() => newest).aggregate(g => max(g.day)));
  const query = input.map(() => ({ newest, nested, shared, equal: val(new Date('2024-02-29T12:00:00Z'), col.Date) }));
  const snapshot = JSON.stringify(query.ir);
  for (const emitter of [emitNaive, compile]) {
    const plan = emitter(query.ir);
    expect(plan.params).toEqual({ p0: '2024-02-29', p1: '2024-02-29' });
    expect(plan.columns.newest).toEqual(col.Nullable(col.Date).type);
    expect(plan.columns.nested).toEqual(col.Nullable(col.Date).type);
    expect(plan.sql).not.toContain('LIMIT 1');
    for (const type of [col.Date32.type, col.DateTime().type, col.DateTime64(3).type, col.Nullable(col.Date32).type]) {
      const total = input.aggregate(g => max(g.day)).ir;
      const output = flatOutput([['day', type]]);
      const forged = { ...total, output, columns: output.columns };
      const sub = { ...newest.ir, kind: 'Subquery' as const, usage: 'scalar' as const, rel: forged, type: col.Nullable(col.Date).type };
      expect(() => emitter(project(sub))).toThrow(/unsupported_scalar_type.*root.exprs.result/);
    }
    expect(() => emitter(project({ ...newest.ir, type: col.Date.type }))).toThrow(/invalid_expression_type.*root.exprs.result/);
  }
  expect(JSON.stringify(query.ir)).toBe(snapshot);
});
it('rejects mixed String/high-precision temporal scalar evidence at runtime without inspecting decoded values', () => {
  // Precise negative fixtures reject these unions at the public scalar boundary;
  // runtime validation must likewise reject the unsupported temporal branch.
  for (const temporal of [true, false]) {
    const source = from(table('mixed_scalar', { day: temporal ? col.String : col.DateTime64(6) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const total = source.aggregate(g => max(g.day));
    if (temporal) expect(scalarDescriptor(total.ir)).toEqual(col.Nullable(col.String).type);
    else expect(() => scalarDescriptor(total.ir)).toThrow('unsupported_scalar_type');
    const nullable = from(table('mixed_nullable_scalar', { day: temporal ? col.Nullable(col.String) : col.Nullable(col.DateTime64(6)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const nullableTotal = nullable.aggregate(g => max(g.day));
    if (temporal) expect(scalarDescriptor(nullableTotal.ir)).toEqual(col.Nullable(col.String).type);
    else expect(() => scalarDescriptor(nullableTotal.ir)).toThrow('unsupported_scalar_type');
  }
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
