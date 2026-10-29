import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, from, max, scalar, sum, table, val, unionAll, type Caps } from '@chql/core';
import { createClickHouseBackend } from '../src/index.js';
import { collect, keys, verify } from './backend-harness.js';
import { source } from './pruning-arbitrary.js';
import { build, buildComposition, native, recipeArbitrary, seed, shape, anchor, type Recipe } from './aggregate-union-arbitrary.js';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
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
async function direct(r: Recipe) {
  const result = await driver.query({ query: native(r), format: 'JSONEachRow' });
  try { return (await result.json<{ key: string; n: string; total: string; highest: string }>()).map(row => ({ key: row.key, n: BigInt(row.n), total: BigInt(row.total), highest: BigInt(row.highest) })); }
  finally { result.close(); }
}
async function check(r: Recipe) {
  const q = build(r), expected = await direct(r), plans = backends.map(b => b.compile(q.ir));
  try {
    expect(plans[0]!.compiled.columns).toEqual(plans[1]!.compiled.columns);
    expect(plans[0]!.compiled.columnPaths).toEqual(plans[1]!.compiled.columnPaths);
    for (const [i, backend] of backends.entries()) {
      const rows = (await collect(backend.run(plans[i]!))).flat();
      expect(keys<unknown, Caps>(q, rows)).toEqual(keys<unknown, Caps>(q, expected));
      expect(rows).toEqual(expected); // key is the complete unique grouping key.
    }
  } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.map(p => ({ sql: p.compiled.sql, params: p.compiled.params })))}`, { cause }); }
  return expected;
}
it('runs 500 fixed-seed recursive aggregate/Union recipes against native bags with rule evidence', async () => {
  const shapes = new Set<string>(); let agg = 0, union = 0;
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async r => {
    shapes.add(shape(r.composition)); const hits = rewriteRel(build(r).ir).hits; agg += hits.PushFilterAggKey; union += hits.PushFilterUnion;
    await check(r);
  }), { seed: Number(process.env.CHQL_AGG_UNION_SEED ?? seed), numRuns: 500, ...(process.env.CHQL_AGG_UNION_PATH ? { path: process.env.CHQL_AGG_UNION_PATH } : {}) });
  console.info('aggregate/Union differential', { runs: result.numRuns, seed: result.seed, shapes: shapes.size, agg, union, milliseconds: Math.round(performance.now() - start) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500); expect(shapes.size).toBeGreaterThan(100); expect(agg).toBeGreaterThanOrEqual(500); expect(union).toBeGreaterThan(100);
}, 180000);
it('anchors rollups, shared latest, repeated/empty branches, HAVING and ordered run/stream', async () => {
  const expected = [{ key: 'a', n: 2n, total: 7n, highest: 5n }];
  await verify(backends, build(anchor), expected, () => direct(anchor), true);
  expect(await check({ ...anchor, composition: { kind: 'leaf', tree: { kind: 'scan' }, latest: true } })).toEqual([{ key: 'a', n: 1n, total: 5n, highest: 5n }]);
  for (const all of [true, false]) {
    const r: Recipe = { ...anchor, composition: { kind: 'union', left: anchor.composition, right: anchor.composition, all, repeat: true, fence: false, take: 3 } };
    expect(await check(r)).toEqual([{ key: 'a', n: all ? 6n : 2n, total: all ? 21n : 7n, highest: 5n }]);
    expect(await check({ ...r, offset: 1 })).toEqual([]);
    expect(await check({ ...r, minimum: 10 })).toEqual([]);
  }
  const empty = source.limit(0).aggregate(() => ({ n: count() }));
  await verify(backends, empty, [{ n: 0n }], async () => [{ n: 0n }], true);
  await verify(backends, empty.where(() => val(false)), [], async () => [], true);
});
it('executes nullable keys, alias collisions and grouped-key versus aggregate-name bindings conservatively', async () => {
  await driver.command({ query: 'CREATE TABLE nullable_rollup (k Nullable(String), n UInt64) ENGINE=Memory' });
  await driver.insert({ table: 'nullable_rollup', values: [{ k: null, n: '2' }, { k: null, n: '3' }, { k: 'x', n: '4' }], format: 'JSONEachRow' });
  const s = from(table('nullable_rollup', { k: col.Nullable(col.String), n: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const q = s.groupBy(r => ({ key: r.k })).aggregate(g => ({ n: sum(g.n) })).where(r => r.key.isNull().and(r.n.gt(4n)));
  expect(rewriteRel(q.ir).hits.PushFilterAggKey).toBe(0);
  expect(backends[0]!.compile(q.ir).compiled.sql).not.toContain('HAVING');
  await verify(backends, q, [{ key: null, n: 5n }], async () => {
    const result = await driver.query({ query: 'SELECT k AS key,sum(n) AS total FROM nullable_rollup GROUP BY k HAVING isNull(k) AND total>4', format: 'JSONEachRow' });
    try { return (await result.json<{ key: null; total: string }>()).map(r => ({ key: r.key, n: BigInt(r.total) })); } finally { result.close(); }
  });
  const bound = source.groupBy(r => ({ amount: r.id })).aggregate(g => ({ id: max(g.amount) })).where(r => r.amount.eq('a').and(r.id.gt(3n)));
  await verify(backends, bound, [{ amount: 'a', id: 5n }], async () => {
    const result = await driver.query({ query: "SELECT id AS key,max(amount) AS highest FROM pruning_wide GROUP BY id HAVING key='a' AND highest>3", format: 'JSONEachRow' });
    try { return (await result.json<{ key: string; highest: string }>()).map(r => ({ amount: r.key, id: BigInt(r.highest) })); } finally { result.close(); }
  });
  const empty = source.limit(0), duplicated = unionAll(empty, source, empty, source).where(r => r.id.eq('a')).aggregate(() => ({ n: count() }));
  await verify(backends, duplicated, [{ n: 4n }], async () => [{ n: 4n }]);
});
it('retains shared materialized rollups across scalar and IN scopes with conflicting consumers', async () => {
  const shared = source.groupBy(r => ({ key: r.id })).aggregate(g => ({ total: sum(g.amount) })).materialize();
  const total = shared.aggregate(g => ({ total: sum(g.total) }));
  const selected = shared.where(r => r.total.gt(4n)).map(r => ({ key: r.key }));
  const q = unionAll(shared.where(r => r.key.eq('a')), shared.where(r => r.key.eq('b')), shared)
    .where(r => r.key.in(selected)).map(r => ({ key: r.key, total: r.total, overall: scalar(total) }));
  await verify(backends, q, [{ key: 'a', total: 7n, overall: 10n }, { key: 'a', total: 7n, overall: 10n }], async () => {
    const result = await driver.query({ query: "WITH grouped AS (SELECT id AS key,sum(amount) AS total FROM pruning_wide GROUP BY id) SELECT key,total,(SELECT sum(total) FROM grouped) AS overall FROM (SELECT * FROM grouped WHERE key='a' UNION ALL SELECT * FROM grouped WHERE key='b' UNION ALL SELECT * FROM grouped) WHERE key IN (SELECT key FROM grouped WHERE total>4)", format: 'JSONEachRow' });
    try { return (await result.json<{ key: string; total: string; overall: string }>()).map(r => ({ key: r.key, total: BigInt(r.total), overall: BigInt(r.overall) })); }
    finally { result.close(); }
  });
  const planned = backends[0]!.compile(q.ir).compiled;
  expect(planned.sql).toContain('WITH ');
  expect(planned.sql).not.toContain('HAVING'); // Materialize is a block boundary, including in the IN scope.
  expect(planned.sql).toContain('WHERE `__chql_input`.`total` > {p2:UInt64}');
  expect([...new Set([...planned.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))]).toEqual(Object.keys(planned.params));
});
it('retains fallible aggregate operands and real conversion errors', async () => {
  const q = source.groupBy(r => ({ key: r.id })).aggregate(g => ({ bad: sum(cast(g.spare, col.UInt64)) })).where(r => r.key.eq('a'));
  expect(rewriteRel(q.ir).hits.PushFilterAggKey).toBe(0);
  for (const backend of backends) {
    const plan = backend.compile(q.ir);
    await expect(collect(backend.run(plan))).rejects.toThrow();
  }
  await expect(driver.query({ query: "SELECT id AS key,sum(CAST(spare AS UInt64)) AS bad FROM pruning_wide GROUP BY id HAVING key='a'", format: 'JSONEachRow' }).then(async r => {
    try { await r.json(); } finally { r.close(); }
  })).rejects.toThrow();
});
it('detects occurrence loss after real IO and shrinks/replays a variable composition', async () => {
  let executions = 0;
  const property = fc.asyncProperty(recipeArbitrary, async r => {
    const s = buildComposition(r.composition), q = unionAll(s, s, s);
    if (q.ir.kind !== 'Union') throw new Error('shape');
    const correct = backends[1]!.compile(q.ir), faulty = backends[0]!.compile({ ...q.ir, inputs: q.ir.inputs.slice(1) });
    const expected = (await collect(backends[1]!.run(correct))).flat();
    const actual = (await collect(backends[0]!.run(faulty))).flat(); executions++;
    try { expect(keys(q, actual)).toEqual(keys(q, expected)); }
    catch (cause) { throw new Error(`wrong-result after IO ${JSON.stringify({ faulty: faulty.compiled.sql, params: faulty.compiled.params, naive: correct.compiled.sql })}`, { cause }); }
  });
  const result = await fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true); expect(result.numShrinks).toBeGreaterThan(0); expect(String(result.errorInstance)).toContain('wrong-result after IO');
  const replay = await fc.check(property, { seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  console.info('aggregate/Union fault', { seed, path: result.counterexamplePath, shrinks: result.numShrinks, executions, recipe: result.counterexample, evidence: String(result.errorInstance) });
}, 120000);
it('records a focused unfenced aggregate EXPLAIN structural snapshot', async () => {
  const q = source.groupBy(r => ({ key: r.id })).aggregate(() => ({ n: count() })).where(r => r.n.gt(0n)).orderBy(r => r.key).limit(2);
  const compiled = backends[0]!.compile(q.ir).compiled;
  expect(compiled.sql.match(/SELECT/g)).toHaveLength(1);
  const result = await driver.query({ query: `EXPLAIN PLAN ${compiled.sql}`, query_params: compiled.params, format: 'TabSeparatedRaw' });
  try {
    const text = await result.text();
    expect(text).not.toContain('Subquery');
    expect(text).toContain('Aggregating'); expect(text).toContain('ReadFromMergeTree');
    expect(text.split('\n').map(l => l.trim()).filter(l => /^(Aggregating|ReadFromMergeTree)/.test(l))).toEqual(['Aggregating', 'ReadFromMergeTree (default.pruning_wide)']);
    console.info('aggregate focused EXPLAIN', { sql: compiled.sql, plan: text });
  } finally { result.close(); }
});
