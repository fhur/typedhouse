import { describe, expect, it } from 'vitest';
import { cast, col, columnExpr, count, from, join, leftJoin, max, relNode, table, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { planCtes } from '../src/plan-ctes.js';
import { pruneColumns } from '../src/prune-columns.js';
import { fallibleComputation, fallibleWithin, rewriteRel } from '../src/rewrite-rel.js';

const t = table('t', { id: col.UInt32, cat: col.String, v: col.UInt32, s: col.String, tags: col.Array(col.String) }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] });
const u = table('u', { id: col.UInt32, w: col.String }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const q = from(t);
const list = '`id`, `cat`, `v`, `s`, `tags`';
const plain = (sql: string) => sql.replaceAll('__typedhouse_input', 'i');
const sql = (query: { ir: Rel }) => plain(compile(query.ir).sql);
const naive = (query: { ir: Rel }) => plain(emitNaive(query.ir).sql);
const code = (build: () => unknown) => { try { build(); } catch (error) { return (error as { code?: string; message: string }).code ?? (error as Error).message; } return 'accepted'; };
const inner = (rel: Rel) => { if (!('input' in rel)) throw new Error(rel.kind); return rel.input; };
const guard = q.prewhere(r => r.v.gt(1));
const paths = [['compile', compile], ['emitNaive', emitNaive]] as const;

describe('rendering', () => {
  it('prints FINAL, SAMPLE, ARRAY JOIN, PREWHERE, WHERE in that order, with textual parameters', () => {
    const query = q.final().sample(0.5).prewhere(r => r.v.gt(1)).arrayJoin(r => r.tags, 'tag').where(r => r.cat.eq('x')).map(r => ({ id: r.id, k: r.tag, one: val(9, col.UInt32) }));
    const compiled = compile(query.ir);
    expect(plain(compiled.sql)).toBe('SELECT `id` AS `id`, `tag` AS `k`, {p0:UInt32} AS `one` FROM `t` AS `i` FINAL SAMPLE 0.5 ARRAY JOIN `tags` AS `tag` PREWHERE `i`.`v` > {p1:UInt32} WHERE `cat` = {p2:String}');
    expect(compiled.params).toEqual({ p0: '9', p1: '1', p2: 'x' });
  });

  it('the naive form shares one SELECT with the scan, and every enclosing node nests', () => {
    expect(naive(q.final().sample(0.5).prewhere(r => r.v.gt(1)))).toBe(`SELECT ${list} FROM \`t\` AS \`i\` FINAL SAMPLE 0.5 PREWHERE greater(\`i\`.\`v\`, {p0:UInt32})`);
    expect(naive(guard.where(r => r.cat.eq('x')))).toBe(`SELECT ${list} FROM (SELECT ${list} FROM \`t\` AS \`i\` PREWHERE greater(\`i\`.\`v\`, {p0:UInt32})) AS \`i\` WHERE (\`i\`.\`cat\` = {p1:String})`);
  });

  it.each(paths)('%s prints a non-key predicate under FINAL with no error', (_name, path) => {
    const emitted = path(q.final().prewhere(r => r.s.eq('open')).ir).sql;
    expect(emitted).toContain('FINAL PREWHERE ');
  });

  it('writes the predicate as given, conjuncts in order and not split into WHERE', () => {
    const emitted = sql(q.prewhere(r => r.s.ne('bad').and(cast(r.s, col.UInt32).gt(0))));
    expect(emitted).toBe(`SELECT ${list} FROM \`t\` AS \`i\` PREWHERE \`i\`.\`s\` != {p0:String} AND CAST(\`i\`.\`s\` AS UInt32) > {p1:UInt32}`);
    const reversed = sql(q.prewhere(r => cast(r.s, col.UInt32).gt(0).and(r.s.ne('bad'))));
    expect(reversed.indexOf('CAST')).toBeLessThan(reversed.indexOf('!='));
    expect(reversed).not.toContain('WHERE `');
  });
});

describe('every block shape keeps exactly one PREWHERE', () => {
  const shapes: readonly (readonly [string, () => { ir: Rel }, number])[] = [
    ['bare', () => guard, 1],
    ['Filter', () => guard.where(r => r.cat.eq('x')), 1],
    ['two Filters', () => guard.where(r => r.cat.eq('x')).where(r => r.id.gt(1)), 1],
    ['fallible Filter then total Filter', () => guard.where(r => cast(r.s, col.UInt32).gt(0)).where(r => r.id.gt(1)), 2],
    ['identity Project', () => guard.map(r => ({ id: r.id, v: r.v })), 1],
    ['narrow identity Project, predicate column unselected', () => guard.map(r => ({ id: r.id })), 1],
    ['computed Project', () => guard.map(r => ({ k: r.v.plus(1) })), 1],
    ['Aggregate', () => guard.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })), 1],
    ['Aggregate over Filter', () => guard.where(r => r.id.gt(1)).groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).where(r => r.c.gt(1n)), 1],
    ['Aggregate with no keys', () => guard.count(), 1],
    ['Distinct', () => guard.map(r => ({ cat: r.cat })).distinct(), 1],
    ['Distinct on the row', () => guard.distinct(), 1],
    ['Sort', () => guard.orderBy(r => r.v), 1],
    ['Limit', () => guard.limit(3, 1), 1],
    ['Limit over total Project', () => guard.map(r => ({ k: r.v.plus(1) })).limit(1), 1],
    ['LimitBy', () => guard.orderBy(r => r.id).limitBy(r => r.cat).take(1).limit(2), 1],
    ['ArrayJoin', () => guard.arrayJoin(r => r.tags, 'tag'), 1],
    ['LEFT ArrayJoin', () => guard.leftArrayJoin(r => r.tags, 'tag'), 1],
    ['Aggregate over ArrayJoin', () => guard.arrayJoin(r => r.tags, 'tag').groupBy(r => ({ tag: r.tag })).aggregate(() => ({ c: count() })), 1],
    ['Materialize', () => guard.cte(), 1],
  ];

  it.each(shapes)('%s', (_name, build, selects) => {
    const emitted = sql(build());
    expect(emitted.match(/PREWHERE/g)).toHaveLength(1);
    expect(emitted.match(/SELECT/g)).toHaveLength(selects + (_name === 'Materialize' ? 1 : 0));
    expect(naive(build()).match(/PREWHERE/g)).toHaveLength(1);
    expect(emitted).toContain('PREWHERE `i`.`v` > {p');
  });

  it('survives every non-folding wrapper', () => {
    for (const query of [
      guard.limit(1).where(r => r.id.gt(1)),
      guard.limitBy(r => r.cat).take(1).orderBy(r => r.id),
      guard.map(r => ({ k: r.v.plus(1) })).orderBy(r => r.k),
      guard.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ v: count() })),
      unionAll(guard, q),
      join({ a: guard, b: from(u) }).on(r => r.a.id.eq(r.b.id)),
      leftJoin({ a: guard }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)),
      q.where(r => r.id.in(guard.map(g => g.id))),
    ]) expect(sql(query).match(/PREWHERE/g)).toHaveLength(1);
  });

  it('a join input renders as a derived table, whatever pruning keeps', () => {
    const emitted = sql(join({ a: from(u).prewhere(r => r.id.gt(1)), b: from(u) }).on(r => r.a.id.eq(r.b.id)));
    expect(emitted).toContain('FROM (SELECT `id`, `w` FROM `u` AS `i` PREWHERE `i`.`id` > {p0:UInt32}) AS `a`');
    expect(emitted.split('\n').filter(line => line.includes('PREWHERE'))).toHaveLength(1);
    expect(sql(join({ a: from(u).prewhere(r => r.id.gt(1)), b: q }).on(r => r.a.id.eq(r.b.id)))).toMatch(/\(SELECT .* PREWHERE .*\) AS `a`/);
  });
});

