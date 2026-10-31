import { expect, it } from 'vitest';
import { cast, col, count, from, join, table, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { planSelects } from '../src/plan-selects.js';

const t = table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const plan = (root: import('@typedhouse/core').Rel) => planSelects(root, Object.values(validateRel(root).nodes));

it('lowers ordered clauses into a block retaining the original scopes', () => {
  const scan = from(t);
  const filter = scan.where(r => r.id.eq(1n));
  const sort = filter.orderBy(r => r.id);
  const limit = sort.limit(10);
  const result = plan(limit.ir);
  const block = result.blocks.get(limit.ir)!;
  expect(result.root).toBe(limit.ir);
  expect(block.source).toEqual({ kind: 'table', scan: scan.ir });
  expect(block.clauses).toEqual([filter.ir, sort.ir, limit.ir]);
  expect(block.clauses[0]).toBe(filter.ir);
  expect(Object.isFrozen(block.clauses)).toBe(true);
});

it('starts a derived block for an earlier clause, then folds later clauses', () => {
  const inner = from(t).limit(5);
  const outer = inner.where(r => r.id.eq(1n)).orderBy(r => r.id).limit(2);
  const result = plan(outer.ir);
  expect(result.blocks.get(outer.ir)?.source).toEqual({ kind: 'derived', rel: inner.ir });
  expect(result.blocks.get(outer.ir)?.clauses.map(n => n.kind)).toEqual(['Filter', 'Sort', 'Limit']);
});

it('plans aggregate HAVING/order/window together but keeps reversal boundaries', () => {
  const source = from(t).where(r => r.id.gt(1n));
  const aggregate = source.groupBy(r => ({ key: r.id })).aggregate(() => ({ n: count() }));
  const filter = aggregate.where(r => r.n.gt(1n));
  const sort = filter.orderBy(r => r.n);
  const limit = sort.limit(2, 1);
  const block = plan(limit.ir).blocks.get(limit.ir)!;
  expect(block.aggregate).toBe(aggregate.ir);
  expect(block.where).toEqual([source.ir]);
  expect(block.clauses).toEqual([filter.ir, sort.ir, limit.ir]);
  const reversed = sort.where(r => r.n.gt(2n));
  expect(plan(reversed.ir).blocks.get(reversed.ir)?.source).toEqual({ kind: 'derived', rel: sort.ir });
});
it('plans expression subqueries without flattening across their scopes', () => {
  const inner = from(t).orderBy(r => r.id).limit(1);
  const outer = from(t).where(r => r.id.in(inner));
  const result = plan(outer.ir);
  expect(result.blocks.get(inner.ir)?.clauses.map(n => n.kind)).toEqual(['Sort', 'Limit']);
  expect(result.blocks.get(outer.ir)?.clauses.map(n => n.kind)).toEqual(['Filter']);
});
it('(v) folds integer arithmetic whose untyped Params resolve from an integer sibling, never from a JS default', () => {
  const events = table('events', { id: col.UInt32, small: col.UInt8, f: col.Float64, n: col.Nullable(col.Int64) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
  const nodesOf = (rel: import('@typedhouse/core').Rel): import('@typedhouse/core').Rel[] => [rel, ...('input' in rel ? nodesOf(rel.input) : [])];
  const folded = from(events).map(e => ({ eventId: e.id.plus(1) })).where(e => e.eventId.gt(100n));
  expect(compile(folded.ir).sql).toBe('SELECT `id` + {p0:UInt32} AS `eventId` FROM `events` WHERE `id` + {p0:UInt32} > {p1:UInt64}');
  expect(compile(folded.ir).params).toEqual(emitNaive(folded.ir).params);
  const positives = [
    from(events).map(e => ({ x: e.id.plus(1).minus(2n) })),
    from(events).map(e => ({ x: e.n.multiply(3n) })),
    from(events).map(e => ({ x: e.small.plus(val(1, col.UInt16)) })), // typed Param wider than the column: unchanged, typed Params were always admitted
    from(events).map(e => ({ x: e.id.plus(val(1, col.UInt32)) })),
  ];
  for (const query of positives) expect(plan(query.ir).blocks.get(query.ir)?.project, compile(query.ir).sql).toBe(query.ir);
  // Slice 3 fix round 1: Float arithmetic folds too (any selection over a scan block with Filter-only clauses);
  // the untyped Param still takes its sibling's type from the resolver, never a JS default.
  const floats = [
    from(events).map(e => ({ x: e.f.plus(1) })), // untyped Param beside a Float sibling resolves to Float64
    from(events).map(e => ({ x: e.id.plus(val(1, col.Float64)) })), // typed Float Param widens the result
    from(events).map(e => ({ x: e.f.multiply(e.f) })),
  ];
  for (const query of floats) {
    expect(plan(query.ir).blocks.get(query.ir)?.project, compile(query.ir).sql).toBe(query.ir);
    expect(compile(query.ir).parameterTypes).toEqual(emitNaive(query.ir).parameterTypes);
  }
  expect(compile(floats[0]!.ir).sql).toBe('SELECT `f` + {p0:Float64} AS `x` FROM `events`');
  // Two untyped Params have no sibling evidence: no fold is planned, and both emitters reject the graph.
  // (The builder types bare numeric constants Float64 when no column is involved; that shape is fenced as Float.)
  const untyped = structuredClone(from(events).map(e => ({ x: e.id.plus(1) })).ir);
  if (untyped.kind !== 'Project' || untyped.exprs.x?.kind !== 'Call') throw new Error('shape');
  Object.assign(untyped.exprs.x, { args: [{ ...untyped.exprs.x.args[1]!, id: -1 }, untyped.exprs.x.args[1]!] });
  for (const emitter of [compile, emitNaive]) expect(() => emitter(untyped)).toThrow('param_untyped');
  expect(compile(from(events).map(() => ({ x: val(1).plus(val(2)) })).ir).sql).toBe('SELECT {p0:Float64} + {p1:Float64} AS `x` FROM `events`');
  // A value outside the sibling's range is rejected by both emitters before any folding question arises.
  const overflow = from(events).map(e => ({ x: e.small.plus(300) }));
  for (const emitter of [compile, emitNaive]) expect(() => emitter(overflow.ir)).toThrow('param_incompatible');
});
it('slice 3b: a filter outside the total fragment never shares a WHERE or HAVING with earlier filters', () => {
  const f = table('f', { id: col.UInt64, s: col.String, k: col.String }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
  const g = table('g', { id: col.UInt64, v: col.UInt64 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
  const scan = from(f);
  const bad = (r: typeof scan.row) => cast(r.s, col.UInt64).gt(0n);
  // Earlier filters below, the fallible one above, in IR order; the first WHERE of a block folds whatever it is.
  const above = scan.where(r => r.id.ne(2n)).where(bad);
  expect(compile(above.ir).sql).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`s`, `__typedhouse_input`.`k` FROM (SELECT `id`, `s`, `k` FROM `f` WHERE `id` != {p0:UInt64}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s` AS UInt64) > {p1:UInt64}');
  expect(plan(above.ir).blocks.get(above.ir)).toMatchObject({ source: { kind: 'derived', rel: above.ir.kind === 'Filter' ? above.ir.input : undefined }, clauses: [above.ir] });
  expect(compile(scan.where(bad).ir).sql).toBe('SELECT `id`, `s`, `k` FROM `f` WHERE CAST(`s` AS UInt64) > {p0:UInt64}');
  // A total filter after the fallible one is not AND-ed into it either; a total pair still shares (MergeFilter merges it anyway).
  expect(compile(scan.where(bad).where(r => r.id.ne(2n)).ir).sql).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`s`, `__typedhouse_input`.`k` FROM (SELECT `id`, `s`, `k` FROM `f` WHERE CAST(`s` AS UInt64) > {p0:UInt64}) AS `__typedhouse_input` WHERE `__typedhouse_input`.`id` != {p1:UInt64}');
  const pair = scan.where(r => r.id.ne(2n)).where(r => r.k.eq('a'));
  expect(plan(pair.ir).blocks.get(pair.ir)?.clauses).toHaveLength(2);
  expect(compile(pair.ir).sql).toBe('SELECT `id`, `s`, `k` FROM `f` WHERE `id` != {p0:UInt64} AND `k` = {p1:String}');
  // Join block: the two-sided total residual is the join block's WHERE; the fallible filter opens a derived table over the
  // whole block, re-qualifying its references by the derived table's leaf names, and the direct selection folds above it.
  const q = compile(join({ a: from(f), b: from(g) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id })).ir);
  expect(q.sql).toBe('SELECT `__typedhouse_input`.`__typedhouse_leaf_0` AS `id` FROM (SELECT `a`.`id` AS `__typedhouse_leaf_0`, `a`.`s` AS `__typedhouse_leaf_1` FROM (SELECT `id`, `s` FROM `f`) AS `a` INNER ALL JOIN `g` AS `b` ON `a`.`id` = `b`.`id` WHERE (`a`.`id` + `b`.`v` != {p0:UInt64})) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`__typedhouse_leaf_1` AS UInt64) > {p1:UInt64}');
  // Aggregate block: a fallible HAVING over an existing HAVING opens a block whose source is the aggregate block; ORDER BY and LIMIT fold into the outer block.
  const having = scan.groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() })).where(r => r.c.gt(1n)).where(r => cast(r.k, col.UInt64).gt(1n)).orderBy(r => r.k).limit(2);
  expect(compile(having.ir).sql).toBe('SELECT `__typedhouse_input`.`k`, `__typedhouse_input`.`c` FROM (SELECT `__typedhouse_input`.`k` AS `k`, count() AS `c` FROM `f` AS `__typedhouse_input` GROUP BY `__typedhouse_input`.`k` HAVING `c` > {p0:UInt64}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`k` AS UInt64) > {p1:UInt64} ORDER BY `__typedhouse_input`.`k` ASC LIMIT 2');
  for (const query of [above, pair, having]) { expect(compile(query.ir).columns).toEqual(emitNaive(query.ir).columns); expect(Object.keys(compile(query.ir).params)).toEqual(Object.keys(emitNaive(query.ir).params)); }
});
it('records Distinct as a flag and ArrayJoin as a FROM-level member of scan blocks', () => {
  const s = table('s', { id: col.UInt64, ids: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const scan = from(s);
  const expanded = scan.where(r => r.id.gt(1n)).arrayJoin(r => r.ids, 'one');
  const query = expanded.where(r => r.one.eq('a')).distinct().orderBy(r => r.one).limit(3);
  const block = plan(query.ir).blocks.get(query.ir)!;
  expect(block.source).toEqual({ kind: 'table', scan: scan.ir });
  expect(block.arrayJoin).toBe(expanded.ir);
  expect(block.distinct?.kind).toBe('Distinct');
  expect(block.clauses.map(n => n.kind)).toEqual(['Filter', 'Filter', 'Sort', 'Limit']);
  // A second expansion, a Filter after DISTINCT and an Aggregate over an expansion each open a new block.
  const twice = expanded.arrayJoin(r => r.ids, 'two');
  expect(plan(twice.ir).blocks.get(twice.ir)).toBeUndefined();
  const filtered = scan.distinct().where(r => r.id.gt(1n));
  if (filtered.ir.kind !== 'Filter') throw new Error('shape');
  expect(plan(filtered.ir).blocks.get(filtered.ir)?.source).toEqual({ kind: 'derived', rel: filtered.ir.input });
  expect(plan(filtered.ir).blocks.get(filtered.ir.input)?.distinct).toBe(filtered.ir.input);
  // (vii) An Aggregate folds over the expanded scan block and keeps the expansion on the block.
  const grouped = expanded.groupBy(r => ({ id: r.id })).aggregate(() => ({ n: count() }));
  expect(plan(grouped.ir).blocks.get(grouped.ir)).toMatchObject({ source: { kind: 'table', scan: scan.ir }, arrayJoin: expanded.ir, aggregate: grouped.ir });
  expect(compile(grouped.ir).sql).toBe('SELECT `id`, count() AS `n` FROM `s` ARRAY JOIN `ids` AS `one` WHERE `id` > {p0:UInt64} GROUP BY `id`');
  const byAlias = expanded.groupBy(r => ({ one: r.one })).aggregate(() => ({ n: count() }));
  expect(compile(byAlias.ir).sql).toBe('SELECT `one`, count() AS `n` FROM `s` ARRAY JOIN `ids` AS `one` WHERE `id` > {p0:UInt64} GROUP BY `one`');
  const hinted = scan.final().sample(0.5).leftArrayJoin(r => r.ids, 'one').aggregate(() => ({ n: count() }));
  expect(compile(hinted.ir).sql).toBe('SELECT count() AS `n` FROM `s` FINAL SAMPLE 0.5 LEFT ARRAY JOIN `ids` AS `one`');
  for (const q of [grouped, byAlias, hinted]) { expect(compile(q.ir).columns).toEqual(emitNaive(q.ir).columns); expect(compile(q.ir).params).toEqual(emitNaive(q.ir).params); }
  // (viii) A whole-row selection folds over a DISTINCT block (the list stays the Distinct node's full leaf set, in the
  // selection's order); a narrower or renaming selection, or a consumer pruning the folded selection, never narrows it.
  const whole = scan.distinct().map(r => ({ ids: r.ids, id: r.id })).orderBy(r => r.id);
  expect(plan(whole.ir).blocks.get(whole.ir)?.distinct?.kind).toBe('Distinct');
  expect(compile(whole.ir).sql).toBe('SELECT DISTINCT `ids`, `id` FROM `s` ORDER BY `id` ASC');
  expect(compile(whole.ir).columns).toEqual(emitNaive(whole.ir).columns);
  // Stacked selections merge first (MergeProject), so the merged narrower one opens a block over the Distinct block.
  expect(compile(scan.distinct().map(r => ({ ids: r.ids, id: r.id })).map(r => ({ id: r.id })).ir).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id` FROM (SELECT DISTINCT `id`, `ids` FROM `s`) AS `__typedhouse_input`');
  expect(compile(scan.distinct().map(r => ({ ids: r.ids, id: r.id })).orderBy(r => r.id).map(r => ({ id: r.id })).ir).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id` FROM (SELECT DISTINCT `ids`, `id` FROM `s` ORDER BY `id` ASC) AS `__typedhouse_input`');
  expect(compile(scan.distinct().map(r => ({ id: r.id })).ir).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id` FROM (SELECT DISTINCT `id`, `ids` FROM `s`) AS `__typedhouse_input`');
  expect(compile(scan.distinct().map(r => ({ id: r.id, other: r.ids })).ir).sql).toContain('FROM (SELECT DISTINCT `id`, `ids` FROM `s`) AS `__typedhouse_input`');
});
