import { expect, it } from 'vitest';
import { Expr, cast, col, table, from, val, sum, count, scalar, unionAll, exprNode, relNode, flatOutput, type ExprNode, type CHType } from '@chql/core';
import { emitNaive, quoteIdentifier } from '../src/index.js';
const q = from(table('cast', { ['a.b`']: col.UInt32, text: col.String, n: col.Nullable(col.UInt32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
function project(e: ExprNode) { const output = flatOutput([['result', e.type!]]); return relNode({ kind: 'Project', input: q.ir, exprs: { result: e }, output, columns: output.columns }); }
function node(expr: ExprNode, to: CHType, type = to) { return exprNode({ kind: 'Cast', expr, to, type }); }
it('aligns explicit union descriptors without enabling implicit coercion', () => {
  const small = q.map(r => ({ value: r['a.b`'] }));
  const wide = q.map(() => ({ value: val(1.5) }));
  expect(() => unionAll(small, wide)).toThrow('union_descriptor_mismatch');
  const aligned = unionAll(small.map(r => cast(r.value, col.Float64)), wide);
  const result = aligned.where(r => cast(r.value, col.Bool)).groupBy(r => cast(r.value, col.String)).aggregate(g => ({ total: cast(count(), col.Float64) })).orderBy(r => cast(r.value, col.Float64));
  expect(emitNaive(result.ir).sql).toContain('CAST(count() AS Float64)');
  expect(emitNaive(result.ir).columns).toEqual({ value: col.String.type, total: col.Float64.type });
});
it('preserves Params, root scope, aggregate traversal and reordered sort references', () => {
  const shared = val('7', col.String);
  const result = q.map(r => ({ a: cast(shared, col.UInt64), b: cast(shared, col.Float64), c: cast(val('7', col.String), col.Int32), d: cast(r['a.b`'], col.String) }));
  const before = JSON.stringify(result.ir);
  const plan = emitNaive(result.ir);
  expect(plan.params).toEqual({ p0: '7', p1: '7' });
  expect(plan.sql.match(/\{p0:String\}/g)).toHaveLength(2);
  expect(plan.sql).toContain(`CAST(\`__chql_input\`.${quoteIdentifier('a.b`')} AS String)`);
  expect(JSON.stringify(result.ir)).toBe(before);
  const sorted = q.orderBy(r => r.text).orderBy(r => cast(r['a.b`'], col.String)).thenBy(r => cast(r.text, col.Float64));
  expect(() => emitNaive(sorted.ir)).not.toThrow();
  const aggregate = q.aggregate(g => ({ before: sum(cast(g['a.b`'], col.Float64)), after: cast(sum(g['a.b`']), col.Float64).plus(1) }));
  expect(emitNaive(aggregate.ir).sql).toContain('sum(CAST(');
  expect(emitNaive(aggregate.ir).sql).toContain('plus(CAST(sum(');
  const nested = q.map(() => cast(cast(scalar(q.aggregate(() => count())), col.Nullable(col.String)), col.Nullable(col.Float64)));
  expect(() => emitNaive(nested.ir)).not.toThrow();
});
it('adversarial casts validate original Params and nested metadata rather than trusting the outer target', () => {
  for (const [value, type] of [[256, col.UInt8.type], ['7', col.UInt32.type], [7, col.UInt64.type], [1, col.Bool.type]] as const) {
    const bad = exprNode({ kind: 'Param', value, type });
    expect(() => emitNaive(project(node(bad, col.String.type)))).toThrow(/param_incompatible.*\.expr/);
  }
  const forged = node(q.row.text.ir, col.UInt32.type, col.Float64.type);
  expect(() => emitNaive(project(node(forged, col.String.type)))).toThrow('invalid_expression_type');
  expect(() => emitNaive(project(node(node(q.row.n.ir, col.UInt32.type), col.Nullable(col.String).type)))).toThrow('cast_nullable_removal');
  const shared = val(7, col.UInt32);
  const plan = emitNaive(q.map(() => ({ original: shared, text: cast(shared, col.String), wide: cast(shared, col.UInt64) })).ir);
  expect(plan.params).toEqual({ p0: '7' });
  expect(plan.parameterTypes).toEqual({ p0: col.UInt32.type });
  expect(plan.sql.match(/\{p0:UInt32\}/g)).toHaveLength(3);
});
it('adversarial cast aggregate operands cannot smuggle nested aggregates or row/grouped mixtures', () => {
  const nested = sum(new Expr<number, 'count', 'grouped'>(cast(count(), col.Float64).ir, 'count', 'grouped'));
  expect(() => emitNaive(q.aggregate(() => nested).ir)).toThrow('invalid_aggregate_placement');
  q.aggregate(g => {
    const mixed = node(sum(cast(g['a.b`'], col.Float64)).plus(new Expr<number, never, 'agg'>(cast(g['a.b`'], col.Float64).ir, undefined as never, 'agg')).ir, col.String.type);
    const output = flatOutput([['x', col.String.type]]);
    expect(() => emitNaive(relNode({ kind: 'Aggregate', input: q.ir, keys: {}, aggs: { x: mixed }, output, columns: output.columns }))).toThrow('invalid_expression_mode');
    return count();
  });
  const foreign = q.map(() => ({ value: cast(q.map(r => r.text).row.text, col.UInt64) }));
  const query = q.map(() => ({ value: cast(scalar(foreign.aggregate(g => sum(g.value))), col.Nullable(col.String)) }));
  expect(() => emitNaive(query.ir)).toThrow(/unbound_column.*\.expr/);
});
it('validates nullable targets and refuses configurable nullable removal', () => {
  expect(() => emitNaive(q.map(r => cast(r.n, col.Float64)).ir)).toThrow('cast_nullable_removal');
  expect(emitNaive(q.map(r => cast(r.n, col.Nullable(col.Float64))).ir).columns).toEqual({ n: col.Nullable(col.Float64).type });
  expect(() => emitNaive(project(node(val(null).ir, col.Float64.type)))).toThrow('param_untyped');
  expect(() => emitNaive(project(node(exprNode({ kind: 'Param', value: null, type: col.UInt32.type }), col.Float64.type)))).toThrow('cast_nullable_removal');
  expect(() => emitNaive(project(node(exprNode({ kind: 'Param', value: '7', type: null }), col.Float64.type)))).toThrow('param_untyped');
});
it('rejects forged targets/results, unsafe type text and unsupported operand families', () => {
  for (const type of [col.Array(col.String).type, col.DateTime64(3).type, col.Decimal(10, 2).type, col.LowCardinality(col.String).type, col.Tuple({ x: col.String }).type, { kind: 'Unknown', raw: 'Float64) AS injected --' }, { kind: 'scalar', name: 'Float64) AS injected --' }, { kind: 'Nullable', inner: col.Nullable(col.String).type }, null] as CHType[]) {
    expect(() => emitNaive(project(node(q.row.text.ir, type, col.Float64.type)))).toThrow('unsupported_cast_type');
  }
  expect(() => emitNaive(project(node(q.row.text.ir, col.Float64.type, col.String.type)))).toThrow('invalid_expression_type');
  expect(() => emitNaive(q.map(() => ({ value: cast(val(new Date(0)), col.String) })).ir)).toThrow('unsupported_cast_type');
  expect(() => emitNaive(q.map(r => cast(r['a.b`'], col.Float64).as(col.String)).ir)).toThrow('invalid_expression_type');
  expect(() => emitNaive(q.map(r => r['a.b`'].as(col.Float64)).ir)).toThrow('unbound_column');
});
it('casts cannot conceal foreign references, grouped columns or illegal aggregates', () => {
  const other = q.map(r => r.text);
  expect(() => emitNaive(other.map(() => cast(q.row.text, col.Float64)).ir)).toThrow(/unbound_column.*\.expr/);
  expect(() => emitNaive(project(cast(count(), col.Float64).ir))).toThrow('invalid_aggregate_placement');
  q.aggregate(g => {
    expect(() => emitNaive(project(cast(g.text, col.Float64).ir))).toThrow('invalid_expression_mode');
    const forged = new Expr<number, 'text', 'agg'>(cast(g.text, col.Float64).ir, 'text', 'agg');
    expect(() => emitNaive(q.aggregate(() => forged).ir)).toThrow('invalid_aggregate_placement');
    return count();
  });
  const output = flatOutput([['x', col.Float64.type]]);
  const bare = node(q.row['a.b`'].ir, col.Float64.type);
  expect(() => emitNaive(relNode({ kind: 'Aggregate', input: q.ir, keys: {}, aggs: { x: bare }, columns: output.columns, output }))).toThrow('invalid_aggregate_placement');
});
