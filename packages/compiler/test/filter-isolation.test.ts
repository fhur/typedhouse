import { expect, it } from 'vitest';
import { cast, col, count, from, join, sql, table, unionAll, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { planSelects } from '../src/plan-selects.js';
import { structure } from './explain-corpus-support.js';
import { rewriteRel } from '../src/rewrite-rel.js';

const descriptor = table('isolation', { id: col.UInt32, s: col.String, ids: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const t = from(descriptor);
const total = (r: typeof t.row) => r.id.ne(2);
const bad = (r: typeof t.row) => cast(r.s, col.UInt64).gt(0n);
const volatile = () => sql`rand() > 0`.as(col.Bool);
const j = join({ a: t, b: from(descriptor) }).on(r => r.a.id.eq(r.b.id));
const grouped = t.groupBy(r => ({ s: r.s })).aggregate(() => ({ c: count() }));
it('never manufactures a filter boundary from a mixed cast or volatile conjunction', () => {
  const sources = [t, t.leftArrayJoin(r => r.ids, 'x'), t.arrayJoin(r => r.ids, 'x'), unionAll(t, t),
    t.groupBy(r => ({ id: r.id, s: r.s })).aggregate(() => ({ c: count() })), t.map(r => ({ id: r.id, s: r.s }))];
  for (const source of sources) for (const reverse of [false, true]) for (const raw of [false, true]) {
    const query = source.where(r => {
      const safe = r.id.ne(2), unsafe = raw ? volatile() : cast(r.s, col.UInt64).gt(0n);
      return reverse ? unsafe.and(safe) : safe.and(unsafe);
    });
    expect(rewriteRel(query.ir).root).toBe(query.ir);
  }
  // A total-looking predicate on projected columns is not permission to suppress
  // a fallible projected output. Existing Project admission must still reject it.
  const projected = t.map(r => ({ id: r.id, n: cast(r.s, col.UInt64) })).where(r => r.id.ne(2).and(r.n.gt(0n)));
  expect(rewriteRel(projected.ir).root).toBe(projected.ir);
});
it('agent2 repair review: nested AND/OR never exposes a cast or volatile residual for splitting', () => {
  const sources = [t, t.cte(), t.distinct(), t.orderBy(r => r.id).limit(2),
    t.leftArrayJoin(r => r.ids, 'x'), t.arrayJoin(r => r.ids, 'x'), unionAll(t, t),
    t.map(r => ({ id: r.id, s: r.s }))];
  for (const source of sources) for (const raw of [false, true]) {
    const query = source.where(r => r.id.ne(2).and(r.id.gt(0).or(raw ? volatile() : cast(r.s, col.UInt64).gt(0n))).and(r.id.lt(9)));
    expect(rewriteRel(query.ir).root).toBe(query.ir);
  }
});
it('still splits all-total conjunctions according to each boundary rule', () => {
  const expanded = t.leftArrayJoin(r => r.ids, 'x').where(r => r.id.ne(2).and(r.x.eq('p')));
  expect(rewriteRel(expanded.ir).hits.PushFilterArrayJoin).toBe(1);
  expect(rewriteRel(j.where(r => r.a.id.ne(2).and(r.a.id.plus(1).gt(0n))).ir).hits.PushFilterJoin).toBe(1);
  const grouped = t.groupBy(r => ({ id: r.id })).aggregate(() => ({ c: count() }));
  expect(rewriteRel(grouped.where(r => r.id.ne(2).and(r.c.gt(0n))).ir).hits.PushFilterAggKey).toBe(1);
  expect(rewriteRel(unionAll(t, t).where(r => r.id.ne(2).and(r.id.plus(1).gt(0n))).ir).hits.PushFilterUnion).toBe(1);
  expect(rewriteRel(t.map(r => ({ id: r.id })).where(r => r.id.ne(2).and(r.id.plus(1).gt(0n))).ir).hits.PushFilterProject).toBe(1);
});
const cases: readonly [string, Rel, boolean][] = [
  ['total / cast', t.where(total).where(bad).ir, true],
  ['cast / total', t.where(bad).where(total).ir, true],
  ['cast / cast', t.where(bad).where(bad).ir, true],
  ['total / total', t.where(total).where(total).ir, false],
  ['first cast', t.where(bad).ir, false],
  ['volatile / total', t.where(volatile).where(total).ir, true],
  ['total / volatile', t.where(total).where(volatile).ir, true],
  ['join residual / cast', j.where(r => r.a.id.lt(r.b.id)).where(r => cast(r.a.s, col.UInt64).gt(0n)).ir, true],
  ['expanded / cast', t.leftArrayJoin(r => r.ids, 'x').where(total).where(bad).ir, true],
  ['HAVING / cast', grouped.where(r => r.c.gt(0n)).where(r => cast(r.s, col.UInt64).gt(0n)).ir, true],
];
for (const [label, root, boundary] of cases) it(`preserves predicate scope: ${label}`, () => {
  if (root.kind !== 'Filter') throw new Error('filter');
  const plan = planSelects(root, Object.values(validateRel(root).nodes));
  const block = plan.blocks.get(root)!;
  expect(block.source.kind === 'derived').toBe(boundary);
  if (boundary) expect(block.source).toEqual({ kind: 'derived', rel: root.input });
  expect(compile(root).columns).toEqual(emitNaive(root).columns);
});
it('pins the isolated scan SQL and does not authorize a total-pair fence', () => {
  const root = t.where(total).where(bad).map(r => ({ id: r.id })).ir;
  expect(compile(root).sql).toBe('SELECT `__typedhouse_input`.`id` FROM (SELECT `id`, `s` FROM `isolation` WHERE `id` != {p0:UInt32}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s` AS UInt64) > {p1:UInt64}');
  expect(compile(root).params).toEqual(emitNaive(root).params);
  expect(structure(root).selects.map(s => s.fence)).toEqual(['root', 'Filter']);
  expect(structure(t.where(total).where(total).ir).selects.map(s => s.fence)).toEqual(['root']);
  // A cast with no earlier predicate is not evidence for an isolation boundary.
  expect(structure(t.where(bad).ir).selects.map(s => s.fence)).toEqual(['root']);
});
