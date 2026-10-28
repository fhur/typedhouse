import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@chql/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { planSelects } from '../../compiler/src/plan-selects.js';
import { validateRel } from '../../compiler/src/emit-naive.js';
import { build, recipeArbitrary, seed, shape } from './aggregate-union-arbitrary.js';
it('500 shrinkable aggregate/Union compositions preserve metadata, provenance and textual Params with actual rules/blocks', () => {
  const shapes = new Set<string>();
  let aggregate = 0, union = 0, blocks = 0;
  fc.assert(fc.property(recipeArbitrary, r => {
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
  }), { seed, numRuns: 500 });
  expect(shapes.size).toBeGreaterThan(100); expect(aggregate).toBeGreaterThanOrEqual(500); expect(union).toBeGreaterThan(100); expect(blocks).toBe(500);
}, 120000);
