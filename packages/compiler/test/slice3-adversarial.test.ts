import { expect, it } from 'vitest';
import fc from 'fast-check';
import { cast, col, count, defineFunction, from, join, print, scalar, table, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { entries } from './fixtures/corpus/explain-corpus.js';
import { columnName, headerColumns, structure } from './explain-corpus-support.js';
import { recipeArbitrary, seed } from '../../client/test/aggregate-union-arbitrary.js';

// Tester probes for slice 3 (Docker-free). The native twin is packages/client/test/slice3-adversarial.integration.ts.
// Target 1: the narrowed alias-shadowing guard of the "any selection folds" arm. Target 2: the EXPLAIN harness's
// compiler-side fence clause. Target 3: the chunked aggregate-union campaign. Plus (vii)/(viii) compile-side checks.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const adv = table('adv_s3', {
  id: col.UInt32, k: col.String, n: col.Int64, s: col.String, nn: col.Nullable(col.String), lc: col.LowCardinality(col.Nullable(col.String)),
  ids: col.Array(col.String), extra: col.UInt8, alias_id: col.UInt32, tup: col.Tuple({ a: col.String, b: col.UInt8 }), parts: col.Array(col.Tuple({ id: col.String, w: col.UInt8 })),
}, meta);
const other = table('adv_s3_other', { id: col.UInt32, v: col.UInt32 }, meta);
const t = from(adv), u = from(other);
const volatile = defineFunction({ name: 'rowNumberInAllBlocks', args: [], returns: col.UInt64, deterministic: false });
const selects = (sql: string) => sql.match(/SELECT /g)?.length ?? 0;
const types = (q: ReturnType<typeof compile>) => Object.values(q.parameterTypes ?? {}).map(print).sort();
/** Same SELECT count as expected, metadata equal to naive, Param set and wire-type multiset equal to naive. */
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
  return optimized.sql;
}

