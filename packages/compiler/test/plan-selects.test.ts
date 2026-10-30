import { expect, it } from 'vitest';
import { col, count, from, table, val } from '@typedhouse/core';
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
  const negatives = [
    from(events).map(e => ({ x: e.f.plus(1) })), // untyped Param beside a Float sibling resolves to Float64
    from(events).map(e => ({ x: e.id.plus(val(1, col.Float64)) })), // typed Float Param widens the result
    from(events).map(e => ({ x: e.f.multiply(e.f) })),
  ];
  for (const query of negatives) {
    expect(plan(query.ir).blocks.get(query.ir), compile(query.ir).sql).toBeUndefined();
    expect(compile(query.ir).sql).toContain(') AS `__typedhouse_input`');
  }
  // Two untyped Params have no sibling evidence: no fold is planned, and both emitters reject the graph.
  // (The builder types bare numeric constants Float64 when no column is involved; that shape is fenced as Float.)
  const untyped = structuredClone(from(events).map(e => ({ x: e.id.plus(1) })).ir);
  if (untyped.kind !== 'Project' || untyped.exprs.x?.kind !== 'Call') throw new Error('shape');
  Object.assign(untyped.exprs.x, { args: [{ ...untyped.exprs.x.args[1]!, id: -1 }, untyped.exprs.x.args[1]!] });
  expect(planSelects(untyped, nodesOf(untyped)).blocks.get(untyped)).toBeUndefined();
  for (const emitter of [compile, emitNaive]) expect(() => emitter(untyped)).toThrow('param_untyped');
  expect(compile(from(events).map(() => ({ x: val(1).plus(val(2)) })).ir).sql).toContain(') AS `__typedhouse_input`');
  // A value outside the sibling's range is rejected by both emitters before any folding question arises.
  const overflow = from(events).map(e => ({ x: e.small.plus(300) }));
  for (const emitter of [compile, emitNaive]) expect(() => emitter(overflow.ir)).toThrow('param_incompatible');
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
  const grouped = expanded.groupBy(r => ({ id: r.id })).aggregate(() => ({ n: count() }));
  expect(plan(grouped.ir).blocks.get(grouped.ir)?.source.kind).toBe('derived');
});
