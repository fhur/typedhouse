import { expect, it } from 'vitest';
import { cast, col, count, createKnownFunctions, crossJoin, defineFunction, exprNode, from, join, now, scalar, table, unionAll, val, type ExprNode, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { emitPlanned, validateRel } from '../src/emit-naive.js';
import { planCtes } from '../src/plan-ctes.js';
import { planSelects } from '../src/plan-selects.js';
import { pruneColumns } from '../src/prune-columns.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { conjuncts, deterministicExpression, safePredicate, totalExpression, totalPredicate } from '../src/rewrite-expressions.js';

// Tester probes for slice 2 (PushFilterArrayJoin for total expansions, Distinct/ArrayJoin folding, (v) untyped
// Params in safeProjection, (vi) per-conjunct gating). Docker-free.
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const adv = table('adv', {
  id: col.UInt32, k: col.String, n: col.Int64, small: col.UInt8, nn: col.Nullable(col.Int64), lcs: col.LowCardinality(col.UInt8), s: col.String,
  ids: col.Array(col.String), nids: col.Array(col.Nullable(col.String)), uids: col.Array(col.UInt64),
  parts: col.Array(col.Tuple({ id: col.String, mpn: col.Nullable(col.String) })), tup: col.Tuple({ a: col.String, b: col.UInt8 }),
}, meta);
const other = table('adv2', { id: col.UInt32, v: col.UInt64 }, meta);
const t = from(adv), u = from(other);
const selects = (sql: string) => sql.match(/SELECT /g)?.length ?? 0;
const distincts = (sql: string) => sql.match(/SELECT DISTINCT /g)?.length ?? 0;
const safe = (r: typeof t.row) => r.id.gt(1);
const arith = (r: typeof t.row) => r.n.plus(val(1n, col.Int64)).gt(2n);
const unsafe = (r: typeof t.row) => cast(r.s, col.UInt64).gt(1n);
// A bounded user scalar function may be volatile; rowNumberInAllBlocks() is stateful in ClickHouse (reproducible with max_threads = 1).
const { fn } = createKnownFunctions({ arrayConcat: { isAggregate: false, deterministic: true, aliasTo: '' } } as const);
const volatile = defineFunction({ name: 'rowNumberInAllBlocks', args: [], returns: col.UInt64, deterministic: false });
function countKind(root: Rel, kind: Rel['kind']): number {
  const seen = new Set<Rel>();
  let n = 0;
  (function visit(rel: Rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (rel.kind === kind) n++;
    if ('input' in rel) visit(rel.input);
    if (rel.kind === 'Join') rel.inputs.forEach(([, r]) => visit(r));
    if (rel.kind === 'Union') rel.inputs.forEach(visit);
  })(root);
  return n;
}
/** Shared invariants: input graph untouched, idempotent fixpoint, same columns and diagnostic paths as naive. */
function rewrite(root: Rel) {
  const snapshot = () => JSON.stringify(root, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
  const before = snapshot();
  const result = rewriteRel(root);
  validateRel(result.root);
  expect(snapshot()).toBe(before);
  expect(rewriteRel(result.root).root).toBe(result.root);
  const compiled = compile(root), naive = emitNaive(root);
  expect(compiled.columns).toEqual(naive.columns);
  expect(Object.keys(compiled.nodes)).toEqual(Object.keys(naive.nodes));
  expect(compiled.sql).not.toContain('*');
  expect(distincts(compiled.sql)).toBe(countKind(result.root, 'Distinct'));
  return { ...result, compiled, naive };
}

// ---------------------------------------------------------------------------------------------------------------
// FINDING 1 (blocker). A Sort/Limit that folds over a folded Distinct keeps the *Sort/Limit's* pruned demand as the
// block's select list, so a pruning consumer turns `SELECT DISTINCT id, k, ids ... ORDER BY id` into
// `SELECT DISTINCT id ... ORDER BY id` (fewer rows), or orders by a column outside the DISTINCT list. The Distinct
// node itself is always full (prune-columns `full(rel)`), the leak is `plan.columns.get(Sort|Limit)` passed as
// `order` to `renderBlock` (emit-naive.ts emitNode → renderBlock(rel, physicalOrder)) after plan-selects.ts
// folds the clause over `child.distinct`. Fixed in fix round 1 (`renderBlock` takes the list from
// `plan.columns.get(block.distinct)`); the re-verification test below covers every path.
// ---------------------------------------------------------------------------------------------------------------
const leak = [
  ['Project over Sort over Distinct', () => t.distinct().orderBy(r => r.id).map(r => ({ id: r.id })).ir],
  ['Project over Limit over Distinct', () => t.distinct().limit(3).map(r => ({ id: r.id })).ir],
  ['Aggregate over Sort over Distinct (ORDER BY leaves the DISTINCT list)', () => t.distinct().orderBy(r => r.id).groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).ir],
  ['Join side Limit over Distinct', () => join({ a: t.distinct().limit(3), b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })).ir],
  ['Join-bound block: Project over Sort over Distinct over joined selection', () => join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, v: r.b.v })).distinct().orderBy(r => r.id).map(r => ({ id: r.id })).ir],
  ['Sort over Distinct over WHERE, pruned by an identity selection', () => t.where(safe).distinct().orderBy(r => r.k).map(r => ({ k: r.k })).ir],
] as const;
it('FINDING 1 (blocker, fixed in fix round 1: flipped from it.fails): a folded DISTINCT block keeps the full leaf set even when a Sort/Limit above it is pruned by its consumer', () => {
  for (const [label, build] of leak) {
    const root = build();
    const sql = compile(root).sql;
    // The DISTINCT select list must be the Distinct node's full leaf set (three `adv` leaves, or both joined leaves).
    const list = /SELECT DISTINCT ([^F]*?) FROM/.exec(sql)?.[1] ?? '';
    const names = list.split(', ').length;
    expect(names, `${label}: ${sql}`).toBeGreaterThanOrEqual(2);
  }
});

