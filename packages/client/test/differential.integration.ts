import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { canonicalKey } from '@typedhouse/core';
import { createClickHouseBackend, type Backend } from '../src/index.js';
import { differential, multiplicityDiff, decodedRecord } from './backend-harness.js';
import { anchors, build, recipeArbitrary, seed, topology, type Tree, type Recipe } from './differential-arbitrary.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const values = [
  { tenant: 'acme', id: 'a', category: 'visible', ids: ['p', 'p', 'q'], at: '2024-03-11', amount: '2' },
  { tenant: 'acme', id: 'b', category: '', ids: ['p', 'orphan'], at: '2024-03-12', amount: '3' },
  { tenant: 'acme', id: 'c', category: null, ids: [], at: '2024-03-13', amount: '0' },
  { tenant: 'other', id: 'a', category: 'hidden', ids: ['p'], at: '2024-03-14', amount: '5' },
];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { max_execution_time: 10, max_result_rows: '1000', result_overflow_mode: 'throw' as const } };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE differential_components (tenant String,id String,category Nullable(String),ids Array(String),at Date,amount UInt64) ENGINE=Memory' });
  await driver.command({ query: 'CREATE TABLE differential_parts (tenant String,id String) ENGINE=Memory' });
  await driver.insert({ table: 'differential_components', values, format: 'JSONEachRow' });
  await driver.insert({ table: 'differential_parts', values: [{ tenant: 'acme', id: 'p' }, { tenant: 'acme', id: 'p' }, { tenant: 'acme', id: 'q' }, { tenant: 'other', id: 'p' }], format: 'JSONEachRow' });
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
// Independent native relational interpreter: no compiler IR/emitter or decoder.
function nativeTree(t: Tree): string {
  if (t.op === 'scan') return `SELECT tenant,id,category,ids,at,amount FROM differential_components WHERE tenant='${t.tenant}'`;
  if (t.op === 'join') return `SELECT c.tenant,c.id,c.category,c.ids,c.at,c.amount FROM (SELECT tenant,id,category,ids,at,amount,part FROM differential_components ARRAY JOIN ids AS part WHERE tenant='${t.tenant}') c INNER ALL JOIN differential_parts p ON c.tenant=p.tenant AND c.part=p.id`;
  if (t.op === 'union') return `SELECT * FROM (${nativeTree(t.left)}) UNION ALL SELECT * FROM (${nativeTree(t.right)})`;
  const input = `(${nativeTree(t.input)})`;
  if (t.op === 'filter') return `SELECT * FROM ${input} WHERE amount>=${t.minimum}`;
  if (t.op === 'distinct') return `SELECT DISTINCT * FROM ${input}`;
  return `SELECT tenant,id,category,ids,at,amount FROM ${input}`;
}
async function check(recipe: Recipe) {
  const query = build(recipe);
  const rows = await differential(backends, query, recipe.end === 'limit');
  let sql = nativeTree(recipe.tree);
  if (recipe.end === 'limit') sql = `SELECT * FROM (${sql}) ORDER BY tenant,id LIMIT ${recipe.take} OFFSET ${recipe.offset}`;
  if (recipe.end === 'rollup') sql = `SELECT ifNull(src.category,'uncategorised') AS category,count() AS rows,uniqExact(src.id) AS entities FROM (${sql}) AS src GROUP BY ifNull(src.category,'uncategorised')`;
  const result = await driver.query({ query: sql, format: 'JSONEachRow' });
  try {
    const native = (await result.json<Record<string, unknown>>()).map(r => recipe.end === 'rollup'
      ? { category: r.category, rows: BigInt(String(r.rows)), entities: BigInt(String(r.entities)) }
      : { ...r, at: new Date(String(r.at)), amount: BigInt(String(r.amount)) });
    const columns = backends[0]!.compile(query.ir).compiled.columns;
    const keys = (rs: unknown[]) => rs.map(r => canonicalKey(decodedRecord(r), Object.entries(columns)));
    expect(multiplicityDiff(keys(rows), keys(native)), `native SQL: ${sql}`).toEqual([]);
    if (recipe.end === 'limit') expect(keys(rows)).toEqual(keys(native));
    return rows;
  } finally { result.close(); }
}
it('anchors every operator and independently checks explicit duplicate-sensitive expectations', async () => {
  const scan = await check(anchors[0]!);
  expect(scan).toEqual(expect.arrayContaining(values.filter(r => r.tenant === 'acme').map(r => ({ ...r, at: new Date(r.at), amount: BigInt(r.amount) }))));
  expect(scan).toHaveLength(3);
  const rollup = await check(anchors[1]!);
  expect(rollup).toHaveLength(2);
  expect(rollup).toEqual(expect.arrayContaining([{ category: 'visible', rows: 5n, entities: 1n }, { category: '', rows: 2n, entities: 1n }]));
  const decoded = values.map(r => ({ ...r, at: new Date(r.at), amount: BigInt(r.amount) }));
  expect(await check(anchors[2]!)).toEqual([decoded[1], decoded[2]]);
  const filtered = await check(anchors[3]!);
  expect(filtered).toHaveLength(2);
  expect(filtered).toEqual(expect.arrayContaining([decoded[0], decoded[1]]));
});
it('keeps LIMIT ties indistinguishable and checks empty and duplicate-boundary windows', async () => {
  // This invariant is essential: id alone is not unique across tenants.
  expect(new Set(values.map(r => JSON.stringify([r.tenant, r.id]))).size).toBe(values.length);
  const tree: Tree = { op: 'union', left: { op: 'join', tenant: 'acme' }, right: { op: 'scan', tenant: 'other' } };
  const a = { ...values[0]!, at: new Date(values[0]!.at), amount: 2n };
  expect(await check({ tree, end: 'limit', take: 3, offset: 1 })).toEqual([a, a, a]);
  expect(await check({ tree, end: 'limit', take: 0, offset: 1 })).toEqual([]);
  expect(await check({ tree, end: 'limit', take: 2, offset: 8 })).toEqual([]);
  expect(await check({ tree: { op: 'filter', input: { op: 'scan', tenant: 'acme' }, minimum: 5 }, end: 'rollup', take: 1, offset: 0 })).toEqual([]);
});
it('shrinks and replays duplicate loss injected into real official-driver results', async () => {
  const source = backends[1]!;
  const faulty: Backend = {
    name: 'live-duplicate-loss', compile: rel => source.compile(rel),
    async *run(plan) {
      const seen = new Set<string>();
      for await (const batch of source.run(plan)) yield batch.filter(row => {
        const key = canonicalKey(decodedRecord(row), Object.entries(plan.compiled.columns));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  };
  const property = fc.asyncProperty(recipeArbitrary, async recipe => {
    // No terminal replacement: every visited/shrunk recipe runs as generated.
    await differential([backends[0]!, faulty], build(recipe), recipe.end === 'limit');
  });
  const result = await fc.check(property, { seed, numRuns: 60 });
  expect(result.failed).toBe(true);
  expect(result.numShrinks).toBeGreaterThan(0);
  expect(String(result.errorInstance)).toContain('multiplicity diff');
  expect(String(result.errorInstance)).toContain('live-duplicate-loss');
  expect(String(result.errorInstance)).toContain('params');
  const replay = await fc.check(property, { seed: result.seed, path: result.counterexamplePath!, numRuns: 60 });
  expect(replay.counterexample).toEqual(result.counterexample);
  expect(String(replay.errorInstance)).toContain('multiplicity diff');
}, 120000);
// Replay: TYPEDHOUSE_DIFF_SEED=20261027 TYPEDHOUSE_DIFF_PATH='...' pnpm test:compiler-integration packages/client/test/differential.integration.ts
it('executes 60 shrinkable bounded query topologies through decoded Backend plugins', async () => {
  const shapes = new Set<string>();
  const started = performance.now();
  const details = await fc.check(fc.asyncProperty(recipeArbitrary, async recipe => {
    shapes.add(`${topology(recipe.tree)}:${recipe.end}`);
    try { await check(recipe); }
    catch (cause) {
      const diagnostics = backends.map(backend => {
        try { const { sql, params } = backend.compile(build(recipe).ir).compiled; return { backend: backend.name, sql, params }; }
        catch (error) { return { backend: backend.name, error: String(error) }; }
      });
      throw new Error(`${String(cause)}\n${JSON.stringify(diagnostics)}`, { cause });
    }
  }), { seed: Number(process.env.TYPEDHOUSE_DIFF_SEED ?? seed), numRuns: 60, ...(process.env.TYPEDHOUSE_DIFF_PATH ? { path: process.env.TYPEDHOUSE_DIFF_PATH } : {}) });
  console.info('bounded differential', { runs: details.numRuns, topologies: shapes.size, milliseconds: Math.round(performance.now() - started), seed: details.seed });
  if (details.failed) throw new Error(`seed=${details.seed} path=${details.counterexamplePath} shrinks=${details.numShrinks}\nminimized recipe=${JSON.stringify(details.counterexample)}\n${details.errorInstance instanceof Error ? details.errorInstance.stack : String(details.errorInstance)}`);
  expect(details.numRuns).toBe(60);
}, 120000);
