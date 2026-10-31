import { expect, it } from 'vitest';
import { col, count, from, sum, table } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { emitPlanned } from '../src/emit-naive.js';
import { planSelects } from '../src/plan-selects.js';

const q = from(table('review_numbers', { n: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('preserves disjunction grouping across separately folded Float64 filters', () => {
  // Float predicates deliberately stay outside the logical totality envelope.
  // n=1 must be removed by the second filter, not admitted by the first OR arm.
  // Slice 3b: neither Float predicate is total, so the second keeps its own SELECT over the first (never one AND-ed WHERE).
  const query = q.where(r => r.n.eq(1).or(r.n.eq(2))).where(r => r.n.gt(1));
  expect(compile(query.ir).sql).toBe('SELECT `__typedhouse_input`.`n` FROM (SELECT `n` FROM `review_numbers` WHERE `n` = {p0:Float64} OR `n` = {p1:Float64}) AS `__typedhouse_input` WHERE `__typedhouse_input`.`n` > {p2:Float64}');
  expect(compile(query.ir).params).toEqual(emitNaive(query.ir).params);
});

it('rejects a prototype-less operand both statically and at runtime', () => {
  // The precise TS2769 assertion lives in negative/expressions/z-operand-copy.ts.
  // @ts-expect-error Deliberately execute the invalid JavaScript caller case too.
  const query = q.map(r => ({ n: r.n.plus({ ...r.n }) }));
  expect(() => compile(query.ir)).toThrow('param_incompatible');
});

it('preserves separately planned HAVING disjunctions without relying on MergeFilter', () => {
  const query = q.aggregate(() => ({ tally: count() }))
    .where(r => r.tally.eq(1n).or(r.tally.eq(2n)))
    .where(r => r.tally.gt(1n));
  // Exercise physical clause composition before the optional logical merge.
  expect(emitPlanned(planSelects(query.ir, [query.ir])).sql).toBe('SELECT count() AS `tally` FROM `review_numbers` AS `__typedhouse_input` HAVING (`tally` = {p0:UInt64} OR `tally` = {p1:UInt64}) AND `tally` > {p2:UInt64}');
});

it('does not wrap a single OR clause unnecessarily', () => {
  expect(compile(q.where(r => r.n.eq(1).or(r.n.eq(2))).ir).sql).toBe('SELECT `n` FROM `review_numbers` WHERE `n` = {p0:Float64} OR `n` = {p1:Float64}');
});

it('preserves OR on either side of aggregate source WHERE conjunctions', () => {
  const query = q.where(r => r.n.eq(1).or(r.n.eq(2)))
    .where(r => r.n.gt(1).or(r.n.lt(0)))
    .aggregate(g => ({ total: sum(g.n) }));
  // Slice 3b: the second Float disjunction keeps its own SELECT over the first; the aggregate reads the derived table.
  expect(compile(query.ir).sql).toBe('SELECT sum(`__typedhouse_input`.`n`) AS `total` FROM (SELECT `__typedhouse_input`.`n` FROM (SELECT `n` FROM `review_numbers` WHERE `n` = {p0:Float64} OR `n` = {p1:Float64}) AS `__typedhouse_input` WHERE `__typedhouse_input`.`n` > {p2:Float64} OR `__typedhouse_input`.`n` < {p3:Float64}) AS `__typedhouse_input`');
  expect(compile(query.ir).params).toEqual(emitNaive(query.ir).params);
});
