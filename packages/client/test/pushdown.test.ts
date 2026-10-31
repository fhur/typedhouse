import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, fails, recipeArbitrary, seed, shape, shapeCount } from './pushdown-arbitrary.js';
it('reconstructs shrinkable multi-operator recipes with all six actual rewrite hits (4b: LeftToInner)', () => {
  const hits = new Set<string>();
  const shapes = new Set<string>();
  let failing = 0, filtered = 0;
  fc.assert(fc.property(recipeArbitrary, recipe => {
    const q = build(recipe);
    const rewritten = rewriteRel(q.ir);
    for (const [rule, count] of Object.entries(rewritten.hits)) if (count) hits.add(rule);
    shapes.add(shape(recipe));
    if (fails(recipe)) failing++; else if (recipe.fallible) filtered++;
    expect(rewriteRel(rewritten.root).root).toBe(rewritten.root);
    const compiled = compile(q.ir);
    expect(compiled.columns).toEqual(emitNaive(q.ir).columns);
    // Slice 3b: the fallible filter is never AND-ed into an earlier WHERE; it reads its own derived table (or, with no
    // earlier WHERE on its block, is that block's first WHERE), and the total filters above it are not AND-ed into it.
    expect(/intDiv\(/.test(compiled.sql)).toBe(recipe.fallible);
    if (recipe.fallible) {
      expect(compiled.sql).not.toMatch(/ AND \(?intDiv\(/);
      expect(compiled.sql).not.toMatch(/intDiv\([^)]*\) > \{p\d+:UInt64\}\)? AND /);
    }
    // 4b: eight kinds share the stream; 700 runs reach every one of the 132 shapes (500 reached 129).
  }), { seed, numRuns: 700 });
  expect([...hits].sort()).toEqual(['LeftToInner', 'MergeFilter', 'MergeProject', 'PushFilterArrayJoin', 'PushFilterJoin', 'PushFilterProject']);
  expect(shapes.size).toBe(shapeCount);
  // Both outcomes of the fallible filter occur in the 500-run stream: the amount = 0 row kept (every execution fails) and removed.
  expect(failing).toBeGreaterThan(20);
  expect(filtered).toBeGreaterThan(20);
});
