import { expect, it } from 'vitest';
import { expectTypeOf } from 'expect-type';
import { col, from, join, max, count, table, val, relNode, exprNode, type Query, type Infer, type ExprNode } from '@typedhouse/core';
import { emitNaive } from '../src/index.js';
import { rowDecoder } from '../../client/src/decode.js';

const t = table('metrics', { tenantId: col.String, entityId: col.String, version: col.UInt32, pair: col.Tuple({ label: col.String }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const q = from(t);
type Versioned = { tenantId: string; entityId: string; version: number };
const latest = <R extends Versioned>(q: Query<R>) => {
  const newest = q.groupBy(m => ({ tenantId: m.tenantId, entityId: m.entityId })).aggregate(g => ({ version: max(g.version) }));
  return join({ m: q, v: newest }).on(r => [r.m.tenantId.eq(r.v.tenantId), r.m.entityId.eq(r.v.entityId), r.m.version.eq(r.v.version)]).map(r => ({ ...r.m }));
};
const concrete = latest(q);
expectTypeOf<Infer<typeof concrete>>().toEqualTypeOf<Infer<typeof t>>();
expectTypeOf<Infer<typeof concrete>>().not.toBeAny();
const j = join({ a: q, b: q }).on(r => [r.a.entityId.eq(r.b.entityId), r.a.version.lt(r.b.version)]);
expectTypeOf<Infer<typeof j>>().toEqualTypeOf<{ a: Infer<typeof t>; b: Infer<typeof t> }>();
expectTypeOf<Infer<typeof j>>().not.toBeAny();
const grouped = j.where(r => r.a.version.gt(1)).orderBy(r => r.b.version).limit(2).distinct().groupBy(r => r.a.entityId).aggregate(g => ({ version: max(g.b.version), n: count() }));
expectTypeOf<Infer<typeof grouped>>().toEqualTypeOf<{ entityId: string; version: number; n: bigint }>();
const projected = j.map(r => ({ ...r.a })).map(r => r.pair.element('label'));
expectTypeOf<Infer<typeof projected>>().toEqualTypeOf<{ pair: string }>();
const nested = join({ ab: j, c: q }).on(r => r.ab.a.entityId.eq(r.c.entityId));
expectTypeOf<Infer<typeof nested>>().toEqualTypeOf<{ ab: { a: Infer<typeof t>; b: Infer<typeof t> }; c: Infer<typeof t> }>();

it('preserves alias occurrences, shared identity, nested descriptors and residual Filter', () => {
  expect(j.ir.kind).toBe('Filter');
  if (j.ir.kind !== 'Filter' || j.ir.input.kind !== 'Join') throw new Error('expected join');
  expect(j.ir.input.inputs[0]![1]).toBe(q.ir);
  expect(j.ir.input.inputs[1]![1]).toBe(q.ir);
  expect(Object.isFrozen(j.row.a)).toBe(true);
  expect(j.row.a.pair.ir.type).toEqual(t.columns.pair);
  expect(emitNaive(j.ir).sql).toContain('INNER ALL JOIN');
  expect(emitNaive(j.ir).sql).toContain(' WHERE less(');
  expect(emitNaive(grouped.ir).sql).toContain('GROUP BY');
  expect(emitNaive(projected.ir).sql).toContain('tupleElement');
  expect(emitNaive(concrete.ir).sql).toContain('max(');
  expect(emitNaive(nested.ir).sql.match(/INNER ALL JOIN/g)).toHaveLength(2);
});
it('decodes nested transport without splitting dotted names or polluting prototypes', () => {
  const source = from(table('hostile', { 'x.y': col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const query = join({ ['__proto__']: source, 'a.b': source }).on(r => r.__proto__['x.y'].eq(r['a.b']['x.y']));
  const plan = emitNaive(query.ir);
  const wire = Object.fromEntries(Object.keys(plan.columns).map(n => [n, '7']));
  expect(rowDecoder(plan.columns, plan.columnPaths)(wire)).toEqual({ ['__proto__']: { 'x.y': 7n }, 'a.b': { 'x.y': 7n } });
});
it('numbers shared and equal Params by emitted SQL appearance', () => {
  const shared = val('acme');
  const query = join({ a: q.where(r => r.tenantId.eq(shared)), b: q.where(r => r.tenantId.eq(val('acme'))), c: q.where(r => r.tenantId.eq(shared)) }).on(r => [r.a.entityId.eq(r.b.entityId), r.b.entityId.eq(r.c.entityId)]);
  expect(emitNaive(query.ir).params).toEqual({ p0: 'acme', p1: 'acme' });
  expect(emitNaive(query.ir).sql.match(/\{p0:String\}/g)).toHaveLength(2);
});
it('validates low-level residual predicates and grouped provenance without mutating shared inputs', () => {
  const built = join({ a: q, b: q }).on(r => [r.a.version.eq(r.b.version), r.a.version.lt(r.b.version)]).ir;
  if (built.kind !== 'Filter' || built.input.kind !== 'Join') throw new Error('expected filter');
  const input = built.input;
  const { id: _id, ...fields } = input;
  const rebind = (e: typeof built.pred): typeof built.pred => e.kind === 'ColumnRef' ? exprNode({ kind: 'ColumnRef', rel: input.scope!, path: e.path, type: e.type, mode: 'row' }) : e.kind === 'Call' ? exprNode({ kind: 'Call', fn: e.fn, type: e.type, args: e.args.map(rebind) }) : e;
  const low = relNode({ ...fields, on: [...input.on, rebind(built.pred)] });
  const before = JSON.stringify(low);
  expect(emitNaive(low).sql).toContain(' WHERE less(`a`.`version`, `b`.`version`)');
  expect(JSON.stringify(low)).toBe(before);
  const eq = input.on[0]!;
  if (eq.kind !== 'Call' || eq.args[0]?.kind !== 'ColumnRef') throw new Error('expected equality');
  const { id: _refId, ...ref } = eq.args[0];
  const bad = exprNode({ kind: 'Call', fn: eq.fn, type: eq.type, args: [exprNode({ ...ref, mode: 'grouped' }), eq.args[1]!] });
  expect(() => emitNaive(relNode({ ...fields, on: [bad] }))).toThrow('invalid_expression_mode at root.on[0].args[0]');
});
it('splits nested ON conjunctions authoritatively, preserves Params, and never extracts OR keys', () => {
  const shared = val(1, col.UInt32);
  let conjunction: ExprNode | undefined;
  const built = join({ a: q.where(r => r.version.gt(shared)), b: q }).on(r => {
    const e = r.a.entityId.eq(r.b.entityId).and(r.a.version.gt(shared).and(r.b.version.gt(shared)));
    conjunction = e.ir;
    return e;
  });
  if (built.ir.kind !== 'Filter' || built.ir.input.kind !== 'Filter' || built.ir.input.input.kind !== 'Join' || !conjunction) throw new Error('expected split filters');
  const { id: _id, ...fields } = built.ir.input.input;
  const low = relNode({ ...fields, on: [conjunction] });
  const before = JSON.stringify(low);
  const plan = emitNaive(low);
  expect(plan.sql).toContain('ON (`a`.`entityId` = `b`.`entityId`) WHERE greater(');
  expect(plan.params).toEqual({ p0: '1' });
  expect(plan.sql.match(/\{p0:UInt32\}/g)).toHaveLength(3);
  expect(JSON.stringify(low)).toBe(before);
  expect(emitNaive(built.ir).params).toEqual(plan.params);
  expect(() => emitNaive(join({ a: q, b: q }).on(r => r.a.entityId.eq(r.b.entityId).or(r.a.version.lt(r.b.version))).ir)).toThrow('join_condition_arity');
  if (conjunction.kind !== 'Call') throw new Error('expected conjunction');
  const { id: _exprId, ...call } = conjunction;
  expect(() => emitNaive(relNode({ ...fields, on: [exprNode({ ...call, type: col.String.type })] }))).toThrow('root.on[0]');
});
it('validates mixed expansion schemas and retains frozen nested rows', () => {
  const source = q.map(r => ({ id: r.entityId, labels: val(['x'], col.Array(col.String)) }));
  const joined = join({ a: source, b: source }).on(r => r.a.id.eq(r.b.id));
  const expanded = joined.arrayJoin(r => r.a.labels, 'item');
  expect(Object.isFrozen(expanded.row)).toBe(true);
  expect(Object.isFrozen(expanded.row.a)).toBe(true);
  expect(expanded.row.item.ir.type).toEqual(col.String.type);
  const alias: string = ['a'].join('');
  expect(() => joined.arrayJoin(r => r.a.labels, alias)).toThrow('duplicate_column: a');
  if (expanded.ir.kind !== 'ArrayJoin' || expanded.ir.output.shape !== 'nested') throw new Error('expected mixed expansion');
  const { id: _id, ...fields } = expanded.ir;
  expect(() => emitNaive(relNode({ ...fields, output: joined.ir.output }))).toThrow('invalid_output at root');
  expect(() => emitNaive(relNode({ ...fields, alias: 'a' }))).toThrow('duplicate_column at root.alias');
  expect(() => emitNaive(relNode({ ...fields, expr: source.row.labels.ir }))).toThrow('unbound_column at root.expr');
});
it('rejects disconnected or wrong-scope graphs with named paths', () => {
  expect(() => emitNaive(join({ a: q, b: q, c: q }).on(r => r.a.entityId.eq(r.c.entityId)).ir)).toThrow('join_condition_arity at root.inputs[1]');
  expect(() => emitNaive(join({ a: q, b: q }).on(r => r.a.version.eq(1)).ir)).toThrow('join_condition_arity at root.on[0]');
  expect(() => emitNaive(join({ a: q, b: q }).on(r => r.a.version.eq(q.row.version)).ir)).toThrow('unbound_column at root.on[0].args[1]');
  const good = join({ a: q, b: q }).on(r => r.a.version.eq(r.b.version)).ir;
  if (good.kind !== 'Join') throw new Error('expected join');
  const { id: _id, ...fields } = good;
  expect(() => emitNaive(relNode({ ...fields, on: [exprNode({ kind: 'Call', fn: good.on[0]!.kind === 'Call' ? good.on[0]!.fn : (() => { throw new Error(); })(), args: [], type: col.Bool.type })] }))).toThrow('join_condition_arity at root.on[0]');
  expect(() => emitNaive(relNode({ ...fields, output: { shape: 'nested', inputs: [['a', q.ir.output]] } }))).toThrow('invalid_output at root');
});
