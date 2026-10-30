import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { print, from, sum, type Query, type CHType } from '@typedhouse/core';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect, multiplicityDiff } from './backend-harness.js';
import { build, buildTree, metricSource, componentPayload, partPayload, metricDetails, nonfinite, latestAvailabilityTotals, latestComponentTotals, latestPartTotals, latestPriceTotals, recipes, seed, shape, type Recipe } from './fixture-differential-arbitrary.js';
import { native, descriptors, decodeNative, independentKeys, componentColumns, partColumns, decodeColumns } from './fixture-differential-native.js';

import { coverage, requiredCoverage, size, actualTables, observedOperators, requiredOperators } from './fixture-differential-support.js';
import { db, latest, type Versioned } from '../../compiler/test/fixtures/corpus/low-stock.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { max_threads: 1, max_execution_time: 20, max_result_rows: '10000', result_overflow_mode: 'throw' as const, date_time_output_format: 'iso' as const, output_format_json_quote_64bit_integers: 1 as const, output_format_json_quote_denormals: 1 as const } };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  for (const file of ['schema.sql', 'seed.sql']) {
    if (file === 'seed.sql') await driver.command({ query: 'SYSTEM STOP MERGES' });
    const sql = readFileSync(new URL(`../../compiler/test/fixtures/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').filter(s => s.trim())) await driver.command({ query: statement });
  }
  const version = await driver.query({ query: 'SELECT version()', format: 'TabSeparatedRaw' });
  try { console.info('six-table server', (await version.text()).trim()); } finally { version.close(); }
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
async function direct(r: Recipe) {
  const oracle = native(r);
  const response = await driver.query({ query: oracle.sql, query_params: oracle.params, format: 'JSON' });
  try {
    const result = await response.json<unknown>();
    expect(JSON.stringify(result.meta)).toBe(JSON.stringify(Object.entries(descriptors(r.end)).map(([name, type]) => ({ name, type: print(type) }))));
    return result.data.map(row => decodeNative(row, r.end));
  } finally { response.close(); }
}
async function check(r: Recipe, fault = false, evidence?: Set<string>) {
  const q = build(r), oracle = native(r);
  const plans = backends.map(backend => backend.compile(q.ir));
  try {
    const expected = await direct(r);
    for (const [i, backend] of backends.entries()) {
      const plan = plans[i]!;
      expect(Object.entries(plan.compiled.columns), 'independent ordered descriptors').toEqual(Object.entries(descriptors(r.end)));
      expect(plan.compiled.columnPaths, 'flat independent paths').toBeUndefined();
      const actual = (await collect(backend.run(plan))).flat();
      // Intentional wrong result only after genuine official-backend IO.
      if (fault && i === 0 && actual.length) actual.pop();
      const wanted = independentKeys(expected, r.end, r.end === 'limit');
      const received = independentKeys(actual, r.end, r.end === 'limit');
      const diff = multiplicityDiff(received, wanted);
      if (diff.length) throw new Error(`decoded multiplicities ${JSON.stringify(diff)}`);
      if (r.end === 'limit') expect(received, 'total ordered sequence').toEqual(wanted);
    }
    if (evidence) {
      for (const kind of observedOperators(q.ir)) evidence.add(`ir:${kind}`);
      for (const [index, plan] of plans.entries()) for (const table of actualTables) {
        if (new RegExp(`\\bFROM\\s+\u0060${table}\u0060`, 'i').test(plan.compiled.sql)) evidence.add(`${index}:${table}`);
      }
    }
    return expected;
  } catch (cause) {
    throw new Error(`${String(cause)}\n${JSON.stringify({ recipe: r, native: oracle, expectedColumns: descriptors(r.end), expectedPaths: Object.keys(descriptors(r.end)).map(name => [name]), plans: plans.map(p => ({ sql: p.compiled.sql, params: p.compiled.params, columns: p.compiled.columns, paths: p.compiled.columnPaths })) })}`, { cause });
  }
}
// Explicit nightly-sized local invocation (no hosted schedule claim):
// TYPEDHOUSE_FIXTURE_RUNS=10000 pnpm test:compiler-integration packages/client/test/fixture-differential.integration.ts
it('executes recursive six-table recipes against independent native SQL', async () => {
  const runs = Number(process.env.TYPEDHOUSE_FIXTURE_RUNS ?? 500);
  if (runs !== 500 && runs !== 10000) throw new Error('TYPEDHOUSE_FIXTURE_RUNS must be 500 or 10000');
  const shapes = new Set<string>();
  const seen = new Map<string, number>();
  const evidence = new Set<string>();
  let empty = 0, nonempty = 0, nativeRows = 0;
  const started = performance.now();
  const result = await fc.check(fc.asyncProperty(recipes, async recipe => {
    shapes.add(`${recipe.end}:${shape(recipe.tree)}`);
    for (const key of new Set(coverage(recipe))) seen.set(key, (seen.get(key) ?? 0) + 1);
    const rows = await check(recipe, false, evidence);
    if (rows.length) nonempty++; else empty++;
    nativeRows += rows.length;
  }), { numRuns: runs, seed: Number(process.env.TYPEDHOUSE_FIXTURE_SEED ?? seed), ...(process.env.TYPEDHOUSE_FIXTURE_PATH ? { path: process.env.TYPEDHOUSE_FIXTURE_PATH } : {}) });
  console.info('six-table differential', { runs: result.numRuns, seed: result.seed, path: result.counterexamplePath, shrinks: result.numShrinks, shapes: shapes.size, empty, nonempty, nativeRows, coverage: Object.fromEntries(seen), observed: [...evidence].sort(), milliseconds: Math.round(performance.now() - started) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(runs);
  expect(nonempty).toBeGreaterThan(0); expect(empty).toBeGreaterThan(0);
  expect(shapes.size).toBeGreaterThan(100);
  for (const key of requiredCoverage) expect(seen.get(key) ?? 0, key).toBeGreaterThan(0);
  for (const kind of requiredOperators) expect(evidence.has(`ir:${kind}`), kind).toBe(true);
  for (const index of backends.keys()) for (const table of actualTables) expect(evidence.has(`${index}:${table}`), `${index}:${table}`).toBe(true);
}, 1800000);

it('shrinks real post-IO occurrence loss, rebuilds shared identity and replays exactly', async () => {
  let first: Recipe | undefined;
  let executions = 0;
  const property = fc.asyncProperty(recipes, async recipe => {
    executions++;
    try { await check(recipe, true); }
    catch (cause) { first ??= recipe; throw cause; }
  });
  const result = await fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true);
  expect(result.numShrinks).toBeGreaterThan(0);
  const minimized = result.counterexample?.[0];
  if (!first || !minimized) throw new Error('expected minimized recipe');
  expect(size(minimized.tree)).toBeLessThan(size(first.tree));
  expect(String(result.errorInstance)).toContain('decoded multiplicities');
  const replay = await fc.check(property, { seed, numRuns: 500, path: result.counterexamplePath! });
  expect(replay.failed).toBe(true);
  expect(replay.counterexample).toEqual(result.counterexample);
  // Correct executions of the minimized graph still pass.
  await check(minimized);
  const shared: Recipe = { scope: { tenant: 'acme', start: 0, week: 0 }, tree: { op: 'in', input: { op: 'metric', metric: 'availability', latest: true, attached: false, cross: false } }, end: 'bag' };
  const a = buildTree(shared.tree, shared.scope), b = buildTree(shared.tree, shared.scope);
  expect(a.ir).not.toBe(b.ir);
  expect(backends[0]!.compile(a.ir).compiled).toMatchObject({ sql: backends[0]!.compile(b.ir).compiled.sql, params: backends[0]!.compile(b.ir).compiled.params });
  expect(backends[0]!.compile(a.ir).compiled.sql).toContain('WITH ');
  await check(shared);
  console.info('six-table injected fault', { seed, path: result.counterexamplePath, shrinks: result.numShrinks, firstNodes: size(first.tree), minimizedNodes: size(minimized.tree), executions, recipe: minimized, evidence: String(result.errorInstance) });
}, 120000);

async function anchor(q: Pick<Query<unknown>, 'ir' | '_rowType' | 'caps'>, sql: string, columns: Record<string, CHType>, expected: unknown[]) {
  const result = await driver.query({ query: sql, format: 'JSON' });
  try {
    const json = await result.json<unknown>();
    expect(JSON.stringify(json.meta)).toBe(JSON.stringify(Object.entries(columns).map(([name, type]) => ({ name, type: print(type) }))));
    expect(json.data.map(row => decodeColumns(row, columns))).toEqual(expected);
  } finally { result.close(); }
  for (const backend of backends) {
    const plan = backend.compile(q.ir), client = createClientFromBackend(backend);
    expect(Object.entries(plan.compiled.columns)).toEqual(Object.entries(columns));
    expect(plan.compiled.columnPaths).toBeUndefined();
    for (const rows of [(await collect(backend.run(plan))).flat(), await client.run(q), await collect(client.stream(q))]) expect(rows).toEqual(expected);
  }
}
it('anchors named tuple arrays, nulls, bigint arrays, dates and Float64 non-finites independently', async () => {
  const scope = { tenant: 'acme', start: 0, week: 0 };
  await anchor(componentPayload(scope).where(r => r.id.eq('cmp_0')),
    "SELECT entityId AS id,category,part_specifications AS parts,matched_part_ids AS ids,countOfParts AS count,updatedAt AS at FROM entity_ots_component WHERE tenantId='acme' AND entityId='cmp_0'", componentColumns,
    [{ id: 'cmp_0', category: null, parts: [{ id: 'spec_0', mpn: null, manufacturer: null, description: 'description', package: null, part_type: null }], ids: [], count: 0n, at: new Date('2026-04-27T00:00:00.000Z') }]);
  await anchor(partPayload(scope).where(r => r.id.eq('part_0')),
    "SELECT entityId AS id,partCategoryId AS category,partCategoryPath AS path,lifecycleStatus AS lifecycle,lifecycleYteol AS years,updatedAt AS at FROM entity_off_the_shelf_part WHERE tenantId='acme' AND entityId='part_0'", partColumns,
    [{ id: 'part_0', category: null, path: [1042n], lifecycle: null, years: null, at: new Date('2026-04-27T00:00:00.000Z') }]);
  await anchor(metricDetails(scope).where(r => r.id.eq('cmp_0').and(r.at.eq(new Date('2026-04-27T00:00:00.000Z')))),
    "SELECT entityId AS id,effectiveAt AS at,stock_index_warnings AS warnings,lead_time_max_days AS lead FROM metric_group_ots_component_indices FINAL WHERE tenantId='acme' AND entityId='cmp_0' AND effectiveAt=toDateTime64('2026-04-27 00:00:00',3,'UTC') AND version=1",
    { id: { kind: 'scalar', name: 'String' }, at: { kind: 'DateTime64', precision: 3 }, warnings: { kind: 'Array', inner: { kind: 'scalar', name: 'String' } }, lead: { kind: 'Nullable', inner: { kind: 'scalar', name: 'Float64' } } },
    [{ id: 'cmp_0', at: new Date('2026-04-27T00:00:00.000Z'), warnings: ['fixture_warning'], lead: null }]);
  await anchor(nonfinite(scope).distinct(), "SELECT 0./0. AS nan,1./0. AS inf", { nan: { kind: 'scalar', name: 'Float64' }, inf: { kind: 'scalar', name: 'Float64' } }, [{ nan: NaN, inf: Infinity }]);
  for (const q of [latestAvailabilityTotals(scope), latestComponentTotals(scope), latestPartTotals(scope), latestPriceTotals(scope)]) {
    for (const backend of backends) expect(backend.compile(q.ir).compiled.columns).toEqual({ version: { kind: 'scalar', name: 'UInt64' }, value: { kind: 'scalar', name: 'Float64' } });
  }
  const erased: Query<Versioned & { stock_index: number }> = from(db.metric_group_ots_component_indices);
  const fallback = latest(erased).aggregate(g => ({ value: sum(g.stock_index) }));
  for (const backend of backends) expect(backend.compile(fallback.ir).compiled.columns).toEqual({ value: { kind: 'scalar', name: 'Float64' } });
});

it('anchors each physical metric value and a nonempty recursive all-six-table composition', async () => {
  // First entity/version/week is seq=0: the later duplicate adds exactly 1000.
  // Constants are independently checked against the seed formula, not native/build output.
  for (const [metric, id, value] of [
    ['availability', 'cmp_0', 1674.29], ['componentIndices', 'cmp_0', 1357.24],
    ['partIndices', 'part_0', 1147.91], ['price', 'part_0', 1548.54],
  ] as const) {
    const rows = await check({ scope: { tenant: 'acme', start: 0, week: 0 }, tree: { op: 'metric', metric, latest: false, attached: true, cross: false }, end: 'bag' });
    expect(rows.filter(r => 'id' in r && r.id === id && r.at.getTime() === Date.UTC(2026, 3, 27))).toEqual([
      { tenant: 'acme', id, at: new Date('2026-04-27T00:00:00.000Z'), version: 1, value },
    ]);
  }
  const leaf = (metric: 'availability' | 'componentIndices' | 'partIndices' | 'price') => ({ op: 'metric', metric, latest: true, attached: false, cross: true } as const);
  const recipe: Recipe = { scope: { tenant: 'acme', start: 398, week: 0 }, tree: {
    op: 'union', repeat: false,
    left: { op: 'union', repeat: false, left: leaf('availability'), right: leaf('componentIndices') },
    right: { op: 'union', repeat: false, left: leaf('partIndices'), right: leaf('price') },
  }, end: 'bag' };
  expect(await check(recipe)).toHaveLength(16);
  expect(await check({ ...recipe, tree: { op: 'distinct', input: recipe.tree } })).toHaveLength(12);
  expect(await check({ ...recipe, end: 'share' })).toHaveLength(16);
  expect(await check({ ...recipe, end: 'limit' })).toHaveLength(7);
  const rollupRows = await check({ ...recipe, end: 'rollup' });
  expect(rollupRows).toEqual([{ tenant: 'acme', rows: 16n, entities: 3n, total: expect.any(Number) }]);
});

it('anchors history values, latest ties, run/stream, early return and subsequent reuse', async () => {
  const scope = { tenant: 'acme', start: 0, week: 0 };
  const r: Recipe = { scope, tree: { op: 'metric', metric: 'availability', latest: false, attached: false, cross: false }, end: 'bag' };
  const expected = await check(r);
  const duplicateCounts = await driver.query({ query: "SELECT (SELECT count() FROM metric_group_ots_component_market_availability WHERE tenantId='acme' AND entityId IN ('cmp_0','cmp_1','cmp_2','cmp_3') AND effectiveAt BETWEEN toDateTime64('2026-04-27',3) AND toDateTime64('2026-05-04',3)) AS raw,(SELECT count() FROM metric_group_ots_component_market_availability FINAL WHERE tenantId='acme' AND entityId IN ('cmp_0','cmp_1','cmp_2','cmp_3') AND effectiveAt BETWEEN toDateTime64('2026-04-27',3) AND toDateTime64('2026-05-04',3)) AS final", format: 'JSONEachRow' });
  try { expect(await duplicateCounts.json()).toEqual([{ raw: '22', final: '20' }]); } finally { duplicateCounts.close(); }
  expect(independentKeys(expected.filter(row => 'id' in row && row.id === 'cmp_0'), 'bag', false)).toEqual(independentKeys([
    { tenant: 'acme', id: 'cmp_0', at: new Date('2026-04-27T00:00:00.000Z'), version: 1, value: 1674.29 },
    { tenant: 'acme', id: 'cmp_0', at: new Date('2026-05-04T00:00:00.000Z'), version: 1, value: 364.98 },
  ], 'bag', false));
  for (const metric of ['availability', 'componentIndices', 'partIndices', 'price'] as const) {
    const crossing: Recipe = { scope: { ...scope, start: 398 }, tree: { op: 'metric', metric, latest: true, attached: false, cross: true }, end: 'bag' };
    const crossed = await check(crossing);
    expect(crossed).toHaveLength(4);
    if (metric === 'price' || metric === 'partIndices') expect(new Set(independentKeys(crossed, 'bag', false)).size).toBe(2); // two components share the same part.
    const recipe: Recipe = { ...r, tree: { op: 'metric', metric, latest: true, attached: false, cross: false } };
    const q = metricSource(metric, scope, true), nativeRows = await check(recipe);
    expect(nativeRows).toHaveLength(8); // max version ties at two distinct effectiveAt values per entity.
    for (const backend of backends) {
      const client = createClientFromBackend(backend);
      for (const rows of [await client.run(q), await collect(client.stream(q))]) expect(independentKeys(rows, 'bag', false)).toEqual(independentKeys(nativeRows, 'bag', false));
      const cursor = client.stream(q);
      expect((await cursor.next()).done).toBe(false);
      await cursor.return();
      expect(await collect(client.stream(q))).toHaveLength(8);
    }
  }
});