it('alias guard: self-reads fold, reads by WHERE / expansion / other items fence, pruned-only shadows fold', () => {
  // Self-read with a different type, WHERE on another column: one SELECT, the alias reads its own column.
  expect(check(t.where(r => r.k.eq('a')).map(r => ({ n: cast(r.n, col.String), k: r.k })).ir, 1)).toBe('SELECT CAST(`n` AS String) AS `n`, `k` AS `k` FROM `adv_s3` WHERE `k` = {p0:String}');
  expect(check(t.where(r => r.extra.gt(7)).map(r => ({ n: r.n.plus(1n), k: r.k })).ir, 1)).toBe('SELECT `n` + {p0:Int64} AS `n`, `k` AS `k` FROM `adv_s3` WHERE `extra` > {p1:UInt8}');
  // Item B reads the column item A shadows (B is a plain rename, a comparison, a cast): fence every time.
  expect(check(t.map(r => ({ n: cast(r.k, col.UInt64), m: r.n })).ir, 2)).toContain(') AS `__typedhouse_input`');
  expect(check(t.map(r => ({ k: cast(r.n, col.String), flag: r.k.eq('a') })).ir, 2)).toContain(') AS `__typedhouse_input`');
  expect(check(t.map(r => ({ k: cast(r.n, col.String), c: cast(r.k, col.UInt64) })).ir, 2)).toContain(') AS `__typedhouse_input`');
  // Swap: both items shadow and each reads the other's column.
  expect(check(t.map(r => ({ k: r.n.plus(0n), n: cast(r.k, col.Int64) })).ir, 2)).toContain(') AS `__typedhouse_input`');
  // `n + 1 AS n, n + 2 AS m`: m reads the shadowed n (ClickHouse would make m = n + 3).
  expect(check(t.map(r => ({ n: r.n.plus(1n), m: r.n.plus(2n) })).ir, 2)).toContain(') AS `__typedhouse_input`');
  // `n + k_len AS n, k AS k`: the self-read may read other identity items' columns.
  expect(check(t.map(r => ({ id: r.id.plus(r.extra), extra: r.extra })).ir, 1)).toBe('SELECT `id` + `extra` AS `id`, `extra` AS `extra` FROM `adv_s3`');
  // Shadow of a column only the pruned-away demand would have read (`extra` is never read): folds.
  expect(check(t.where(r => r.k.eq('a')).map(r => ({ extra: cast(r.n, col.String) })).ir, 1)).toBe('SELECT CAST(`n` AS String) AS `extra` FROM `adv_s3` WHERE `k` = {p0:String}');
  // Shadow of the column the WHERE reads: fence, under both the pushed-total and the fallible form.
  expect(check(t.map(r => ({ n: r.n.plus(1n) })).where(r => r.n.gt(5n)).ir, 2)).toBe('SELECT `__typedhouse_input`.`n` + {p0:Int64} AS `n` FROM (SELECT `n` FROM `adv_s3` WHERE `n` + {p0:Int64} > {p1:Int64}) AS `__typedhouse_input`');
  expect(check(t.where(r => r.n.gt(5n)).map(r => ({ n: cast(r.id, col.Int64) })).ir, 2)).toContain(') AS `__typedhouse_input`');
  // A later WHERE on a fallible alias cannot be pushed: it opens a block above the folded selection (not a shadow question).
  expect(check(t.map(r => ({ n: cast(r.s, col.Int64) })).where(r => r.n.gt(1n)).ir, 2)).toBe('SELECT `__typedhouse_input`.`n` FROM (SELECT CAST(`s` AS Int64) AS `n` FROM `adv_s3`) AS `__typedhouse_input` WHERE `__typedhouse_input`.`n` > {p0:Int64}');
  // Sort / Limit / Distinct after the fold: Sort and Limit open a block (pre-existing `!child.project`), Distinct folds.
  expect(check(t.map(r => ({ n: cast(r.k, col.String) })).orderBy(r => r.n).ir, 2)).toContain('ORDER BY `__typedhouse_input`.`n` ASC');
  expect(check(t.map(r => ({ n: cast(r.k, col.String) })).limit(2).ir, 2)).toContain(') AS `__typedhouse_input` LIMIT 2');
  expect(check(t.where(r => r.k.eq('a')).map(r => ({ n: cast(r.k, col.String) })).distinct().ir, 1)).toBe('SELECT DISTINCT CAST(`k` AS String) AS `n` FROM `adv_s3` WHERE `k` = {p0:String}');
  // Sort folded into the child before the selection: the selection does not fold over a sorted block.
  expect(check(t.orderBy(r => r.n).map(r => ({ n: cast(r.k, col.String) })).ir, 2)).toContain('ORDER BY `n` ASC) AS `__typedhouse_input`');
});

