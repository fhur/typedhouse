import { expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { type Backend } from '../src/index.js';
import { differential } from './backend-harness.js';
import { anchors, build, recipeArbitrary, seed, topology, type Tree } from './differential-arbitrary.js';
function depth(t: Tree): number {
  if ('input' in t) return 1 + depth(t.input);
  return t.op === 'union' ? 1 + Math.max(depth(t.left), depth(t.right)) : 0;
}
it('reconstructs deterministic serializable, descriptor-aligned bounded topologies', () => {
  const recipes = fc.sample(recipeArbitrary, { seed, numRuns: 60 });
  expect(recipes).toEqual(fc.sample(recipeArbitrary, { seed, numRuns: 60 }));
  expect(new Set(recipes.map(r => topology(r.tree))).size).toBeGreaterThan(5);
  const shapes = recipes.map(r => topology(r.tree));
  for (const operator of ['scan', 'join', 'filter(', 'project(', 'distinct(', 'union(']) {
    expect(shapes.some(shape => shape.includes(operator)), operator).toBe(true);
  }
  expect(recipes.some(r => depth(r.tree) === 2)).toBe(true);
  expect(shapes.some(shape => /union\(union\(/.test(shape))).toBe(true);
  expect(new Set(recipes.map(r => r.end))).toEqual(new Set(['bag', 'limit', 'rollup']));
  for (const recipe of [...anchors, ...recipes]) {
    expect(depth(recipe.tree) + (recipe.end === 'bag' ? 0 : 1)).toBeLessThanOrEqual(3);
    const q = build(recipe);
    expect(compile(build(JSON.parse(JSON.stringify(recipe))).ir).sql).toEqual(compile(q.ir).sql);
    expect(compile(q.ir).columns).toEqual(emitNaive(q.ir).columns);
  }
});
it('checks order only when promised and rejects schema drift', async () => {
  const a = { tenant: 'acme', id: 'a', category: null, ids: [], at: new Date('2024-03-11'), amount: 2n };
  const b = { ...a, id: 'b' };
  const forward: Backend = { name: 'forward', compile: rel => ({ compiled: compile(rel) }), async *run() { yield [a, b]; } };
  const reverse: Backend = { ...forward, name: 'reverse', async *run() { yield [b, a]; } };
  const query = build(anchors[0]!);
  await expect(differential([forward, reverse], query)).resolves.toEqual([a, b]);
  await expect(differential([forward, reverse], query, true)).rejects.toThrow('ordered sequence');
  const wrongSchema: Backend = { ...forward, name: 'wrong-schema', compile: rel => ({ compiled: { ...compile(rel), columns: {} } }) };
  await expect(differential([forward, wrongSchema], query)).rejects.toThrow('output descriptors');
});
it('retains both plans and parameter values when execution fails', async () => {
  const good: Backend = { name: 'planned', compile: rel => ({ compiled: compile(rel) }), async *run() { yield []; } };
  const broken: Backend = { name: 'naive-fails', compile: rel => ({ compiled: emitNaive(rel) }), async *run() { throw new Error('injected execution failure'); } };
  const query = build(anchors[0]!);
  let message = '';
  try { await differential([good, broken], query); }
  catch (error) { message = String(error); }
  expect(message).toContain('naive-fails: Error: injected execution failure');
  for (const backend of [good, broken]) {
    const { sql, params } = backend.compile(query.ir).compiled;
    expect(message).toContain(JSON.stringify(sql));
    expect(message).toContain(JSON.stringify(params));
  }
});
it('detects duplicate loss in a test-only backend, shrinks and exactly replays the failing recipe', async () => {
  const row = { tenant: 'acme', id: 'a', category: null, ids: [], at: new Date('2024-03-11'), amount: 2n };
  const good: Backend = { name: 'reference', compile: rel => ({ compiled: compile(rel) }), async *run() { yield [row, row]; } };
  const faulty: Backend = { name: 'faulty-drops-duplicate', compile: emitNaivePlan, async *run() { yield [row]; } };
  function emitNaivePlan(rel: Parameters<Backend['compile']>[0]) { return { compiled: emitNaive(rel) }; }
  // Compile wrapper deliberately uses the real plans; injection only changes decoded rows.
  const property = fc.asyncProperty(recipeArbitrary, async recipe => {
    await differential([good, faulty], build({ ...recipe, end: 'bag' }));
  });
  const result = await fc.check(property, { seed, numRuns: 60 });
  expect(result.failed).toBe(true);
  expect(result.numShrinks).toBeGreaterThan(0);
  expect(String(result.errorInstance)).toContain('multiplicity diff');
  expect(String(result.errorInstance)).toContain('faulty-drops-duplicate');
  expect(String(result.errorInstance)).toContain('sql');
  const replay = await fc.check(property, { seed: result.seed, path: result.counterexamplePath!, numRuns: 60 });
  expect(replay.failed).toBe(true);
  expect(replay.counterexample).toEqual(result.counterexample);
  expect(String(replay.errorInstance)).toContain('multiplicity diff');
});
