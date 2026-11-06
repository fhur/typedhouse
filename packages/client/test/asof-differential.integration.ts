import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { compile, emitNaive } from '@typedhouse/compiler';
import { build, model, recipes, seed as arbitrarySeed, shape } from './asof-arbitrary.js';
import { canonical, connect, paths, seed, startServer, type Connection } from './asof-support.js';

let stop: () => Promise<void>;

let c: Connection;

beforeAll(async () => {
  const server = await startServer('24.8');
  stop = server.stop;
  const base = connect(server.url);
  const database = `asof_differential_${Date.now()}`;
  await base.admin.command({ query: `CREATE DATABASE ${database}` });
  await base.close();
  c = connect(server.url, {}, database);
  await seed(c);
});

afterAll(async () => {
  await c?.close();
  await stop();
});

it('300 recipes with unique right keys: optimized, naive and the model agree', async () => {
  const shapes = new Set<string>();

  let nonEmpty = 0;

  await fc.assert(
    fc.asyncProperty(recipes, async recipe => {
      shapes.add(shape(recipe));
      const q = build(recipe);
      const expected = canonical(model(recipe));
      if (expected.length) nonEmpty++;
      expect(compile(q.ir).sql).toMatch(/ASOF (INNER|LEFT) JOIN/);
      expect(emitNaive(q.ir).sql).toMatch(/ASOF (INNER|LEFT) JOIN/);

      for (const [path, rows] of Object.entries(await paths(c, q)))
        expect(canonical(rows), `${path}: ${JSON.stringify(recipe)}\n${compile(q.ir).sql}`).toEqual(
          expected,
        );
    }),
    { numRuns: 300, seed: arbitrarySeed },
  );

  // The property must not pass by being vacuous.
  expect(shapes.size).toBeGreaterThan(100);
  expect(nonEmpty).toBeGreaterThan(150);
}, 300_000);
