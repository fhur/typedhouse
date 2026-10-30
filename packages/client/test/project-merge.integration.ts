import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { canonicalKey } from '@typedhouse/core';
import { createClickHouseBackend, type Backend } from '../src/index.js';
import { differential, decodedRecord } from './backend-harness.js';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, native, recipeArbitrary, seed, shape, type Recipe } from './project-merge-arbitrary.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
// (tenant,id) is unique except one exact duplicate row, so every ORDER BY tie is an identical row.
const values = [
  { tenant: 'acme', id: 'a', category: 'visible', amount: '2', score: '3' },
  { tenant: 'acme', id: 'b', category: null, amount: '5', score: '-1' },
  { tenant: 'acme', id: 'c', category: '', amount: '0', score: '0' },
  { tenant: 'acme', id: 'c', category: '', amount: '0', score: '0' },
  { tenant: 'acme', id: 'd', category: null, amount: '7', score: '4' },
  { tenant: 'other', id: 'a', category: 'hidden', amount: '1', score: '2' },
  { tenant: 'other', id: 'e', category: null, amount: '9', score: '-5' },
];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { max_execution_time: 10, max_result_rows: '1000', result_overflow_mode: 'throw' as const } };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE merge_items (tenant String,id String,category Nullable(String),amount UInt64,score Int64) ENGINE=Memory' });
  await driver.insert({ table: 'merge_items', values, format: 'JSONEachRow' });
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
async function raw(sql: string, params: Readonly<Record<string, string>>, preferColumn: 0 | 1) {
  const result = await driver.query({ query: sql, query_params: params, format: 'JSON', clickhouse_settings: { prefer_column_name_to_alias: preferColumn } });
  try { const json = await result.json<Record<string, unknown>>(); return { meta: json.meta, data: json.data }; } finally { result.close(); }
}
/** Rows and `meta` types must agree across both backends and both alias settings, and with the oracle. */
async function check(recipe: Recipe) {
  const q = build(recipe);
  const plans = backends.map(b => b.compile(q.ir).compiled);
  const sql = native(recipe);
  try {
    const oracle = await driver.query({ query: sql, format: 'JSONEachRow' });
    const expected = await oracle.json<Record<string, unknown>>().finally(() => oracle.close());
    const first = await raw(plans[0]!.sql, plans[0]!.params, 0);
    for (const plan of plans) for (const setting of [0, 1] as const) expect(await raw(plan.sql, plan.params, setting)).toEqual(first);
    expect(first.data).toEqual(expected);
    const rows = await differential(backends, q, true);
    expect(rows).toHaveLength(expected.length);
    return rows;
  } catch (cause) {
    throw new Error(`${String(cause)}\n${JSON.stringify({ oracle: sql, plans: plans.map(p => ({ sql: p.sql, params: p.params })) })}`, { cause });
  }
}
const anchor: Recipe = { tenant: 'acme', steps: [{ op: 'plus', k: 2 }], at: 1, minimum: 3, nullable: false, shared: false };
it('anchors computed pushdown, shadowed aliases, shared diamonds and NULL handling against hand-written SQL', async () => {
  const row = (id: string, category: string | null, label: string, amount: bigint, score: bigint, total: bigint) => ({ tenant: 'acme', id, category, label, amount, score, total });
  expect(await check(anchor)).toEqual([row('a', 'visible', 'acme', 2n, 3n, 5n), row('d', null, 'acme', 7n, 4n, 6n)]);
  const shadowed: Recipe = { ...anchor, steps: [{ op: 'swap' }, { op: 'amountPlus', k: 1 }], at: 2, minimum: 0 };
  const plan = backends[0]!.compile(build(shadowed).ir).compiled;
  expect(plan.sql).toContain(') AS `__typedhouse_input`');
  expect(await check(shadowed)).toEqual([row('acme', '', 'c', 1n, 0n, 0n), row('acme', '', 'c', 1n, 0n, 0n), row('acme', 'visible', 'a', 3n, 3n, 3n), row('acme', null, 'd', 8n, 4n, 4n)]);
  const diamond: Recipe = { ...anchor, steps: [{ op: 'ifNull' }], at: 0, minimum: -10, shared: true };
  expect(await check(diamond)).toEqual([row('a', 'visible', 'visible', 2n, 3n, 3n), row('b', null, 'acme', 5n, -1n, -1n), ...Array(4).fill(row('c', '', '', 0n, 0n, 0n)), row('d', null, 'acme', 7n, 4n, 4n)]);
  expect(rewriteRel(build(diamond).ir).hits.MergeProject).toBeGreaterThan(0);
  expect(backends[0]!.compile(build(diamond).ir).compiled.sql).toContain('WITH `t0` AS');
  const nullable: Recipe = { ...anchor, steps: [{ op: 'scoreMinus', k: 3 }, { op: 'minus', k: 1 }], at: 1, minimum: 2, nullable: true };
  expect(await check(nullable)).toEqual([row('a', 'visible', 'acme', 2n, 0n, 2n)]);
});
it('executes 500 stacked-selection recipes with MergeProject and PushFilterProject coverage under both alias settings', async () => {
  const hits = new Set<string>(), shapes = new Set<string>();
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async recipe => {
    const rewritten = rewriteRel(build(recipe).ir);
    for (const [rule, n] of Object.entries(rewritten.hits)) if (n) hits.add(rule);
    shapes.add(shape(recipe));
    await check(recipe);
  }), { seed: Number(process.env.TYPEDHOUSE_MERGE_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_MERGE_PATH ? { path: process.env.TYPEDHOUSE_MERGE_PATH } : {}) });
  console.info('project-merge differential', { runs: result.numRuns, seed: result.seed, milliseconds: Math.round(performance.now() - start), rules: [...hits].sort(), shapes: shapes.size });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500);
  expect([...hits].sort()).toEqual(['MergeFilter', 'MergeProject', 'PushFilterProject']);
  expect(shapes.size).toBeGreaterThan(150);
}, 300000);
it('detects decoded duplicate loss, genuinely shrinks and exactly replays', async () => {
  const source = backends[1]!;
  const faulty: Backend = { name: 'project-merge-duplicate-loss', compile: r => source.compile(r), async *run(plan) {
    const seen = new Set<string>();
    for await (const batch of source.run(plan)) yield batch.filter(row => {
      const key = canonicalKey(decodedRecord(row), Object.entries(plan.compiled.columns));
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  } };
  const property = fc.asyncProperty(recipeArbitrary, async recipe => { await differential([backends[0]!, faulty], build(recipe), true); });
  const result = await fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true);
  expect(result.numShrinks).toBeGreaterThan(0);
  expect(String(result.errorInstance)).toContain('multiplicity diff');
  const replay = await fc.check(property, { seed: result.seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  expect(String(replay.errorInstance)).toContain('multiplicity diff');
  console.info('project-merge fault injection', { shrinks: result.numShrinks, path: result.counterexamplePath, seed: result.seed });
}, 120000);
