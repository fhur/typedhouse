import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, expansionFolds, foldsToOneSelect, recipeArbitrary, seed, shape } from './array-join-blocks-arbitrary.js';
const selects = (sql: string) => sql.match(/SELECT /g)?.length ?? 0;
it('generates expansion recipes whose planned shape matches the fold rule, preserving schema and the input graph', () => {
  const hits = new Set<string>(), shapes = new Set<string>();
  let folded = 0;
  fc.assert(fc.property(recipeArbitrary, recipe => {
    const q = build(recipe);
    const snapshot = () => JSON.stringify(q.ir, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
    const before = snapshot();
    const rewritten = rewriteRel(q.ir);
    for (const [rule, n] of Object.entries(rewritten.hits)) if (n) hits.add(rule);
    shapes.add(shape(recipe));
    expect(rewriteRel(rewritten.root).root).toBe(rewritten.root);
    const a = compile(q.ir), b = emitNaive(q.ir);
    expect(a.columns).toEqual(b.columns); expect(a.nodes).toEqual(b.nodes);
    expect(Object.keys(a.params)).toEqual(Object.keys(b.params));
    expect(a.sql).not.toContain('*'); expect(compile(q.ir)).toEqual(a);
    expect(a.sql.match(/ARRAY JOIN/g)).toHaveLength(1);
    expect(a.sql.includes('DISTINCT')).toBe(recipe.fence === 'distinct');
    // A folded block writes the user alias verbatim after a bare FROM; otherwise the nested emission stays.
    expect(/FROM `array_join_items` (LEFT )?ARRAY JOIN (`ids`|tupleElement\(`parts`, \{p\d+:String\}\)) AS `part`/.test(a.sql), a.sql).toBe(expansionFolds(recipe));
    expect(a.sql.includes('AS `__typedhouse_element`'), a.sql).toBe(!expansionFolds(recipe));
    expect(selects(a.sql) === 1, a.sql).toBe(foldsToOneSelect(recipe));
    if (selects(a.sql) === 1) folded++;
    expect(snapshot()).toBe(before);
  }), { seed, numRuns: 500 });
  expect([...hits].sort()).toEqual(['MergeFilter', 'PushFilterArrayJoin']);
  expect(shapes.size).toBeGreaterThan(200);
  expect(folded).toBeGreaterThan(100);
  const property = fc.property(recipeArbitrary, recipe => recipe.left || recipe.before !== 'unsafe');
  const failure = fc.check(property, { seed, numRuns: 500 });
  expect(failure.failed).toBe(true); expect(failure.numShrinks).toBeGreaterThan(0);
  const replay = fc.check(property, { seed, path: failure.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(failure.counterexample);
});
