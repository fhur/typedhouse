import { expect, it } from 'vitest';
import fc from 'fast-check';
import { prefetchedCheck, ciLimit, ciMaxExecutionTime, prefetchConcurrency } from './prefetch-check.js';
import { resultsContract } from './results-contract.js';
import * as aggregateUnion from './aggregate-union-arbitrary.js';
import * as cte from './cte-arbitrary.js';
import * as joinBlock from './join-block-arbitrary.js';
import * as outerJoin from './outer-join-arbitrary.js';
import * as pruning from './pruning-arbitrary.js';
import * as pushdown from './pushdown-arbitrary.js';

// Slice 4d item 0 (Docker-free): `prefetchedCheck` must run exactly the campaign `fc.check` runs.
const campaigns: [string, fc.Arbitrary<unknown>, number, number][] = [
  ['aggregate-union', aggregateUnion.recipeArbitrary, aggregateUnion.seed, 500],
  ['cte', cte.recipeArbitrary, cte.seed, 500],
  ['join-block colliding', joinBlock.colliding, joinBlock.seed, 500],
  ['outer-join', outerJoin.recipes, outerJoin.seed, 500],
  ['pruning', pruning.recipeArbitrary, pruning.seed, 500],
  ['pushdown', pushdown.recipeArbitrary, pushdown.seed, 700],
];
it.each(campaigns)('%s: the prefetched stream equals fc.check\'s, every value is asserted once, in order', async (_, arbitrary, seed, numRuns) => {
  const options = { seed, numRuns };
  const live: string[] = [];
  const reference = await fc.check(fc.asyncProperty(arbitrary, async v => { live.push(fc.stringify(v)); }), options);
  const evaluated: string[] = [], asserted: string[] = [];
  const { result, prefetched } = await prefetchedCheck(arbitrary, options, async v => { evaluated.push(fc.stringify(v)); return fc.stringify(v); }, (v, e) => {
    expect(e).toBe(fc.stringify(v)); asserted.push(e);
  });
  expect(result.failed).toBe(false); expect(reference.failed).toBe(false);
  expect(result.numRuns).toBe(numRuns);
  expect(asserted).toEqual(live);
  // Duplicates are evaluated live on their second occurrence; everything else came from the cache.
  expect(prefetched).toBe(new Set(live).size);
  expect(evaluated.length).toBe(numRuns);
}, 120000);

it('a failure is reported at its own run, shrinks and replays live, with an evaluation failure rethrown like a live one', async () => {
  const arbitrary = fc.integer({ min: 0, max: 1000 });
  const options = { seed: 42, numRuns: 200 };
  const failing = (n: number) => n > 500;
  const reference = await fc.check(fc.asyncProperty(arbitrary, async n => { if (failing(n)) throw new Error('big'); }), options);
  for (const where of ['property', 'evaluate'] as const) {
    const { result } = await prefetchedCheck(arbitrary, options,
      async n => { if (where === 'evaluate' && failing(n)) throw new Error('big'); return n; },
      n => { if (where === 'property' && failing(n)) throw new Error('big'); });
    expect(result.failed, where).toBe(true);
    expect(result.counterexample, where).toEqual(reference.counterexample);
    expect(result.counterexamplePath, where).toBe(reference.counterexamplePath);
    expect(result.numShrinks, where).toBe(reference.numShrinks);
    const replay = await prefetchedCheck(arbitrary, { ...options, path: result.counterexamplePath! }, async n => n, n => { if (failing(n)) throw new Error('big'); });
    expect(replay.prefetched, where).toBe(0);
    expect(replay.result.counterexample, where).toEqual(reference.counterexample);
  }
});

it('ciLimit doubles an explicit limit only under CI=true', () => {
  const saved = process.env.CI;
  try {
    delete process.env.CI; expect(ciLimit(180000)).toBe(180000);
    for (const value of ['false', '0', '', '1', 'TRUE']) { process.env.CI = value; expect(ciLimit(180000), value).toBe(180000); }
    process.env.CI = 'true'; expect(ciLimit(180000)).toBe(360000);
  } finally { if (saved === undefined) delete process.env.CI; else process.env.CI = saved; }
});