it('alias guard: subqueries, volatile and user calls, Params, expansion aliases and expansion inputs', () => {
  const total = u.aggregate(g => ({ m: count() }));
  // A scalar-subquery item beside a shadowing self-read: the Subquery is an opaque read, so the shadow fences.
  expect(check(t.map(r => ({ n: cast(r.k, col.Int64), m: scalar(total) })).ir, 3)).toContain(') AS `__typedhouse_input`');
  // The same scalar item beside a non-shadowing alias folds (one SELECT plus the scalar's own).
  expect(check(t.map(r => ({ x: cast(r.k, col.Int64), m: scalar(total) })).ir, 2)).toBe('SELECT CAST(`k` AS Int64) AS `x`, (SELECT count() AS `m` FROM `adv_s3_other` AS `__typedhouse_input`) AS `m` FROM `adv_s3`');
  // An IN-subquery WHERE below a shadowing alias: the predicate is an opaque read of `n`, fence (the IN itself is one SELECT).
  expect(check(t.where(r => r.id.in(u.map(x => ({ id: x.id })))).map(r => ({ n: cast(r.k, col.Int64) })).ir, 3)).toContain(') AS `__typedhouse_input`');
  // The IN-subquery WHERE below a non-shadowing alias folds.
  expect(check(t.where(r => r.id.in(u.map(x => ({ id: x.id })))).map(r => ({ x: cast(r.k, col.Int64) })).ir, 2)).toMatch(/^SELECT CAST\(`k` AS Int64\) AS `x` FROM `adv_s3` WHERE in\(`id`, \(SELECT /);
  // Volatile and Param-only items fold, also under a physical alias nothing reads.
  expect(check(t.where(r => r.k.eq('a')).map(r => ({ id: r.id, n: volatile() })).ir, 1)).toBe('SELECT `id` AS `id`, rowNumberInAllBlocks() AS `n` FROM `adv_s3` WHERE `k` = {p0:String}');
  expect(check(t.where(r => r.k.eq('a')).map(r => ({ n: val(5n, col.Int64) })).ir, 1)).toBe('SELECT {p0:Int64} AS `n` FROM `adv_s3` WHERE `k` = {p1:String}');
  // Expansion: alias equal to the expansion alias, or to a column the expansion expression reads, fences; a rename of the
  // alias to an unread physical name folds; a shadow read by a WHERE after the expansion fences.
  const x = t.arrayJoin(r => r.ids, 'x');
  expect(check(x.map(r => ({ x: cast(r.id, col.String) })).ir, 2)).toContain(') AS `__typedhouse_input`');
  expect(check(x.map(r => ({ ids: cast(r.id, col.String), x: r.x })).ir, 2)).toContain(') AS `__typedhouse_input`');
  expect(check(x.map(r => ({ n: r.x })).ir, 1)).toBe('SELECT `x` AS `n` FROM `adv_s3` ARRAY JOIN `ids` AS `x`');
  expect(check(x.where(r => r.n.gt(1n)).map(r => ({ n: cast(r.x, col.String) })).ir, 2)).toContain(') AS `__typedhouse_input`');
  expect(check(x.where(r => r.x.eq('q')).map(r => ({ n: cast(r.x, col.String), x: r.x })).ir, 1)).toBe('SELECT CAST(`x` AS String) AS `n`, `x` AS `x` FROM `adv_s3` ARRAY JOIN `ids` AS `x` WHERE `x` = {p0:String}');
  // Tuple expansion with a Param in the expression and a WHERE pushed below it: Param numbering follows each text.
  const tupled = t.where(r => r.k.eq('a')).arrayJoin(r => r.ids, 'x').map(r => ({ y: cast(r.x, col.UInt64), b: r.tup.element('b') }));
  expect(check(tupled.ir, 1)).toBe('SELECT CAST(`x` AS UInt64) AS `y`, tupleElement(`tup`, {p0:String}) AS `b` FROM `adv_s3` ARRAY JOIN `ids` AS `x` WHERE `k` = {p1:String}');
  // A table-level ALIAS/MATERIALIZED column declared in the descriptor is just a name to the planner: reading it beside a
  // shadow of its underlying column folds (the native twin shows 24.8 resolves it against the table, not the alias).
  expect(check(t.map(r => ({ id: cast(r.k, col.String), alias_id: r.alias_id })).ir, 1)).toBe('SELECT CAST(`k` AS String) AS `id`, `alias_id` AS `alias_id` FROM `adv_s3`');
  expect(check(t.where(r => r.alias_id.gt(1)).map(r => ({ id: cast(r.k, col.String) })).ir, 1)).toBe('SELECT CAST(`k` AS String) AS `id` FROM `adv_s3` WHERE `alias_id` > {p0:UInt32}');
});

it('join-bound direct selections fold over Filter(Join) blocks only; computed ones and clause-bearing blocks keep a boundary', () => {
  const j = join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id));
  // Residual `lt` in WHERE with a selection whose alias equals a physical column the WHERE reads qualified: folds (qualified refs).
  const shadowed = j.where(r => r.a.id.lt(r.b.v)).map(r => ({ x: r.a.id, id: r.b.v }));
  expect(check(shadowed.ir, 2)).toBe('SELECT `a`.`id` AS `x`, `b`.`v` AS `id`\nFROM (SELECT `id` FROM `adv_s3`) AS `a`\nINNER ALL JOIN `adv_s3_other` AS `b` ON `a`.`id` = `b`.`id`\nWHERE (`a`.`id` < `b`.`v`)');
  // Two filters, one fallible (slice 3b, flipped from one shared WHERE): the total residual is the join block's WHERE, the
  // cast keeps its own SELECT over the whole block, and the direct selection folds above it.
  const twice = j.where(r => r.a.id.lt(r.b.v)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id }));
  expect(check(twice.ir, 3)).toBe('SELECT `__typedhouse_input`.`__typedhouse_leaf_0` AS `id` FROM (SELECT `a`.`id` AS `__typedhouse_leaf_0`, `a`.`s` AS `__typedhouse_leaf_3` FROM (SELECT `id`, `s` FROM `adv_s3`) AS `a` INNER ALL JOIN `adv_s3_other` AS `b` ON `a`.`id` = `b`.`id` WHERE (`a`.`id` < `b`.`v`)) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`__typedhouse_leaf_3` AS UInt64) > {p0:UInt64}');
  // Scan twin of the native "as observed" pin: the total filter below, the fallible one above, the identity selection transparent.
  expect(check(t.where(r => r.id.ne(2)).where(r => cast(r.s, col.UInt64).gt(0n)).map(r => ({ id: r.id })).ir, 2)).toBe('SELECT `__typedhouse_input`.`id` FROM (SELECT `id`, `s` FROM `adv_s3` WHERE `id` != {p0:UInt32}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s` AS UInt64) > {p1:UInt64}');
  // Computed selection over the filtered join: a boundary.
  expect(check(j.where(r => r.a.id.lt(r.b.v)).map(r => ({ next: r.a.id.plus(1) })).ir, 3)).toContain(') AS `__typedhouse_input`');
  // Sort between the filter and the selection, or after it: boundaries either side.
  expect(check(j.where(r => r.a.id.lt(r.b.v)).orderBy(r => r.a.id).map(r => ({ id: r.a.id })).ir, 3)).toContain(') AS `__typedhouse_input`');
  expect(check(j.where(r => r.a.id.lt(r.b.v)).map(r => ({ id: r.a.id })).orderBy(r => r.id).ir, 3)).toContain('ORDER BY `__typedhouse_input`.`id` ASC');
  // Selection alias equal to the CTE name of a shared input: the CTE planner renames the CTE (`t1`) and the join alias
  // colliding with a select alias gets `_`, exactly as for the spec's `sharedPart` (pre-existing collision handling).
  const shared = t.where(r => r.k.eq('a'));
  const self = join({ a: shared, b: shared }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.n.lt(r.b.n)).map(r => ({ t0: r.a.id, b: r.b.n }));
  expect(check(self.ir, 2)).toBe('WITH `t1` AS (SELECT `id`, `n` FROM `adv_s3` WHERE `k` = {p0:String})\nSELECT `a`.`id` AS `t0`, `b_`.`n` AS `b`\nFROM `t1` AS `a`\nINNER ALL JOIN `t1` AS `b_` ON `a`.`id` = `b_`.`id`\nWHERE (`a`.`n` < `b_`.`n`)');
  // The spec shape itself (ON with eq + lt, the shared scan a CTE) lands as Project(Filter(Join)) and folds; nothing moves.
  const spec = join({ a: t, b: t }).on(r => [r.a.id.eq(r.b.id), r.a.n.lt(r.b.n)]).map(r => ({ a: r.a.id, b: r.b.id }));
  expect(rewriteRel(spec.ir).hits.PushFilterJoin).toBe(0);
  expect(check(spec.ir, 2)).toContain('\nWHERE (`a_`.`n` < `b_`.`n`)');
});

