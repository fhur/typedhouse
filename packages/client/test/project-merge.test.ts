import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, recipeArbitrary, seed, shape } from './project-merge-arbitrary.js';
it('generates stacked computed selections that merge and push, preserving schema and the input graph', () => {
  const hits = new Set<string>(), shapes = new Set<string>();
  fc.assert(fc.property(recipeArbitrary, recipe => {
    const snapshot = () => JSON.stringify(q.ir, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
    const q = build(recipe), before = snapshot();
    const rewritten = rewriteRel(q.ir);
    for (const [rule, n] of Object.entries(rewritten.hits)) if (n) hits.add(rule);
    shapes.add(shape(recipe));
    expect(rewriteRel(rewritten.root).root).toBe(rewritten.root);
    const a = compile(q.ir), b = emitNaive(q.ir);
    expect(a.columns).toEqual(b.columns); expect(a.nodes).toEqual(b.nodes);
    expect(Object.keys(a.params)).toEqual(Object.keys(b.params));
    expect(a.sql).not.toContain('*'); expect(compile(q.ir)).toEqual(a);
    expect(snapshot()).toBe(before);
  }), { seed, numRuns: 500 });
  expect([...hits].sort()).toEqual(['MergeFilter', 'MergeProject', 'PushFilterProject']);
  expect(shapes.size).toBeGreaterThan(150);
  const property = fc.property(recipeArbitrary, recipe => !recipe.steps.some(s => s.op === 'swap'));
  const failure = fc.check(property, { seed, numRuns: 500 });
  expect(failure.failed).toBe(true); expect(failure.numShrinks).toBeGreaterThan(0);
  expect(failure.counterexample?.[0].steps.some(s => s.op === 'swap')).toBe(true);
  const replay = fc.check(property, { seed, path: failure.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(failure.counterexample);
});