/** Every Distinct node reachable through the main input chain, join sides and union branches. */
function distinctNodes(root: Rel): Extract<Rel, { kind: 'Distinct' }>[] {
  const out: Extract<Rel, { kind: 'Distinct' }>[] = [], seen = new Set<Rel>();
  (function visit(rel: Rel) {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (rel.kind === 'Distinct') out.push(rel);
    if ('input' in rel) visit(rel.input);
    if (rel.kind === 'Join') rel.inputs.forEach(([, r]) => visit(r));
    if (rel.kind === 'Union') rel.inputs.forEach(visit);
  })(root);
  return out;
}
it('fix round 1: every DISTINCT list equals its Distinct node\'s full leaf set on every path a consumer can prune through', () => {
  const sharedSorted = t.distinct().orderBy(r => r.id);
  const nested = join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id));
  const shapes: [string, () => Rel][] = [
    ...leak.map(([label, build]) => [label, build] as [string, () => Rel]),
    ['DISTINCT block as a CTE definition (shared Sort over Distinct)', () => crossJoin({ a: sharedSorted.map(r => ({ id: r.id })), b: sharedSorted.map(r => ({ k: r.k })) }).map(r => ({ id: r.a.id, k: r.b.k })).ir],
    ['DISTINCT under unionAll, pruned above the union', () => unionAll(t.distinct().limit(2), from(adv).limit(2)).map(r => ({ id: r.id })).ir],
    ['DISTINCT over a FINAL SAMPLE scan', () => t.final().sample(0.5).distinct().orderBy(r => r.id).map(r => ({ id: r.id })).ir],
    ['DISTINCT over a pruned identity selection', () => t.map(r => ({ id: r.id, k: r.k })).distinct().orderBy(r => r.id).map(r => ({ id: r.id })).ir],
    ['DISTINCT over a computed selection, pruned above', () => t.map(r => ({ w: r.id.plus(1), k: r.k })).distinct().orderBy(r => r.w).map(r => ({ w: r.w })).ir],
    ['DISTINCT over nested join leaves, pruned to one side', () => nested.distinct().orderBy(r => r.a.id).map(r => ({ id: r.a.id })).ir],
    ['DISTINCT over an expansion with a tuple leaf, pruned to the alias', () => t.arrayJoin(r => r.parts, 'p').distinct().limit(5).map(r => ({ p: r.p })).ir],
    ['consumer alias colliding with a non-demanded DISTINCT leaf', () => t.distinct().orderBy(r => r.id).map(r => ({ k: r.id })).ir],
    ['DISTINCT with WHERE, HAVING-free aggregate below, Limit above, pruned', () => t.groupBy(r => ({ k: r.k, id: r.id })).aggregate(() => ({ c: count() })).distinct().limit(3).map(r => ({ c: r.c })).ir],
  ];
  for (const [label, build] of shapes) {
    const root = build();
    const { compiled, naive } = rewrite(root);
    expect(Object.keys(compiled.params), label).toEqual(Object.keys(naive.params));
    const lists = [...compiled.sql.matchAll(/SELECT DISTINCT (.*?) FROM/g)].map(m => m[1]!);
    const nodes = distinctNodes(root);
    expect(lists, label).toHaveLength(nodes.length);
    for (const [i, node] of nodes.entries()) {
      const names = [...lists[i]!.matchAll(/`((?:[^`\\]|\\.)*)`(?: AS `(?:[^`\\]|\\.)*`)?(?:, |$)/g)].map(m => m[1]!);
      // Qualified items (`__typedhouse_input`.`x`, `t0`.`x`, `a`.`id`) keep the last identifier; aliases keep the alias.
      const expected = new Set(plan(root).columns?.get(node)?.map(l => l.name) ?? []);
      expect(expected.size, label).toBe(outputLeafNames(node).length);
      const selected = new Set(lists[i]!.split(', ').map(item => /AS `((?:[^`\\]|\\.)*)`$/.exec(item)?.[1] ?? /`((?:[^`\\]|\\.)*)`$/.exec(item)?.[1]));
      expect(selected, `${label}: ${lists[i]}`).toEqual(expected);
      void names;
    }
  }
  function plan(root: Rel) { return planSelects(root, Object.values(validateRel(root).nodes), pruneColumns(root), planCtes(root)); }
  function outputLeafNames(rel: Rel) { return Object.keys(compile(rel).columns); }
  // The literal shapes from the first round.
  expect(compile(leak[0][1]()).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id` FROM (SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `lcs`, `s`, `ids`, `nids`, `uids`, `parts`, `tup` FROM `adv` ORDER BY `id` ASC) AS `__typedhouse_input`');
  expect(compile(leak[2][1]()).sql).toContain('(SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `lcs`, `s`, `ids`, `nids`, `uids`, `parts`, `tup` FROM `adv` ORDER BY `id` ASC)');
});
it('fix round 1: deterministicExpression admits only Raw-, Subquery- and volatile-free expressions; the LEFT fold is its only caller', () => {
  const r = t.row;
  const rawPred = exprNode({ kind: 'Raw', type: col.Bool.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['1'], args: [] });
  expect(deterministicExpression(rawPred)).toBe(false);
  expect(deterministicExpression(r.id.in(u.map(x => ({ id: x.id }))).ir)).toBe(false);
  expect(deterministicExpression(r.n.eq(cast(scalar(u.aggregate(() => count())), col.Int64)).ir)).toBe(false);
  expect(deterministicExpression(volatile().eq(0n).ir)).toBe(false);
  expect(deterministicExpression(now().eq(now()).ir)).toBe(false);
  const known = fn.arrayConcat(r.ids, r.ids).as(col.Array(col.String)).ir;
  expect(deterministicExpression(known)).toBe(true);
  if (known.kind !== 'Call') throw new Error('shape');
  expect(deterministicExpression({ ...known, fn: { ...known.fn, deterministic: false } })).toBe(false);
  expect(deterministicExpression({ ...known, fn: { ...known.fn, deterministic: null as never } })).toBe(false);
  for (const e of [unsafe(r), arith(r), safe(r), r.ids.has('a'), r.tup.element('a').eq('x'), val(true), cast(r.k, col.UInt64).gt(1n).and(r.nn.isNull())]) expect(deterministicExpression(e.ir)).toBe(true);
  // Deterministic but fallible/unsafe filters fold under LEFT; volatile ones do not; inner expansions still need safePredicate.
  expect(selects(compile(t.where(r2 => cast(r2.k, col.UInt64).gt(1n)).leftArrayJoin(r2 => r2.ids, 'x').ir).sql)).toBe(1);
  expect(compile(t.where(r2 => r2.id.in(u.map(x => ({ id: x.id })))).leftArrayJoin(r2 => r2.ids, 'x').ir).sql).toContain(') AS `__typedhouse_input` LEFT ARRAY JOIN `__typedhouse_input`.`ids` AS `__typedhouse_element`');
  expect(selects(compile(t.where(() => now().eq(now())).leftArrayJoin(r2 => r2.ids, 'x').ir).sql)).toBe(2);
  expect(selects(compile(t.where(() => now().eq(now())).arrayJoin(r2 => r2.ids, 'x').ir).sql)).toBe(2);
  expect(selects(compile(t.where(r2 => cast(r2.k, col.UInt64).gt(1n)).arrayJoin(r2 => r2.ids, 'x').ir).sql)).toBe(2);
});

// ---------------------------------------------------------------------------------------------------------------
// (1) missing_physical_column guard: a sweep of legal shapes whose block roots demand fewer columns than their scans.
// ---------------------------------------------------------------------------------------------------------------
const sweep: (() => Rel)[] = [
  () => t.orderBy(r => r.k).map(r => ({ id: r.id })).ir,
  () => t.where(safe).orderBy(r => r.k).thenBy(r => r.n).limit(2, 1).map(r => ({ id: r.id })).ir,
  () => t.arrayJoin(r => r.ids, 'x').map(r => ({ x: r.x })).ir,
  () => t.arrayJoin(() => val(['a'], col.Array(col.String)), 'x').map(r => ({ x: r.x })).ir,
  () => t.arrayJoin(r => r.parts.element('mpn'), 'm').where(r => r.m.eq('p')).orderBy(r => r.k).map(r => ({ m: r.m })).ir,
  () => t.where(r => r.id.in(u.map(x => ({ id: x.id })))).orderBy(r => r.n).map(r => ({ k: r.k })).ir,
  () => t.where(r => r.nn.eq(cast(scalar(u.aggregate(() => count())), col.Nullable(col.Int64)))).map(r => ({ k: r.k })).ir,
  () => t.leftArrayJoin(r => r.uids, 'q').where(r => r.q.gt(1n)).distinct().orderBy(r => r.q).map(r => ({ q: r.q })).ir,
  () => t.final().sample(0.5).arrayJoin(r => r.ids, 'x').where(safe).limit(3).map(r => ({ x: r.x, id: r.id })).ir,
  () => join({ a: t.arrayJoin(r => r.ids, 'x').where(safe), b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ x: r.a.x })).ir,
  () => t.cte().arrayJoin(r => r.ids, 'x').map(r => ({ x: r.x })).ir,
  () => t.groupBy(r => ({ k: r.k })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n)).orderBy(r => r.n).map(r => ({ k: r.k })).ir,
  () => unionAll(t.map(r => ({ id: r.id })), t.distinct().map(r => ({ id: r.id }))).orderBy(r => r.id).ir,
  () => t.where(safe).where(arith).where(unsafe).arrayJoin(r => r.ids, 'x').where(r => r.x.eq('a')).map(r => ({ id: r.id })).ir,
  () => t.map(r => ({ id: r.id, w: r.small.plus(1) })).where(r => r.w.gt(2)).orderBy(r => r.w).map(r => ({ id: r.id })).ir,
  () => crossJoin({ a: t.map(r => ({ id: r.id })), b: t.map(r => ({ k: r.k })) }).map(r => ({ id: r.a.id })).ir,
  () => t.arrayJoin(r => r.ids, 'x').arrayJoin(r => r.uids, 'y').where(r => r.y.gt(0n)).map(r => ({ x: r.x, y: r.y })).ir,
  () => t.distinct().where(safe).orderBy(r => r.id).map(r => ({ k: r.k })).ir,
];
it('(1) the renderBlock guard never fires on legal shapes; naive and planned agree on columns, nodes and Param keys', () => {
  for (const [i, build] of sweep.entries()) {
    const root = build();
    const { compiled, naive } = rewrite(root);
    expect(Object.keys(compiled.params), String(i)).toEqual(Object.keys(naive.params));
    expect(compiled.parameterTypes, String(i)).toEqual(naive.parameterTypes);
    expect(compiled.sql.match(/ARRAY JOIN/g)?.length ?? 0, String(i)).toBe(countKind(rewriteRel(root).root, 'ArrayJoin'));
  }
});
it('(1) the guard fires only on an inconsistent demand map, with the block path', () => {
  const root = t.where(safe).orderBy(r => r.k).ir;
  const validated = validateRel(root);
  const columns = new Map(pruneColumns(root));
  for (const [rel, leaves] of columns) if (rel.kind === 'Scan') columns.set(rel, leaves.filter(l => l.name !== 'n'));
  expect(() => emitPlanned(planSelects(root, Object.values(validated.nodes), columns))).toThrow(/missing_physical_column at root/);
});

// ---------------------------------------------------------------------------------------------------------------
// (2)/(vi) MergeFilter on totalPredicate and per-conjunct gating: nothing outside safePredicate crosses a Join,
// ArrayJoin, Aggregate or Union; nothing outside totalPredicate crosses a Project; residuals stay directly above.
// ---------------------------------------------------------------------------------------------------------------
function boundaryFilter(root: Rel, kind: Rel['kind']): Extract<Rel, { kind: 'Filter' }> | undefined {
  // The Filter sitting directly on the first node of `kind` found along the main input chain.
  let cur: Rel = root, parent: Rel | undefined;
  for (;;) {
    if (cur.kind === kind) return parent?.kind === 'Filter' ? parent : undefined;
    if (!('input' in cur)) return undefined;
    parent = cur; cur = cur.input;
  }
}
it('(vi) a mixed conjunction (safe AND arithmetic AND cast) splits exactly at each boundary', () => {
  const mixed = (r: typeof t.row) => safe(r).and(arith(r)).and(unsafe(r));
  // Join: only the safe conjunct reaches side a; arithmetic and cast stay as the residual above the join.
  const j = rewrite(join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.gt(1).and(r.a.n.plus(val(1n, col.Int64)).gt(2n)).and(cast(r.a.s, col.UInt64).gt(1n)).and(r.b.v.lt(5n))).map(r => ({ id: r.a.id })).ir);
  expect(j.hits.PushFilterJoin).toBe(1);
  const jf = boundaryFilter(j.root, 'Join')!;
  expect(conjuncts(jf.pred).map(safePredicate)).toEqual([false, false]);
  // Slice 3 fix round 1: the direct selection folds over the filtered join block, which is now the root (newline separators).
  expect(j.compiled.sql).toBe('SELECT `a`.`id` AS `id`\nFROM (SELECT `id`, `n`, `s` FROM `adv` WHERE `id` > {p0:UInt32}) AS `a`\nINNER ALL JOIN (SELECT `id` FROM `adv2` WHERE `v` < {p1:UInt64}) AS `b` ON `a`.`id` = `b`.`id`\nWHERE (`a`.`n` + {p2:Int64} > {p3:Int64} AND CAST(`a`.`s` AS UInt64) > {p4:UInt64})');
  // ArrayJoin (inner and left): only the safe conjunct moves below the expansion.
  for (const left of [false, true]) {
    const q = left ? t.leftArrayJoin(r => r.ids, 'x') : t.arrayJoin(r => r.ids, 'x');
    const a = rewrite(q.where(mixed).ir);
    expect(a.hits.PushFilterArrayJoin).toBe(1);
    const af = boundaryFilter(a.root, 'ArrayJoin')!;
    expect(conjuncts(af.pred).map(safePredicate)).toEqual([false, false]);
    expect(conjuncts(af.pred).map(totalPredicate)).toEqual([true, false]);
    if (a.root.kind !== 'Filter' || a.root.input.kind !== 'ArrayJoin' || a.root.input.input.kind !== 'Filter') throw new Error('shape');
    expect(safePredicate(a.root.input.input.pred)).toBe(true);
    // Planner: the pushed safe filter folds under the expansion. Slice 3b (flipped from one shared WHERE): the residual
    // carries the cast, so it is not total and keeps its own SELECT above the safe WHERE instead of being AND-ed into it.
    const columns = ['id', 'k', 'n', 'small', 'nn', 'lcs', 's', 'ids', 'nids', 'uids', 'parts', 'tup', 'x'];
    expect(a.compiled.sql).toBe(`SELECT ${columns.map(c => `\`__typedhouse_input\`.\`${c}\``).join(', ')} FROM (SELECT ${columns.map(c => `\`${c}\``).join(', ')} FROM \`adv\` ${left ? 'LEFT ' : ''}ARRAY JOIN \`ids\` AS \`x\` WHERE \`id\` > {p0:UInt32}) AS \`__typedhouse_input\` WHERE \`__typedhouse_input\`.\`n\` + {p1:Int64} > {p2:Int64} AND CAST(\`__typedhouse_input\`.\`s\` AS UInt64) > {p3:UInt64}`);
  }
  // Aggregate: the safe key conjunct becomes WHERE below the aggregate; arithmetic over the key and a cast stay above
  // (never HAVING, since the planner also requires safePredicate for HAVING folding).
  const grouped = t.groupBy(r => ({ k: r.k, id: r.id })).aggregate(() => ({ c: count() }));
  const g = rewrite(grouped.where(r => r.k.eq('a').and(r.id.plus(1).gt(2n)).and(cast(r.k, col.UInt64).gt(1n)).and(r.c.gt(1n))).ir);
  expect(g.hits.PushFilterAggKey).toBe(1);
  const gf = boundaryFilter(g.root, 'Aggregate')!;
  expect(conjuncts(gf.pred)).toHaveLength(3);
  expect(conjuncts(gf.pred).map(safePredicate)).toEqual([false, false, true]);
  expect(g.compiled.sql).toContain('GROUP BY `__typedhouse_input`.`k`, `__typedhouse_input`.`id`) AS `__typedhouse_input` WHERE `__typedhouse_input`.`id` + {p1:UInt32} > {p2:UInt64} AND CAST(`__typedhouse_input`.`k` AS UInt64) > {p3:UInt64} AND `__typedhouse_input`.`c` > {p4:UInt64}');
  expect(g.compiled.sql).toContain('FROM `adv` AS `__typedhouse_input` WHERE `__typedhouse_input`.`k` = {p0:String} GROUP BY');
  // Union: the safe conjunct replicates into both branches, the rest stays above the union.
  const un = rewrite(unionAll(t, t.where(r => r.k.eq('z'))).where(mixed).ir);
  expect(un.hits.PushFilterUnion).toBe(1);
  const uf = boundaryFilter(un.root, 'Union')!;
  expect(conjuncts(uf.pred).map(safePredicate)).toEqual([false, false]);
  if (uf.input.kind !== 'Union') throw new Error('shape');
  for (const branch of uf.input.inputs) { expect(branch.kind).toBe('Filter'); if (branch.kind === 'Filter') expect(safePredicate(branch.pred)).toBe(true); }
  expect(un.hits.MergeFilter).toBe(1); // the replicated safe conjunct merges with the second branch's own filter
  // Project: safe and arithmetic cross (substituted copies are total); the cast conjunct stays above.
  const p = rewrite(t.map(r => ({ id: r.id, n2: r.n.plus(val(1n, col.Int64)), s: r.s })).where(r => r.id.gt(1).and(r.n2.gt(2n)).and(cast(r.s, col.UInt64).gt(1n))).ir);
  expect(p.hits.PushFilterProject).toBe(1);
  if (p.root.kind !== 'Filter' || p.root.input.kind !== 'Project' || p.root.input.input.kind !== 'Filter') throw new Error('shape');
  expect(conjuncts(p.root.pred)).toHaveLength(1);
  expect(conjuncts(p.root.input.input.pred).map(totalPredicate)).toEqual([true, true]);
  expect(conjuncts(p.root.input.input.pred).map(safePredicate)).toEqual([true, false]);
});
it('(2) MergeFilter merges only total pairs and never carries a non-safe conjunct across a boundary afterwards', () => {
  // Two filters stacked above a Join: merged in pass 2 after the safe one is pushed? No: bottom-up, the lower one is
  // pushed first, so the upper total filter lands on the new Join and stays there.
  const joined = join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id));
  const stacked = rewrite(joined.where(r => r.a.id.gt(1)).where(r => r.a.n.plus(val(1n, col.Int64)).gt(2n)).ir);
  expect(stacked.hits).toMatchObject({ PushFilterJoin: 1, MergeFilter: 0 });
  if (stacked.root.kind !== 'Filter' || stacked.root.input.kind !== 'Join') throw new Error('shape');
  expect(safePredicate(stacked.root.pred)).toBe(false);
  expect(stacked.root.input.inputs[0]![1].kind).toBe('Filter');
  // Reverse order (total below, safe above): merged into one total Filter on the Join, whose safe conjunct is then
  // pushed and whose arithmetic conjunct is the residual.
  const reversed = rewrite(joined.where(r => r.a.n.plus(val(1n, col.Int64)).gt(2n)).where(r => r.a.id.gt(1)).ir);
  expect(reversed.hits).toMatchObject({ PushFilterJoin: 1, MergeFilter: 1 });
  if (reversed.root.kind !== 'Filter' || reversed.root.input.kind !== 'Join') throw new Error('shape');
  expect(conjuncts(reversed.root.pred)).toHaveLength(1);
  expect(reversed.compiled.sql).toContain('FROM `adv` WHERE `id` > {p0:UInt32}) AS `a`');
  expect(reversed.compiled.sql).toContain('WHERE (`a`.`n` + {p1:Int64} > {p2:Int64})');
  // A cast filter never merges (not total), above or below.
  for (const q of [t.where(unsafe).where(safe), t.where(safe).where(unsafe), t.where(unsafe).where(arith)]) expect(rewrite(q.ir).hits.MergeFilter).toBe(0);
  // Merged total filters below an inner expansion: same evaluation set, and the planner keeps the fence (2 SELECTs).
  const below = rewrite(t.where(safe).where(arith).arrayJoin(r => r.ids, 'x').ir);
  expect(below.hits.MergeFilter).toBe(1);
  expect(selects(below.compiled.sql)).toBe(2);
  expect(below.compiled.sql).toContain('WHERE `id` > {p0:UInt32} AND `n` + {p1:Int64} > {p2:Int64}) AS `__typedhouse_input` ARRAY JOIN');
  const belowLeft = rewrite(t.where(safe).where(arith).leftArrayJoin(r => r.ids, 'x').ir);
  expect(selects(belowLeft.compiled.sql)).toBe(1);
  // HAVING: merging a safe HAVING with a total one moves both out of the aggregate block (count unchanged: 2 SELECTs
  // before and after), recorded as a non-regression.
  const grouped = t.groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() }));
  const having = rewrite(grouped.where(r => r.c.gt(1n)).where(r => r.c.plus(1n).gt(2n)).ir);
  expect(having.hits.MergeFilter).toBe(1);
  expect(selects(having.compiled.sql)).toBe(2);
  expect(having.compiled.sql).not.toContain('HAVING');
});

