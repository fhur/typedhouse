import { expect, it } from 'vitest';
import { cast, col, count, createKnownFunctions, crossJoin, defineFunction, exprNode, from, join, now, scalar, stringLike, sum, table, unionAll, val, Query, type CHType, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { planCtes } from '../src/plan-ctes.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { references, safePredicate, totalExpression, totalPredicate } from '../src/rewrite-expressions.js';

// Tester probes for slice 1 (MergeProject + general PushFilterProject). Docker-free.
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const wide = table('adv', {
  id: col.UInt32, n: col.Int64, small: col.UInt8, extra: col.Int32, text: col.Nullable(col.String), s: col.String, lc: col.LowCardinality(col.String),
  nlc: col.LowCardinality(col.Nullable(col.String)), nn: col.Nullable(col.Int64), f: col.Float64, d: col.Decimal64(2), at: col.DateTime(),
  e: col.Enum8({ a: 1, b: 2 }), flag: col.Bool, ids: col.Array(col.String),
}, meta);
const q = from(wide);
const { fn } = createKnownFunctions({ cityHash64: { isAggregate: false, deterministic: true, aliasTo: '' } } as const);
const editDistance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
const selects = (sql: string) => sql.match(/SELECT /g)?.length ?? 0;
const raw = (parts: string, type: CHType = col.UInt32.type) => exprNode({ kind: 'Raw', type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: [parts], args: [] });

/** Shared invariants: input graph untouched, idempotent fixpoint, same columns and diagnostic paths as naive. */
function rewrite(root: Rel) {
  const snapshot = () => JSON.stringify(root, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
  const before = snapshot();
  validateRel(root);
  const result = rewriteRel(root);
  validateRel(result.root);
  expect(snapshot()).toBe(before);
  expect(result.root.output).toEqual(root.output);
  expect(rewriteRel(result.root).root).toBe(result.root);
  const again = rewriteRel(result.root).hits;
  expect(Object.values(again).every(n => n === 0)).toBe(true);
  const compiled = compile(root), naive = emitNaive(root);
  expect(compiled.columns).toEqual(naive.columns);
  expect(Object.keys(compiled.nodes)).toEqual(Object.keys(naive.nodes));
  expect(compiled.sql).not.toContain('*');
  return { ...result, compiled, naive };
}

it('admission audit: the wide fragment admits nothing fallible, volatile, raw, scoped or outside String/Bool/integer', () => {
  const r = q.row;
  const rejected: [string, import('@typedhouse/core').ExprNode][] = [
    ['cast', cast(r.text, col.Nullable(col.UInt32)).ir],
    ['divide', r.n.divide(2n).ir],
    ['divide by zero param', r.n.divide(val(0n, col.Int64)).ir],
    ['raw', raw('rand()')],
    ['raw predicate', raw('throwIf(1)', col.Bool.type)],
    ['subquery', scalar(q.aggregate(() => count())).ir],
    ['known origin', fn.cityHash64(r.id).as(col.UInt64).ir],
    ['user origin', editDistance(r.text, 'x').ir],
    ['now', now().ir],
    ['now comparison', now().eq(now()).ir],
    ['float plus', r.f.plus(1).ir],
    ['float compare', r.f.gt(1).ir],
    ['decimal plus', r.d.plus(r.d).ir],
    ['decimal compare', r.d.gt(r.d).ir],
    ['datetime compare', r.at.gt(new Date(0)).ir],
    ['enum compare', r.e.eq('a').ir],
    ['array has', r.ids.has('a').ir],
    ['array length', r.ids.length().ir],
    ['string concat-ish ifNull across families', r.text.ifNull(val(1n, col.Int64) as never).ir],
    ['in list', r.id.in([1, 2]).ir],
    ['between', r.id.between(1, 2).ir],
    ['ifNull on float', val(null, col.Nullable(col.Float64)).ifNull(1.5).ir],
  ];
  for (const [label, e] of rejected) {
    expect(totalExpression(e), label).toBe(false);
    expect(totalPredicate(e), label).toBe(false);
    expect(safePredicate(e), label).toBe(false);
  }
  // Admitted: bare reads of any type (drop-only), integer arithmetic, boolean family, same-family ifNull incl. LowCardinality/Nullable.
  for (const e of [r.f, r.d, r.at, r.e, r.ids, r.nlc, val(1.5, col.Float64), val(new Date(0), col.DateTime())]) expect(totalExpression(e.ir)).toBe(true);
  for (const e of [r.small.plus(r.small), r.nn.plus(1n), r.nn.ifNull(0n), r.text.ifNull(r.lc), r.lc.eq('x'), r.nn.isNull(), r.small.multiply(val(200, col.UInt8)).gt(1)]) expect(totalExpression(e.ir)).toBe(true);
  // Conservative rejections worth knowing: ifNull over LowCardinality(Nullable) and a typed Param of a narrower width than the arithmetic result.
  expect(totalExpression(r.nlc.ifNull('x').ir)).toBe(false);
  expect(totalPredicate(r.small.multiply(val(200, col.UInt8)).gt(val(1, col.UInt8)).ir)).toBe(false);
  // Bare float/decimal/datetime reads are admitted as drops but never as predicate operands.
  for (const e of [r.f, r.d, r.at, r.ids]) expect(totalPredicate(e.ir)).toBe(false);
  expect(totalPredicate(r.flag.ir)).toBe(true);
  // safePredicate is exactly the narrow fragment: no arithmetic, no ifNull.
  expect(safePredicate(r.small.plus(1).gt(1).ir)).toBe(false);
  expect(safePredicate(r.text.ifNull('x').eq('x').ir)).toBe(false);
  expect(totalPredicate(r.text.ifNull('x').eq('x').ir)).toBe(true);
});

it('fences: volatile, cast, divide, known/user-origin and raw projections neither push nor merge, referenced or not', () => {
  const base = q.map(r => ({ id: r.id, raw: r.id })).ir;
  if (base.kind !== 'Project') throw new Error('shape');
  const withRaw = new Query<{ id: number; raw: number }>({ ...base, exprs: { ...base.exprs, raw: raw('rand()') } }, { live: false });
  const stacks = [
    q.map(r => ({ id: r.id.plus(1), at: now() })),
    q.map(r => ({ id: r.id.plus(1), c: cast(r.text, col.Nullable(col.UInt64)) })),
    q.map(r => ({ id: r.id.plus(1), ratio: r.n.divide(val(0n, col.Int64)) })),
    q.map(r => ({ id: r.id.plus(1), h: fn.cityHash64(r.id).as(col.UInt64) })),
    q.map(r => ({ id: r.id.plus(1), u: editDistance(r.text, 'x') })),
  ];
  // Raw with sql provenance cannot be emitted at all; check the rewrite alone. A Raw referenced once *moves* under
  // MergeProject (spec (c) only forbids duplication); it is never copied into WHERE nor dropped.
  const rawStack = withRaw.map(r => ({ id: r.id.plus(1), raw: r.raw }));
  const rawFiltered = rewriteRel(rawStack.where(r => r.id.gt(1n)).ir);
  expect(rawFiltered.hits).toMatchObject({ MergeProject: 1, PushFilterProject: 0 });
  if (rawFiltered.root.kind !== 'Filter' || rawFiltered.root.input.kind !== 'Project') throw new Error('shape');
  expect(rawFiltered.root.input.input).toBe(q.ir);
  expect(rawFiltered.root.input.exprs.raw).toBe(withRaw.ir.kind === 'Project' ? withRaw.ir.exprs.raw : undefined);
  const rawDropped = rewriteRel(rawStack.map(r => ({ id: r.id })).ir);
  expect(rawDropped.hits.MergeProject).toBe(1);
  if (rawDropped.root.kind !== 'Project' || rawDropped.root.input.kind !== 'Project') throw new Error('shape');
  expect(rawDropped.root.input.exprs.raw?.kind).toBe('Raw');
  expect(rawDropped.root.input.input).toBe(q.ir);
  for (const [i, inner] of stacks.entries()) {
    // Filter above: nothing moves (b)/(c). Outer map dropping the hazard: no merge (d).
    const filtered = inner.where(r => r.id.gt(1n));
    expect(rewrite(filtered.ir).root).toBe(filtered.ir);
    const dropped = inner.map(r => ({ id: r.id }));
    expect(rewrite(dropped.ir).root).toBe(dropped.ir);
    // Slice 3 fix round 1: the hazardous selection folds over its scan (the hash stack's `h` reads the shadowed `id`,
    // so that one keeps its scope); the narrower outer selection stays above it.
    expect(selects(compile(dropped.ir).sql)).toBe(i === 3 ? 3 : 2);
  }
  // Filter referencing the hazard itself is also blocked by (b).
  const onCast = q.map(r => ({ c: cast(r.text, col.Nullable(col.UInt64)) })).where(r => r.c.gt(1n));
  expect(rewrite(onCast.ir).root).toBe(onCast.ir);
  const onNow = q.map(r => ({ at: now(), id: r.id })).where(r => r.at.eq(r.at));
  expect(rewrite(onNow.ir).root).toBe(onNow.ir);
  // Spec (c): a single reference to now() merges (moves, never duplicates); two references do not.
  const once = q.map(r => ({ at: now(), id: r.id })).map(r => ({ when: r.at }));
  expect(rewrite(once.ir).hits.MergeProject).toBe(1);
  expect(compile(once.ir).sql.match(/now\(\)/g)).toHaveLength(1);
  const twice = q.map(r => ({ at: now(), id: r.id })).map(r => ({ a: r.at, b: r.at }));
  expect(rewrite(twice.ir).root).toBe(twice.ir);
  // Deterministic fallible expression referenced twice is duplicated by design (spec (c)); both copies keep the cast.
  const dupCast = q.map(r => ({ c: cast(r.text, col.Nullable(col.UInt64)) })).map(r => ({ a: r.c, b: r.c }));
  expect(rewrite(dupCast.ir).hits.MergeProject).toBe(1);
  expect(compile(dupCast.ir).sql.match(/CAST\(/g)).toHaveLength(2);
});

it('house invariant: a dropped output outside the fragment keeps its evaluation; a dropped total output disappears with its Params', () => {
  const kept = [
    q.map(r => ({ id: r.id, bad: cast(r.s, col.UInt64) })).map(r => ({ id: r.id })),
    q.map(r => ({ id: r.id, bad: r.n.divide(val(0n, col.Int64)) })).map(r => ({ id: r.id })),
    q.map(r => ({ id: r.id, bad: r.ids.arrayElement(val(0, col.UInt8)) })).map(r => ({ id: r.id })),
  ];
  for (const query of kept) {
    const { compiled, naive } = rewrite(query.ir);
    expect(compiled.sql).toMatch(/CAST\(|\/ \{p|arrayElement\(/);
    expect(Object.keys(compiled.params)).toEqual(Object.keys(naive.params));
  }
  // A Param-only output that is dropped removes the parameter entirely. Values are range/type-checked locally by
  // serializeParameter before either emission, so no server-only Param failure can be hidden this way.
  const dropped = q.map(r => ({ id: r.id, k: val(7, col.UInt32), big: val(-1n, col.Int64) })).map(r => ({ id: r.id }));
  const { compiled, naive } = rewrite(dropped.ir);
  expect(compiled.params).toEqual({});
  expect(naive.params).toEqual({ p0: '7', p1: '-1' });
  expect(compiled.sql).toBe('SELECT `id` FROM `adv`');
  for (const bad of [() => val(1.5, col.UInt32), () => val(-1n, col.UInt64), () => val(300, col.UInt8)]) {
    const query = q.map(r => ({ id: r.id, k: bad() })).map(r => ({ id: r.id }));
    expect(() => emitNaive(query.ir)).toThrow('param_incompatible');
    expect(() => compile(query.ir)).toThrow('param_incompatible');
  }
});

it('(a) use counts: shared inner selections through slots, Subquery in-sets and scalar subqueries are never merged and stay CTEs', () => {
  const shared = q.map(r => ({ id: r.id, total: r.n.plus(val(1n, col.Int64)) }));
  // Two Projects over the shared node, both merge-eligible on their own.
  const pair = crossJoin({ a: shared.map(r => ({ id: r.id })), b: shared.map(r => ({ total: r.total })) });
  let result = rewrite(pair.ir);
  expect(result.hits.MergeProject).toBe(0);
  expect(planCtes(result.root).definitions).toEqual([shared.ir]);
  // Same node in two slots of one Join.
  const twin = crossJoin({ a: shared, b: shared }).map(r => ({ x: r.a.id, y: r.b.total }));
  result = rewrite(twin.ir);
  expect(result.hits.MergeProject).toBe(0);
  expect(result.compiled.sql).toContain('WITH `t0` AS');
  // Shared through an IN-subquery edge and the main input.
  const inSet = shared.map(r => ({ id: r.id, total: r.total })).where(r => r.id.in(shared.map(x => ({ id: x.id }))));
  result = rewrite(inSet.ir);
  expect(result.hits.MergeProject).toBe(0);
  expect(result.compiled.sql).toContain('WITH `t0` AS');
  expect(result.compiled.sql).toContain('in(`t0`.`id`, (SELECT `t0`.`id` FROM `t0`))');
  // Shared through a scalar subquery inside the outer Project's own expressions (slot + Subquery of the same parent).
  const self = shared.map(r => ({ id: r.id, n: scalar(shared.aggregate(() => count())) }));
  result = rewrite(self.ir);
  expect(result.hits.MergeProject).toBe(0);
  expect(result.compiled.sql).toContain('WITH `t0` AS');
  // Shared through the ON predicate of a join (Subquery inside `on`).
  const onSub = join({ a: shared.map(r => ({ id: r.id })), b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, n: scalar(shared.aggregate(() => count())) }));
  result = rewrite(onSub.ir);
  expect(result.hits.MergeProject).toBe(0);
  expect(planCtes(result.root).definitions).toContain(shared.ir);
});

it('(a) same-pass staleness: an earlier arm rewriting one parent never under-counts; the next pass merges only what is then single-use', () => {
  const shared = q.map(r => ({ id: r.id, total: r.n.plus(val(1n, col.Int64)) }));
  // Parent 1 is a Filter that PushFilterProject rewrites in pass 1 (the Project copy is new); parent 2 is a Project.
  const p1 = shared.where(r => r.total.gt(5n));
  const p2 = shared.map(r => ({ id: r.id }));
  const root = crossJoin({ a: p1, b: p2 }).map(r => ({ x: r.a.id, y: r.b.id }));
  const result = rewrite(root.ir);
  // After pass 1 `shared` has a single remaining parent, so the merge is legal in pass 2 and the CTE is no longer owed.
  // (The Scan itself is now shared by two parents and becomes `t0`: pre-existing planCtes behaviour for self-joins.)
  expect(result.hits.PushFilterProject).toBe(1);
  expect(result.hits.MergeProject).toBe(1);
  expect(planCtes(result.root).definitions).toEqual([q.ir]);
  expect(result.compiled.sql).toContain('WITH `t0` AS (SELECT `id`, `n` FROM `adv`)');
  expect(result.compiled.sql).toContain('WHERE `t0`.`n` + {p0:Int64} > {p1:Int64}');
  // Shared Filter(Project) rewritten once and consumed by two Projects: the rewritten node keeps count 2 and becomes the CTE.
  const sharedFilter = shared.where(r => r.total.gt(5n));
  const diamond = crossJoin({ a: sharedFilter.map(r => ({ id: r.id })), b: sharedFilter.map(r => ({ total: r.total })) });
  const d = rewrite(diamond.ir);
  expect(d.hits.PushFilterProject).toBe(1);
  expect(d.hits.MergeProject).toBe(0);
  const defs = planCtes(d.root).definitions;
  expect(defs).toHaveLength(1);
  expect(defs[0]!.kind).toBe('Project');
  expect(d.compiled.sql).toContain('WITH `t0` AS (SELECT `id` AS `id`, `n` + {p0:Int64} AS `total` FROM `adv` WHERE `n` + {p0:Int64} > {p1:Int64})');
  // A shared *outer* Project(Project): the inner merges (single use), the merged node inherits the two parents and stays the CTE.
  const outer = q.map(r => ({ a: r.id, b: r.n })).map(r => ({ id: r.a, total: r.b.plus(val(1n, col.Int64)) }));
  const o = rewrite(crossJoin({ x: outer.map(r => ({ id: r.id })), y: outer.map(r => ({ total: r.total })) }).ir);
  expect(o.hits.MergeProject).toBe(1);
  expect(planCtes(o.root).definitions.map(r => r.kind)).toEqual(['Project']);
  expect(o.compiled.sql).toContain('WITH `t0` AS (SELECT `id` AS `id`, `n` + {p0:Int64} AS `total` FROM `adv`)');
});

it('alias shadowing: a merged or pushed alias that equals any physical column (even a pruned one) keeps its own block', () => {
  // `extra` is never read, only shadowed: since slice 3 fix round 1 an unread shadow folds (the native twin checks both alias settings).
  const pruned = q.map(r => ({ a: r.n.plus(val(1n, col.Int64)) })).map(r => ({ extra: r.a })).where(r => r.extra.gt(1n));
  let { compiled, hits } = rewrite(pruned.ir);
  expect(hits.MergeProject).toBe(1); expect(hits.PushFilterProject).toBe(1);
  expect(compiled.sql).toBe('SELECT `n` + {p0:Int64} AS `extra` FROM `adv` WHERE `n` + {p0:Int64} > {p1:Int64}');
  // Alias equals the column the pushed WHERE reads.
  const same = q.map(r => ({ n: r.n.plus(val(1n, col.Int64)) })).where(r => r.n.gt(1n));
  ({ compiled } = rewrite(same.ir));
  expect(compiled.sql).toBe('SELECT `__typedhouse_input`.`n` + {p0:Int64} AS `n` FROM (SELECT `n` FROM `adv` WHERE `n` + {p0:Int64} > {p1:Int64}) AS `__typedhouse_input`');
  // Swap then filter: the filter reads `n` while `id` is aliased to `n`.
  const swap = q.map(r => ({ id: r.n, n: r.id })).where(r => r.id.gt(1n));
  ({ compiled } = rewrite(swap.ir));
  expect(compiled.sql).toBe('SELECT `__typedhouse_input`.`n` AS `id`, `__typedhouse_input`.`id` AS `n` FROM (SELECT `id`, `n` FROM `adv` WHERE `n` > {p0:Int64}) AS `__typedhouse_input`');
  // Double swap is the identity.
  const back = q.map(r => ({ id: r.n, n: r.id })).map(r => ({ id: r.n, n: r.id }));
  ({ compiled, hits } = rewrite(back.ir));
  expect(hits.MergeProject).toBe(1);
  expect(compiled.sql).toBe('SELECT `id`, `n` FROM `adv`');
  // No shadow: folds to one SELECT with the typed Param shared between SELECT and WHERE.
  const clean = q.map(r => ({ a: r.n.plus(val(1n, col.Int64)) })).map(r => ({ b: r.a })).where(r => r.b.gt(1n));
  ({ compiled } = rewrite(clean.ir));
  expect(compiled.sql).toBe('SELECT `n` + {p0:Int64} AS `b` FROM `adv` WHERE `n` + {p0:Int64} > {p1:Int64}');
});

it('nested-input selections over joins merge and push with path-2 refs intact and ON scope binding preserved', () => {
  const other = from(table('adv2', { id: col.UInt32, k: col.Int64 }, meta));
  const joined = join({ a: q, b: other }).on(r => r.a.id.eq(r.b.id));
  const query = joined.map(r => ({ ...r.a, k: r.b.k })).map(r => ({ id: r.id, n2: r.n.plus(val(1n, col.Int64)), k: r.k })).where(r => r.n2.gt(5n).and(r.k.lt(3n)));
  const { hits, root, compiled } = rewrite(query.ir);
  expect(hits.MergeProject).toBe(1); expect(hits.PushFilterProject).toBe(1);
  // Slice 1 Finding 1, fixed in slice 2 (per-conjunct gating): the safe conjunct `b.k < 3` reaches side b while the
  // arithmetic conjunct (total, not safe) stays above the join as the residual. Flipped deliberately from `toBe(0)`.
  expect(hits.PushFilterJoin).toBe(1);
  if (root.kind !== 'Project' || root.input.kind !== 'Filter' || root.input.input.kind !== 'Join') throw new Error('shape');
  expect(root.input.input.inputs[0]![1]).toBe(q.ir);
  expect(root.input.input.inputs[1]![1].kind).toBe('Filter');
  expect(safePredicate(root.input.pred)).toBe(false);
  expect(totalPredicate(root.input.pred)).toBe(true);
  expect(references(root.input.pred).map(r => r.path)).toEqual([['a', 'n']]);
  expect(references(root.exprs.n2!).map(r => r.path)).toEqual([['a', 'n']]);
  expect(compiled.sql).toContain('INNER ALL JOIN (SELECT `id`, `k` FROM `adv2` WHERE `k` < {p1:Int64}) AS `b` ON `a`.`id` = `b`.`id` WHERE (`a`.`n` + {p0:Int64} > {p2:Int64})');
  expect(selects(compiled.sql)).toBeLessThan(selects(emitNaive(query.ir).sql));
  // The same filter written as a rename-only selection reaches both join sides.
  const renamed = joined.map(r => ({ ...r.a, k: r.b.k })).where(r => r.n.gt(5n).and(r.k.lt(3n)));
  expect(rewrite(renamed.ir).hits.PushFilterJoin).toBe(1);
  // A safe filter stacked *below* a pushed total filter now merges with it (slice 2: MergeFilter needs both total,
  // merging changes no evaluation set). Flipped deliberately from `toBe(0)`; the SQL text is unchanged.
  const stacked = q.where(r => r.id.gt(1)).map(r => ({ a: r.n.plus(val(1n, col.Int64)) })).where(r => r.a.gt(5n));
  const st = rewrite(stacked.ir);
  expect(st.hits.MergeFilter).toBe(1);
  if (st.root.kind !== 'Project' || st.root.input.kind !== 'Filter' || st.root.input.input !== q.ir) throw new Error('shape');
  expect(st.compiled.sql).toBe('SELECT `n` + {p0:Int64} AS `a` FROM `adv` WHERE `id` > {p1:UInt32} AND `n` + {p0:Int64} > {p2:Int64}');
  // Substitution never touches a path-2 ref bound to the join when the inner selection is a spread of one side.
  const spread = joined.map(r => ({ ...r.a })).map(r => ({ id: r.id }));
  const s = rewrite(spread.ir);
  expect(s.hits.MergeProject).toBe(1);
  if (s.root.kind !== 'Project') throw new Error('shape');
  expect(s.root.input).toBe(joined.ir);
  expect(references(s.root.exprs.id!).map(r => [r.rel, r.path])).toEqual([[joined.ir.id, ['a', 'id']]]);
});

it('Param identity: equal values stay distinct, a Param referenced twice keeps one name, names match naive unless an output is dropped', () => {
  const k = val(1, col.UInt32);
  const sharedParam = q.map(r => ({ a: r.id.plus(k), b: r.id.plus(k) })).map(r => ({ s: r.a.plus(r.b), t: r.a }));
  let { compiled, naive } = rewrite(sharedParam.ir);
  expect(Object.keys(compiled.params)).toEqual(['p0']);
  expect(Object.keys(naive.params)).toEqual(['p0']);
  expect(compiled.sql.match(/\{p0:UInt32\}/g)).toHaveLength(3);
  const distinct = q.map(r => ({ a: r.id.plus(val(1, col.UInt32)), b: r.id.plus(val(1, col.UInt32)) })).map(r => ({ s: r.a.plus(r.b) }));
  ({ compiled, naive } = rewrite(distinct.ir));
  expect(compiled.params).toEqual({ p0: '1', p1: '1' });
  expect(naive.params).toEqual({ p0: '1', p1: '1' });
  // The pushed WHERE and the SELECT list share the projected Param; comparison Param is new.
  const pushed = q.map(r => ({ a: r.id.plus(k) })).where(r => r.a.gt(val(2n, col.UInt64)).and(r.a.lt(val(2n, col.UInt64))));
  ({ compiled, naive } = rewrite(pushed.ir));
  expect(compiled.params).toEqual({ p0: '1', p1: '2', p2: '2' });
  expect(Object.keys(naive.params)).toEqual(['p0', 'p1', 'p2']);
  expect(compiled.parameterTypes).toEqual(naive.parameterTypes);
});

it('confluence: the three entry shapes of Filter/Project/Project reach the same SQL, and a blocked inner drop stops exactly at the fence', () => {
  const k = val(1n, col.Int64);
  const stacked = q.map(r => ({ a: r.n.plus(k), id: r.id })).map(r => ({ b: r.a, id: r.id })).where(r => r.b.gt(5n));
  const pushedFirst = q.map(r => ({ a: r.n.plus(k), id: r.id })).where(r => r.a.gt(5n)).map(r => ({ b: r.a, id: r.id }));
  const mergedFirst = q.map(r => ({ b: r.n.plus(k), id: r.id })).where(r => r.b.gt(5n));
  const sqls = [stacked, pushedFirst, mergedFirst].map(x => rewrite(x.ir).compiled.sql);
  expect(new Set(sqls).size).toBe(1);
  expect(sqls[0]).toBe('SELECT `n` + {p0:Int64} AS `b`, `id` AS `id` FROM `adv` WHERE `n` + {p0:Int64} > {p1:Int64}');
  // Inner has an unreferenced non-total output: the outer rename pushes the filter one level (fast path), then (c) stops it.
  const blocked = q.map(r => ({ a: r.n.plus(k), id: r.id, bad: r.n.divide(2n) })).map(r => ({ b: r.a, id: r.id })).where(r => r.b.gt(5n));
  const { root, hits, compiled } = rewrite(blocked.ir);
  expect(hits.MergeProject).toBe(0);
  expect(hits.PushFilterProject).toBe(1);
  if (root.kind !== 'Project' || root.input.kind !== 'Filter' || root.input.input.kind !== 'Project') throw new Error('shape');
  expect(root.input.input.input).toBe(q.ir);
  expect(compiled.sql).toContain('/ {p');
});

it('CTE and Materialize boundaries, union branches, and aggregate/distinct/sort/limit neighbours', () => {
  const k = val(1n, col.Int64);
  // .cte() between the selections is a Materialize node: no merge, WITH emitted.
  const cte = q.map(r => ({ a: r.n.plus(k), id: r.id })).cte().map(r => ({ b: r.a })).where(r => r.b.gt(1n));
  let r = rewrite(cte.ir);
  expect(r.hits.MergeProject).toBe(0);
  // The filter still crosses the outer rename onto the Materialize (legal); the Materialize itself is the fence.
  expect(r.hits.PushFilterProject).toBe(1);
  if (r.root.kind !== 'Project' || r.root.input.kind !== 'Filter') throw new Error('shape');
  expect(r.root.input.input.kind).toBe('Materialize');
  expect(r.compiled.sql).toContain('WITH `t0` AS (SELECT `n` + {p0:Int64} AS `a`, `id` AS `id` FROM `adv`)');
  // unionAll with each branch ending in two maps and a filter above: merge per branch, replicate, push.
  const left = q.map(x => ({ a: x.n.plus(k), id: x.id })).map(x => ({ v: x.a, id: x.id }));
  const right = q.map(x => ({ a: x.n.minus(k), id: x.id })).map(x => ({ v: x.a, id: x.id }));
  const u = unionAll(left, right).where(x => x.v.gt(0n));
  r = rewrite(u.ir);
  expect(r.hits).toMatchObject({ MergeProject: 2, PushFilterUnion: 1, PushFilterProject: 2 });
  expect(r.compiled.sql.match(/WHERE/g)).toHaveLength(2);
  // Project(Project(Aggregate)) merges above the aggregate; Project(Aggregate) alone is untouched.
  const agg = q.groupBy(x => ({ id: x.id })).aggregate(g => ({ total: sum(g.n) }));
  r = rewrite(agg.map(x => ({ t: x.total, id: x.id })).map(x => ({ t2: x.t.plus(k) })).ir);
  expect(r.hits.MergeProject).toBe(1);
  r = rewrite(agg.map(x => ({ t: x.total })).ir);
  expect(r.hits.MergeProject).toBe(0);
  // Sort / Limit / Distinct between the selections: never merged across; above them: merged beneath.
  for (const mid of [
    q.map(x => ({ a: x.n.plus(k), id: x.id })).orderBy(x => x.id).map(x => ({ b: x.a })),
    q.map(x => ({ a: x.n.plus(k), id: x.id })).limit(3).map(x => ({ b: x.a })),
    q.map(x => ({ a: x.n.plus(k), id: x.id })).distinct().map(x => ({ b: x.a })),
  ]) { const m = rewrite(mid.ir); expect(m.root).toBe(mid.ir); expect(m.hits.MergeProject).toBe(0); }
  for (const above of [
    q.map(x => ({ a: x.n.plus(k), id: x.id })).map(x => ({ b: x.a })).orderBy(x => x.b),
    q.map(x => ({ a: x.n.plus(k), id: x.id })).map(x => ({ b: x.a })).limit(3),
    q.map(x => ({ a: x.n.plus(k), id: x.id })).map(x => ({ b: x.a })).distinct(),
  ]) { const m = rewrite(above.ir); expect(m.hits.MergeProject).toBe(1); expect(m.root.kind).toBe(above.ir.kind); }
  // ArrayJoin between the selections.
  const aj = q.map(x => ({ ids: x.ids, id: x.id })).arrayJoin(x => x.ids, 'one').map(x => ({ one: x.one, id: x.id })).map(x => ({ o: x.one }));
  r = rewrite(aj.ir);
  expect(r.hits.MergeProject).toBe(1);
  if (r.root.kind !== 'Project') throw new Error('shape');
  expect(r.root.input.kind).toBe('ArrayJoin');
});

it('an intermediate selection whose output name equals a source column but maps another expression merges correctly', () => {
  const k = val(1n, col.Int64);
  const query = q.map(r => ({ id: r.n.plus(k), n: r.id })).map(r => ({ x: r.id, y: r.n })).where(r => r.x.gt(1n).and(r.y.lt(10)));
  const { compiled, hits } = rewrite(query.ir);
  expect(hits.MergeProject).toBe(1); expect(hits.PushFilterProject).toBe(1);
  expect(compiled.sql).toBe('SELECT `n` + {p0:Int64} AS `x`, `id` AS `y` FROM `adv` WHERE `n` + {p0:Int64} > {p1:Int64} AND `id` < {p2:UInt32}');
  // Three-level chain with a swap in the middle and a residual-free push.
  const chain = q.map(r => ({ a: r.id, b: r.n })).map(r => ({ a: r.b, b: r.a })).map(r => ({ a: r.b, b: r.a })).where(r => r.a.gt(1));
  const c = rewrite(chain.ir);
  expect(c.hits.MergeProject).toBe(2);
  expect(c.compiled.sql).toBe('SELECT `id` AS `a`, `n` AS `b` FROM `adv` WHERE `id` > {p0:UInt32}');
});

it('a manual residual split keeps the non-binding conjunct above and still merges a stacked Project beneath in the same run', () => {
  const inner = q.map(r => ({ a: r.n.plus(val(1n, col.Int64)), id: r.id })).map(r => ({ b: r.a, id: r.id }));
  const good = inner.where(r => r.b.gt(1n).and(r.id.gt(0)));
  const root = good.ir;
  if (root.kind !== 'Filter' || root.pred.kind !== 'Call' || root.pred.args[1]?.kind !== 'Call') throw new Error('shape');
  const second = root.pred.args[1];
  const foreign = { ...second, args: second.args.map(a => a.kind === 'ColumnRef' ? { ...a, rel: -1 as typeof a.rel } : a) };
  const manual = { ...root, pred: { ...root.pred, args: [root.pred.args[0]!, foreign] } } as Rel;
  const result = rewriteRel(manual);
  expect(result.hits.MergeProject).toBe(1);
  expect(result.hits.PushFilterProject).toBe(1);
  if (result.root.kind !== 'Filter' || result.root.input.kind !== 'Project' || result.root.input.input.kind !== 'Filter') throw new Error('shape');
  expect(result.root.input.input.input).toBe(q.ir);
  expect(references(result.root.pred).map(r => r.rel)).toEqual([-1]);
});

it('a total-but-unsafe pushed filter stays sound over an Aggregate (new block, never HAVING) and over an ArrayJoin alias', () => {
  const k = val(1n, col.Int64);
  const agg = q.groupBy(x => ({ id: x.id })).aggregate(g => ({ total: sum(g.n) }));
  const overAgg = agg.map(r => ({ k2: r.total.plus(k), id: r.id })).where(r => r.k2.gt(1n));
  const a = rewrite(overAgg.ir);
  expect(a.hits.PushFilterProject).toBe(1); expect(a.hits.PushFilterAggKey).toBe(0);
  if (a.root.kind !== 'Project' || a.root.input.kind !== 'Filter' || a.root.input.input.kind !== 'Aggregate') throw new Error('shape');
  expect(a.compiled.sql).not.toContain('HAVING');
  expect(a.compiled.sql).toContain('GROUP BY `__typedhouse_input`.`id`) AS `__typedhouse_input` WHERE `__typedhouse_input`.`total` + {p0:Int64} > {p1:Int64}');
  const overArray = q.arrayJoin(x => x.ids, 'one').map(r => ({ o: r.one, id: r.id.plus(k as never) })).where(r => r.o.eq('a'));
  const j = rewrite(overArray.ir);
  expect(j.hits.PushFilterProject).toBe(1); expect(j.hits.PushFilterArrayJoin).toBe(0);
  if (j.root.kind !== 'Project' || j.root.input.kind !== 'Filter' || j.root.input.input.kind !== 'ArrayJoin') throw new Error('shape');
  // Slice 2 folds the ARRAY JOIN into the scan block (alias-dependent WHERE after it); slice 3 fix round 1 folds the
  // selection too, since nothing in the block reads the shadowed `id`. Emission shape updated deliberately.
  expect(j.compiled.sql).toBe('SELECT `one` AS `o`, `id` + {p0:Int64} AS `id` FROM `adv` ARRAY JOIN `ids` AS `one` WHERE `one` = {p1:String}');
});
