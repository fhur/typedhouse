import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { count, crossJoin, join, unionAll, type Caps } from '@chql/core';
import { createClickHouseBackend } from '../src/index.js';
import { collect, keys, verify } from './backend-harness.js';
import { build, native, recipeArbitrary, seed, source, topology, type Recipe } from './pruning-arbitrary.js';
import { pruneColumns } from '../../compiler/src/prune-columns.js';
import { planSelects } from '../../compiler/src/plan-selects.js';
import { emitPlanned, validateRel } from '../../compiler/src/emit-naive.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { max_execution_time: 10, max_result_rows: '5000', result_overflow_mode: 'throw' as const } };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE pruning_wide (id String,tenant String,amount UInt64,spare String,ids Array(String),waste String) ENGINE=MergeTree ORDER BY (tenant,id)' });
  await driver.insert({ table: 'pruning_wide', values: [
    { id: 'a', tenant: 'acme', amount: '2', spare: 'x', ids: ['p', 'p'], waste: 'unused' },
    { id: 'b', tenant: 'acme', amount: '3', spare: 'y', ids: [], waste: 'unused' },
    { id: 'a', tenant: 'other', amount: '5', spare: 'z', ids: ['orphan'], waste: 'unused' },
  ], format: 'JSONEachRow' });
}, 120000);
afterAll(async () => { for (const b of backends) await b.close(); await driver?.close(); await container?.stop(); });
async function direct(recipe: Recipe) {
  const result = await driver.query({ query: native(recipe), format: 'JSONEachRow' });
  try { return (await result.json<{ id: string; amount: string }>()).map(r => recipe.nested ? { a: { id: r.id }, b: { amount: BigInt(r.amount) } } : { id: r.id, amount: BigInt(r.amount) }); }
  finally { result.close(); }
}
async function check(recipe: Recipe) {
  const q = build(recipe), expected = await direct(recipe);
  const plans = backends.map(b => b.compile(q.ir));
  try {
    expect(plans[0]!.compiled.columns).toEqual(plans[1]!.compiled.columns);
    expect(plans[0]!.compiled.columnPaths).toEqual(plans[1]!.compiled.columnPaths);
    for (const [i, backend] of backends.entries()) {
      const rows = (await collect(backend.run(plans[i]!))).flat();
      expect(keys<unknown, Caps>(q, rows)).toEqual(keys<unknown, Caps>(q, expected));
    }
  } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.map(p => ({ sql: p.compiled.sql, params: p.compiled.params })))}`, { cause }); }
  return expected;
}
const anchor: Recipe = { tree: { kind: 'scan' }, fence: 'none', take: 12, offset: 0, tenant: 'acme', renames: 0, nested: true };
it('anchors disjoint shared demands, duplicate expansions and full-interface fences independently', async () => {
  const expected = [{ a: { id: 'a' }, b: { amount: 2n } }, { a: { id: 'a' }, b: { amount: 3n } }, { a: { id: 'b' }, b: { amount: 2n } }, { a: { id: 'b' }, b: { amount: 3n } }];
  expect(keys<unknown, Caps>(build(anchor), await check(anchor))).toEqual(keys<unknown, Caps>(build(anchor), expected));
  expect(await check({ ...anchor, tree: { kind: 'array' } })).toHaveLength(4);
  expect(await check({ ...anchor, tree: { kind: 'leftArray' } })).toHaveLength(9);
  expect(await check({ ...anchor, tree: { kind: 'leftArray' }, fence: 'distinct' })).toHaveLength(4);
  expect(await check({ ...anchor, tree: { kind: 'array' }, fence: 'limit', take: 1 })).toHaveLength(1);
  expect(await check({ ...anchor, tree: { kind: 'shared', left: { kind: 'array' } } })).toHaveLength(16);
});
it('executes 500 bounded variable nested/shared recipes with independent native bag anchors', async () => {
  const shapes = new Set<string>();
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async recipe => { shapes.add(topology(recipe.tree)); await check(recipe); }), { seed: Number(process.env.CHQL_PRUNING_SEED ?? seed), numRuns: 500, ...(process.env.CHQL_PRUNING_PATH ? { path: process.env.CHQL_PRUNING_PATH } : {}) });
  console.info('pruning differential', { runs: result.numRuns, seed: result.seed, topologies: shapes.size, milliseconds: Math.round(performance.now() - start) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500); expect(shapes.size).toBeGreaterThan(50);
}, 120000);
it('detects a real dropped physical dependency, shrinks and replays the failing plan', () => {
  const property = fc.property(recipeArbitrary, recipe => {
    const q = build(recipe), validated = validateRel(q.ir);
    const columns = new Map(pruneColumns(q.ir));
    // Simulate a shared-demand union bug: keep the first consumer (id), lose
    // the later amount demand, retaining an existing carrier, not an empty list.
    if (!topology(recipe.tree).includes('shared')) return;
    for (const [rel, leaves] of columns) if (rel.kind === 'Scan') columns.set(rel, leaves.filter(l => l.path[0] !== 'amount'));
    try { emitPlanned(planSelects(q.ir, Object.values(validated.nodes), columns)); }
    catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(backends.map(b => { const p = b.compile(q.ir).compiled; return { sql: p.sql, params: p.params }; }))}`, { cause }); }
  });
  const result = fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true); expect(result.numShrinks).toBeGreaterThan(0);
  expect(String(result.errorInstance)).toContain('missing_physical_column'); expect(String(result.errorInstance)).toContain('params');
  const replay = fc.check(property, { seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  console.info('pruning demand-loss fault', { shrinks: result.numShrinks, path: result.counterexamplePath, seed });
});
it('retains multiplicity-only sides, grouping, UNION and total-order LIMIT semantics', async () => {
  const q = crossJoin({ a: source.arrayJoin(r => r.ids, 'p'), b: source }).aggregate(() => ({ n: count() }));
  await verify(backends, q, [{ n: 9n }], async () => [{ n: 9n }]);
  const grouped = source.groupBy(r => ({ tenant: r.tenant })).aggregate(() => ({ n: count() })).map(r => ({ n: r.n })).orderBy(r => r.n);
  await verify(backends, grouped, [{ n: 1n }, { n: 2n }], async () => [{ n: 1n }, { n: 2n }], true);
  const selected = source.map(r => ({ id: r.id, tenant: r.tenant }));
  const u = unionAll(selected, selected).distinct().map(r => ({ id: r.id })).orderBy(r => r.id).limit(2);
  await verify(backends, u, [{ id: 'a' }, { id: 'a' }], async () => [{ id: 'a' }, { id: 'a' }], true);
});
it('executes late disjoint consumers of a shared nested join in either discovery order', async () => {
  const shared = join({ left: source, right: source }).on(r => [r.left.id.eq(r.right.id), r.left.tenant.eq(r.right.tenant)])
    .leftArrayJoin(r => r.right.ids, 'element');
  const early = shared.where(r => r.left.tenant.eq('acme')).map(r => ({ id: r.left.id }));
  const late = shared.orderBy(r => r.right.amount).thenBy(r => r.element).limit(2)
    .map(r => ({ value: r.right.amount, discarded: r.left.spare }))
    .map(r => ({ renamed: r.value })).map(r => ({ amount: r.renamed }));
  for (const reverse of [false, true]) {
    const pair = reverse ? crossJoin({ late, early }) : crossJoin({ early, late });
    const q = pair.map(r => ({ id: r.early.id, amount: r.late.amount }));
    const expected = [{ id: 'a', amount: 2n }, { id: 'a', amount: 2n }, { id: 'a', amount: 2n }, { id: 'a', amount: 2n }, { id: 'b', amount: 2n }, { id: 'b', amount: 2n }];
    await verify(backends, q, expected, async () => {
      const expanded = 'SELECT l.id AS id,l.tenant AS tenant,r.amount AS amount,e FROM pruning_wide l INNER ALL JOIN pruning_wide r ON l.id=r.id AND l.tenant=r.tenant LEFT ARRAY JOIN r.ids AS e';
      const result = await driver.query({ query: `SELECT a.id AS id,b.amount AS amount FROM (SELECT id FROM (${expanded}) WHERE tenant='acme') a CROSS JOIN (SELECT amount FROM (${expanded}) ORDER BY amount,e LIMIT 2) b ORDER BY id,amount`, format: 'JSONEachRow' });
      try { return (await result.json<{ id: string; amount: string }>()).map(r => ({ id: r.id, amount: BigInt(r.amount) })); }
      finally { result.close(); }
    });
  }
});
it('preserves empty multiplicity-only sides and constant carrier counts through fences', async () => {
  const empty = source.where(r => r.tenant.eq('missing')).leftArrayJoin(r => r.ids, 'element');
  for (const q of [crossJoin({ a: source, b: empty }).aggregate(() => ({ n: count() })), crossJoin({ b: empty, a: source }).aggregate(() => ({ n: count() }))]) {
    await verify(backends, q, [{ n: 0n }], async () => {
      const result = await driver.query({ query: "SELECT count() AS n FROM pruning_wide a CROSS JOIN (SELECT id FROM pruning_wide LEFT ARRAY JOIN ids AS element WHERE tenant='missing') b", format: 'JSONEachRow' });
      try { return (await result.json<{ n: string }>()).map(r => ({ n: BigInt(r.n) })); }
      finally { result.close(); }
    });
  }
});
it('records focused MergeTree read-column evidence including predicate and ON dependencies', async () => {
  const cases = [source.where(r => r.tenant.eq('acme')).map(r => ({ id: r.id })), join({ a: source, b: source }).on(r => r.a.tenant.eq(r.b.tenant)).map(r => ({ id: r.a.id }))];
  for (const q of cases) {
    const compiled = backends[0]!.compile(q.ir).compiled;
    const result = await driver.query({ query: `EXPLAIN PLAN actions = 1 ${compiled.sql}`, query_params: compiled.params, format: 'TabSeparatedRaw' });
    try {
      const text = await result.text();
      expect(text).toContain('ReadFromMergeTree');
      expect(text).toContain('tenant'); expect(text).toContain('id');
      expect(text).not.toContain('waste'); expect(text).not.toContain('spare'); expect(text).not.toContain('amount'); expect(text).not.toContain('ids');
      console.info('pruning focused EXPLAIN', { sql: compiled.sql, plan: text });
    } finally { result.close(); }
  }
});