it('harness: the compiler-side fence clause flags unfenced derived tables in join inputs and above sorted/filtered blocks', () => {
  const unfenced = (s: ReturnType<typeof structure>) => s.selects.filter(x => x.fence === 'unfenced').map(x => `${x.role}:${x.consumer?.kind} over ${x.rel.kind}`);
  // A join input carrying a fallible selection under a filter that cannot be pushed: the inner boundary is unfenced.
  const input = t.map(r => ({ id: r.id, v: cast(r.s, col.UInt64) })).where(r => r.v.gt(1n));
  const j = join({ a: input, b: u }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, w: r.b.v }));
  const s = structure(j.ir);
  expect(s.selects.map(x => `${x.role}:${x.rel.kind}:${x.fence}`)).toEqual(['root:Project:root', 'join-input:Filter:Join', 'derived:Project:unfenced']); // `u` is read whole: a bare table, no SELECT
  expect(selects(compile(j.ir).sql)).toBe(s.selects.length);
  // A computed selection over a filtered join block, and a selection over a filtered sorted block, are unfenced too.
  expect(unfenced(structure(join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.lt(r.b.v)).map(r => ({ next: r.a.id.plus(1) })).ir))).toEqual(['derived:Project over Filter']);
  expect(unfenced(structure(t.orderBy(r => r.id).where(r => cast(r.s, col.UInt64).gt(1n)).map(r => ({ x: cast(r.k, col.UInt64) })).ir))).toEqual(['derived:Project over Filter']);
  // Limitation (recorded, not a defect of the brief's definition): a derived table under a Sort/Limit/Aggregate consumer is
  // always classified by the consumer's kind, so the pre-existing "no clause folds above a computed selection" gap is invisible
  // to clause (i) even though spec stage 3 orders ORDER BY and LIMIT after the select list.
  for (const [q, kind] of [[t.map(r => ({ x: cast(r.k, col.UInt64) })).orderBy(r => r.x), 'Sort'], [t.map(r => ({ x: cast(r.k, col.UInt64) })).limit(1), 'Limit'],
    [t.map(r => ({ x: cast(r.k, col.UInt64) })).groupBy(r => ({ x: r.x })).aggregate(() => ({ n: count() })), 'Aggregate']] as const) {
    const st = structure(q.ir);
    expect(st.selects.map(x => x.fence)).toEqual(['root', kind]);
    expect(selects(compile(q.ir).sql)).toBe(2);
  }
  // Corpus-wide: SELECT count equality and no unfenced boundary hold for every id, and the declared fence sets are exact.
  for (const entry of entries) {
    const st = structure(entry.query.ir);
    expect(selects(compile(entry.query.ir).sql), entry.id).toBe(st.selects.length);
    expect(unfenced(st), entry.id).toEqual([]);
  }
});