describe('alias guards', () => {
  it('a computed alias equal to a predicate column keeps its own scope', () => {
    const shadow = guard.map(r => ({ v: r.v.plus(1000), id: r.id }));
    expect(sql(shadow)).toBe('SELECT `i`.`v` + {p0:UInt32} AS `v`, `i`.`id` AS `id` FROM (SELECT `id`, `v` FROM `t` AS `i` PREWHERE `i`.`v` > {p1:UInt32}) AS `i`');
  });

  it('a computed alias on another column folds', () => {
    const emitted = sql(guard.map(r => ({ cat: r.s, id: r.id })));
    expect(emitted).toBe('SELECT `s` AS `cat`, `id` AS `id` FROM `t` AS `i` PREWHERE `i`.`v` > {p0:UInt32}');
  });

  it('an expansion alias equal to a predicate column keeps its own scope', () => {
    const narrowed = q.prewhere(r => r.cat.eq('x')).map(r => ({ id: r.id, tags: r.tags })).arrayJoin(r => r.tags, 'cat');
    const emitted = sql(narrowed);
    expect(emitted).toContain('FROM (SELECT `id`, `tags` FROM `t` AS `i` PREWHERE `i`.`cat` = {p0:String}) AS `i`');
  });

  it('an expansion alias on another column folds, and so does a later predicate on it', () => {
    expect(sql(q.prewhere(r => r.cat.eq('x')).map(r => ({ id: r.id, tags: r.tags })).arrayJoin(r => r.tags, 'tag').where(r => r.tag.eq('y')))).toBe('SELECT `id`, `tags`, `tag` FROM `t` AS `i` ARRAY JOIN `tags` AS `tag` PREWHERE `i`.`cat` = {p0:String} WHERE `tag` = {p1:String}');
  });

  it('an aggregate alias equal to a source column keeps its own scope', () => {
    const emitted = sql(guard.groupBy(r => ({ cat: r.cat })).aggregate(r => ({ v: max(r.v) })));
    expect(emitted).toContain('FROM (SELECT `cat`, `v` FROM `t` AS `i` PREWHERE `i`.`v` > {p0:UInt32}) AS `i` GROUP BY');
  });

  it('hidden columns count', () => {
    const hidden = table('h', { id: col.UInt32, v: col.UInt32 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [], hiddenColumns: ['a'] });
    const named = from(hidden).prewhere(r => r.id.gt(1)).map(r => ({ a: r.v.plus(1), id: r.id }));
    expect(sql(named)).toContain('PREWHERE `i`.`id`');
  });
});

