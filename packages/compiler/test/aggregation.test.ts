import { expect, it } from 'vitest';
import { avg, avgIf, argMax, argMaxIf, type CHType, from, table, col, count, sum, sumState, val, columnExpr, exprNode, relNode, flatOutput, Expr } from '@typedhouse/core';
import { emitNaive } from '../src/index.js';
const t = table('t', { k: col.String, n: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
it('validates mean operands, modes, metadata and result descriptors authoritatively with paths', () => {
  const q = from(t), other = from(t);
  const root = q.aggregate(g => ({ mean: avgIf(g.n, g.n.gt(0)) })).ir;
  expect(emitNaive(root).sql).toContain('avgIf(');
  if (root.aggs.mean?.kind !== 'Agg') throw new Error('expected Agg');
  const { id: _id, ...fields } = root;
  const { id: _expr, ...agg } = root.aggs.mean;
  const check = (changes: Partial<typeof agg>, error: RegExp) => {
    const output = flatOutput([['mean', changes.type ?? agg.type]]);
    expect(() => emitNaive(relNode({ ...fields, output, columns: output.columns, aggs: { mean: exprNode({ ...agg, ...changes }) } }))).toThrow(error);
  };
  check({ args: [] }, /invalid_argument_arity at root.aggs.mean/);
  check({ type: col.UInt64.type }, /invalid_expression_type at root.aggs.mean/);
  check({ fn: { ...agg.fn, linear: false } }, /invalid_function_metadata at root.aggs.mean/);
  check({ fn: { ...agg.fn, deterministic: false } }, /invalid_function_metadata/);
  check({ fn: { ...agg.fn, sqlName: 'unsafe)' } }, /invalid_function_metadata/);
  check({ args: [q.row.n.ir, agg.args[1]!] }, /invalid_expression_mode/);
  check({ args: [root.aggs.mean, agg.args[1]!] }, /invalid_aggregate_placement/);
  check({ args: [agg.args[0]!, val(1).ir] }, /invalid_predicate/);
  for (const combinators of [['State'], ['Merge'], ['If', 'If']] as const) check({ combinators }, /unsupported_aggregate_combinator/);
  check({ params: [val(1).ir] }, /unsupported_aggregate_combinator/);
  const foreign = columnExpr(col.UInt32, other.ir.id, ['n'], 'n', 'grouped');
  expect(() => emitNaive(q.aggregate(() => avg(foreign.plus(1))).ir)).toThrow(/unbound_column.*root.aggs.n/);
  expect(() => emitNaive(q.aggregate(g => avgIf(g.n, foreign.gt(1))).ir)).toThrow(/unbound_column.*root.aggs.n/);
  for (const value of [-1, 256, 1.5]) expect(() => emitNaive(q.aggregate(() => avg(val(value, col.UInt8))).ir)).toThrow(/param/);
  const unsupported: CHType[] = [col.String.type, col.Bool.type, col.Decimal64(2).type, col.Array(col.UInt32).type, col.LowCardinality(col.UInt32).type, col.Date.type, col.Tuple({ n: col.UInt32 }).type, col.SimpleAggregateFunction('max', col.UInt32).type, { kind: 'Unknown', raw: 'unsafe' }];
  for (const type of unsupported) {
    const source = from(table('unsupported_mean', { value: { type } }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const value = columnExpr({ type }, source.ir.id, ['value'], 'value', 'grouped');
    expect(() => emitNaive(relNode({ ...fields, input: source.ir, aggs: { mean: exprNode({ ...agg, combinators: [], args: [value.ir] }) } }))).toThrow(/incompatible_operands at root.aggs.mean/);
  }
});
it('validates both argMax operands, conditional predicates and authoritative metadata with paths', () => {
  const q = from(t), other = from(t);
  const query = q.aggregate(g => ({ latest: argMaxIf(g.n, g.n, g.n.gt(0)) }));
  expect(emitNaive(query.ir).sql).toContain('argMaxIf(');
  const root = query.ir;
  if (root.kind !== 'Aggregate' || root.aggs.latest?.kind !== 'Agg') throw new Error('expected Aggregate');
  const { id: _id, ...fields } = root;
  const { id: _expr, ...agg } = root.aggs.latest;
  const check = (changes: Partial<typeof agg>, error: RegExp) => {
    const output = flatOutput([['latest', changes.type ?? agg.type]]);
    expect(() => emitNaive(relNode({ ...fields, output, columns: output.columns, aggs: { latest: exprNode({ ...agg, ...changes }) } }))).toThrow(error);
  };
  check({ args: agg.args.slice(0, 2) }, /invalid_argument_arity at root.aggs.latest/);
  check({ fn: { ...agg.fn, deterministic: false } }, /invalid_function_metadata at root.aggs.latest/);
  check({ fn: { ...agg.fn, linear: true } }, /invalid_function_metadata at root.aggs.latest/);
  check({ fn: { ...agg.fn, sqlName: 'unsafe)' } }, /invalid_function_metadata at root.aggs.latest/);
  check({ args: [agg.args[0]!, columnExpr(col.String, q.ir.id, ['k'], 'k', 'grouped').ir, agg.args[2]!] }, /incompatible_operands at root.aggs.latest/);
  check({ type: col.Float64.type }, /invalid_expression_type at root.aggs.latest/);
  check({ combinators: ['State'] }, /unsupported_aggregate_combinator/);
  for (let index = 0; index < 3; index++) {
    const args = [...agg.args];
    args[index] = columnExpr(index === 2 ? col.Bool : col.UInt32, other.ir.id, ['n'], 'n', 'grouped').ir;
    check({ args }, /unbound_column.*root.aggs.latest/);
  }
  check({ args: [q.row.n.ir, ...agg.args.slice(1)] }, /invalid_expression_mode/);
  check({ args: [agg.args[0]!, root.aggs.latest, agg.args[2]!] }, /invalid_aggregate_placement/);
  check({ args: [agg.args[0]!, agg.args[1]!, val(1).ir] }, /invalid_predicate/);
  const unsupported: CHType[] = [col.Array(col.UInt32).type, col.LowCardinality(col.String).type, col.Decimal64(2).type, col.Date.type, col.Tuple({ n: col.UInt32 }).type, { kind: 'Unknown', raw: 'unsafe' }];
  for (const type of unsupported) {
    const source = from(table('unsupported', { value: { type }, version: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const value = columnExpr({ type }, source.ir.id, ['value'], 'value', 'grouped');
    const version = columnExpr(col.UInt32, source.ir.id, ['version'], 'version', 'grouped');
    const output = flatOutput([['latest', type]]);
    expect(() => emitNaive(relNode({ ...fields, input: source.ir, output, columns: output.columns, aggs: { latest: exprNode({ ...agg, combinators: [], args: [value.ir, version.ir], type }) } }))).toThrow(/incompatible_operands at root.aggs.latest/);
  }
  const nullableVersion = from(table('nullable_version', { n: col.UInt32, v: col.Nullable(col.UInt32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const forged = nullableVersion.aggregate(g => argMax(g.n, g.n)).ir;
  if (forged.kind !== 'Aggregate' || forged.aggs.n?.kind !== 'Agg') throw new Error('expected Aggregate');
  const { id: _r, ...r } = forged; const { id: _a, ...a } = forged.aggs.n;
  expect(() => emitNaive(relNode({ ...r, aggs: { n: exprNode({ ...a, args: [a.args[0]!, columnExpr(col.Nullable(col.UInt32), nullableVersion.ir.id, ['v'], 'v', 'grouped').ir] }) } }))).toThrow(/incompatible_operands/);
});
it('adversarial argMax rejects invalid constant payloads in every operand and nested foreign calls', () => {
  const q = from(t), other = from(t);
  for (const value of [-1, 256, 1.5]) {
    expect(() => emitNaive(q.aggregate(g => argMax(val(value, col.UInt8), g.n)).ir)).toThrow(/param/);
    expect(() => emitNaive(q.aggregate(g => argMax(g.n, val(value, col.UInt8))).ir)).toThrow(/param/);
  }
  const foreign = columnExpr(col.UInt32, other.ir.id, ['n'], 'n', 'grouped');
  expect(() => emitNaive(q.aggregate(g => argMax(g.n, foreign.plus(1))).ir)).toThrow(/unbound_column.*root.aggs.n/);
  expect(() => emitNaive(q.aggregate(g => argMaxIf(g.n, g.n, foreign.gt(1))).ir)).toThrow(/unbound_column.*root.aggs.n/);
  const valid = q.aggregate(g => argMax(g.n, g.n)).ir;
  if (valid.kind !== 'Aggregate' || valid.aggs.n?.kind !== 'Agg') throw new Error('expected aggregate');
  const { id: _id, ...fields } = valid;
  const { id: _agg, ...agg } = valid.aggs.n;
  for (const combinators of [['If', 'If'], ['Merge'], ['State']] as const) {
    expect(() => emitNaive(relNode({ ...fields, aggs: { n: exprNode({ ...agg, combinators }) } }))).toThrow(/unsupported_aggregate_combinator at root.aggs.n/);
  }
  expect(() => emitNaive(relNode({ ...fields, aggs: { n: exprNode({ ...agg, params: [val(1).ir] }) } }))).toThrow(/unsupported_aggregate_combinator at root.aggs.n/);
});
it('preserves keys, shared parameters, output descriptors and immutable aggregation stages', () => {
  const q = from(t), shared = val('fallback');
  const stage = q.groupBy(r => ({ k: r.k.ifNull(shared) }));
  expect(Object.isFrozen(stage)).toBe(true);
  expect('map' in stage).toBe(false);
  const result = stage.aggregate(g => ({ total: sum(g.n), c: count() }));
  if (result.ir.output.shape !== 'flat') throw new Error('expected flat');
  expect(result.ir.output.order).toEqual(['k', 'total', 'c']);
  const compiled = emitNaive(result.ir);
  expect(compiled.params).toEqual({ p0: 'fallback' });
  expect(compiled.sql.match(/\{p0:String\}/g)).toHaveLength(2);
  expect(result.row.total.ir.type).toEqual(col.UInt64.type);
  expect(q.ir.kind).toBe('Scan');
});
it('validates scope and aggregate placement independently of wrappers', () => {
  const q = from(t);
  const grouped = columnExpr(col.UInt32, q.ir.id, ['n'], 'n', 'grouped');
  const output = flatOutput([['x', col.UInt32.type]]);
  const project = relNode({ kind: 'Project', input: q.ir, output, columns: output.columns, exprs: { x: grouped.ir } });
  expect(() => emitNaive(project)).toThrow(/invalid_expression_mode.*root.exprs.x/);
  const aggregate = q.aggregate(g => ({ total: sum(g.n) })).ir;
  if (aggregate.kind !== 'Aggregate') throw new Error('expected aggregate');
  const valid = aggregate.aggs.total!;
  if (valid.kind !== 'Agg') throw new Error('expected agg');
  const { id: _relId, ...aggregateFields } = aggregate;
  const { id: _exprId, ...fields } = valid;
  const forged = (e: typeof valid) => relNode({ ...aggregateFields, aggs: { total: e } });
  expect(() => emitNaive(forged(exprNode({ ...fields, args: [q.row.n.ir] })))).toThrow(/invalid_expression_mode/);
  expect(() => emitNaive(forged(exprNode({ ...fields, args: [valid] })))).toThrow(/invalid_aggregate_placement/);
  expect(() => emitNaive(forged(exprNode({ ...fields, args: [] })))).toThrow(/invalid_argument_arity/);
  expect(() => emitNaive(forged(exprNode({ ...fields, fn: { ...valid.fn, linear: false } })))).toThrow(/invalid_function_metadata/);
  const other = from(t);
  const foreign = columnExpr(col.UInt32, other.ir.id, ['n'], 'n', 'grouped');
  expect(() => emitNaive(forged(exprNode({ ...fields, args: [foreign.ir] })))).toThrow(/unbound_column/);
  expect(() => emitNaive(q.aggregate(g => ({ state: sumState(g.n) })).ir)).toThrow(/aggregate_state_selection/);
  expect(() => emitNaive(q.map(() => ({ x: new Expr(count().ir, 'x', 'row') })).ir)).toThrow(/invalid_aggregate_placement/);
});
it('rejects escaped grouped calls, forged results and aggregate schema collisions with paths', () => {
  const q = from(t);
  const grouped = columnExpr(col.UInt32, q.ir.id, ['n'], 'n', 'grouped');
  const escaped = new Expr(grouped.plus(1).ir, 'escaped', 'row');
  expect(() => emitNaive(q.map(() => ({ escaped })).ir)).toThrow(/invalid_expression_mode at root.exprs.escaped.args\[0\]/);
  const valid = q.aggregate(g => ({ total: sum(g.n) })).ir;
  if (valid.kind !== 'Aggregate' || valid.aggs.total?.kind !== 'Agg') throw new Error('expected aggregate');
  const { id: _id, ...fields } = valid;
  const { id: _aggId, ...agg } = valid.aggs.total;
  const incorrect = exprNode({ ...agg, type: col.Float64.type });
  const wrongOutput = flatOutput([['total', col.Float64.type]]);
  expect(() => emitNaive(relNode({ ...fields, aggs: { total: incorrect }, output: wrongOutput, columns: wrongOutput.columns }))).toThrow(/invalid_expression_type at root.aggs.total/);
  expect(() => emitNaive(relNode({ ...fields, keys: { total: q.row.n.ir } }))).toThrow(/duplicate_column at root/);
  expect(() => emitNaive(relNode({ ...fields, aggs: { total: grouped.ir } }))).toThrow(/invalid_aggregate_placement at root.aggs.total/);
});
