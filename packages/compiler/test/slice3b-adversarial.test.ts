import { expect, it } from 'vitest';
import { cast, col, count, defineFunction, exprNode, from, join, max, multiIf, now, print, relNode, scalar, table, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { planCtes } from '../src/plan-ctes.js';
import { planSelects } from '../src/plan-selects.js';
import { pruneColumns } from '../src/prune-columns.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { safePredicate, totalPredicate } from '../src/rewrite-expressions.js';
import { structure } from './explain-corpus-support.js';
import { entries } from './fixtures/corpus/explain-corpus.js';
import { fn } from '../../codegen/test/snapshots/functions.js';

// Tester probes for slice 3b (Docker-free). Native twin: packages/client/test/slice3b-adversarial.integration.ts.
// Target 1: the Filter-arm rule (a Filter joins held Filter clauses only when it and every held Filter are total).
// Target 2: deviation 2 (the nested direct-selection arm over a derived Filter-only block). Target 3: the harness's
// `filterFence`. Target 4: the two moved snapshots. Target 5: invariants (naive text, params, no SELECT *).
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const adv = table('adv_s3b', { id: col.UInt32, k: col.String, n: col.Int64, s: col.String, nn: col.Nullable(col.String), ids: col.Array(col.String), f: col.Float64 }, meta);
const other = table('adv_s3b_other', { id: col.UInt32, v: col.UInt32, s2: col.String }, meta);
const t = from(adv), u = from(other);
const rand = defineFunction({ name: 'rand', args: [], returns: col.UInt32, deterministic: false });
const userDiv = defineFunction({ name: 'intDiv', args: [col.UInt64, col.UInt64], returns: col.UInt64, deterministic: true });
const selects = (sql: string) => sql.match(/SELECT /g)?.length ?? 0;
const types = (q: ReturnType<typeof compile>) => Object.values(q.parameterTypes ?? {}).map(print).sort();
const bad = (r: typeof t.row) => cast(r.s, col.UInt64).gt(0n);
const bad2 = (r: typeof t.row) => userDiv(val(10n, col.UInt64), cast(r.id.minus(1), col.UInt64)).gt(0n);
const total = (r: typeof t.row) => r.k.eq('a');
const fences = (root: Rel) => structure(root).selects.map(x => `${x.role}:${x.rel.kind}:${x.fence}`);
/** SELECT count as expected; metadata, Param names, wire types equal to naive; Params numbered in textual order; no SELECT *. */
function check(root: Rel, expectedSelects: number, label = '') {
  const optimized = compile(root), naive = emitNaive(root);
  const context = `${label}\n${optimized.sql}\n${naive.sql}`;
  expect(selects(optimized.sql), context).toBe(expectedSelects);
  expect(optimized.columns, context).toEqual(naive.columns);
  expect(optimized.columnPaths, context).toEqual(naive.columnPaths);
  expect(Object.keys(optimized.params), context).toEqual(Object.keys(naive.params));
  expect(types(optimized), context).toEqual(types(naive));
  expect([...new Set([...optimized.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))], context).toEqual(Object.keys(optimized.params));
  expect(optimized.sql).not.toMatch(/SELECT \*/);
  // No boundary of the structure walk is unfenced unless the shape is the recorded slice 3 control (a Filter over a folded computed selection).
  return optimized.sql;
}
/** Every WHERE/HAVING of the optimized text, in textual order, as the list of its top-level conjunct texts. */
function clauses(sql: string): string[][] {
  const out: string[][] = [];
  for (const m of sql.matchAll(/(?:WHERE|HAVING) (.*?)(?= GROUP BY| ORDER BY| LIMIT|\) AS `|\) AS `|$)/g)) out.push(m[1]!.split(/ AND (?![^(]*\))/));
  return out;
}

