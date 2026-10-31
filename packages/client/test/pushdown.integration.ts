import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { canonicalKey, crossJoin, join, unionAll, val, col } from '@typedhouse/core';
import { components, parts } from './differential-arbitrary.js';
import { createClickHouseBackend, type Backend } from '../src/index.js';
import { collect, differential, multiplicityDiff, decodedRecord } from './backend-harness.js';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, fails, native, recipeArbitrary, seed, shape, shapeCount, type Recipe } from './pushdown-arbitrary.js';
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
/** The server error type a backend fails with (QueryError's cause is the driver error), or 'none'. */
async function failure(backend: Backend, q: ReturnType<typeof build>): Promise<string> {
  try { await collect(backend.run(backend.compile(q.ir))); return 'none'; }
  catch (error) { return String((error as { cause?: { type?: string } }).cause?.type ?? error); }
}
/** Executions of fallible recipes that failed (in both emitters and the oracle alike). */
let failedExecutions = 0;
async function check(recipe: Recipe) {
  const q = build(recipe);
  if (recipe.fallible) {
    // Slice 3b: the two texts must fail or succeed alike, with the same server code, and so must the independent nested
    // SQL. Which rows the server actually divides is its own business (it pushes an alias-independent predicate below an
    // inner ARRAY JOIN in every text); `fails` only names the recipes where the amount = 0 row certainly reaches the filter.
    const outcomes: string[] = [];
    for (const backend of backends) outcomes.push(await failure(backend, q));
    const context = `${native(recipe)}\n${JSON.stringify(backends.map(b => b.compile(q.ir).compiled.sql))}`;
    if (outcomes.some(o => o !== 'none')) {
      expect(outcomes, context).toEqual(['ILLEGAL_DIVISION', 'ILLEGAL_DIVISION']);
      await expect(driver.query({ query: native(recipe), format: 'JSONEachRow' }), context).rejects.toMatchObject({ type: 'ILLEGAL_DIVISION' });
      failedExecutions++;
      return [];
    }
    expect(fails(recipe), context).toBe(false);
  }
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
const anchor: Recipe = { kind: 'inner', tenant: 'acme', minimum: 0, renames: 2, nullable: false, fence: 'none', take: 9, offset: 0, expansion: 'column', mixed: false, fallible: false };
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
  // Slice 3b: the fallible filter fails in both emitters and the oracle when the amount = 0 row reaches it (cross join,
  // LEFT or constant expansion), and keeps the earlier filters' rows when it does not (the inner expansion drops the
  // empty-array row; the mixed arithmetic conjunct removes it when minimum >= 1; tenant other never has it).
  // Under the inner expansion the empty-array row is gone in IR order, yet ClickHouse pushes the alias-independent predicate
  // below the ARRAY JOIN in both texts and divides by its 0 anyway: both emitters and the oracle fail alike (`check` asserts it).
  expect(fails({ ...anchor, fallible: true })).toBe(false);
  expect(await check({ ...anchor, fallible: true })).toEqual([]);
  for (const recipe of [{ ...anchor, kind: 'cross' as const, fallible: true }, { ...anchor, kind: 'leftArray' as const, fallible: true }, { ...anchor, kind: 'array' as const, expansion: 'constant' as const, fallible: true }, { ...anchor, kind: 'cross' as const, fallible: true, mixed: true }]) {
    expect(fails(recipe)).toBe(true);
    expect(await check(recipe)).toEqual([]);
  }
  expect(await check({ ...anchor, kind: 'cross', fallible: true, mixed: true, minimum: 1 })).toEqual([...Array(3).fill(decoded[0]), ...Array(3).fill(decoded[1])]);
  expect(await check({ ...anchor, kind: 'cross', tenant: 'other', fallible: true })).toEqual([decoded[3]]);
  // The mixed residual (arithmetic AND cast) is the join block's WHERE; the fallible filter reads its own derived table above it.
  expect(backends[0]!.compile(build({ ...anchor, kind: 'cross', fallible: true, mixed: true, minimum: 1 }).ir).compiled.sql).toMatch(/CAST\(`c`\.`amount` AS String\) != \{p\d+:String\}\)\) AS `__typedhouse_input` WHERE intDiv\(\{p\d+:UInt64\}, `__typedhouse_input`\.`__typedhouse_leaf_\d+`\) > \{p\d+:UInt64\}\)/);
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
  let certain = 0;
  failedExecutions = 0;
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async recipe => {
    const rewritten = rewriteRel(build(recipe).ir);
    for (const [rule, n] of Object.entries(rewritten.hits)) if (n) hits.add(rule);
    shapes.add(shape(recipe));
    if (fails(recipe)) certain++;
    try { await check(recipe); } catch (cause) {
      const sqls = backends.map(b => { const p = b.compile(build(recipe).ir).compiled; return { name: b.name, sql: p.sql, params: p.params }; });
      throw new Error(`${String(cause)}\n${JSON.stringify(sqls)}`, { cause });
    }
  }), { seed: Number(process.env.TYPEDHOUSE_PUSHDOWN_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_PUSHDOWN_PATH ? { path: process.env.TYPEDHOUSE_PUSHDOWN_PATH } : {}) });
  console.info('pushdown differential', { runs: result.numRuns, seed: result.seed, milliseconds: Math.round(performance.now() - start), rules: [...hits], topologies: shapes.size, certainFailures: certain, failedExecutions });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500);
  expect([...hits].sort()).toEqual(['MergeFilter', 'MergeProject', 'PushFilterArrayJoin', 'PushFilterJoin', 'PushFilterProject']);
  expect(shapes.size).toBe(shapeCount);
  // Both outcomes of the fallible filter are exercised natively: every certain failure failed, and some fallible recipes succeeded.
  expect(certain).toBeGreaterThan(20);
  expect(failedExecutions).toBeGreaterThanOrEqual(certain);
  expect(failedExecutions).toBeLessThan(250);
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
  // Slice 3b: fallible recipes can fail on the server before any duplicate is lost, so the campaign that must find the
  // injected loss (and shrink to it) runs over the recipes that execute; the 500-run differential above covers the rest.
  const property = fc.asyncProperty(recipeArbitrary.filter(recipe => !recipe.fallible), async recipe => { await differential([backends[0]!, faulty], build(recipe), true); });
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
