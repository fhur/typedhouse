import { expect, it } from 'vitest';
import fc from 'fast-check';
import { recipeArbitrary, seed } from './aggregate-union-arbitrary.js';
import { assertAggregateUnionAccounting } from './aggregate-union-accounting.js';

const complete = { shapes: 392, agg: 500, union: 1000 };
it('requires all 500 default runs and every coverage threshold, even with an empty path', () => {
  for (const path of [undefined, '']) {
    for (let runs = 0; runs < 500; runs++) {
      expect(() => assertAggregateUnionAccounting(runs, path, complete)).toThrow();
    }
    expect(assertAggregateUnionAccounting(500, path, complete)).toBe('full-500');
    for (const coverage of [{ ...complete, shapes: 100 }, { ...complete, agg: 499 }, { ...complete, union: 100 }]) {
      expect(() => assertAggregateUnionAccounting(500, path, coverage)).toThrow();
    }
  }
});
it('accounts for the real recipe arbitrary shrink path without claiming full acceptance', async () => {
  let calls = 0;
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async () => { calls++; }), { seed, path: '6:0', numRuns: 500 });
  expect(result.failed).toBe(false);
  expect(result.numRuns).toBe(68);
  expect(calls).toBe(result.numRuns);
  expect(assertAggregateUnionAccounting(result.numRuns, '6:0', { shapes: 14, agg: 68, union: 278 })).toBe('replay-only');
  for (const runs of [0, 501, NaN, 1.5]) expect(() => assertAggregateUnionAccounting(runs, '6:0', complete)).toThrow();
});
it('rejects malformed and unreachable shrink paths rather than accepting an empty replay', async () => {
  for (const path of ['not-a-path', '6:999999']) {
    await expect(async () => {
      const result = await fc.check(fc.asyncProperty(recipeArbitrary, async () => {}), {
        seed, path, numRuns: 500,
      });
      assertAggregateUnionAccounting(result.numRuns, path, complete);
    }).rejects.toThrow();
  }
});
it('retains property errors in normal and replay streams without discarding failures', async () => {
  const failure = new Error('injected execution failure');
  for (const path of [undefined, '6:0']) {
    const result = await fc.check(fc.asyncProperty(recipeArbitrary, async () => { throw failure; }), {
      seed, numRuns: 500, ...(path ? { path } : {}),
    });
    expect(result.failed).toBe(true);
    expect(result.errorInstance).toBe(failure);
    expect(result.numSkips).toBe(0);
    expect(result.counterexample).not.toBeNull();
  }
});
