import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { pruneColumns } from '../../compiler/src/prune-columns.js';
import { build, recipeArbitrary, seed, topology } from './pruning-arbitrary.js';
it('generates variable nested/shared recipes, preserves schema and genuinely shrinks topology', () => {
  const shapes = new Set<string>();
  fc.assert(fc.property(recipeArbitrary, recipe => {
    const q = build(recipe);
    const a = compile(q.ir), b = emitNaive(q.ir);
    expect(a.columns).toEqual(b.columns); expect(a.columnPaths).toEqual(b.columnPaths);
    expect(a.sql).not.toContain('*'); expect(compile(q.ir)).toEqual(a);
    expect([...pruneColumns(q.ir).values()].every(leaves => leaves.length > 0)).toBe(true);
    shapes.add(topology(recipe.tree));
  }), { seed, numRuns: 500 });
  expect(shapes.size).toBeGreaterThan(50);
  const property = fc.property(recipeArbitrary, recipe => !topology(recipe.tree).includes('shared'));
  const failure = fc.check(property, { seed, numRuns: 500 });
  expect(failure.failed).toBe(true); expect(failure.numShrinks).toBeGreaterThan(0);
  const replay = fc.check(property, { seed, path: failure.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(failure.counterexample);
});