// ---------------------------------------------------------------------------------------------------------------
// (3) ArrayJoin fold condition and rendering.
// ---------------------------------------------------------------------------------------------------------------
it('(3) inner expansions fold only over safe filters; LEFT folds over any deterministic one (volatile fenced since fix round 1)', () => {
  const inner = (q: ReturnType<typeof t.where>) => q.arrayJoin(r => r.ids, 'x'), left = (q: ReturnType<typeof t.where>) => q.leftArrayJoin(r => r.ids, 'x');
  expect(selects(compile(inner(t.where(safe)).ir).sql)).toBe(1);
  expect(selects(compile(inner(t.where(arith)).ir).sql)).toBe(2);
  expect(selects(compile(inner(t.where(unsafe)).ir).sql)).toBe(2);
  expect(selects(compile(inner(t.where(r => r.ids.has('a'))).ir).sql)).toBe(2);
  expect(selects(compile(left(t.where(unsafe)).ir).sql)).toBe(1);
  // FINDING 2 (fixed in fix round 1, assertions flipped): a volatile predicate below a LEFT expansion keeps the nested
  // emission, matching the rewrite rules, which never move volatile predicates.
  const vol = left(t.where(() => volatile().eq(0n)));
  expect(selects(compile(vol.ir).sql)).toBe(2);
  expect(compile(vol.ir).sql).toContain('WHERE rowNumberInAllBlocks() = {p0:UInt64}) AS `__typedhouse_input` LEFT ARRAY JOIN `__typedhouse_input`.`ids` AS `__typedhouse_element`');
  expect(selects(compile(inner(t.where(() => volatile().eq(0n))).ir).sql)).toBe(2);
  // FINAL and SAMPLE precede the expansion; a WHERE after it, DISTINCT, ORDER BY and LIMIT fold.
  const hinted = t.final().sample(0.25).arrayJoin(r => r.nids, 'x').where(r => r.x.isNotNull()).distinct().orderBy(r => r.x).limit(2);
  expect(compile(hinted.ir).sql).toBe('SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `lcs`, `s`, `ids`, `nids`, `uids`, `parts`, `tup`, `x` FROM `adv` FINAL SAMPLE 0.25 ARRAY JOIN `nids` AS `x` WHERE isNotNull(`x`) ORDER BY `x` ASC LIMIT 2');
  // Two expansions: the second opens a block over the folded first; LIMIT before an expansion fences; after folds.
  expect(selects(compile(t.arrayJoin(r => r.ids, 'x').arrayJoin(r => r.uids, 'y').ir).sql)).toBe(2);
  expect(selects(compile(t.limit(2).arrayJoin(r => r.ids, 'x').ir).sql)).toBe(2);
  expect(selects(compile(t.arrayJoin(r => r.ids, 'x').limit(2).ir).sql)).toBe(1);
  // Slice 3 (vii): count() above an inner expansion folds into the expanded block (recording flipped).
  const counted = t.arrayJoin(r => r.ids, 'x').aggregate(() => ({ c: count() }));
  expect(compile(counted.ir).sql).toBe('SELECT count() AS `c` FROM `adv` ARRAY JOIN `ids` AS `x`');
  // Tuple, Nullable and UInt64 element types keep their descriptors on both emitters.
  for (const q of [t.arrayJoin(r => r.parts, 'p'), t.arrayJoin(r => r.nids, 'p'), t.leftArrayJoin(r => r.uids, 'p'), t.arrayJoin(r => r.parts.element('id'), 'p')]) {
    expect(compile(q.ir).columns).toEqual(emitNaive(q.ir).columns);
  }
});
it('(3) alias shadowing: expansion alias vs physical columns and computed aliases, under identity and renames', () => {
  const x = t.arrayJoin(r => r.ids, 'x');
  expect(() => (t.arrayJoin as Function)((r: typeof t.row) => r.ids, 'id')).toThrow(/duplicate_column/);
  // Computed alias equal to the expansion alias: fence (two definitions of one alias). Slice 3 fix round 1: a rename of
  // the alias to a physical name folds unless the block reads that column (`ids` is read by the expansion).
  expect(selects(compile(x.map(r => ({ x: r.id.plus(1) })).ir).sql)).toBe(2);
  expect(compile(x.map(r => ({ id: r.x })).ir).sql).toBe('SELECT `x` AS `id` FROM `adv` ARRAY JOIN `ids` AS `x`');
  expect(selects(compile(x.map(r => ({ ids: r.x })).ir).sql)).toBe(2);
  // Rename of the alias to a fresh name folds; identity folds; a computed alias equal to an unread physical column folds too.
  expect(compile(x.map(r => ({ y: r.x })).ir).sql).toBe('SELECT `x` AS `y` FROM `adv` ARRAY JOIN `ids` AS `x`');
  expect(compile(x.map(r => ({ x: r.x, ids: r.ids })).ir).sql).toBe('SELECT `x`, `ids` FROM `adv` ARRAY JOIN `ids` AS `x`');
  expect(selects(compile(x.map(r => ({ tup: r.id.plus(1), x: r.x })).ir).sql)).toBe(1);
  expect(selects(compile(x.where(r => r.tup.element('a').eq('q')).map(r => ({ tup: r.id.plus(1), x: r.x })).ir).sql)).toBe(2); // the WHERE reads `tup`
  // WHERE on the alias plus a computed projection with a fresh alias: one block, WHERE binds the expansion alias.
  expect(compile(x.where(r => r.x.eq('a')).map(r => ({ w: r.id.plus(1), x: r.x })).ir).sql).toBe('SELECT `id` + {p0:UInt32} AS `w`, `x` AS `x` FROM `adv` ARRAY JOIN `ids` AS `x` WHERE `x` = {p1:String}');
});