it('slice 4f item 0: prefetch concurrency and the per-query server limit change only under CI=true', async () => {
  const os = await import('node:os');
  // Locally (CI unset or anything but 'true'): 8 at a time and the suite's own limit, whatever the host.
  for (const env of [{}, { CI: 'false' }, { CI: '1' }, { CI: 'TRUE' }, { CI: '' }] as NodeJS.ProcessEnv[]) {
    for (const cpus of [1, 2, 4, 16]) expect(prefetchConcurrency(env, cpus), JSON.stringify(env)).toBe(8);
    expect(ciMaxExecutionTime(10, env)).toBe(10);
    expect(ciMaxExecutionTime(20, env)).toBe(20);
  }
  const ci = { CI: 'true' } as NodeJS.ProcessEnv;
  expect([1, 2, 4, 8, 16, 64].map(cpus => prefetchConcurrency(ci, cpus))).toEqual([1, 2, 4, 8, 8, 8]);
  expect(prefetchConcurrency(ci, 0)).toBe(1); // never zero workers
  expect(ciMaxExecutionTime(10, ci)).toBe(30);
  expect(ciMaxExecutionTime(60, ci)).toBe(60); // never lowers a suite's own limit
  // Defaults read the real environment and host.
  const saved = process.env.CI;
  try {
    delete process.env.CI; expect(prefetchConcurrency()).toBe(8); expect(ciMaxExecutionTime(10)).toBe(10);
    process.env.CI = 'true'; expect(prefetchConcurrency()).toBe(Math.min(8, os.availableParallelism())); expect(ciMaxExecutionTime(10)).toBe(30);
  } finally { if (saved === undefined) delete process.env.CI; else process.env.CI = saved; }
});

it('slice 4f item 0: a lower concurrency runs exactly the same campaign (stream, order, failure, shrink)', async () => {
  const arbitrary = fc.integer({ min: 0, max: 1000 }), options = { seed: 42, numRuns: 200 };
  const reference = await fc.check(fc.asyncProperty(arbitrary, async n => { if (n > 500) throw new Error('big'); }), options);
  for (const concurrency of [1, 2, 4, 8]) {
    const asserted: number[] = [];
    const passing = await prefetchedCheck(arbitrary, options, async n => n, n => { asserted.push(n); }, concurrency);
    expect(passing.result.failed).toBe(false);
    expect(asserted).toEqual(fc.sample(arbitrary, options));
    const { result } = await prefetchedCheck(arbitrary, options, async n => n, n => { if (n > 500) throw new Error('big'); }, concurrency);
    expect(result.counterexample, String(concurrency)).toEqual(reference.counterexample);
    expect(result.counterexamplePath, String(concurrency)).toBe(reference.counterexamplePath);
    expect(result.numShrinks, String(concurrency)).toBe(reference.numShrinks);
  }
});

it('resultsContract: results-only error contract (user ruling, slice 4d follow-up)', () => {
  const rows = { data: [[1]], meta: ['UInt8'] }, other = { data: [[2]], meta: ['UInt8'] }, failed = { error: '6' };
  expect(resultsContract(rows, rows)).toEqual({ ok: true, kind: 'equal' });
  expect(resultsContract(other, rows).ok).toBe(false); // rows differ where naive succeeds
  expect(resultsContract({ data: [[1]], meta: ['UInt16'] }, rows).ok).toBe(false); // types differ
  expect(resultsContract(failed, rows).ok).toBe(false); // never fail where naive succeeds
  expect(resultsContract(failed, failed)).toEqual({ ok: true, kind: 'both-failed' });
  expect(resultsContract(rows, failed, rows)).toEqual({ ok: true, kind: 'oracle-rows' });
  expect(resultsContract(rows, failed, other).ok).toBe(false); // not the guard-first rows
  expect(resultsContract(rows, failed).ok).toBe(false); // no oracle given
  expect(resultsContract(rows, failed, failed).ok).toBe(false); // the guard-first evaluation fails too
});
