import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { canonicalKey, count } from '@typedhouse/core';
import { createClickHouseBackend, type Backend } from '../src/index.js';
import { differential, decodedRecord } from './backend-harness.js';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { build, foldsToOneSelect, items, native, recipeArbitrary, seed, shape, type Recipe } from './array-join-blocks-arbitrary.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
// Empty arrays (c), duplicate elements (a: 'p','p'; d: two equal tuples), NULL and '' categories, NULL mpns.
const values = [
  { tenant: 'acme', id: 'a', category: 'visible', ids: ['p', 'p', 'q'], parts: [{ id: 'x', mpn: 'p' }, { id: 'y', mpn: null }], amount: '2' },
  { tenant: 'acme', id: 'b', category: '', ids: ['p', 'orphan'], parts: [{ id: 'z', mpn: 'q' }], amount: '3' },
  { tenant: 'acme', id: 'c', category: null, ids: [], parts: [], amount: '0' },
  { tenant: 'acme', id: 'd', category: null, ids: ['q'], parts: [{ id: 'w', mpn: 'p' }, { id: 'w', mpn: 'p' }], amount: '7' },
  { tenant: 'other', id: 'a', category: 'hidden', ids: ['p'], parts: [{ id: 'v', mpn: null }], amount: '5' },
];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { max_execution_time: 10, max_result_rows: '1000', result_overflow_mode: 'throw' as const } };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: 'CREATE TABLE array_join_items (tenant String,id String,category Nullable(String),ids Array(String),parts Array(Tuple(id String, mpn Nullable(String))),amount UInt64) ENGINE=MergeTree ORDER BY (tenant,id)' });
  await driver.insert({ table: 'array_join_items', values, format: 'JSONEachRow' });
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
const anchor: Recipe = { tenant: 'acme', left: false, source: 'ids', before: 'safe', after: 'none', fence: 'none', project: true, minimum: 0, take: 6 };
it('anchors empty arrays, duplicate elements, LEFT defaults, NULL tuple fields and DISTINCT against hand-written SQL', async () => {
  const row = (tenant: string, id: string, part: string | null, amount: bigint) => ({ tenant, id, part, amount });
  expect(await check(anchor)).toEqual([row('acme', 'a', 'p', 2n), row('acme', 'a', 'p', 2n), row('acme', 'a', 'q', 2n), row('acme', 'b', 'orphan', 3n), row('acme', 'b', 'p', 3n), row('acme', 'd', 'q', 7n)]);
  // LEFT keeps the empty-array row with the element type's default, never NULL for String.
  expect(await check({ ...anchor, left: true, after: 'independent' })).toEqual([row('acme', 'a', 'p', 2n), row('acme', 'a', 'p', 2n), row('acme', 'a', 'q', 2n), row('acme', 'b', 'orphan', 3n), row('acme', 'b', 'p', 3n)]);
  expect(await check({ ...anchor, left: true, before: 'none', tenant: 'acme', after: 'none', fence: 'sort', take: 6, project: true })).toContainEqual(row('acme', 'c', '', 0n));
  // Tuple extraction: NULL mpns survive the expansion; LEFT over an empty tuple array yields NULL.
  expect(await check({ ...anchor, source: 'mpn' })).toEqual([row('acme', 'a', 'p', 2n), row('acme', 'a', null, 2n), row('acme', 'b', 'q', 3n), row('acme', 'd', 'p', 7n), row('acme', 'd', 'p', 7n)]);
  expect(await check({ ...anchor, source: 'mpn', left: true, after: 'alias', fence: 'distinct' })).toEqual([row('acme', 'a', 'p', 2n), row('acme', 'd', 'p', 7n)]);
  expect(await check({ ...anchor, source: 'mpn', left: true, before: 'none', fence: 'distinct' })).toContainEqual(row('acme', 'c', null, 0n));
  // Unsafe filter under an inner expansion keeps the nested emission (the selection and ordering above it open
  // their own blocks); under LEFT everything folds into one SELECT. Both agree natively.
  for (const left of [false, true]) {
    const recipe: Recipe = { ...anchor, before: 'unsafe', left };
    expect(backends[0]!.compile(build(recipe).ir).compiled.sql.match(/SELECT /g)).toHaveLength(left ? 1 : 4);
    expect(await check(recipe)).toHaveLength(left ? 8 : 7);
  }
});
it('executes 500 expansion recipes with PushFilterArrayJoin coverage, identical rows and meta under both alias settings', async () => {
  const hits = new Set<string>(), shapes = new Set<string>();
  let folded = 0;
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async recipe => {
    const rewritten = rewriteRel(build(recipe).ir);
    for (const [rule, n] of Object.entries(rewritten.hits)) if (n) hits.add(rule);
    shapes.add(shape(recipe));
    const sql = backends[0]!.compile(build(recipe).ir).compiled.sql;
    expect(sql.match(/SELECT /g)?.length === 1).toBe(foldsToOneSelect(recipe));
    if (foldsToOneSelect(recipe)) folded++;
    await check(recipe);
  }), { seed: Number(process.env.TYPEDHOUSE_ARRAY_JOIN_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_ARRAY_JOIN_PATH ? { path: process.env.TYPEDHOUSE_ARRAY_JOIN_PATH } : {}) });
  console.info('array-join-blocks differential', { runs: result.numRuns, seed: result.seed, milliseconds: Math.round(performance.now() - start), rules: [...hits].sort(), shapes: shapes.size, folded });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500);
  expect([...hits].sort()).toEqual(['MergeFilter', 'PushFilterArrayJoin']);
  expect(shapes.size).toBeGreaterThan(200);
  expect(folded).toBeGreaterThan(100);
}, 300000);
it('a DISTINCT folded under a Sort or Limit that a consumer prunes keeps the full row set natively (fix round 1)', async () => {
  // DISTINCT over whole rows keeps all five rows; the narrowing map must not turn it into DISTINCT tenant (two rows).
  const narrowed = items.distinct().orderBy(r => r.tenant).map(r => ({ tenant: r.tenant })).orderBy(r => r.tenant);
  const plans = backends.map(b => b.compile(narrowed.ir).compiled);
  expect(plans[0]!.sql).toContain('(SELECT DISTINCT `tenant`, `id`, `category`, `ids`, `parts`, `amount` FROM `array_join_items` ORDER BY `tenant` ASC)');
  const oracle = await driver.query({ query: 'SELECT tenant FROM (SELECT DISTINCT * FROM array_join_items ORDER BY tenant) ORDER BY tenant', format: 'JSONEachRow' });
  const expected = await oracle.json<Record<string, unknown>>().finally(() => oracle.close());
  expect(expected).toHaveLength(5);
  const first = await raw(plans[0]!.sql, plans[0]!.params, 0);
  for (const plan of plans) for (const setting of [0, 1] as const) expect(await raw(plan.sql, plan.params, setting)).toEqual(first);
  expect(first.data).toEqual(expected);
  expect(await differential(backends, narrowed, true)).toHaveLength(5);
  const grouped = items.distinct().orderBy(r => r.id).groupBy(r => ({ tenant: r.tenant })).aggregate(() => ({ c: count() })).orderBy(r => r.tenant);
  const counts = backends.map(b => b.compile(grouped.ir).compiled);
  const rows = await raw(counts[0]!.sql, counts[0]!.params, 0);
  expect(rows.data).toEqual([{ tenant: 'acme', c: '4' }, { tenant: 'other', c: '1' }]);
  for (const plan of counts) for (const setting of [0, 1] as const) expect(await raw(plan.sql, plan.params, setting)).toEqual(rows);
});
it('reads only the pruned columns through a folded ARRAY JOIN block', async () => {
  const query = items.arrayJoin(r => r.ids, 'part').where(r => r.tenant.eq('acme')).map(r => ({ id: r.id, part: r.part }));
  expect(rewriteRel(query.ir).hits.PushFilterArrayJoin).toBe(1);
  const compiled = backends[0]!.compile(query.ir).compiled;
  expect(compiled.sql).toBe('SELECT `id`, `part` FROM `array_join_items` ARRAY JOIN `ids` AS `part` WHERE `tenant` = {p0:String}');
  const result = await driver.query({ query: `EXPLAIN PLAN header = 1 ${compiled.sql}`, query_params: compiled.params, format: 'TabSeparatedRaw' });
  try {
    const text = await result.text();
    expect(text).toContain('ReadFromMergeTree');
    expect(text).toContain('ArrayJoin');
    expect(text).not.toContain('Subquery');
    for (const column of ['id', 'tenant', 'ids']) expect(text).toContain(column);
    for (const column of ['category', 'parts', 'amount']) expect(text).not.toContain(column);
    console.info('array-join focused EXPLAIN', { sql: compiled.sql, plan: text });
  } finally { result.close(); }
});
it('detects decoded duplicate loss across expansions, genuinely shrinks and exactly replays', async () => {
  const source = backends[1]!;
  const faulty: Backend = { name: 'array-join-duplicate-loss', compile: r => source.compile(r), async *run(plan) {
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
  console.info('array-join fault injection', { shrinks: result.numShrinks, path: result.counterexamplePath, seed: result.seed });
}, 120000);