// ---------------------------------------------------------------------------------------------------------------
// (4) `element` admission.
// ---------------------------------------------------------------------------------------------------------------
it('(4) element with a constant selector is total only when the catalog resolves it; unknown fields never reach one emitter alone', () => {
  const r = t.row;
  expect(totalExpression(r.parts.element('mpn').ir)).toBe(true);
  expect(totalExpression(r.tup.element('a').ir)).toBe(true);
  expect(totalPredicate(r.tup.element('a').eq('x').ir)).toBe(true);
  expect(safePredicate(r.tup.element('a').eq('x').ir)).toBe(false);
  // Builder-level rejection of an unknown field and of a positional selector.
  expect(() => (r.parts.element as Function)('nope')).toThrow();
  expect(() => (r.tup.element as Function)(0)).toThrow();
  // A forged unknown selector in the IR is outside the fragment and fails on both emitters at the same path.
  const call = r.parts.element('mpn').ir;
  if (call.kind !== 'Call' || call.args[1]?.kind !== 'Param') throw new Error('shape');
  const forged: ExprNode = { ...call, args: [call.args[0]!, exprNode({ kind: 'Param', value: 'nope', type: call.args[1].type })] };
  expect(totalExpression(forged)).toBe(false);
  const shape = t.arrayJoin(r2 => r2.parts.element('mpn'), 'm').where(r2 => r2.id.gt(1)).ir;
  if (shape.kind !== 'Filter' || shape.input.kind !== 'ArrayJoin') throw new Error('shape');
  const bad: Rel = { ...shape, input: { ...shape.input, expr: forged } };
  for (const emit of [compile, emitNaive]) expect(() => emit(bad)).toThrow(/invalid_array_join_expression at root\.input\.expr/);
  // A scalar named-tuple element pushes through a selection; since slice 3 fix round 1 the selection folds over the scan too.
  const pushed = rewrite(t.map(r2 => ({ a: r2.tup.element('a'), id: r2.id })).where(r2 => r2.a.eq('x')).ir);
  expect(pushed.hits.PushFilterProject).toBe(1);
  expect(pushed.compiled.sql).toBe('SELECT tupleElement(`tup`, {p0:String}) AS `a`, `id` AS `id` FROM `adv` WHERE tupleElement(`tup`, {p0:String}) = {p1:String}');
  // Known-origin array expressions are fences for the expansion push.
  const fence = rewrite(t.arrayJoin(r2 => fn.arrayConcat(r2.ids, r2.ids).as(col.Array(col.String)), 'x').where(safe).ir);
  expect(fence.hits.PushFilterArrayJoin).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// (5) Distinct fold.
// ---------------------------------------------------------------------------------------------------------------
it('(5) distinct shapes: twice, duplicate renames, unions, CTE and join inputs, HAVING, filter after', () => {
  expect(compile(t.distinct().distinct().ir).sql).toBe('SELECT DISTINCT `__typedhouse_input`.`id`, `__typedhouse_input`.`k`, `__typedhouse_input`.`n`, `__typedhouse_input`.`small`, `__typedhouse_input`.`nn`, `__typedhouse_input`.`lcs`, `__typedhouse_input`.`s`, `__typedhouse_input`.`ids`, `__typedhouse_input`.`nids`, `__typedhouse_input`.`uids`, `__typedhouse_input`.`parts`, `__typedhouse_input`.`tup` FROM (SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `lcs`, `s`, `ids`, `nids`, `uids`, `parts`, `tup` FROM `adv`) AS `__typedhouse_input`');
  expect(compile(t.map(r => ({ a: r.id, b: r.id })).distinct().ir).sql).toBe('SELECT DISTINCT `id` AS `a`, `id` AS `b` FROM `adv`');
  expect(compile(t.map(r => ({ k: r.k })).distinct().ir).sql).toBe('SELECT DISTINCT `k` FROM `adv`');
  const union = compile(unionAll(from(adv).map(r => ({ k: r.k })).distinct(), from(adv).map(r => ({ k: r.k })).distinct()).ir).sql;
  expect(distincts(union)).toBe(2);
  expect(union).toContain('(SELECT DISTINCT `k` FROM `adv`) AS `__typedhouse_input` UNION ALL');
  expect(compile(t.cte().distinct().ir).sql).toContain('SELECT DISTINCT `t0`.`id`');
  const side = compile(join({ a: t.map(r => ({ id: r.id })).distinct(), b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, v: r.b.v })).ir).sql;
  expect(side).toContain('FROM (SELECT DISTINCT `id` FROM `adv`) AS `a`');
  const grouped = t.groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() }));
  expect(compile(grouped.where(r => r.c.gt(1n)).distinct().orderBy(r => r.c).limit(1).ir).sql).toBe('SELECT DISTINCT `__typedhouse_input`.`k` AS `k`, count() AS `c` FROM `adv` AS `__typedhouse_input` GROUP BY `__typedhouse_input`.`k` HAVING `c` > {p0:UInt64} ORDER BY `c` ASC LIMIT 1');
  expect(selects(compile(grouped.distinct().where(r => r.c.gt(1n)).ir).sql)).toBe(2);
  // A computed selection after a folded Distinct opens a block (the table test only covers the identity selection).
  expect(compile(t.distinct().map(r => ({ w: r.id.plus(1) })).ir).sql).toBe('SELECT `__typedhouse_input`.`id` + {p0:UInt32} AS `w` FROM (SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `lcs`, `s`, `ids`, `nids`, `uids`, `parts`, `tup` FROM `adv`) AS `__typedhouse_input`');
  expect(selects(compile(t.distinct().groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() })).ir).sql)).toBe(2);
  expect(compile(t.where(safe).distinct().where(r => r.k.eq('a')).ir).sql).toContain('FROM (SELECT DISTINCT `id`');
  // Sort key expression over a folded Distinct references selected columns only.
  expect(compile(t.distinct().orderBy(r => r.id.plus(1)).ir).sql).toBe('SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `lcs`, `s`, `ids`, `nids`, `uids`, `parts`, `tup` FROM `adv` ORDER BY `id` + {p0:UInt32} ASC');
  // No DISTINCT without a Distinct node, across every sweep shape (checked in `rewrite`) and the naive text is untouched.
  for (const build of sweep) { const root = build(); expect(distincts(emitNaive(root).sql)).toBe(countKind(root, 'Distinct')); }
});

