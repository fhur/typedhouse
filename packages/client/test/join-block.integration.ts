import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, type Caps } from '@chql/core';
import { createClickHouseBackend } from '../src/index.js';
import { collect, keys } from './backend-harness.js';
import { build, native, recipes, seed, shape, type Recipe } from './join-block-arbitrary.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE pruning_wide (id String,tenant String,amount UInt64,spare String,ids Array(String),waste String) ENGINE=MergeTree ORDER BY (tenant,id)' });
  await driver.insert({ table: 'pruning_wide', format: 'JSONEachRow', values: [
    { id: 'a', tenant: 'acme', amount: '2', spare: 'x', ids: ['p', 'p'], waste: 'unused' },
    { id: 'b', tenant: 'acme', amount: '3', spare: 'y', ids: [], waste: 'unused' },
    { id: 'a', tenant: 'other', amount: '5', spare: 'z', ids: ['orphan'], waste: 'unused' },
  ] });
}, 120000);
afterAll(async () => { for (const b of backends) await b.close(); await driver?.close(); await container?.stop(); });
function decode(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && ['amount', 'n', 'total'].includes(key)) return BigInt(value);
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v, k)])) : value;
}
async function direct(r: Recipe) {
  const response = await driver.query({ query: native(r), format: 'JSONEachRow', clickhouse_settings: { output_format_json_named_tuples_as_objects: 1, output_format_json_quote_64bit_integers: 1 } });
  try { return (await response.json()).map(row => decode(row)); } finally { response.close(); }
}
it('runs 500 shrinkable variable join/project/aggregate recipes against independent native SQL and full metadata', async () => {
  const shapes = new Set<string>();
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipes, async r => {
    shapes.add(shape(r));
    const q = build(r), plans = backends.map(b => b.compile(q.ir));
    const expected = await direct(r);
    try {
      expect(plans[0]!.compiled.columns).toEqual(plans[1]!.compiled.columns);
      expect(plans[0]!.compiled.columnPaths).toEqual(plans[1]!.compiled.columnPaths);
      for (const [i, b] of backends.entries()) expect(keys<unknown, Caps>(q, (await collect(b.run(plans[i]!))).flat())).toEqual(keys<unknown, Caps>(q, expected));
    } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.map(p => ({ sql: p.compiled.sql, params: p.compiled.params })))}`, { cause }); }
  }), { seed: Number(process.env.CHQL_JOIN_BLOCK_SEED ?? seed), numRuns: 500, ...(process.env.CHQL_JOIN_BLOCK_PATH ? { path: process.env.CHQL_JOIN_BLOCK_PATH } : {}) });
  console.info('join-block differential', { runs: result.numRuns, seed: result.seed, shapes: shapes.size, milliseconds: Math.round(performance.now() - start) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500); expect(shapes.size).toBeGreaterThan(100);
}, 180000);
it('preserves separate Float64 OR filters against native SQL and the naive backend', async () => {
  await driver.command({ query: 'CREATE TABLE review_numbers (n Float64) ENGINE=Memory' });
  await driver.insert({ table: 'review_numbers', format: 'JSONEachRow', values: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  const q = from(table('review_numbers', { n: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }))
    .where(r => r.n.eq(1).or(r.n.eq(2))).where(r => r.n.gt(1));
  const response = await driver.query({ query: 'SELECT n FROM review_numbers WHERE (n=1 OR n=2) AND n>1', format: 'JSONEachRow' });
  let expected: unknown[];
  try { expected = await response.json(); } finally { response.close(); }
  expect(expected).toEqual([{ n: 2 }]);
  // Run the reference first so the optimized failure cannot hide its result.
  for (const backend of [...backends].reverse()) {
    const actual = (await collect(backend.run(backend.compile(q.ir)))).flat();
    expect(keys(q, actual), backend.name).toEqual(keys(q, expected));
  }
});
it('detects missing join conditions after IO, shrinks and replays the actual wrong-result recipe', async () => {
  let executions = 0;
  const property = fc.asyncProperty(recipes, async r => {
    const q = build(r), correct = backends[1]!.compile(q.ir), faulty = backends[0]!.compile(build(r, true).ir);
    const expected = (await collect(backends[1]!.run(correct))).flat();
    const actual = (await collect(backends[0]!.run(faulty))).flat(); executions++;
    try { expect(keys<unknown, Caps>(q, actual)).toEqual(keys<unknown, Caps>(q, expected)); }
    catch (cause) { throw new Error(`wrong-result after IO ${JSON.stringify({ faulty: faulty.compiled.sql, params: faulty.compiled.params, naive: correct.compiled.sql })}`, { cause }); }
  });
  const result = await fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true); expect(result.numShrinks).toBeGreaterThan(0); expect(String(result.errorInstance)).toContain('wrong-result after IO');
  const replay = await fc.check(property, { seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  console.info('join-block fault', { seed, path: result.counterexamplePath, shrinks: result.numShrinks, executions, recipe: JSON.stringify(result.counterexample), evidence: String(result.errorInstance) });
}, 120000);