it('rule: a non-total Filter never shares a WHERE with a held Filter, in either direction, for every predicate class outside the fragment', () => {
  // Chains: each boundary separates a non-total predicate from its neighbours; total pairs still share.
  const chain = t.where(total).where(bad).where(r => r.id.ne(1)).where(bad2).where(r => r.n.gt(0n));
  const sql = check(chain.ir, 5, 'total,bad,total,bad2,total');
  expect(clauses(sql).map(c => c.length)).toEqual([1, 1, 1, 1, 1]); // never two conjuncts in one clause along the chain
  expect(sql).toMatch(/FROM `adv_s3b` WHERE `k` = \{p0:String\}\) AS `__typedhouse_input` WHERE CAST\(/);
  expect(sql).toMatch(/WHERE `__typedhouse_input`\.`id` != \{p2:UInt32\}\) AS `__typedhouse_input` WHERE intDiv\(/);
  expect(sql).toMatch(/\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`n` > \{p6:Int64\}$/);
  expect(check(t.where(bad).where(total).where(bad2).ir, 3, 'bad,total,bad2')).toMatch(/^SELECT .* FROM \(SELECT .* FROM \(SELECT .* FROM `adv_s3b` WHERE CAST\(`s` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`k` = \{p1:String\}\) AS `__typedhouse_input` WHERE intDiv\(/);
  // Two total filters that MergeFilter did not merge (a whole-predicate `total AND bad` is not total) stay one Filter: its own text is one clause in both emitters.
  expect(check(t.where(r => total(r).and(bad(r))).where(r => r.n.gt(0n)).ir, 2)).toContain('WHERE `k` = {p0:String} AND CAST(`s` AS UInt64) > {p1:UInt64}) AS `__typedhouse_input` WHERE `__typedhouse_input`.`n` > {p2:Int64}');
  // Predicate classes outside the fragment each open a block over a total WHERE, and a total WHERE above each opens another.
  const outside: [string, (r: typeof t.row) => Parameters<typeof t.where>[0] extends (row: never) => infer P ? P : never][] = [
    ['IN-subquery with a fallible inner filter', r => r.id.in(u.where(x => cast(x.s2, col.UInt64).gt(0n)).map(x => ({ id: x.id })))],
    ['IN-subquery, total inside', r => r.id.in(u.where(x => x.v.gt(1)).map(x => ({ id: x.id })))],
    ['scalar subquery', r => r.n.gt(scalar(u.aggregate(() => ({ m: count() }))))],
    ['known-origin call', r => fn.cityHash64(r.s).as(col.UInt64).gt(1n)],
    ['user-origin call', r => bad2(r)],
    ['multiIf', r => multiIf([r.k.eq('a'), 'x'], 'y').eq('x')],
    ['now()', () => now().gt(now())],
    ['rand()', () => rand().gt(5)],
    ['Float comparison', r => r.f.gt(0.5)],
    ['has()', r => r.ids.has('p')],
    ['startsWith (componentsLatest shape)', r => r.s.startsWith('1')],
    ['cast', bad],
  ];
  for (const [label, pred] of outside) {
    const p = pred(t.row);
    expect(totalPredicate(p.ir), label).toBe(false);
    const extra = label.startsWith('IN') || label.startsWith('scalar') ? 1 : 0; // the subquery is its own SELECT
    const below = check(t.where(total).where(pred).ir, 2 + extra, `${label} over total`);
    expect(clauses(below).map(c => c.length), label).toEqual([1, 1]);
    expect(fences(t.where(total).where(pred).ir), label).toEqual(['root:Filter:root', 'derived:Filter:Filter', ...(label.startsWith('IN') ? ['subquery:Project:Subquery'] : label.startsWith('scalar') ? ['subquery:Aggregate:Subquery'] : [])]);
    const above = check(t.where(pred).where(total).ir, 2 + extra, `total over ${label}`);
    expect(clauses(above).map(c => c.length), label).toEqual([1, 1]);
    expect(above, label).toMatch(/\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`k` = \{p\d+:String\}$/);
    expect(check(t.where(pred).ir, 1 + extra, `${label} alone`)).toMatch(/^SELECT [^(]* FROM `adv_s3b` WHERE /);
  }
  // Total predicates of every admitted kind share one WHERE (what MergeFilter merges): comparisons, isNull, Nullable operands, integer arithmetic, Params.
  for (const [label, pred] of [['isNull', (r: typeof t.row) => r.nn.isNull()], ['arith', (r: typeof t.row) => r.n.plus(1n).gt(2n)], ['nullable eq', (r: typeof t.row) => r.nn.eq('x')]] as const) {
    expect(totalPredicate(pred(t.row).ir), label).toBe(true);
    expect(clauses(check(t.where(total).where(pred).where(r => r.n.lt(9n)).ir, 1, label))).toEqual([expect.arrayContaining([expect.stringContaining('`k` = {p0:String}')])]);
  }
  // Raw and Case predicates cannot be emitted (no emitter case), so the planner is checked directly: neither is total and each opens a block over a held WHERE.
  const held = t.where(total).ir;
  const raw = exprNode({ kind: 'Raw', type: col.Bool.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['throwIf(1)'], args: [] });
  const kase = exprNode({ kind: 'Case', type: col.Bool.type, branches: [{ when: total(t.row).ir, then: val(true).ir }], otherwise: val(false).ir });
  for (const pred of [raw, kase]) {
    expect(totalPredicate(pred)).toBe(false);
    const root = relNode({ kind: 'Filter', input: held, output: held.output, pred });
    const plan = planSelects(root, [root, held, t.ir]);
    expect(plan.blocks.get(root)).toMatchObject({ source: { kind: 'derived', rel: held }, clauses: [root] });
    const first = relNode({ kind: 'Filter', input: t.ir, output: t.ir.output, pred });
    expect(planSelects(first, [first, t.ir]).blocks.get(first)).toMatchObject({ source: { kind: 'table' }, clauses: [first] });
    const above = relNode({ kind: 'Filter', input: first, output: first.output, pred: total(t.row).ir });
    expect(planSelects(above, [above, first, t.ir]).blocks.get(above)).toMatchObject({ source: { kind: 'derived', rel: first }, clauses: [above] });
  }
});

it('rule: blocks of every source kind, HAVING sequences, expansions, CTE, union and Materialize', () => {
  // Join block: residual `lt` is the join WHERE; the fallible filter re-qualifies its references by leaf name above it.
  const j = join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id));
  const residual = check(join({ a: t, b: u }).on(r => [r.a.id.eq(r.b.id), r.a.id.lt(r.b.v)]).where(r => cast(r.a.s, col.UInt64).gt(0n)).ir, 2, 'join residual + bad');
  expect(residual).toMatch(/WHERE \(`a`\.`id` < `b`\.`v`\)\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\) > \{p0:UInt64\}$/);
  // Fallible first on the join block folds as its first WHERE; a total two-sided filter above it opens a block; a one-sided total one is pushed into the side instead.
  expect(check(j.where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id })).ir, 3)).toMatch(/ON `a`\.`id` = `b`\.`id`\nWHERE \(CAST\(`a`\.`s` AS UInt64\) > \{p0:UInt64\}\)$/);
  expect(check(j.where(r => cast(r.a.s, col.UInt64).gt(0n)).where(r => r.a.id.plus(r.b.v).ne(27n)).map(r => ({ id: r.a.id })).ir, 4)).toMatch(/WHERE \(CAST\(`a`\.`s` AS UInt64\) > \{p0:UInt64\}\)\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`__typedhouse_leaf_0` \+ `__typedhouse_input`\.`__typedhouse_leaf_8` != \{p1:UInt64\}$/);
  // A one-sided total filter after the fallible one is neither pushed into side b (it may not hop a non-total Filter: that would shrink the cast's rows) nor AND-ed in.
  const pushed = check(j.where(r => cast(r.a.s, col.UInt64).gt(0n)).where(r => r.b.v.gt(1)).map(r => ({ id: r.a.id })).ir, 4, 'one-sided total after fallible stays above, not AND-ed');
  expect(rewriteRel(j.where(r => cast(r.a.s, col.UInt64).gt(0n)).where(r => r.b.v.gt(1)).ir).hits.PushFilterJoin).toBe(0);
  expect(pushed).toMatch(/WHERE \(CAST\(`a`\.`s` AS UInt64\) > \{p0:UInt64\}\)\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`__typedhouse_leaf_8` > \{p1:UInt32\}$/);
  // A safe conjunct pushed into a join side that already holds a fallible filter lands above it in IR order and is not AND-ed in.
  // 4b fix round 1 (was 4): input a evaluates a fallible filter, so `a.k = 'x'` is not pushed into it (`fallibleWithin`) and folds into the join block.
  const side = check(join({ a: t.where(bad), b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.k.eq('x')).map(r => ({ id: r.a.id })).ir, 3);
  expect(side).toContain('FROM (SELECT `id`, `k` FROM `adv_s3b` WHERE CAST(`s` AS UInt64) > {p0:UInt64}) AS `a`\nINNER ALL JOIN (SELECT `id` FROM `adv_s3b_other`) AS `b` ON `a`.`id` = `b`.`id`\nWHERE (`a`.`k` = {p1:String})');
  // HAVING: safe, fallible, safe = three blocks; ORDER BY/LIMIT land in the outermost; a fallible first HAVING keeps its own block (deviation 1) and never shares with a later conjunct.
  const g = t.groupBy(r => ({ k: r.k })).aggregate(g => ({ c: count(), m: max(g.s) }));
  const having = check(g.where(r => r.c.gt(1n)).where(r => cast(r.m, col.UInt64).gt(0n)).where(r => r.c.lt(9n)).orderBy(r => r.k).limit(2).ir, 3, 'having safe,bad,safe');
  expect(having).toMatch(/HAVING `c` > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`m` AS UInt64\) > \{p1:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`c` < \{p2:UInt64\} ORDER BY `__typedhouse_input`\.`k` ASC LIMIT 2$/);
  const first = check(g.where(r => cast(r.m, col.UInt64).gt(0n)).where(r => r.c.gt(1n)).orderBy(r => r.k).limit(2).ir, 3, 'having bad first');
  expect(first).toMatch(/GROUP BY `__typedhouse_input`\.`k`\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`m` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`c` > \{p1:UInt64\} ORDER BY .* LIMIT 2$/);
  expect(fences(g.where(r => cast(r.m, col.UInt64).gt(0n)).where(r => r.c.gt(1n)).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter', 'derived:Aggregate:Aggregate']);
  // A total-but-unsafe HAVING pair is merged by MergeFilter and keeps one block over the aggregate (pre-existing safe-HAVING gate; both conjuncts total).
  expect(check(g.where(r => r.c.gt(1n)).where(r => r.c.plus(1n).lt(9n)).ir, 2)).toMatch(/GROUP BY `__typedhouse_input`\.`k`\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`c` > \{p0:UInt64\} AND `__typedhouse_input`\.`c` \+ \{p1:UInt64\} < \{p2:UInt64\}$/);
  // Expansions: fallible first WHERE above an inner or LEFT expansion folds; anything after it opens; a fallible WHERE below a LEFT expansion folds and a total above opens.
  expect(check(t.arrayJoin(r => r.ids, 'x').where(bad).ir, 1)).toBe('SELECT `id`, `k`, `n`, `s`, `nn`, `ids`, `f`, `x` FROM `adv_s3b` ARRAY JOIN `ids` AS `x` WHERE CAST(`s` AS UInt64) > {p0:UInt64}');
  expect(check(t.arrayJoin(r => r.ids, 'x').where(bad).where(r => r.x.eq('q')).ir, 2)).toMatch(/ARRAY JOIN `ids` AS `x` WHERE CAST\(`s` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`x` = \{p1:String\}$/);
  expect(check(t.where(total).arrayJoin(r => r.ids, 'x').where(bad).ir, 2)).toMatch(/ARRAY JOIN `ids` AS `x` WHERE `k` = \{p0:String\}\) AS `__typedhouse_input` WHERE CAST\(/);
  expect(check(t.where(bad).leftArrayJoin(r => r.ids, 'x').where(r => r.x.eq('q')).ir, 2)).toMatch(/LEFT ARRAY JOIN `ids` AS `x` WHERE CAST\(`s` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`x` = \{p1:String\}$/);
  expect(check(t.where(bad).leftArrayJoin(r => r.ids, 'x').where(bad2).ir, 2)).toMatch(/LEFT ARRAY JOIN `ids` AS `x` WHERE CAST\(`s` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE intDiv\(/);
  // A fallible WHERE pushed below an inner expansion never happens (PushFilterArrayJoin needs safePredicate) and the inner fold refuses it below.
  expect(check(t.where(bad).arrayJoin(r => r.ids, 'x').ir, 2)).toMatch(/^SELECT .* FROM \(SELECT .* FROM `adv_s3b` WHERE CAST\(`s` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` ARRAY JOIN/);
  // CTE-sourced blocks, union branches, a filter above a union, and a Materialize of the chain consumed twice.
  expect(check(t.cte().where(total).where(bad).ir, 3)).toMatch(/^WITH `t0` AS \(SELECT .* FROM `adv_s3b`\) SELECT .* FROM \(SELECT .* FROM `t0` WHERE `t0`\.`k` = \{p0:String\}\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`s` AS UInt64\) > \{p1:UInt64\}$/);
  expect(check(t.cte().where(bad).where(total).ir, 3)).toMatch(/FROM `t0` WHERE CAST\(`t0`\.`s` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`k` = \{p1:String\}$/);
  const branches = check(unionAll(t.where(total).where(bad), t.where(r => r.k.eq('b')).where(bad)).ir, 7);
  expect(branches.match(/\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`s` AS UInt64\) > \{p\d+:UInt64\}/g)).toHaveLength(2);
  expect(clauses(branches).every(c => c.length === 1)).toBe(true);
  const above = check(unionAll(t.where(r => r.k.eq('a')), t.where(r => r.id.eq(3))).where(r => r.id.ne(2)).where(bad).ir, 6, 'fallible above a union, total pushed into the branches');
  expect(above).toMatch(/^WITH `t0` AS \(SELECT .* FROM `adv_s3b`\) SELECT .* FROM \(SELECT .* UNION ALL .*\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`s` AS UInt64\) > \{p\d+:UInt64\}$/s); // the shared scan is a CTE
  expect(above.match(/ AND (`t0`\.)?`id` != \{p\d+:UInt32\}/g)).toHaveLength(2); // the total filter is pushed into (and merged with) both branch filters
  const shared = t.where(total).where(bad).cte();
  expect(check(join({ a: shared, b: shared }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })).ir, 3)).toMatch(/^WITH `t0` AS \(SELECT .* FROM \(SELECT .* FROM `adv_s3b` WHERE `k` = \{p0:String\}\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`s` AS UInt64\) > \{p1:UInt64\}\)\nSELECT `a`\.`id` AS `id`\nFROM `t0` AS `a`\nINNER ALL JOIN `t0` AS `b` ON/);
  // Computed selection folded below a fallible filter on its alias; identity selection transparent; Sort/Limit fold above the isolated filter; Distinct folds over it; an aggregate reads the derived table.
  expect(check(t.where(total).map(r => ({ next: r.id.plus(1), s: r.s })).where(r => cast(r.s, col.UInt64).gt(0n)).ir, 2)).toBe('SELECT `__typedhouse_input`.`next`, `__typedhouse_input`.`s` FROM (SELECT `id` + {p0:UInt32} AS `next`, `s` AS `s` FROM `adv_s3b` WHERE `k` = {p1:String}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s` AS UInt64) > {p2:UInt64}');
  expect(check(t.where(total).map(r => ({ id: r.id, s: r.s })).where(r => cast(r.s, col.UInt64).gt(0n)).orderBy(r => r.id).limit(2).ir, 2)).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`s` FROM (SELECT `id`, `s` FROM `adv_s3b` WHERE `k` = {p0:String}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s` AS UInt64) > {p1:UInt64} ORDER BY `__typedhouse_input`.`id` ASC LIMIT 2');
  expect(check(t.where(total).where(bad).distinct().ir, 2)).toMatch(/^SELECT DISTINCT `__typedhouse_input`\.`id`, .* FROM \(SELECT .* WHERE `k` = \{p0:String\}\) AS `__typedhouse_input` WHERE CAST\(/);
  expect(check(t.where(total).where(bad).groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() })).ir, 3)).toMatch(/^SELECT `__typedhouse_input`\.`k` AS `k`, count\(\) AS `c` FROM \(SELECT .* WHERE CAST\(.*\) AS `__typedhouse_input` GROUP BY `__typedhouse_input`\.`k`$/);
  // Sort/Limit between: the Filter above a Sort/Limit opens (clause order), and a total after a fallible one over that opens again.
  expect(fences(t.where(total).orderBy(r => r.id).where(bad).where(r => r.k.eq('a')).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter', 'derived:Sort:Sort']);
  expect(fences(t.where(total).limit(5).where(bad).ir)).toEqual(['root:Filter:root', 'derived:Limit:Limit']);
  expect(fences(t.where(total).orderBy(r => r.id).limit(1).where(bad).ir)).toEqual(['root:Filter:root', 'derived:Limit:Limit']);
  // FINAL stays on the scan block below the isolated filter.
  expect(check(from(adv).final().where(total).where(bad).ir, 2)).toContain('FROM `adv_s3b` FINAL WHERE `k` = {p0:String}) AS `__typedhouse_input` WHERE CAST(');
});

it('deviation 2: a direct selection folds over a derived nested Filter-only block of any kind; renames cannot capture the qualified leaf references', () => {
  const j = join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id));
  const cases: [string, Rel, number, RegExp][] = [
    ['filtered join + fallible + rename', j.where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ s: r.b.s2, id: r.b.v, v: r.a.id })).ir, 3,
      /^SELECT `__typedhouse_input`\.`__typedhouse_leaf_9` AS `s`, `__typedhouse_input`\.`__typedhouse_leaf_8` AS `id`, `__typedhouse_input`\.`__typedhouse_leaf_0` AS `v` FROM \(SELECT `a`\.`id` AS `__typedhouse_leaf_0`, `a`\.`s` AS `__typedhouse_leaf_3`, `b`\.`v` AS `__typedhouse_leaf_8`, `b`\.`s2` AS `__typedhouse_leaf_9` FROM .* WHERE \(`a`\.`id` \+ `b`\.`v` != \{p0:UInt64\}\)\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\) > \{p1:UInt64\}$/],
    ['sorted join + fallible', j.orderBy(r => r.a.id).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id, v: r.b.v })).ir, 4, /ORDER BY `a`\.`id` ASC\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\) > \{p0:UInt64\}$/],
    ['limited join + total', j.limit(3).where(r => r.b.v.gt(1)).map(r => ({ id: r.a.id, v: r.b.v })).ir, 4, /LIMIT 3\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`__typedhouse_leaf_8` > \{p0:UInt32\}$/],
    ['distinct join + total', j.distinct().where(r => r.b.v.gt(1)).map(r => ({ id: r.a.id, v: r.b.v })).ir, 2, /^SELECT `__typedhouse_input`\.`__typedhouse_leaf_0` AS `id`, `__typedhouse_input`\.`__typedhouse_leaf_8` AS `v` FROM \(SELECT DISTINCT `a`\.`id` AS `__typedhouse_leaf_0`, .* ON `a`\.`id` = `b`\.`id`\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`__typedhouse_leaf_8` > \{p0:UInt32\}$/],
    ['expanded join + fallible', j.arrayJoin(r => r.a.ids, 'x').where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id, x: r.x })).ir, 5, /`__typedhouse_element` AS `__typedhouse_leaf_10` FROM .* ARRAY JOIN `__typedhouse_input`\.`__typedhouse_leaf_5` AS `__typedhouse_element`\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\) > \{p0:UInt64\}$/],
    ['fallible then total over a sorted join', j.orderBy(r => r.a.id).where(r => cast(r.a.s, col.UInt64).gt(0n)).where(r => r.a.id.plus(r.b.v).ne(27n)).map(r => ({ id: r.a.id })).ir, 5, /WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE `__typedhouse_input`\.`__typedhouse_leaf_0` \+ `__typedhouse_input`\.`__typedhouse_leaf_8` != \{p1:UInt64\}$/],
  ];
  for (const [label, root, n, pattern] of cases) {
    const sql = check(root, n, label);
    expect(sql, label).toMatch(pattern);
    expect(fences(root).filter(f => f.endsWith('unfenced')), label).toEqual([]);
  }
  // Still refused: a computed selection, a selection over a block that already carries one, Sort/Limit clauses on the derived block itself, a CTE input.
  expect(fences(j.where(r => r.b.v.gt(1)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ next: r.a.id.plus(1) })).ir)[0]).toBe('root:Project:root');
  expect(check(j.where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ next: r.a.id.plus(1) })).ir, 5)).toMatch(/^SELECT `__typedhouse_input`\.`__typedhouse_leaf_0` \+ \{p0:UInt32\} AS `next` FROM \(SELECT `__typedhouse_input`\.`__typedhouse_leaf_0` FROM \(SELECT/);
  expect(check(j.where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).orderBy(r => r.a.id).map(r => ({ id: r.a.id })).ir, 5)).toMatch(/WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\) > \{p1:UInt64\} ORDER BY `__typedhouse_input`\.`__typedhouse_leaf_0` ASC\) AS `__typedhouse_input`$/); // the Sort folds into the derived Filter block; the direct selection above a Sort is naive-emitted
  const shared = j.cte();
  expect(check(shared.where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id })).ir, 3)).toMatch(/^WITH `t0` AS \(.*\) SELECT `__typedhouse_input`\.`__typedhouse_leaf_0` AS `id` FROM \(SELECT `t0`\.`__typedhouse_leaf_0` FROM `t0` WHERE CAST\(`t0`\.`__typedhouse_leaf_3` AS UInt64\) > \{p0:UInt64\}\) AS `__typedhouse_input`$/); // the CTE-sourced Filter block is not `derived`: the selection stays naive-emitted above it
  // A user alias equal to a synthetic leaf name the isolated WHERE reads: the reference stays qualified in both texts (natively probed under both alias settings).
  const captured = j.where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ __typedhouse_leaf_3: r.b.s2, id: r.a.id }));
  expect(check(captured.ir, 3)).toMatch(/^SELECT `__typedhouse_input`\.`__typedhouse_leaf_9` AS `__typedhouse_leaf_3`, `__typedhouse_input`\.`__typedhouse_leaf_0` AS `id` FROM .* WHERE CAST\(`__typedhouse_input`\.`__typedhouse_leaf_3` AS UInt64\)/);
});

it('harness: filterFence claims only boundaries the totality rule opened; Sort/Limit boundaries under a fallible filter keep their own kind; a total pair never opens one', () => {
  // Sort/Limit fences under a fallible consumer, then a Filter fence above.
  expect(fences(t.where(total).orderBy(r => r.id).where(bad).ir)).toEqual(['root:Filter:root', 'derived:Sort:Sort']);
  expect(fences(t.where(total).orderBy(r => r.id).limit(2).where(bad).where(r => r.n.gt(0n)).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter', 'derived:Limit:Limit']);
  // A derived block ending in a Filter over a Sort: the Filter above it is a Filter fence (the Sort below stays Sort).
  expect(fences(t.orderBy(r => r.id).where(total).where(bad).ir)).toEqual(['root:Filter:root', 'derived:Filter:Filter', 'derived:Sort:Sort']);
  // Total pairs never open a boundary on scan, join, CTE, aggregate (HAVING) and expanded blocks; nothing is claimed.
  const g = t.groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() }));
  for (const root of [t.where(total).where(r => r.n.gt(0n)).ir, join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.ne(r.b.v)).where(r => r.a.id.lt(r.b.v)).ir,
    t.cte().where(total).where(r => r.n.gt(0n)).ir, g.where(r => r.c.gt(1n)).where(r => r.c.lt(9n)).ir, t.leftArrayJoin(r => r.ids, 'x').where(total).where(r => r.x.eq('p')).ir]) {
    const s = fences(root);
    expect(s.filter(x => x.endsWith(':Filter')), compile(root).sql).toEqual([]);
    expect(s.filter(x => x.endsWith('unfenced')), compile(root).sql).toEqual([]);
  }
  // Not claimed: the slice 3 control (Filter over a folded computed selection) stays unfenced; a fallible first HAVING is an Aggregate boundary; a Filter over a
  // Distinct is a Distinct boundary; an identity selection between the two filters is transparent (the boundary is still the rule's).
  expect(fences(t.where(total).map(r => ({ next: r.id.plus(1), s: r.s })).where(r => cast(r.s, col.UInt64).gt(0n)).ir)).toEqual(['root:Filter:root', 'derived:Project:unfenced']);
  expect(fences(g.where(r => cast(r.k, col.UInt64).gt(0n)).ir)).toEqual(['root:Filter:root', 'derived:Aggregate:Aggregate']);
  expect(fences(t.where(total).distinct().where(bad).ir)).toEqual(['root:Filter:root', 'derived:Distinct:Distinct']);
  expect(fences(t.where(total).map(r => ({ id: r.id, s: r.s })).where(r => cast(r.s, col.UInt64).gt(0n)).ir)).toEqual(['root:Filter:root', 'derived:Project:Filter']);
  // The structure walk's SELECT count still equals the emitted count on every shape above and in the chains.
  for (const root of [t.where(total).where(bad).where(r => r.id.ne(1)).where(bad2).ir, t.orderBy(r => r.id).where(total).where(bad).ir, g.where(r => r.c.gt(1n)).where(r => cast(r.k, col.UInt64).gt(0n)).orderBy(r => r.k).ir]) {
    expect(structure(root).selects.length).toBe(selects(compile(root).sql));
  }
});

it('snapshots: the two moved corpus ids are the HEAD texts with the non-total filter lifted into its own SELECT; Param numbering and columns equal naive', () => {
  const byId = new Map(entries.map(e => [e.id, e]));
  const cl = compile(byId.get('entities/componentsLatest')!.query.ir), cn = emitNaive(byId.get('entities/componentsLatest')!.query.ir);
  expect(Object.keys(cl.params)).toEqual(Object.keys(cn.params)); expect(cl.columns).toEqual(cn.columns);
  expect(cl.sql).toContain('(SELECT `__typedhouse_input`.`entityId`, `__typedhouse_input`.`category` FROM (SELECT `entityId`, `category` FROM `entity_ots_component` WHERE `tenantId` = {p2:String} AND `state` = {p3:String}) AS `__typedhouse_input` WHERE startsWith(`__typedhouse_input`.`category`, {p4:String})) AS `c`');
  expect(selects(cl.sql)).toBe(10); // HEAD had 9: exactly one lifted filter
  expect(cl.sql.match(/startsWith/g)).toHaveLength(1);
  const hl = compile(byId.get('entities/history')!.query.ir), hn = emitNaive(byId.get('entities/history')!.query.ir);
  expect(Object.keys(hl.params)).toEqual(Object.keys(hn.params)); expect(hl.columns).toEqual(hn.columns);
  expect(hl.sql).toContain('(SELECT `__typedhouse_input`.`entityId` FROM (SELECT `entityId`, `category` FROM `entity_ots_component` WHERE `tenantId` = {p0:String}) AS `__typedhouse_input` WHERE startsWith(`__typedhouse_input`.`category`, {p1:String})) AS `c`');
  expect(hl.sql).toContain("FROM `metric_group_ots_component_market_availability` FINAL WHERE `tenantId` = {p2:String}) AS `__typedhouse_input` WHERE ((`__typedhouse_input`.`effectiveAt`) BETWEEN (CAST({p3:DateTime64(3, 'UTC')} AS DateTime64(3))) AND (CAST({p4:DateTime64(3, 'UTC')} AS DateTime64(3))))) AS `a`");
  expect(selects(hl.sql)).toBe(6); // HEAD had 4: two lifted filters (c side and a side)
  expect(fences(byId.get('entities/history')!.query.ir).filter(f => f.endsWith('unfenced'))).toEqual([]);
  // No other corpus id carries a Filter fence boundary.
  for (const e of entries) {
    const claimed = fences(e.query.ir).some(f => f.endsWith(':Filter'));
    expect(claimed, e.id).toBe(e.fences.includes('Filter'));
  }
});

it('invariants: safePredicate ⊂ totalPredicate on every probe predicate; rewrite is unchanged on the chain shapes (no MergeFilter across a non-total filter)', () => {
  const preds = [total, bad, bad2, (r: typeof t.row) => r.nn.isNull(), (r: typeof t.row) => r.n.plus(1n).gt(2n), (r: typeof t.row) => r.f.gt(0.5), (r: typeof t.row) => r.ids.has('p')];
  for (const p of preds) if (safePredicate(p(t.row).ir)) expect(totalPredicate(p(t.row).ir)).toBe(true);
  const chain = rewriteRel(t.where(total).where(bad).where(r => r.id.ne(1)).where(bad2).where(r => r.n.gt(0n)).ir);
  expect(chain.hits.MergeFilter).toBe(0);
  expect(rewriteRel(t.where(total).where(r => r.id.ne(1)).where(bad).ir).hits.MergeFilter).toBe(1);
  // Clause-count sanity for the regex helper: one clause with two conjuncts.
  expect(clauses('SELECT `id` FROM `f` WHERE `id` != {p0:UInt64} AND `k` = {p1:String}')).toEqual([['`id` != {p0:UInt64}', '`k` = {p1:String}']]);
});