// ---------------------------------------------------------------------------------------------------------------
// (v) untyped Params in safeProjection.
// ---------------------------------------------------------------------------------------------------------------
it('(v) untyped Params resolve from integer siblings only; out-of-range and mixed-sibling values fail on both emitters', () => {
  const one = (q: { ir: Rel }) => selects(compile(q.ir).sql);
  expect(one(t.map(r => ({ w: r.nn.plus(1n) })).where(r => r.w.gt(2n)))).toBe(1);
  expect(one(t.map(r => ({ w: r.lcs.plus(1) })).where(r => r.w.gt(2)))).toBe(1);
  expect(one(t.map(r => ({ w: r.small.plus(1) })).where(r => r.w.gt(2)))).toBe(1);
  expect(compile(t.map(r => ({ w: r.small.plus(1) })).where(r => r.w.gt(2)).ir).sql).toBe('SELECT `small` + {p0:UInt8} AS `w` FROM `adv` WHERE `small` + {p0:UInt8} > {p1:UInt16}');
  expect(one(t.map(r => ({ w: r.n.plus(1n) })).where(r => r.w.gt(2n)))).toBe(1);
  // Slice 3 fix round 1: Float selections fold over the scan; a Float filter above one is not total, so it stays a second block.
  expect(one(t.map(r => ({ w: val(1).plus(val(2)) })).where(r => r.w.gt(2)))).toBe(2);
  expect(one(t.map(r => ({ w: r.id.plus(val(1, col.Float64)) })))).toBe(1);
  // Out of range, negative against unsigned, bigint against a 32-bit column, number against a 64-bit column, fraction:
  // every one is rejected by both emitters (serializeParameter runs before either emission).
  for (const bad of [t.map(r => ({ w: r.small.plus(300) })), t.map(r => ({ w: r.small.plus(-1) })), t.map(r => ({ w: r.id.plus(-1) })), t.map(r => ({ w: r.id.plus(1n as never) })), t.map(r => ({ w: r.n.plus(1 as never) })), t.map(r => ({ w: r.small.plus(1.5) })), t.map(r => ({ w: r.id.plus(1.5) }))]) {
    for (const emit of [compile, emitNaive]) expect(() => emit(bad.ir)).toThrow(/param_incompatible/);
  }
  // A standalone `val(1)` is a typed Float64 Param (fence, both emitters agree); a genuinely untyped Param is only
  // created by a literal operand, so sharing one needs a hand-built graph: two different siblings fail identically on
  // both emitters, equal siblings keep one name and fold into one SELECT.
  expect(one(t.map(r => ({ a: r.small.plus(val(1) as never), b: r.n.plus(val(1) as never) })))).toBe(1);
  function sharing(build: (r: typeof t.row) => Record<'a' | 'b', unknown>): Rel {
    const ir = t.map(build as never).ir;
    if (ir.kind !== 'Project' || ir.exprs.a?.kind !== 'Call' || ir.exprs.b?.kind !== 'Call') throw new Error('shape');
    const shared = ir.exprs.a.args[1]!;
    if (shared.kind !== 'Param' || shared.type !== null) throw new Error('expected an untyped Param');
    const { id: _id, ...b } = ir.exprs.b;
    return { ...ir, exprs: { a: ir.exprs.a, b: exprNode({ ...b, args: [ir.exprs.b.args[0]!, shared] }) } };
  }
  const mixedSiblings = sharing(r => ({ a: r.small.plus(1), b: r.n.plus(1n) }));
  for (const emit of [compile, emitNaive]) expect(() => emit(mixedSiblings)).toThrow(/param_incompatible/);
  const equalSiblings = sharing(r => ({ a: r.id.plus(1), b: r.id.plus(1) }));
  const shared = compile(equalSiblings), sharedNaive = emitNaive(equalSiblings);
  expect(shared.sql).toBe('SELECT `id` + {p0:UInt32} AS `a`, `id` + {p0:UInt32} AS `b` FROM `adv`');
  expect(shared.params).toEqual({ p0: '1' });
  expect(sharedNaive.params).toEqual({ p0: '1' });
  // Shadowing guard unchanged: a computed alias equal to a physical column keeps the derived table.
  expect(one(t.map(r => ({ id: r.id.plus(1) })).where(r => r.id.gt(2n)))).toBe(2);
});
