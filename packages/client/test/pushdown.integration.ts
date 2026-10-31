import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { canonicalKey, crossJoin, join, unionAll, val, col } from '@typedhouse/core';
import { components, parts } from './differential-arbitrary.js';
import { createClickHouseBackend, type Backend } from '../src/index.js';
import { differential, multiplicityDiff, decodedRecord } from './backend-harness.js';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, native, recipeArbitrary, seed, shape, shapeCount, type Recipe } from './pushdown-arbitrary.js';
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
async function check(recipe: Recipe) {
  const q = build(recipe);
  const rows = await differential(backends, q, true);
  const sql = native(recipe);
  const result = await driver.query({ query: sql, format: 'JSONEachRow' });
  try {
    const expected = (await result.json<Record<string, unknown>>()).map(r => ({ ...r, at: new Date(String(r.at)), amount: BigInt(String(r.amount)) }));
    const columns = Object.entries(backends[0]!.compile(q.ir).compiled.columns);
    const keys = (rs: unknown[]) => rs.map(r => canonicalKey(decodedRecord(r), columns));
    expect(multiplicityDiff(keys(rows), keys(expected)), sql).toEqual([]);
    expect(keys(rows), sql).toEqual(keys(expected));
    return rows;
  } finally { result.close(); }
}
const anchor: Recipe = { kind: 'inner', tenant: 'acme', minimum: 0, renames: 2, nullable: false, fence: 'none', take: 9, offset: 0, expansion: 'column', mixed: false };
it('anchors duplicate, empty-array, NULL, tenant and shared-occurrence cardinalities independently', async () => {
  const decoded = values.map(r => ({ ...r, at: new Date(r.at), amount: BigInt(r.amount) }));
  expect(await check(anchor)).toEqual([...Array(5).fill(decoded[0]), ...Array(2).fill(decoded[1])]);
  expect(await check({ ...anchor, kind: 'leftArray' })).toEqual([...Array(3).fill(decoded[0]), ...Array(2).fill(decoded[1]), decoded[2]]);
  expect(await check({ ...anchor, kind: 'shared' })).toEqual([decoded[0]]);
  expect(await check({ ...anchor, kind: 'cross', tenant: 'other' })).toEqual([decoded[3]]);
  expect(await check({ ...anchor, fence: 'limit', take: 3, offset: 1 })).toEqual(Array(3).fill(decoded[0]));
  // A Param array expands every row, the empty-array row included; the mixed filter pushes only its safe conjuncts.
  expect(await check({ ...anchor, kind: 'array', expansion: 'constant', mixed: true })).toEqual([...Array(2).fill(decoded[0]), ...Array(2).fill(decoded[1]), ...Array(2).fill(decoded[2])]);
  const mixed = rewriteRel(build({ ...anchor, mixed: true }).ir);
  expect(mixed.hits.PushFilterJoin).toBeGreaterThan(0); expect(mixed.hits.PushFilterArrayJoin).toBe(1);
  expect(await check({ ...anchor, mixed: true })).toEqual([...Array(5).fill(decoded[0]), ...Array(2).fill(decoded[1])]);
});
it('preserves nested occurrence paths, same-side residuals, swapped names and shared consumers', async () => {
  const nested = join({ t0: components, '__typedhouse_input': parts }).on(r => r.t0.tenant.eq(r.__typedhouse_input.tenant));
  const query = crossJoin({ t0: nested, '__typedhouse_input': parts })
    .where(r => r.t0.t0.tenant.eq('acme')
      .and(r.t0.t0.id.eq('a').or(r.t0.__typedhouse_input.id.eq('q')))
      .and(r.__typedhouse_input.tenant.eq('other')))
    .map(r => ({ tenant: r.t0.t0.id, id: r.t0.t0.tenant }))
    .where(r => r.id.eq('acme').and(r.tenant.eq('b')));
  const rewritten = rewriteRel(query.ir);
  expect(rewritten.hits.PushFilterJoin).toBeGreaterThanOrEqual(2);
  expect(rewritten.hits.PushFilterProject).toBeGreaterThan(0);
  expect(await differential(backends, query)).toEqual([{ tenant: 'b', id: 'acme' }]);
  const direct = await driver.query({ query: "SELECT c.id AS tenant,c.tenant AS id FROM differential_components c INNER ALL JOIN differential_parts p ON c.tenant=p.tenant CROSS JOIN differential_parts x WHERE c.tenant='acme' AND (c.id='a' OR p.id='q') AND x.tenant='other' AND c.id='b'", format: 'JSONEachRow' });
  try { expect(await direct.json()).toEqual([{ tenant: 'b', id: 'acme' }]); } finally { direct.close(); }
  const shared = components.map(r => ({ id: r.id, tenant: r.tenant })).where(r => r.tenant.eq('acme'));
  const branches = unionAll(shared.where(r => r.id.eq('a')), shared.where(r => r.id.eq('b')), shared.where(r => r.id.eq('a'))).orderBy(r => r.id);
  expect(await differential(backends, branches, true)).toEqual([{ id: 'a', tenant: 'acme' }, { id: 'a', tenant: 'acme' }, { id: 'b', tenant: 'acme' }]);
});
it('retains NULL-as-false and element-dependent predicates after left expansion', async () => {
  const expanded = components.leftArrayJoin(r => r.ids, '__typedhouse_element');
  const query = expanded.where(r => r.category.eq(val(null, col.Nullable(col.String))).or(r.__typedhouse_element.eq('')))
    .map(r => ({ id: r.id, part: r.__typedhouse_element }));
  expect(rewriteRel(query.ir).hits.PushFilterArrayJoin).toBe(0);
  expect(await differential(backends, query)).toEqual([{ id: 'c', part: '' }]);
  const independent = expanded.where(r => r.category.isNull()).map(r => ({ id: r.id, part: r.__typedhouse_element }));
  expect(rewriteRel(independent.ir).hits.PushFilterArrayJoin).toBe(1);
  expect(await differential(backends, independent)).toEqual([{ id: 'c', part: '' }]);
});
it('executes 500 bounded shrinkable multi-operator recipes with actual rule/topology coverage', async () => {
  const hits = new Set<string>(), shapes = new Set<string>();
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async recipe => {
    const rewritten = rewriteRel(build(recipe).ir);
    for (const [rule, n] of Object.entries(rewritten.hits)) if (n) hits.add(rule);
    shapes.add(shape(recipe));
    try { await check(recipe); } catch (cause) {
      const sqls = backends.map(b => { const p = b.compile(build(recipe).ir).compiled; return { name: b.name, sql: p.sql, params: p.params }; });
      throw new Error(`${String(cause)}\n${JSON.stringify(sqls)}`, { cause });
    }
  }), { seed: Number(process.env.TYPEDHOUSE_PUSHDOWN_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_PUSHDOWN_PATH ? { path: process.env.TYPEDHOUSE_PUSHDOWN_PATH } : {}) });
  console.info('pushdown differential', { runs: result.numRuns, seed: result.seed, milliseconds: Math.round(performance.now() - start), rules: [...hits], topologies: shapes.size });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500);
  expect([...hits].sort()).toEqual(['MergeFilter', 'MergeProject', 'PushFilterArrayJoin', 'PushFilterJoin', 'PushFilterProject']);
  expect(shapes.size).toBe(shapeCount);
}, 120000);
it('detects real decoded duplicate loss, genuinely shrinks and exactly replays', async () => {
  const source = backends[1]!;
  const faulty: Backend = { name: 'pushdown-duplicate-loss', compile: r => source.compile(r), async *run(plan) {
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
  expect(String(result.errorInstance)).toContain('params');
  const replay = await fc.check(property, { seed: result.seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  expect(String(replay.errorInstance)).toContain('multiplicity diff');
  console.info('pushdown fault injection', { shrinks: result.numShrinks, path: result.counterexamplePath, seed: result.seed });
}, 120000);