describe('rewrite passes', () => {
  it('no rule moves a Filter below it or merges into it', () => {
    const query = guard.where(r => r.cat.eq('x'));
    const { root, hits } = rewriteRel(query.ir);
    expect(root).toBe(query.ir);
    expect(Object.values(hits).every(n => n === 0)).toBe(true);
  });

  it('total Filters above merge with each other only', () => {
    const { root, hits } = rewriteRel(guard.where(r => r.cat.eq('x')).where(r => r.id.gt(1)).ir);
    expect(hits.MergeFilter).toBe(1);
    expect(root.kind).toBe('Filter');
    expect(inner(root).kind).toBe('Prewhere');
    expect(inner(inner(root)).kind).toBe('Scan');
  });

  it('a filter pushed through a Project and into a join side stops above it', () => {
    const pushed = rewriteRel(guard.map(r => ({ id: r.id })).where(r => r.id.gt(2)).ir);
    expect(pushed.hits.PushFilterProject).toBe(1);
    expect(inner(inner(pushed.root)).kind).toBe('Prewhere');
    const joined = rewriteRel(join({ a: guard, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.gt(2)).ir);
    expect(joined.hits.PushFilterJoin).toBe(1);
    const side = (joined.root as Extract<Rel, { kind: 'Join' }>).inputs[0]![1];
    expect(side.kind).toBe('Filter');
    expect(inner(side).kind).toBe('Prewhere');
  });

  it('rebuilds the node when a predicate subquery is rewritten, keeping it and its scan', () => {
    const sub = from(u).map(r => ({ id: r.id, w: r.w })).where(r => r.id.gt(1)).map(r => r.id);
    const query = q.final().prewhere(r => r.id.in(sub));
    const { root, hits } = rewriteRel(query.ir);
    expect(hits.PushFilterProject).toBeGreaterThan(0);
    if (root.kind !== 'Prewhere' || query.ir.kind !== 'Prewhere') throw new Error(root.kind);
    expect(root).not.toBe(query.ir);
    expect(root.input).toBe(query.ir.input);
    expect(sql(query)).toContain('FINAL PREWHERE in(`i`.`id`, (');
    expect(sql(query)).toContain('`id` > {p0:UInt32}');
  });

  it('a non-total predicate fences the join rules and MergeFilter, in both modes', () => {
    const fallible = q.prewhere(r => cast(r.s, col.UInt32).gt(0));
    expect(fallibleComputation(fallible.ir)).toBe(true);
    expect(fallibleWithin(fallible.ir)).toBe(true);
    expect(fallibleComputation(guard.ir)).toBe(false);
    expect(fallibleWithin(guard.ir)).toBe(false);
    expect(rewriteRel(join({ a: fallible, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x')).ir).hits.PushFilterJoin).toBe(0);
    expect(rewriteRel(leftJoin({ a: fallible }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x')).ir).hits.LeftToInner).toBe(0);
    expect(rewriteRel(fallible.where(r => r.cat.eq('x')).where(r => r.id.gt(1)).ir).hits.MergeFilter).toBe(0);
    expect(rewriteRel(leftJoin({ a: guard }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x')).ir).hits.LeftToInner).toBe(1);
  });
});

describe('CTEs', () => {
  it('a Scan shared by prewhere and where never becomes a CTE under PREWHERE', () => {
    const query = unionAll(q.prewhere(r => r.v.gt(1)), q.where(r => r.v.lt(5)));
    const ctes = planCtes(query.ir);
    expect(ctes.names.has(q.ir)).toBe(false);
    expect(sql(query)).not.toContain('WITH');
    expect(sql(query)).toContain('FROM `t` AS `i` PREWHERE');
  });

  it('when other uses do make the Scan a CTE, PREWHERE still reads the table', () => {
    const query = unionAll(q.prewhere(r => r.v.gt(1)), q.where(r => r.v.lt(5)), q.where(r => r.v.lt(6)));
    expect(planCtes(query.ir).uses.get(q.ir)).toBe(2);
    expect(planCtes(query.ir).names.has(q.ir)).toBe(true);
    const emitted = sql(query);
    expect(emitted).toContain('WITH `t0` AS (SELECT');
    expect(emitted).toContain('FROM `t` AS `i` PREWHERE');
    expect(emitted).not.toMatch(/`t0`[^(]*PREWHERE/);
  });

  it('two prewheres on one scan keep separate predicates', () => {
    const emitted = sql(unionAll(q.prewhere(r => r.v.gt(1)), q.prewhere(r => r.v.lt(5))));
    expect(emitted).not.toContain('WITH');
    expect(emitted.match(/PREWHERE/g)).toHaveLength(2);
  });

  it('a shared Prewhere becomes a CTE with its predicate inside', () => {
    const emitted = sql(unionAll(guard, guard));
    expect(emitted).toMatch(/^WITH `t0` AS \(SELECT .* FROM `t` AS `i` PREWHERE `i`.`v` > \{p0:UInt32\}\) SELECT/);
    expect(emitted.match(/PREWHERE/g)).toHaveLength(1);
    expect(planCtes(unionAll(guard, guard).ir).names.has(guard.ir)).toBe(true);
  });

  it('a subquery in the predicate is counted, and a shared one becomes a CTE', () => {
    const shared = from(u).where(r => r.id.gt(1)).map(r => r.id);
    const query = q.prewhere(r => r.id.in(shared).and(r.v.in(shared)));
    expect(planCtes(query.ir).uses.get(shared.ir)).toBe(2);
    expect(planCtes(query.ir).names.has(shared.ir)).toBe(true);
  });
});

describe('column pruning', () => {
  it('demands a column read only by the predicate from the scan', () => {
    const query = q.prewhere(r => r.v.gt(1)).map(r => ({ id: r.id }));
    const demand = pruneColumns(query.ir);
    const node = inner(query.ir);
    expect(demand.get(node)!.map(l => l.name)).toEqual(['id']);
    expect(demand.get(inner(node))!.map(l => l.name)).toEqual(['id', 'v']);
    expect(sql(query)).toBe('SELECT `id` FROM `t` AS `i` PREWHERE `i`.`v` > {p0:UInt32}');
  });
});

describe('compiler validation of hand-built IR', () => {
  const pred = q.row.v.gt(1).ir;
  const build = (input: unknown, p: unknown = pred) => relNode({ kind: 'Prewhere', input: input as Extract<Rel, { kind: 'Scan' }>, pred: p as typeof pred, output: q.ir.output });

  it.each(paths)('%s rejects an input that is not a Scan', (_name, path) => {
    const filter = q.where(r => r.v.gt(1));
    expect(code(() => path(build(filter.ir, filter.row.v.gt(1).ir)))).toBe('invalid_prewhere_input');
    const cte = q.cte();
    expect(code(() => path(build(cte.ir, cte.row.v.gt(1).ir)))).toBe('invalid_prewhere_input');
    const nested = guard;
    expect(code(() => path(build(nested.ir, nested.row.v.gt(1).ir)))).toBe('invalid_prewhere_input');
  });

  it.each(paths)('%s still rejects invalid scan hints', (_name, path) => {
    for (const bad of [0, 2, NaN]) expect(code(() => path(q.sample(bad).prewhere(r => r.v.gt(1)).ir))).toBe('invalid_scan_hint');
  });

  it.each(paths)('%s rejects a bad predicate', (_name, path) => {
    expect(code(() => path(build(q.ir, q.row.v.ir)))).toBe('invalid_predicate');
    expect(code(() => path(build(q.ir, from(t).row.v.gt(1).ir)))).toBe('unbound_column');
    const agg = max(columnExpr(col.UInt32, q.ir.id, ['v'], 'v', 'grouped')).gt(1n as never).ir;
    expect(code(() => path(build(q.ir, agg)))).toMatch(/invalid_aggregate_placement|invalid_call/);
  });

  it.each(paths)('%s rejects a changed output and malformed structure', (_name, path) => {
    const narrowed = q.map(r => ({ id: r.id }));
    expect(code(() => path(relNode({ kind: 'Prewhere', input: q.ir as Extract<Rel, { kind: 'Scan' }>, pred, output: narrowed.ir.output })))).toBe('invalid_output');
    expect(code(() => path({ ...guard.ir, pred: undefined } as unknown as Rel))).toBe('invalid_structure');
  });
});
