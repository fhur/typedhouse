import { expect, it } from 'vitest';
import { cast, col, count, crossJoin, exprNode, from, join, scalar, table, unionAll, val, type Rel } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { references, safePredicate } from '../src/rewrite-expressions.js';
const q = from(table('rewrite', { id: col.UInt32, text: col.Nullable(col.String), ids: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
function rewrite(root: Rel) {
  const snapshot = () => JSON.stringify(root, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
  const before = snapshot();
  validateRel(root);
  const result = rewriteRel(root);
  validateRel(result.root);
  expect(snapshot()).toBe(before);
  expect(result.root.output).toEqual(root.output);
  expect(rewriteRel(result.root).root).toBe(result.root);
  expect(compile(root).columns).toEqual(emitNaive(root).columns);
  return result;
}
it('merges total filters, retaining Params and original metadata', () => {
  const p = val(1, col.UInt32);
  const query = q.where(r => r.id.gt(p)).where(r => r.id.lt(p));
  const result = rewrite(query.ir);
  expect(result.hits.MergeFilter).toBe(1);
  expect(result.root.kind).toBe('Filter');
  if (result.root.kind !== 'Filter' || result.root.pred.kind !== 'Call') throw new Error('shape');
  expect(result.root.input).toBe(q.ir);
  for (const e of result.root.pred.args) { if (e.kind !== 'Call') throw new Error('shape'); expect(e.args[1]).toBe(p.ir); }
  expect(Object.keys(compile(query.ir).params)).toEqual(['p0']);
  expect(compile(query.ir).nodes).toEqual(emitNaive(query.ir).nodes);
});
it('pushes renamed selections and joins to a multi-rule fixpoint with exact occurrences', () => {
  const shared = q.map(r => ({ renamed: r.id, text: r.text }));
  const query = join({ a: shared, b: shared }).on(r => r.a.renamed.eq(r.b.renamed))
    .where(r => r.a.renamed.gt(1).and(r.b.renamed.lt(3)))
    .where(r => r.a.text.isNotNull());
  const result = rewrite(query.ir);
  expect(result.hits.MergeFilter).toBeGreaterThan(0);
  expect(result.hits.PushFilterProject).toBe(3);
  expect(result.hits.PushFilterJoin).toBeGreaterThan(0);
  expect(result.root.kind).toBe('Join');
  if (result.root.kind !== 'Join') throw new Error('shape');
  for (const [, side] of result.root.inputs) {
    expect(side.kind).toBe('Project');
    if (side.kind !== 'Project' || side.input.kind !== 'Filter') throw new Error('shape');
    expect(side.input.input).toBe(q.ir);
    expect(references(side.input.pred).every(r => r.rel === q.ir.id && r.path.length === 1)).toBe(true);
  }
  expect(shared.ir.kind === 'Project' && shared.ir.input).toBe(q.ir);
});
it('retains mixed-side OR and constants above cross joins, pushing single-side conjuncts only', () => {
  const query = crossJoin({ a: q, b: q }).where(r => r.a.id.gt(1).and(r.a.id.eq(2).or(r.b.id.eq(3))).and(val(true)));
  const result = rewrite(query.ir);
  expect(result.hits.PushFilterJoin).toBe(1);
  if (result.root.kind !== 'Filter' || result.root.input.kind !== 'Join') throw new Error('shape');
  expect(result.root.input.inputs[0]![1].kind).toBe('Filter');
  expect(result.root.input.inputs[1]![1]).toBe(q.ir);
  const input = result.root.input;
  expect(references(result.root.pred).every(r => r.rel === input.id)).toBe(true);
});
it.each([false, true])('pushes independent predicates below expansion (left=%s)', left => {
  const expanded = left ? q.leftArrayJoin(r => r.ids, 'part') : q.arrayJoin(r => r.ids, 'part');
  const result = rewrite(expanded.where(r => r.text.isNull()).ir);
  expect(result.hits.PushFilterArrayJoin).toBe(1);
  if (result.root.kind !== 'ArrayJoin' || result.root.input.kind !== 'Filter') throw new Error('shape');
  expect(result.root.left).toBe(left);
  expect(result.root.expr.kind === 'ColumnRef' && result.root.expr.rel).toBe(result.root.input.id);
  expect(rewrite(expanded.where(r => r.part.eq('x')).ir).hits.PushFilterArrayJoin).toBe(0);
});
it('keeps all explicit fences and unused fallible projections', () => {
  const fences = [q.orderBy(r => r.id), q.limit(1), q.distinct(), unionAll(q, q), q.materialize()];
  for (const fence of fences) { const root = fence.where(r => r.id.gt(1)).ir; expect(rewriteRel(root).root).toBe(root); }
});
it('does not move across computed projections, casts, aggregates or unsafe filters', () => {
  const queries = [
    q.map(r => ({ id: r.id, unused: cast(r.text, col.Nullable(col.UInt32)) })).where(r => r.id.gt(1)),
    q.map(r => ({ id: r.id.plus(1) })).where(r => r.id.gt(1n)),
    q.where(r => cast(r.text, col.Nullable(col.UInt32)).gt(1)).where(r => r.id.gt(1)),
    q.aggregate(() => ({ n: count() })).where(r => r.n.gt(1n)),
  ];
  for (const query of queries) { const result = rewrite(query.ir); expect(result.root).toBe(query.ir); }
});
it('preserves manual graph and Param identities without requiring constructor registration', () => {
  const p = val(1, col.UInt32);
  const manual = structuredClone(q.where(r => r.id.gt(p)).where(r => r.id.lt(p)).ir);
  if (manual.kind !== 'Filter' || manual.pred.kind !== 'Call') throw new Error('shape');
  const param = manual.pred.args[1];
  const result = rewrite(manual).root;
  if (result.kind !== 'Filter' || result.pred.kind !== 'Call') throw new Error('shape');
  expect(result.input).toBe(manual.input.kind === 'Filter' ? manual.input.input : undefined);
  for (const e of result.pred.args) { if (e.kind !== 'Call') throw new Error('shape'); expect(e.args[1]).toBe(param); }
  expect(Object.keys(compile(manual).params)).toEqual(['p0']);
});
it('retains supported hidden selections and never misses a hidden fallible output', () => {
  const direct = structuredClone(q.map(r => ({ id: r.id })).where(r => r.id.gt(1)).ir);
  if (direct.kind !== 'Filter' || direct.input.kind !== 'Project') throw new Error('shape');
  const es = direct.input.exprs;
  Object.defineProperty(es, 'id', { enumerable: false });
  Object.defineProperty(es, 'spare', { enumerable: true, value: es.id });
  expect(rewrite(direct).hits.PushFilterProject).toBe(1);
  const unsafe = structuredClone(q.map(r => ({ id: r.id, unused: cast(r.text, col.Nullable(col.UInt32)) })).where(r => r.id.gt(1)).ir);
  if (unsafe.kind !== 'Filter' || unsafe.input.kind !== 'Project') throw new Error('shape');
  const exprs = unsafe.input.exprs;
  Object.defineProperty(exprs, 'unused', { enumerable: false });
  Object.defineProperty(exprs, 'spare', { enumerable: true, value: exprs.id });
  expect(rewrite(unsafe).root).toBe(unsafe);
});
it('rebinds whole nested occurrence paths, never leaf names alone', () => {
  const nested = crossJoin({ a: q, b: q });
  const query = crossJoin({ nested, a: q }).where(r => r.nested.b.id.gt(1));
  const result = rewrite(query.ir);
  expect(result.hits.PushFilterJoin).toBe(2);
  if (result.root.kind !== 'Join') throw new Error('shape');
  const inner = result.root.inputs[0]![1];
  if (inner.kind !== 'Join') throw new Error('shape');
  expect(inner.inputs[0]![1]).toBe(q.ir);
  expect(inner.inputs[1]![1].kind).toBe('Filter');
  expect(result.root.inputs[1]![1]).toBe(q.ir);
});
it('rewrites subquery scopes independently but never moves their containing predicates', () => {
  const inner = q.where(r => r.id.gt(1)).where(r => r.id.lt(5)).map(r => ({ id: r.id }));
  const query = q.map(r => ({ renamed: r.id })).where(r => r.renamed.in(inner));
  const result = rewrite(query.ir);
  expect(result.root.kind).toBe('Filter');
  expect(result.hits.MergeFilter).toBe(1);
  expect(result.hits.PushFilterProject).toBe(0);
  const scalarQuery = q.map(r => ({ id: r.id })).where(r => r.id.gt(scalar(q.aggregate(g => ({ n: count() }))).as(col.UInt32)));
  // The scalar declaration is not valid; validation must not be bypassed by a rewrite.
  expect(() => compile(scalarQuery.ir)).toThrow();
});
it('treats date-range-checked outputs and computed join conditions as fences', () => {
  const dates = from(table('dates', { id: col.UInt32, at: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const dateQuery = dates.map(r => ({ id: r.id, unused: r.at.toStartOfWeek() })).where(r => r.id.gt(1));
  expect(rewrite(dateQuery.ir).root).toBe(dateQuery.ir);
  const joined = join({ a: q, b: q }).on(r => r.a.id.plus(1).eq(r.b.id.plus(1))).where(r => r.a.id.gt(1));
  expect(rewrite(joined.ir).hits.PushFilterJoin).toBe(0);
});
it('requires resolved scalar families, not deterministic metadata alone', () => {
  const float = val(1).eq(2).ir;
  const casted = cast(q.row.id, col.UInt64).eq(1n).ir;
  expect(safePredicate(float)).toBe(false);
  expect(safePredicate(casted)).toBe(false);
  const raw = exprNode({ kind: 'Raw', type: col.Bool.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['throwIf(1)'], args: [] });
  expect(safePredicate(raw)).toBe(false);
  const volatile = exprNode({ kind: 'Call', type: col.Bool.type, fn: { name: 'rand', deterministic: false, origin: 'known' }, args: [] });
  expect(safePredicate(volatile)).toBe(false);
  expect(safePredicate(q.row.id.eq(val(1, col.UInt16)).ir)).toBe(false);
  expect(safePredicate(q.row.text.isNull().ir)).toBe(true);
  const forged = q.row.id.eq(1).ir;
  if (forged.kind !== 'Call') throw new Error('shape');
  expect(safePredicate({ ...forged, fn: { ...forged.fn, deterministic: false } })).toBe(false);
});
it('keeps diagnostic paths on original objects and equal-valued Params distinct after movement', () => {
  const first = val(1, col.UInt32), second = val(1, col.UInt32);
  const shared = q.map(r => ({ renamed: r.id }));
  const query = crossJoin({ t0: shared, '__chql_input': shared })
    .where(r => r.t0.renamed.gt(first).and(r.__chql_input.renamed.lt(second)))
    .where(r => r.t0.renamed.ne(first));
  const before = emitNaive(query.ir);
  const compiled = compile(query.ir);
  expect(compiled.nodes.root).toBe(query.ir);
  expect(Object.keys(compiled.nodes)).toEqual(Object.keys(before.nodes));
  for (const path of Object.keys(before.nodes)) expect(compiled.nodes[path]).toBe(before.nodes[path]);
  expect(Object.values(compiled.params)).toEqual(['1', '1']);
  expect(compiled.parameterTypes).toEqual({ p0: col.UInt32.type, p1: col.UInt32.type });
  const rewritten = rewrite(query.ir);
  expect(rewritten.hits.PushFilterJoin).toBeGreaterThan(0);
  expect(rewriteRel(rewritten.root).hits).toEqual({ MergeFilter: 0, PushFilterProject: 0, PushFilterJoin: 0, PushFilterArrayJoin: 0 });
});
it('retains original invalid graph diagnostics and fails loudly at the convergence cap', () => {
  const foreign = q.map(r => ({ id: r.id }));
  const invalid = q.where(() => foreign.row.id.gt(1));
  let reference: unknown;
  try { emitNaive(invalid.ir); } catch (error) { reference = error; }
  expect(() => compile(invalid.ir)).toThrow(String(reference).replace(/^ValidationError: /, ''));
  const query = q.map(r => ({ id: r.id })).where(r => r.id.gt(1));
  expect(() => rewriteRel(query.ir, 1)).toThrow('rewrite_nonconvergence');
});