it('harness: header parsing drops unqualified PREWHERE expressions silently and keeps unknown names visible', () => {
  // A PREWHERE expression header printed without analyzer qualifiers names no column at all: the read-set clause then
  // checks nothing for that entry (recorded; on 24.8 with the analyzer every expression header is `__tableN.` qualified).
  expect(headerColumns(['greater(k, 1)'], ['k'])).toEqual([]);
  expect(headerColumns(['__table1.k', '__table1.ids.size0', 'tup.a'], ['k', 'ids', 'tup'])).toEqual(['k', 'ids', 'tup']);
  expect(headerColumns(['__table1.other'], ['k'])).toEqual(['other']);
  expect(columnName('__table12.k')).toBe('k');
  expect(columnName('__tablex.k')).toBe('__tablex.k');
});

it('(vii)/(viii) compile-side: expanded aggregate blocks keep clause order and Params; whole-row selections over DISTINCT', () => {
  // FINAL and SAMPLE precede the expansion; WHERE, GROUP BY, HAVING, ORDER BY, LIMIT follow in one block.
  const expanded = t.final().sample(0.5).where(r => r.k.eq('a')).leftArrayJoin(r => r.ids, 'x').where(r => r.x.ne('z'))
    .groupBy(r => ({ x: r.x })).aggregate(() => ({ c: count() })).where(r => r.c.gt(0n)).orderBy(r => r.x).limit(5);
  expect(check(expanded.ir, 1)).toBe('SELECT `x`, count() AS `c` FROM `adv_s3` FINAL SAMPLE 0.5 LEFT ARRAY JOIN `ids` AS `x` WHERE `k` = {p0:String} AND `x` != {p1:String} GROUP BY `x` HAVING `c` > {p2:UInt64} ORDER BY `x` ASC LIMIT 5');
  // An expansion expression carrying a Param beside a WHERE below it: the folded text allocates the expansion Param
  // before the WHERE Param, the naive text the other way round (each text numbers by first appearance; types agree).
  const paramExpansion = t.where(r => r.k.eq('a')).arrayJoin(r => r.parts.element('id'), 'x').groupBy(r => ({ x: r.x })).aggregate(() => ({ c: count() }));
  const sql = check(paramExpansion.ir, 1);
  expect(sql).toBe('SELECT `x`, count() AS `c` FROM `adv_s3` ARRAY JOIN tupleElement(`parts`, {p0:String}) AS `x` WHERE `k` = {p1:String} GROUP BY `x`');
  expect(compile(paramExpansion.ir).params).toEqual({ p0: 'id', p1: 'a' });
  expect(emitNaive(paramExpansion.ir).params).toEqual({ p0: 'a', p1: 'id' });
  // Aggregate alias shadowing a physical column (non-identity) or the expansion alias keeps the explicit scope.
  expect(check(t.arrayJoin(r => r.ids, 'x').groupBy(r => ({ k: r.x })).aggregate(() => ({ c: count() })).ir, 2)).toContain(') AS `__typedhouse_input` GROUP BY');
  expect(check(t.arrayJoin(r => r.ids, 'x').aggregate(() => ({ n: count() })).ir, 2)).toContain(') AS `__typedhouse_input`');
  // Aggregate over an expanded block that carries a selection: a boundary (the selection is the block's list).
  expect(check(t.arrayJoin(r => r.ids, 'x').map(r => ({ x: r.x, w: cast(r.k, col.UInt64) })).groupBy(r => ({ x: r.x })).aggregate(() => ({ c: count() })).ir, 2)).toContain(') AS `__typedhouse_input`');
  // (viii) whole-row over an expanded DISTINCT block, reordered; the DISTINCT list is every leaf in the selection's order.
  const whole = t.arrayJoin(r => r.ids, 'x').distinct().map(r => ({ x: r.x, extra: r.extra, id: r.id, k: r.k, n: r.n, s: r.s, nn: r.nn, lc: r.lc, ids: r.ids, alias_id: r.alias_id, tup: r.tup, parts: r.parts })).orderBy(r => r.x).limit(2);
  expect(check(whole.ir, 1)).toBe('SELECT DISTINCT `x`, `extra`, `id`, `k`, `n`, `s`, `nn`, `lc`, `ids`, `alias_id`, `tup`, `parts` FROM `adv_s3` ARRAY JOIN `ids` AS `x` ORDER BY `x` ASC LIMIT 2');
  // A whole-row selection whose key count matches but misses a leaf cannot exist (keys must be identities); a narrower one opens a block.
  expect(check(t.arrayJoin(r => r.ids, 'x').distinct().map(r => ({ x: r.x, id: r.id })).ir, 2)).toContain('FROM (SELECT DISTINCT ');
});

