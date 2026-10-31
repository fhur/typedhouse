import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { planSelects } from '../../compiler/src/plan-selects.js';
import { validateRel } from '../../compiler/src/emit-naive.js';
import { build, recipeArbitrary, seed, shape, type Recipe } from './aggregate-union-arbitrary.js';
// The 500 fixed-seed runs are split into chunks, and each chunk ends by yielding to the event loop: a worker that
// stays synchronous for 60 s never reads the reply to its `onTaskUpdate` RPC, which Vitest reports as an unhandled
// timeout even when every test passed (awaiting an already-settled promise between tests does not yield). A fast-check
// `path` without a shrink segment is an offset into the same seed stream (the runner drops that many generated values
// and runs `numRuns` from there, shrinking as usual), so chunk k sees exactly recipes k*chunk .. k*chunk+chunk-1 of
// the unchunked campaign; the accounting test proves it against `fc.sample`.
const runs = 500, chunk = 50;
const offsets = Array.from({ length: runs / chunk }, (_, i) => i * chunk);
const stringify = (r: Recipe) => JSON.stringify(r);
const shapes = new Set<string>(), sequence: string[] = [];
let aggregate = 0, union = 0, blocks = 0;
function property(r: Recipe) {
  const q = build(r), original = JSON.stringify(q.ir, (_, v: unknown) => typeof v === 'bigint' ? String(v) : v);
  const rewritten = rewriteRel(q.ir), a = compile(q.ir), b = emitNaive(q.ir);
  expect(a.columns).toEqual(b.columns); expect(a.columnPaths).toEqual(b.columnPaths); expect(a.nodes).toEqual(b.nodes);
  expect(compile(q.ir)).toEqual(a);
  expect(JSON.stringify(q.ir, (_, v: unknown) => typeof v === 'bigint' ? String(v) : v)).toBe(original);
  expect(rewriteRel(rewritten.root).root).toBe(rewritten.root);
  expect([...new Set([...a.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))]).toEqual(Object.keys(a.params));
  aggregate += rewritten.hits.PushFilterAggKey; union += rewritten.hits.PushFilterUnion;
  const planned = planSelects(rewritten.root, Object.values(validateRel(rewritten.root).nodes));
  blocks += Number(planned.blocks.get(rewritten.root)?.aggregate !== undefined);
  shapes.add(shape(r.composition));
  sequence.push(stringify(r));
}
const campaign = (offset: number, numRuns: number) => ({ seed, numRuns, ...(offset ? { path: String(offset) } : {}) });
const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));
for (const offset of offsets) {
  it(`runs ${offset}..${offset + chunk - 1} of ${runs} shrinkable aggregate/Union compositions preserving metadata, provenance and textual Params with actual rules/blocks`, async () => {
    fc.assert(fc.property(recipeArbitrary, property), campaign(offset, chunk));
    await yieldToEventLoop();
  });
}
it(`accounts for all ${runs} runs: the chunked sequence is the unchunked one, with the original coverage thresholds`, () => {
  expect(sequence).toHaveLength(runs);
  expect(sequence).toEqual(fc.sample(recipeArbitrary, { seed, numRuns: runs }).map(stringify));
  expect(shapes.size).toBeGreaterThan(100); expect(aggregate).toBeGreaterThanOrEqual(runs); expect(union).toBeGreaterThan(100); expect(blocks).toBe(runs);
});
it('an injected fault fails in its chunk with the unchunked campaign\'s counterexample and seed-stream path', () => {
  const stream = fc.sample(recipeArbitrary, { seed, numRuns: runs }).map(stringify);
  const target = stream[257]!, index = stream.indexOf(target);
  const faulty = fc.property(recipeArbitrary, (r: Recipe) => { if (stringify(r) === target) throw new Error('injected fault'); });
  const whole = fc.check(faulty, campaign(0, runs));
  expect(whole.failed).toBe(true);
  // The leading path segment is the seed-stream index; the rest is the shrink walk (content-equal shrinks exist
  // because the composition arbitrary maps a wider recipe), identical in both campaigns.
  expect(whole.counterexamplePath!.split(':')[0]).toBe(String(index));
  const chunked = offsets.map(offset => fc.check(faulty, campaign(offset, chunk)));
  expect(chunked.map(r => r.failed)).toEqual(offsets.map(offset => index >= offset && index < offset + chunk));
  const failing = chunked.find(r => r.failed)!;
  expect(failing.counterexamplePath).toBe(whole.counterexamplePath);
  expect(failing.counterexample).toEqual(whole.counterexample);
  expect(String(failing.errorInstance)).toContain('injected fault');
});
