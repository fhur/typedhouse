import { expect, it } from 'vitest';
import { cast, col, count, createKnownFunctions, max, sum, crossJoin, exprNode, from, join, leftJoin, rightJoin, scalar, table, unionAll, val, type ExprNode, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { rewriteMeasure, rewriteRel } from '../src/rewrite-rel.js';
import { conjuncts, nullRejecting, references, safePredicate, totalExpression } from '../src/rewrite-expressions.js';
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
  const fences = [q.orderBy(r => r.id), q.limit(1), q.distinct(), q.cte()];
  for (const fence of fences) { const root = fence.where(r => r.id.gt(1)).ir; expect(rewriteRel(root).root).toBe(root); }
});
it('does not move across fallible projections, casts, aggregates or unsafe filters', () => {
  const queries = [
    q.map(r => ({ id: r.id, unused: cast(r.text, col.Nullable(col.UInt32)) })).where(r => r.id.gt(1)),
    q.map(r => ({ id: r.id.plus(1), unused: cast(r.text, col.Nullable(col.UInt32)) })).where(r => r.id.gt(1n)),
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
  const query = crossJoin({ t0: shared, '__typedhouse_input': shared })
    .where(r => r.t0.renamed.gt(first).and(r.__typedhouse_input.renamed.lt(second)))
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
  expect(rewriteRel(rewritten.root).hits).toEqual({ MergeFilter: 0, MergeProject: 0, PushFilterProject: 0, LeftToInner: 0, PushFilterJoin: 0, PushFilterArrayJoin: 0, PushFilterAggKey: 0, PushFilterUnion: 0 });
});
it('pushes direct aggregate keys, splitting AND but retaining aggregate/mixed OR predicates', () => {
  const a = q.groupBy(r => ({ key: r.id })).aggregate(g => ({ n: count(), highest: max(g.id), total: sum(g.id) }));
  const result = rewrite(a.where(r => r.key.gt(1).and(r.n.gt(1n)).and(r.key.eq(2).or(r.highest.eq(3)))).ir);
  expect(result.hits.PushFilterAggKey).toBe(1);
  if (result.root.kind !== 'Filter' || result.root.input.kind !== 'Aggregate') throw new Error('shape');
  expect(result.root.input.input.kind).toBe('Filter');
  expect(references(result.root.pred).map(r => r.path[0])).toEqual(['n', 'key', 'highest']);
  const nullable = q.groupBy(r => ({ key: r.text })).aggregate(() => ({ n: count() })).where(r => r.key.isNull());
  expect(rewrite(nullable.ir).hits.PushFilterAggKey).toBe(0);
  const fallible = q.groupBy(r => ({ key: r.id })).aggregate(g => ({ n: sum(cast(g.text, col.Nullable(col.UInt32))) })).where(r => r.key.gt(1));
  expect(rewrite(fallible.ir).hits.PushFilterAggKey).toBe(0);
  const global = q.limit(0).aggregate(() => ({ n: count() })).where(() => val(false));
  expect(rewrite(global.ir).root).toBe(global.ir);
});
it('replicates Union predicates per slot without crossing branch fences or merging Params', () => {
  const branches = [q.limit(1), q.orderBy(r => r.id), q.distinct(), q.cte()];
  const p = val(1, col.UInt32), other = val(1, col.UInt32);
  const query = unionAll(branches[0]!, branches[1]!, ...branches.slice(2), branches[0]!).where(r => r.id.gt(p).and(r.id.ne(other)));
  const result = rewriteRel(query.ir);
  expect(result.hits.PushFilterUnion).toBe(1);
  if (result.root.kind !== 'Union') throw new Error('shape');
  expect(result.root.all).toBe(true);
  expect(result.root.inputs).toHaveLength(5);
  for (const [i, branch] of result.root.inputs.entries()) {
    if (branch.kind !== 'Filter') throw new Error('shape');
    expect(branch.input).toBe(i === 4 ? branches[0]!.ir : branches[i]!.ir);
    expect(references(branch.pred).every(r => r.rel === branch.input.id)).toBe(true);
  }
  expect(rewriteRel(result.root).root).toBe(result.root);
});
it('requires exact Union path/order descriptors and preserves DISTINCT occurrences', () => {
  const a = q.map(r => ({ first: r.id, second: r.id }));
  const b = q.map(r => ({ second: r.id, first: r.id }));
  const reordered = unionAll(a, b).where(r => r.first.gt(1));
  expect(rewrite(reordered.ir).hits.PushFilterUnion).toBe(0);
  const distinct = structuredClone(unionAll(a, a, a).where(r => r.first.gt(1)).ir);
  if (distinct.kind !== 'Filter' || distinct.input.kind !== 'Union') throw new Error('shape');
  Object.assign(distinct.input, { all: false });
  const result = rewrite(distinct);
  expect(result.hits.PushFilterUnion).toBe(1);
  if (result.root.kind !== 'Union') throw new Error('shape');
  expect(result.root.all).toBe(false); expect(result.root.inputs).toHaveLength(3);
});
it('does not suppress computed keys, arithmetic aggregates or unused invalid computations', () => {
  const computed = q.groupBy(r => ({ key: r.id.plus(1) })).aggregate(() => ({ n: count() })).where(r => r.key.gt(1n));
  const arithmetic = q.groupBy(r => ({ key: r.id })).aggregate(g => ({ n: sum(g.id).plus(1n) })).where(r => r.key.gt(1));
  for (const query of [computed, arithmetic]) expect(rewrite(query.ir).hits.PushFilterAggKey).toBe(0);
  const invalid = structuredClone(q.groupBy(r => ({ key: r.id })).aggregate(() => ({ n: count() })).where(r => r.key.gt(1)).ir);
  if (invalid.kind !== 'Filter' || invalid.input.kind !== 'Aggregate') throw new Error('shape');
  Object.assign(invalid.input.aggs.n!, { fn: { name: 'rand', deterministic: false, origin: 'known' } });
  expect(() => compile(invalid)).toThrow();
});
it('keeps shared conflicting aggregate consumers independent', () => {
  const shared = q.groupBy(r => ({ key: r.id })).aggregate(() => ({ n: count() }));
  const query = unionAll(shared.where(r => r.key.eq(1)), shared.where(r => r.key.eq(2)), shared);
  const result = rewrite(query.ir);
  expect(result.hits.PushFilterAggKey).toBe(2);
  if (result.root.kind !== 'Union') throw new Error('shape');
  expect(result.root.inputs[2]).toBe(shared.ir);
  expect(shared.ir.kind === 'Aggregate' && shared.ir.input).toBe(q.ir);
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
it('pushes safe conjuncts below any total array expansion, keeping alias-dependent and unsafe ones above', () => {
  const p = from(table('rewrite_parts', { id: col.UInt32, text: col.Nullable(col.String), parts: col.Array(col.Tuple({ id: col.String, mpn: col.Nullable(col.String) })) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const shared = val(['x', 'y'], col.Array(col.String));
  expect(totalExpression(p.row.parts.element('mpn').ir)).toBe(true);
  for (const expanded of [p.arrayJoin(r => r.parts.element('mpn'), 'mpn'), p.leftArrayJoin(r => r.parts.element('mpn'), 'mpn'), p.arrayJoin(() => shared, 'mpn')]) {
    const result = rewrite(expanded.where(r => r.text.isNull().and(r.mpn.eq('a')).and(r.id.gt(1))).ir);
    expect(result.hits.PushFilterArrayJoin).toBe(1);
    if (result.root.kind !== 'Filter' || result.root.input.kind !== 'ArrayJoin' || result.root.input.input.kind !== 'Filter') throw new Error('shape');
    expect(references(result.root.pred).map(r => r.path)).toEqual([['mpn']]);
    expect(references(result.root.input.input.pred).map(r => r.path)).toEqual([['text'], ['id']]);
    expect(result.root.input.input.input).toBe(p.ir);
    expect(result.root.input.expr.kind === 'Param' ? result.root.input.expr : undefined).toBe(expanded.ir.kind === 'ArrayJoin' && expanded.ir.expr.kind === 'Param' ? expanded.ir.expr : undefined);
  }
  // `element` is total only with a ColumnRef receiver and a constant selector the catalog resolves.
  const total = p.row.parts.element('mpn').ir;
  if (total.kind !== 'Call') throw new Error('shape');
  expect(totalExpression({ ...total, args: [total.args[0]!, p.row.id.ir] })).toBe(false); // non-constant selector
  expect(totalExpression(p.row.parts.arrayElement(1).element('mpn').ir)).toBe(false); // computed receiver
  expect(totalExpression({ ...total, args: [p.row.parts.arrayElement(1).ir, total.args[1]!] })).toBe(false);
  // A known-origin expansion is outside the total fragment: evaluating it on fewer rows could hide a failure.
  const { fn } = createKnownFunctions({ arraySort: { isAggregate: false, deterministic: true, aliasTo: '' } } as const);
  const opaque = q.arrayJoin(r => fn.arraySort(r.ids).as(col.Array(col.String)), 'one').where(r => r.text.isNull());
  expect(rewrite(opaque.ir).root).toBe(opaque.ir);
  // An unsafe conjunct alone leaves the Filter where it is; total-but-unsafe arithmetic does not cross either.
  for (const unsafe of [p.arrayJoin(r => r.parts.element('mpn'), 'mpn').where(r => cast(r.text, col.Nullable(col.UInt32)).gt(1)), p.arrayJoin(r => r.parts.element('mpn'), 'mpn').where(r => r.id.plus(1).gt(2n))]) {
    expect(rewrite(unsafe.ir).root).toBe(unsafe.ir);
  }
});
it('(vi) gates per conjunct: only safe conjuncts cross Join, ArrayJoin, Aggregate and Union; only total ones cross a Project', () => {
  const unsafe = (text: typeof q.row.text) => cast(text, col.Nullable(col.UInt32)).gt(1);
  const kinds = (e: import('@typedhouse/core').ExprNode) => conjuncts(e).map(c => c.kind === 'Call' && c.args.some(a => a.kind === 'Cast') ? 'cast' : safePredicate(c) ? 'safe' : 'arith');
  // Slice 4b: a non-total conjunct in (or above) the Filter fences PushFilterJoin entirely (`fallibleExposure`:
  // 24.8 copies it across ON equalities into an input the moved guard no longer precedes).
  const fenced = crossJoin({ a: q, b: q }).where(r => r.a.id.gt(1).and(r.a.id.plus(1).gt(2n)).and(unsafe(r.a.text)));
  expect(rewrite(fenced.ir).root).toBe(fenced.ir);
  const joined = rewrite(crossJoin({ a: q, b: q }).where(r => r.a.id.gt(1).and(r.a.id.plus(1).gt(2n))).ir);
  expect(joined.hits.PushFilterJoin).toBe(1);
  if (joined.root.kind !== 'Filter' || joined.root.input.kind !== 'Join' || joined.root.input.inputs[0]![1].kind !== 'Filter') throw new Error('shape');
  expect(kinds(joined.root.pred)).toEqual(['arith']);
  expect(kinds(joined.root.input.inputs[0]![1].pred)).toEqual(['safe']);
  expect(joined.root.input.inputs[1]![1]).toBe(q.ir);
  const expanded = rewrite(q.arrayJoin(r => r.ids, 'part').where(r => r.id.gt(1).and(r.id.plus(1).gt(2n)).and(unsafe(r.text))).ir);
  expect(expanded.hits.PushFilterArrayJoin).toBe(1);
  if (expanded.root.kind !== 'Filter' || expanded.root.input.kind !== 'ArrayJoin' || expanded.root.input.input.kind !== 'Filter') throw new Error('shape');
  expect(kinds(expanded.root.pred)).toEqual(['arith', 'cast']);
  expect(kinds(expanded.root.input.input.pred)).toEqual(['safe']);
  const grouped = q.groupBy(r => ({ key: r.id })).aggregate(() => ({ n: count() })).where(r => r.key.gt(1).and(r.key.plus(1).gt(2n)).and(cast(r.n, col.String).ne('x')));
  const aggregated = rewrite(grouped.ir);
  expect(aggregated.hits.PushFilterAggKey).toBe(1);
  if (aggregated.root.kind !== 'Filter' || aggregated.root.input.kind !== 'Aggregate' || aggregated.root.input.input.kind !== 'Filter') throw new Error('shape');
  expect(kinds(aggregated.root.pred)).toEqual(['arith', 'cast']);
  expect(kinds(aggregated.root.input.input.pred)).toEqual(['safe']);
  const union = rewrite(unionAll(q, q).where(r => r.id.gt(1).and(r.id.plus(1).gt(2n)).and(unsafe(r.text))).ir);
  expect(union.hits.PushFilterUnion).toBe(1);
  if (union.root.kind !== 'Filter' || union.root.input.kind !== 'Union') throw new Error('shape');
  expect(kinds(union.root.pred)).toEqual(['arith', 'cast']);
  for (const branch of union.root.input.inputs) { if (branch.kind !== 'Filter') throw new Error('shape'); expect(kinds(branch.pred)).toEqual(['safe']); expect(branch.input).toBe(q.ir); }
  const projected = rewrite(q.map(r => ({ id: r.id, text: r.text })).where(r => r.id.gt(1).and(r.id.plus(1).gt(2n)).and(unsafe(r.text))).ir);
  expect(projected.hits.PushFilterProject).toBe(1);
  if (projected.root.kind !== 'Filter' || projected.root.input.kind !== 'Project' || projected.root.input.input.kind !== 'Filter') throw new Error('shape');
  expect(kinds(projected.root.pred)).toEqual(['cast']);
  expect(kinds(projected.root.input.input.pred)).toEqual(['safe', 'arith']);
  expect(projected.root.input.input.input).toBe(q.ir);
  // MergeFilter needs both predicates total, not safe: merging changes no evaluation set.
  const merged = rewrite(q.where(r => r.id.plus(1).gt(2n)).where(r => r.id.gt(1)).ir);
  expect(merged.hits.MergeFilter).toBe(1);
  expect(merged.root.kind === 'Filter' && merged.root.input).toBe(q.ir);
  const blocked = q.where(r => unsafe(r.text)).where(r => r.id.plus(1).gt(2n));
  expect(rewrite(blocked.ir).root).toBe(blocked.ir);
});

// Slice 4b: LeftToInner and the outer-join conditions of PushFilterJoin.
const oa = from(table('oa', { id: col.UInt32, s: col.String, k: col.Nullable(col.UInt32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const ob = from(table('ob', { id: col.UInt32, s: col.String, n: col.Int64, k: col.Nullable(col.UInt32), tags: col.Array(col.String), lc: col.LowCardinality(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const lj = () => leftJoin({ a: oa }, { b: ob }).on(r => r.a.id.eq(r.b.id));
const joinOf = (rel: Rel) => { while (rel.kind !== 'Join') { if (!('input' in rel)) throw new Error('no join'); rel = rel.input; } return rel; };
it('LeftToInner: each null-rejecting form on the extended side makes the join inner; the Filter and the output stay', () => {
  const forms = [
    lj().where(r => r.b.s.eq('x')), lj().where(r => r.b.s.ne('x')), lj().where(r => r.b.n.lt(3n)), lj().where(r => r.b.n.le(3n)),
    lj().where(r => r.b.n.gt(3n)), lj().where(r => r.b.n.ge(3n)), lj().where(r => r.b.s.isNotNull()), lj().where(r => r.b.lc.eq('x')),
    // Both sides in one comparison: still NULL on an extended row; it stays above as a residual.
    lj().where(r => r.a.s.eq(r.b.s)),
    // Already Nullable in its source table: an extended row has k = NULL, `k > 1` is NULL (falsy in WHERE),
    // so it is rejected exactly as before. Source NULLs are rejected by the same predicate on either kind.
    lj().where(r => r.b.k.gt(1)),
    // A null-rejecting conjunct anywhere in the conjunction is enough; the or-conjunct stays as is.
    lj().where(r => r.a.s.eq('x').or(r.b.s.eq('y'))).where(r => r.b.n.gt(0n)),
  ];
  for (const query of forms) {
    const result = rewrite(query.ir);
    expect(result.hits.LeftToInner).toBe(1);
    const j = joinOf(result.root);
    expect(j.joinKind).toBe('inner');
    expect(j.output).toEqual(joinOf(query.ir).output);
    // Nothing moves into b: its descriptors are wider in the Join's output than its own.
    expect(j.inputs[1]![1]).toBe(ob.ir);
    const sql = compile(query.ir).sql;
    expect(sql).toMatch(/INNER ALL JOIN/);
    expect(sql).not.toMatch(/join_use_nulls|LEFT ALL JOIN/);
  }
  // Symmetric for right joins on the first input.
  const right = rewrite(rightJoin({ a: oa }, { b: ob }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.eq('x')).ir);
  expect(right.hits).toMatchObject({ LeftToInner: 1, PushFilterJoin: 0 });
  expect(joinOf(right.root).joinKind).toBe('inner');
});
it('LeftToInner negatives: or across sides, isNull, ifNull-wrapped, Param-only, preserved side only, unsafe conjuncts', () => {
  const negatives: [Rel, number][] = [
    [lj().where(r => r.a.s.eq('x').or(r.b.s.eq('y'))).ir, 0],
    [lj().where(r => r.b.s.isNull()).ir, 0],
    [lj().where(r => r.b.n.ifNull(0n).gt(1n)).ir, 0],
    [lj().where(() => val(true)).ir, 0],
    [lj().where(() => val(1, col.UInt32).eq(val(1, col.UInt32))).ir, 0],
    // Preserved side only: pushed into a (PushFilterJoin), the join stays left.
    [lj().where(r => r.a.s.eq('x')).ir, 1],
    // Outside safePredicate: a cast never converts or moves.
    [lj().where(r => cast(r.b.s.ifNull('7'), col.UInt8).gt(1)).ir, 0],
  ];
  for (const [root, pushed] of negatives) {
    const result = rewrite(root);
    expect(result.hits.LeftToInner).toBe(0);
    expect(result.hits.PushFilterJoin).toBe(pushed);
    expect(joinOf(result.root).joinKind).toBe('left');
    expect(compile(root).sql).toMatch(/LEFT ALL JOIN[^]*join_use_nulls = 1/);
  }
  // The predicate itself, directly: only bare Nullable columns of the named side, through the closed forms.
  const bare = (q: { ir: Rel }) => { const r = q.ir; if (r.kind !== 'Filter') throw new Error('filter'); return { pred: r.pred, join: r.input.id }; };
  const tags = bare(lj().where(r => r.b.tags.length().gt(0n)));
  expect(nullRejecting(tags.pred, tags.join, 'b')).toBe(false); // Array side columns keep server defaults ([]).
  const arrayRef = references(tags.pred)[0]!;
  const forged: ExprNode = exprNode({ kind: 'Call', fn: { name: 'eq', origin: 'typed', deterministic: true }, args: [arrayRef, arrayRef], type: { kind: 'scalar', name: 'Bool' } });
  expect(nullRejecting(forged, tags.join, 'b')).toBe(false);
  const pre = bare(lj().where(r => r.b.s.eq('x')));
  expect(nullRejecting(pre.pred, pre.join, 'b')).toBe(true);
  expect(nullRejecting(pre.pred, pre.join, 'a')).toBe(false);
  expect(nullRejecting(pre.pred, oa.ir.id, 'b')).toBe(false);
  const and: ExprNode = exprNode({ kind: 'Call', fn: { name: 'and', origin: 'typed', deterministic: true }, args: [bare(lj().where(r => r.a.s.eq('x'))).pred, pre.pred], type: { kind: 'Nullable', inner: { kind: 'scalar', name: 'Bool' } } });
  expect(nullRejecting(and, pre.join, 'b')).toBe(true);
  const not = bare(lj().where(r => r.b.s.eq('x').not()));
  expect(nullRejecting(not.pred, not.join, 'b')).toBe(false);
});
it('LeftToInner never fires at or under a Filter with a non-total conjunct (server push-down would reorder it)', () => {
  const bad = (r: any): any => cast(r.b.s.ifNull('7'), col.UInt8).gt(1);
  for (const root of [
    lj().where(r => r.b.n.gt(2n)).where(bad).ir,
    lj().where(r => r.b.n.gt(2n).and(bad(r))).ir,
    lj().where(r => r.b.n.gt(2n)).map(r => ({ id: r.a.id, s: r.b.s })).where(r => cast(r.s.ifNull('7'), col.UInt8).gt(1)).ir,
    lj().where(r => r.b.n.gt(2n)).orderBy(r => r.a.id).limit(3).where(bad).ir,
  ]) {
    const result = rewrite(root);
    expect(result.hits.LeftToInner).toBe(0);
    expect(compile(root).sql).toMatch(/LEFT ALL JOIN/);
  }
  // A fallible Filter elsewhere (another union branch, an outer scope around an IN subquery) does not expose this join...
  const converted = lj().where(r => r.b.n.gt(2n)).map(r => ({ id: r.a.id }));
  const elsewhere = lj().where(bad).map(r => ({ id: r.a.id }));
  expect(rewrite(unionAll(converted, elsewhere).ir).hits.LeftToInner).toBe(1);
  expect(rewrite(oa.where(r => r.id.in(converted.map(c => c.id))).where(r => cast(r.s, col.UInt8).gt(1)).ir).hits.LeftToInner).toBe(1);
  // ...while a non-total IN above the join does (conservatively).
  expect(rewrite(converted.where(r => r.id.in(elsewhere.map(e => e.id))).ir).hits.LeftToInner).toBe(0);
  // A total but non-safe conjunct (integer plus) above does not expose it either.
  expect(rewrite(lj().where(r => r.b.n.gt(2n)).where(r => r.a.id.plus(val(1, col.UInt32)).gt(2n)).ir).hits.LeftToInner).toBe(1);
});
it('outer PushFilterJoin never enters an extended input, even one whose output the join leaves unchanged; LeftToInner needs safePredicate', () => {
  // Every column of `on` is already Nullable or an Array, so the left join's output for it equals its own output.
  const on = from(table('on', { id: col.Nullable(col.UInt32), tags: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const anti = leftJoin({ a: oa }, { b: on }).on(r => r.a.k.eq(r.b.id)).where(r => r.b.id.isNull());
  const result = rewrite(anti.ir);
  expect(result.hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  expect(joinOf(result.root).inputs[1]![1]).toBe(on.ir);
  // Null-rejecting and total, but outside safePredicate (integer minus): no conversion.
  const total = lj().where(r => r.b.n.gt(r.b.n.minus(1n)));
  expect(rewrite(total.ir).hits.LeftToInner).toBe(0);
});
it('LeftToInner judges the substituted conjunct after projection pushdown', () => {
  const direct = lj().map(r => ({ id: r.a.id, bs: r.b.s })).where(r => r.bs.eq('x'));
  expect(rewrite(direct.ir).hits).toMatchObject({ PushFilterProject: 1, LeftToInner: 1 });
  // Fix round 1 (m3): the select list keeps the descriptor (toNullable), the total WHERE reads the column bare.
  expect(compile(direct.ir).sql).toMatch(/toNullable\(`b`\.`s`\) AS `bs`[^]*INNER ALL JOIN[^]*WHERE \(`b`\.`s` = /);
  const wrapped = lj().map(r => ({ id: r.a.id, n: r.b.n.ifNull(0n) })).where(r => r.n.gt(1n));
  expect(rewrite(wrapped.ir).hits).toMatchObject({ PushFilterProject: 1, LeftToInner: 0 });
});
it('join_use_nulls stays while another outer join survives and goes when none does; columns keep their descriptors', () => {
  const nested = leftJoin({ x: lj() }, { c: ob }).on(r => r.x.a.id.eq(r.c.id));
  const outerOnly = nested.where(r => r.c.s.eq('x'));
  const result = rewrite(outerOnly.ir);
  expect(result.hits.LeftToInner).toBe(1);
  const sql = compile(outerOnly.ir).sql;
  expect(sql).toMatch(/LEFT ALL JOIN[^]*INNER ALL JOIN|INNER ALL JOIN[^]*LEFT ALL JOIN/);
  expect(sql.match(/join_use_nulls = 1/g)).toHaveLength(2); // the SETTINGS clause and its comment
  const both = nested.where(r => r.c.s.eq('x')).where(r => r.x.b.s.eq('y'));
  expect(rewrite(both.ir).hits.LeftToInner).toBe(2);
  expect(compile(both.ir).sql).not.toMatch(/join_use_nulls|LEFT ALL JOIN/);
  // The compiled descriptors are the original graph's (Nullable on the formerly extended inputs).
  expect(compile(both.ir).columns).toEqual(emitNaive(both.ir).columns);
  expect(Object.values(compile(both.ir).columns).filter(t => t.kind === 'Nullable' || t.kind === 'LowCardinality').length).toBeGreaterThan(0);
});
it('LeftToInner strictly decreases only the fourth (null-extended input) component of the measure', () => {
  const root = lj().where(r => r.b.s.eq('x')).ir;
  const once = (() => { try { return rewriteRel(root, 1); } catch (error) { return error as Error; } })();
  expect(once).toBeInstanceOf(Error); // one pass converts, a second is needed to observe the fixpoint
  const result = rewriteRel(root);
  const [d0, f0, n0, x0] = rewriteMeasure(root), [d1, f1, n1, x1] = rewriteMeasure(result.root);
  expect([d1, f1, n1]).toEqual([d0, f0, n0]);
  expect([x0, x1]).toEqual([1, 0]);
});

// Fix round 1 (D1): a non-total expression anywhere inside either join input fences LeftToInner and PushFilterJoin.
it('fix round 1: fallibleWithin fences both join rules over inputs with fallible projections, expansions, aggregates, filters, sorts', () => {
  const known = createKnownFunctions({ intDiv: { isAggregate: false, deterministic: true, aliasTo: '' }, splitByChar: { isAggregate: false, deterministic: true, aliasTo: '' } } as const).fn;
  const fallible: [string, { ir: Rel }][] = [
    ['cast projection', ob.map(r => ({ id: r.id, n: r.n, s: r.s, c: cast(r.s, col.UInt8) }))],
    ['known call', ob.map(r => ({ id: r.id, n: r.n, s: r.s, c: known.intDiv(r.n, r.n).as(col.Int64) }))],
    ['fallible expansion', ob.arrayJoin(r => known.splitByChar(val(','), r.s).as(col.Array(col.String)), 'x').map(r => ({ id: r.id, n: r.n, s: r.s }))],
    ['fallible aggregate', ob.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: max(g.n), s: max(g.s), c: sum(cast(g.s, col.UInt8)) }))],
    ['fallible filter', ob.where(r => cast(r.s, col.UInt8).gt(1))],
    ['fallible sort key', ob.orderBy(r => cast(r.s, col.UInt8)).limit(10)],
  ];
  for (const [label, input] of fallible) {
    const extended = leftJoin({ a: oa }, { b: input as any }).on((r: any) => r.a.id.eq(r.b.id)).where((r: any) => r.b.n.gt(0n).and(r.a.s.eq('x')));
    expect(rewrite(extended.ir).hits, `${label} (extended)`).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
    const preserved = leftJoin({ b: input as any }, { a: oa }).on((r: any) => r.a.id.eq(r.b.id)).where((r: any) => r.a.id.lt(3).and(r.b.n.gt(0n)));
    expect(rewrite(preserved.ir).hits, `${label} (preserved)`).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
    const inner = join({ a: oa, b: input as any }).on((r: any) => r.a.id.eq(r.b.id)).where((r: any) => r.a.id.gt(2));
    expect(rewrite(inner.ir).hits.PushFilterJoin, `${label} (inner)`).toBe(0);
  }
  // Total inputs still convert and push: integer arithmetic, renames, count/max/integer sum, a total filter and sort.
  const total: [string, { ir: Rel }][] = [
    ['arithmetic', ob.map(r => ({ id: r.id, n: r.n.plus(1n), s: r.s }))],
    ['total aggregate', ob.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: sum(g.n), s: max(g.s), c: count() }))],
    ['total filter and sort', ob.where(r => r.n.gt(1n)).orderBy(r => r.id).limit(10)],
  ];
  for (const [label, input] of total) {
    const extended = leftJoin({ a: oa }, { b: input as any }).on((r: any) => r.a.id.eq(r.b.id)).where((r: any) => r.b.n.gt(0n).and(r.a.s.eq('x')));
    expect(rewrite(extended.ir).hits, label).toMatchObject({ LeftToInner: 1, PushFilterJoin: 1 });
  }
});
it('fix round 1 (m3): total WHERE and ORDER BY read a converted column bare; outputs, GROUP BY keys and aggregates keep toNullable', () => {
  const q = lj().where(r => r.b.n.gt(2n)).orderBy(r => r.b.s);
  const sql = compile(q.ir).sql;
  expect(sql).toMatch(/toNullable\(`b`\.`n`\) AS `__typedhouse_leaf_\d+`/);
  expect(sql).toMatch(/WHERE \(`b`\.`n` > \{p\d+:Int64\}\)/);
  expect(sql).toMatch(/ORDER BY `b`\.`s` ASC/);
  const grouped = lj().where(r => r.b.n.gt(2n)).groupBy(r => ({ s: r.b.s })).aggregate(g => ({ m: max(g.b.n) }));
  const g = compile(grouped.ir).sql;
  expect(g).toMatch(/toNullable\(`b`\.`s`\) AS `s`, max\(toNullable\(`b`\.`n`\)\)/);
  expect(g).toMatch(/WHERE `b`\.`n` > /);
  expect(compile(grouped.ir).columns).toEqual(emitNaive(grouped.ir).columns);
});
it('fix round 2 (D2): a total key over a converted join groups by its bare reads; only the select item carries the descriptor', () => {
  const conv = () => lj().where(r => r.b.n.gt(0n));
  // 4c: the identity key now reads `lc`, which only `ob` carries; `s` is also a (pruned) column of `oa`, so HAVING `s` /
  // ORDER BY `s` would bind `a`.`s` under prefer_column_name_to_alias = 1 and that shape is fenced (below).
  const identity = conv().groupBy(r => ({ lc: r.b.lc })).aggregate(() => ({ c: count() })).where(r => r.lc.ne('x')).orderBy(r => r.lc.desc());
  expect(compile(identity.ir).sql).toBe('SELECT toNullable(`b`.`lc`) AS `lc`, count() AS `c`\nFROM (SELECT `id` FROM `oa`) AS `a`\nINNER ALL JOIN (SELECT `id`, `n`, `lc` FROM `ob`) AS `b` ON `a`.`id` = `b`.`id`\nWHERE `b`.`n` > {p0:Int64}\nGROUP BY `b`.`lc`\nHAVING `lc` != {p1:String}\nORDER BY `lc` DESC');
  const both = conv().groupBy(r => ({ s: r.b.s })).aggregate(() => ({ c: count() })).where(r => r.s.ne('x')).orderBy(r => r.s.desc());
  expect(compile(both.ir).sql).toBe('SELECT `__typedhouse_input`.`__typedhouse_leaf_4` AS `s`, count() AS `c` FROM (SELECT toNullable(`b`.`s`) AS `__typedhouse_leaf_4` FROM (SELECT `id` FROM `oa`) AS `a` INNER ALL JOIN (SELECT `id`, `s`, `n` FROM `ob`) AS `b` ON `a`.`id` = `b`.`id` WHERE (`b`.`n` > {p0:Int64})) AS `__typedhouse_input` GROUP BY `__typedhouse_input`.`__typedhouse_leaf_4` HAVING `s` != {p1:String} ORDER BY `s` DESC');
  // Compound keys: the whole key is wrapped when its declared type carries NULL (m), not when it does not (f).
  const compound = conv().groupBy(r => ({ m: r.b.n.plus(1n), f: r.b.n.ifNull(0n), lc: r.b.lc })).aggregate(() => ({ c: count() }));
  expect(compile(compound.ir).sql).toBe('SELECT toNullable(`b`.`n` + {p0:Int64}) AS `m`, ifNull(`b`.`n`, {p1:Int64}) AS `f`, toNullable(`b`.`lc`) AS `lc`, count() AS `c`\nFROM (SELECT `id` FROM `oa`) AS `a`\nINNER ALL JOIN (SELECT `id`, `n`, `lc` FROM `ob`) AS `b` ON `a`.`id` = `b`.`id`\nWHERE `b`.`n` > {p2:Int64}\nGROUP BY `b`.`n` + {p0:Int64}, ifNull(`b`.`n`, {p1:Int64}), `b`.`lc`');
  for (const q of [identity, both, compound]) expect(compile(q.ir).columns).toEqual(emitNaive(q.ir).columns);
  // Unconverted (LEFT) aggregate blocks keep their single rendering.
  expect(compile(lj().groupBy(r => ({ s: r.b.s })).aggregate(() => ({ c: count() })).ir).sql).toMatch(/SELECT `b`\.`s` AS `s`, count\(\) AS `c`[^]*LEFT ALL JOIN[^]*GROUP BY `b`\.`s`/);
});
