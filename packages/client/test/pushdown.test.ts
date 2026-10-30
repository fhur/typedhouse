import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, recipeArbitrary, seed } from './pushdown-arbitrary.js';
it('reconstructs shrinkable multi-operator recipes with all five actual rewrite hits', () => {
  const hits = new Set<string>();
  const shapes = new Set<string>();
  fc.assert(fc.property(recipeArbitrary, recipe => {
    const q = build(recipe);
    const rewritten = rewriteRel(q.ir);
    for (const [rule, count] of Object.entries(rewritten.hits)) if (count) hits.add(rule);
    shapes.add(`${recipe.kind}:${recipe.fence}`);
    expect(rewriteRel(rewritten.root).root).toBe(rewritten.root);
    expect(compile(q.ir).columns).toEqual(emitNaive(q.ir).columns);
  }), { seed, numRuns: 500 });
  expect([...hits].sort()).toEqual(['MergeFilter', 'MergeProject', 'PushFilterArrayJoin', 'PushFilterJoin', 'PushFilterProject']);
  expect(shapes.size).toBe(15);
});
