import { expect, it } from 'vitest';
import { cast, col, count, createKnownFunctions, crossJoin, exprNode, from, now, scalar, sum, table, val, Query, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { planCtes } from '../src/plan-ctes.js';
import { rewriteMeasure, rewriteRel } from '../src/rewrite-rel.js';
import { references, safePredicate, substitute, totalExpression, totalPredicate } from '../src/rewrite-expressions.js';
const q = from(table('merge', { id: col.UInt32, n: col.Int64, text: col.Nullable(col.String), ids: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const { fn } = createKnownFunctions({ cityHash64: { isAggregate: false, deterministic: true, aliasTo: '' } } as const);
const selects = (sql: string) => sql.match(/SELECT /g)?.length;
function rewrite(root: Rel) {
  const snapshot = () => JSON.stringify(root, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
  const before = snapshot();
  validateRel(root);
  const result = rewriteRel(root);
  validateRel(result.root);
  expect(snapshot()).toBe(before);
  expect(result.root.output).toEqual(root.output);
  expect(rewriteRel(result.root).root).toBe(result.root);
  const compiled = compile(root), naive = emitNaive(root);
  expect(compiled.columns).toEqual(naive.columns);
  expect(Object.keys(compiled.nodes)).toEqual(Object.keys(naive.nodes));
  for (const path of Object.keys(naive.nodes)) expect(compiled.nodes[path]).toBe(naive.nodes[path]);
  // Dropping an unreferenced total expression drops its Params too; nothing is ever added.
  expect(Object.keys(compiled.params).length).toBeLessThanOrEqual(Object.keys(naive.params).length);
  return result;
}
it('merges stacked selections into one Project over the original input, sharing substituted subtrees and Params', () => {
  const k = val(2, col.UInt32);
  const inner = q.map(r => ({ renamed: r.id, total: r.n.plus(1n), text: r.text }));
  const query = inner.map(r => ({ id: r.renamed, twice: r.total.plus(r.total), label: r.text.ifNull('none'), k }));
  const result = rewrite(query.ir);
  expect(result.hits.MergeProject).toBe(1);
  if (result.root.kind !== 'Project' || inner.ir.kind !== 'Project') throw new Error('shape');
  expect(result.root.input).toBe(q.ir);
  expect(result.root.exprs.id).toBe(inner.ir.exprs.renamed);
  expect(result.root.exprs.k).toBe(k.ir);
  expect(result.root.output).toEqual(query.ir.output);
  const twice = result.root.exprs.twice;
  if (twice?.kind !== 'Call') throw new Error('shape');
  expect(twice.args[0]).toBe(inner.ir.exprs.total); expect(twice.args[1]).toBe(inner.ir.exprs.total);
  expect(references(twice).every(r => r.rel === q.ir.id)).toBe(true);
  expect(Object.values(compile(query.ir).params)).toEqual(['1', 'none', '2']);
  expect(Object.keys(compile(query.ir).params)).toEqual(Object.keys(emitNaive(query.ir).params));
  expect(rewriteMeasure(result.root)).toEqual([0, 0, 2]);
  expect(rewriteMeasure(query.ir)).toEqual([0, 0, 3]);
  const chain = q.map(r => ({ a: r.id })).map(r => ({ b: r.a })).map(r => ({ c: r.b })).map(r => ({ d: r.c }));
  expect(rewrite(chain.ir).hits.MergeProject).toBe(3);
  expect(compile(chain.ir).sql).toBe('SELECT `id` AS `d` FROM `merge`');
});
it('(a) keeps a selection consumed twice, through slots or subqueries, as one CTE instead of merging it', () => {
  const shared = q.map(r => ({ id: r.id, total: r.n.plus(val(1n, col.Int64)) }));
  const diamond = crossJoin({ a: shared.map(r => ({ id: r.id })), b: shared.map(r => ({ total: r.total })) });
  const result = rewrite(diamond.ir);
  expect(result.hits.MergeProject).toBe(0);
  expect(planCtes(result.root).definitions).toEqual([shared.ir]);
  expect(compile(diamond.ir).sql).toContain('WITH `t0` AS (SELECT `id` AS `id`, `n` + {p0:Int64} AS `total` FROM `merge`)');
  // The spec's scopedLatest shape: the shared selection feeds a scalar total and the outer map.
  const scoped = q.map(r => ({ id: r.id, stock: r.n }));
  const total = scoped.aggregate(g => sum(g.stock));
  const share = scoped.map(r => ({ id: r.id, share: r.stock.divide(scalar(total)).multiply(100) }));
  expect(rewrite(share.ir).hits.MergeProject).toBe(0);
  expect(compile(share.ir).sql).toContain('WITH `t0` AS (SELECT `id` AS `id`, `n` AS `stock` FROM `merge`)');
  const once = q.map(r => ({ id: r.id }));
  const counted = once.map(r => ({ id: r.id, n: scalar(once.aggregate(() => count())) }));
  expect(rewrite(counted.ir).root).toBe(counted.ir);
});
it('(c) never duplicates Raw or non-deterministic outputs; single references still merge', () => {
  const clock = q.map(r => ({ id: r.id, at: now() }));
  const twice = clock.map(r => ({ a: r.at, b: r.at }));
  expect(rewrite(twice.ir).root).toBe(twice.ir);
  expect(compile(twice.ir).sql.match(/now\(\)/g)).toHaveLength(1);
  const onceOnly = clock.map(r => ({ a: r.at, id: r.id }));
  const merged = rewrite(onceOnly.ir);
  expect(merged.hits.MergeProject).toBe(1);
  if (merged.root.kind !== 'Project' || clock.ir.kind !== 'Project') throw new Error('shape');
  expect(merged.root.exprs.a).toBe(clock.ir.exprs.at);
  const raw = exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['rand()'], args: [] });
  const base = q.map(r => ({ id: r.id, raw: r.id })).ir;
  if (base.kind !== 'Project') throw new Error('shape');
  const manual = new Query<{ id: number; raw: number }>({ ...base, exprs: { ...base.exprs, raw } }, { live: false });
  const duplicated = manual.map(r => ({ a: r.raw, b: r.raw }));
  expect(rewriteRel(duplicated.ir).hits.MergeProject).toBe(0);
  expect(rewriteRel(duplicated.ir).root).toBe(duplicated.ir);
  expect(rewriteRel(manual.map(r => ({ a: r.raw })).ir).hits.MergeProject).toBe(1);
});
it('(d) drops unreferenced outputs only when they are total', () => {
  const dropped = [
    q.map(r => ({ id: r.id, bad: cast(r.text, col.Nullable(col.UInt32)) })),
    q.map(r => ({ id: r.id, ratio: r.n.divide(2n) })),
    q.map(r => ({ id: r.id, hash: fn.cityHash64(r.id).as(col.UInt64) })),
    q.map(r => ({ id: r.id, at: now() })),
  ].map(inner => inner.map(r => ({ id: r.id })));
  // No merge; the hazardous inner selection still folds over its scan (slice 3), the narrower outer one stays above it.
  for (const query of dropped) { expect(rewrite(query.ir).root).toBe(query.ir); expect(selects(compile(query.ir).sql)).toBe(2); expect(compile(query.ir).sql).toContain(') AS `__typedhouse_input`'); }
  const total = q.map(r => ({ id: r.id, label: r.text.ifNull('x'), ids: r.ids, diff: r.n.minus(2n), flag: r.text.isNull().or(r.id.gt(1)) })).map(r => ({ id: r.id }));
  const result = rewrite(total.ir);
  expect(result.hits.MergeProject).toBe(1);
  expect(compile(total.ir).sql).toBe('SELECT `id` FROM `merge`');
  expect(compile(total.ir).params).toEqual({});
});
it('(e) subqueries inside the inner selection fence merging even when referenced once', () => {
  const inner = q.map(r => ({ id: r.id, n: scalar(q.aggregate(() => count())) }));
  const outer = inner.map(r => ({ id: r.id, n: r.n }));
  expect(rewrite(outer.ir).root).toBe(outer.ir);
  // An Agg inside a Project never validates, so its half of (e) is unreachable from validated graphs.
});
it('pushes conjuncts through computed selections, copying only total expressions', () => {
  const query = q.map(r => ({ eventId: r.id.plus(1), label: r.text.ifNull('none') })).where(r => r.eventId.gt(100n).and(r.label.eq('x')));
  const result = rewrite(query.ir);
  expect(result.hits.PushFilterProject).toBe(1);
  if (result.root.kind !== 'Project' || result.root.input.kind !== 'Filter') throw new Error('shape');
  expect(result.root.input.input).toBe(q.ir);
  expect(references(result.root.input.pred).every(r => r.rel === q.ir.id)).toBe(true);
  expect(safePredicate(result.root.input.pred)).toBe(false);
  expect(totalPredicate(result.root.input.pred)).toBe(true);
  expect(compile(query.ir).sql).toBe('SELECT `id` + {p0:UInt32} AS `eventId`, ifNull(`text`, {p1:String}) AS `label` FROM `merge` WHERE `id` + {p0:UInt32} > {p2:UInt64} AND ifNull(`text`, {p1:String}) = {p3:String}');
  const folded = q.map(r => ({ eventId: r.id.plus(val(1, col.UInt32)) })).where(r => r.eventId.gt(100n));
  expect(compile(folded.ir).sql).toBe('SELECT `id` + {p0:UInt32} AS `eventId` FROM `merge` WHERE `id` + {p0:UInt32} > {p1:UInt64}');
  const fences = [
    q.map(r => ({ v: cast(r.text, col.Nullable(col.UInt32)) })).where(r => r.v.gt(1)), // (b) the copy would carry a cast
    q.map(r => ({ id: r.id.plus(1), ratio: r.n.divide(2n) })).where(r => r.id.gt(1n)), // (c) division left behind
    q.map(r => ({ id: r.id.plus(1), hash: fn.cityHash64(r.id).as(col.UInt64) })).where(r => r.id.gt(1n)), // (c) known-origin call
    q.map(r => ({ id: r.id.plus(1), at: now() })).where(r => r.id.gt(1n)), // (c) volatile output
  ];
  for (const fence of fences) expect(rewrite(fence.ir).root).toBe(fence.ir);
});
it('keeps conjuncts that do not bind to the input as a residual above the selection', () => {
  const good = q.map(r => ({ a: r.id.plus(1), b: r.n })).where(r => r.a.gt(1n).and(r.b.gt(0n)));
  const root = good.ir;
  if (root.kind !== 'Filter' || root.pred.kind !== 'Call' || root.pred.args[1]?.kind !== 'Call') throw new Error('shape');
  const second = root.pred.args[1];
  // Condition (a) is only reachable on a manual graph: validation rejects foreign references first.
  const foreign = { ...second, args: second.args.map(a => a.kind === 'ColumnRef' ? { ...a, rel: -1 as typeof a.rel } : a) };
  const manual = { ...root, pred: { ...root.pred, args: [root.pred.args[0]!, foreign] } } as Rel;
  const result = rewriteRel(manual);
  expect(result.hits.PushFilterProject).toBe(1);
  if (result.root.kind !== 'Filter' || result.root.input.kind !== 'Project' || result.root.input.input.kind !== 'Filter') throw new Error('shape');
  expect(result.root.input.input.input).toBe(q.ir);
  expect(result.root.pred).toEqual(expect.objectContaining({ fn: expect.objectContaining({ name: 'gt' }) }));
  expect(references(result.root.pred).map(r => r.rel)).toEqual([-1]);
  expect(references(result.root.input.input.pred).map(r => r.path)).toEqual([['id']]);
});
it('defines the total fragment by resolution: bare reads, integer arithmetic, boolean family, same-family ifNull', () => {
  const r = q.row;
  for (const e of [r.ids, r.text, r.n.plus(1n), r.n.minus(2n), r.id.multiply(2), r.text.ifNull('x'), r.text.isNull(), r.id.plus(1).gt(5n), r.text.ifNull('a').eq('b').and(r.id.ge(1))]) expect(totalExpression(e.ir)).toBe(true);
  expect(totalPredicate(r.id.plus(1).gt(5n).ir)).toBe(true);
  expect(safePredicate(r.id.plus(1).gt(5n).ir)).toBe(false);
  expect(totalPredicate(r.n.plus(1n).ir)).toBe(false);
  const raw = exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['throwIf(1)'], args: [] });
  for (const e of [cast(r.text, col.Nullable(col.UInt32)).ir, r.n.divide(2n).ir, raw, fn.cityHash64(r.id).as(col.UInt64).ir, now().ir, val(1.5, col.Float64).multiply(2).ir, scalar(q.aggregate(() => count())).ir, r.ids.has('a').ir]) expect(totalExpression(e)).toBe(false);
  const forged = r.n.plus(1n).ir;
  if (forged.kind !== 'Call') throw new Error('shape');
  expect(totalExpression({ ...forged, fn: { ...forged.fn, deterministic: false } })).toBe(false);
});
it('substitutes only path-length-one references bound to the selection, preserving identity otherwise', () => {
  const p = q.map(r => ({ a: r.id }));
  if (p.ir.kind !== 'Project') throw new Error('shape');
  const pred = p.row.a.gt(val(1)).ir;
  const out = substitute(pred, p.ir);
  if (out.kind !== 'Call') throw new Error('shape');
  expect(out.args[0]).toBe(p.ir.exprs.a);
  expect(out.args[1]).toBe(pred.kind === 'Call' ? pred.args[1] : undefined);
  const foreign = q.row.id.gt(1).ir;
  expect(substitute(foreign, p.ir)).toBe(foreign);
  const pair = crossJoin({ a: q, b: q }).map(r => ({ ...r.a }));
  if (pair.ir.kind !== 'Project') throw new Error('shape');
  const nested = pair.ir.exprs.id!;
  expect(nested.kind === 'ColumnRef' && nested.path).toEqual(['a', 'id']);
  expect(substitute(nested, pair.ir)).toBe(nested);
});
it('handles hidden keys, idempotence and the convergence guard', () => {
  const stacked = q.map(r => ({ x: r.id, y: r.n })).map(r => ({ z: r.x })).ir;
  expect(() => rewriteRel(stacked, 1)).toThrow('rewrite_nonconvergence');
  const hidden = structuredClone(stacked);
  if (hidden.kind !== 'Project' || hidden.input.kind !== 'Project') throw new Error('shape');
  Object.defineProperty(hidden.input.exprs, 'x', { enumerable: false });
  Object.defineProperty(hidden.input.exprs, 'spare', { enumerable: true, value: hidden.input.exprs.y });
  expect(rewrite(hidden).hits.MergeProject).toBe(1);
  const unsafe = structuredClone(q.map(r => ({ x: r.id, bad: cast(r.text, col.Nullable(col.UInt32)) })).map(r => ({ z: r.x })).ir);
  if (unsafe.kind !== 'Project' || unsafe.input.kind !== 'Project') throw new Error('shape');
  Object.defineProperty(unsafe.input.exprs, 'bad', { enumerable: false });
  Object.defineProperty(unsafe.input.exprs, 'spare', { enumerable: true, value: unsafe.input.exprs.x });
  expect(rewrite(unsafe).root).toBe(unsafe);
});