it('chunked campaign: fast-check path offsets reproduce the unchunked seed stream exactly and replay from the owning chunk', () => {
  const whole = fc.sample(recipeArbitrary, { seed, numRuns: 500 }).map(r => JSON.stringify(r));
  for (let offset = 0; offset < 500; offset += 50) {
    const chunk = fc.sample(recipeArbitrary, { seed, numRuns: 50, ...(offset ? { path: String(offset) } : {}) }).map(r => JSON.stringify(r));
    expect(chunk, String(offset)).toEqual(whole.slice(offset, offset + 50));
  }
  // A fault at stream index 123 is found by chunk 100..149 at the same leading path segment, and fc.check with that path
  // replays the same counterexample (the replay semantics the sibling suites rely on).
  const target = whole[123]!;
  const faulty = fc.property(recipeArbitrary, r => { if (JSON.stringify(r) === target) throw new Error('injected'); });
  const owning = fc.check(faulty, { seed, numRuns: 50, path: '100' });
  expect(owning.failed).toBe(true);
  expect(owning.counterexamplePath!.split(':')[0]).toBe(String(whole.indexOf(target)));
  const replay = fc.check(faulty, { seed, numRuns: 1, path: owning.counterexamplePath! });
  expect(replay.failed).toBe(true);
  expect(replay.counterexample).toEqual(owning.counterexample);
  for (const offset of [0, 50, 150]) expect(fc.check(faulty, { seed, numRuns: 50, ...(offset ? { path: String(offset) } : {}) }).failed).toBe(false);
});
