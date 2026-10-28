import { expect, it } from 'vitest';
import { col, count, from, table } from '@chql/core';
import { validateRel } from '../src/emit-naive.js';
import { planSelects } from '../src/plan-selects.js';

const t = table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const plan = (root: import('@chql/core').Rel) => planSelects(root, Object.values(validateRel(root).nodes));

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
