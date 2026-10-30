import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, count, crossJoin, from, join, scalar, sum, table, unionAll, type Caps } from '@typedhouse/core';
import { createClickHouseBackend } from '../src/index.js';
import { collect, keys, verify } from './backend-harness.js';
import { build, decodeNative, native, recipeArbitrary, seed, shape, type Recipe } from './cte-arbitrary.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
let warning: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  await driver.command({ query: 'CREATE TABLE t0 (id String, __typedhouse_input String, t1 String) ENGINE=Memory' });
  await driver.insert({ table: 't0', values: [{ id: 'a', __typedhouse_input: 'i', t1: 'j' }], format: 'JSONEachRow' });
}, 120000);
afterAll(async () => { warning?.mockRestore(); for (const b of backends) await b.close(); await driver?.close(); await container?.stop(); });
async function direct(r: Recipe) {
  const result = await driver.query({ query: native(r), format: 'JSONEachRow' });
  try { return (await result.json<{ id: string; amount: string; first?: string; second?: string }>()).map(row => decodeNative(r, row)); }
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
    }
  } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.map(p => ({ sql: p.compiled.sql, params: p.compiled.params })))}`, { cause }); }
  return expected;
}
const anchor: Recipe = { tree: { kind: 'scan' }, mode: 'union', fence: 'none', take: 3, renames: 0, nested: false };
it('executes 500 fixed-seed variable shared DAGs through official Backend plugins and native decoded bags', async () => {
  const shapes = new Set<string>();
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async r => { shapes.add(shape(r)); await check(r); }), { seed: Number(process.env.TYPEDHOUSE_CTE_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_CTE_PATH ? { path: process.env.TYPEDHOUSE_CTE_PATH } : {}) });
  console.info('CTE differential', { runs: result.numRuns, seed: result.seed, shapes: shapes.size, milliseconds: Math.round(performance.now() - start) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500); expect(shapes.size).toBeGreaterThan(100);
}, 120000);
it('anchors repeated references, empty/duplicate expansions, scalar totals and latest independently', async () => {
  const rows = [{ id: 'a', amount: 2n }, { id: 'b', amount: 3n }, { id: 'a', amount: 5n }];
  const q = build(anchor);
  expect(keys<unknown, Caps>(q, await check(anchor))).toEqual(keys<unknown, Caps>(q, [...rows, ...rows, ...rows]));
  expect(await check({ ...anchor, mode: 'scalar' })).toEqual(rows.map(r => ({ ...r, first: 10n, second: 10n })));
  expect(keys<unknown, Caps>(build({ ...anchor, mode: 'latest' }), await check({ ...anchor, mode: 'latest' }))).toEqual(keys<unknown, Caps>(build({ ...anchor, mode: 'latest' }), [rows[1]!, rows[2]!]));
  expect(await check({ ...anchor, tree: { kind: 'array' } })).toHaveLength(9);
  expect(await check({ ...anchor, tree: { kind: 'leftArray' } })).toHaveLength(12);
  expect(await check({ ...anchor, fence: 'limit', take: 0 })).toEqual([]);
});
it('executes collision-safe physical names and checks a total-order client sequence', async () => {
  const s = from(table('t0', { id: col.String, __typedhouse_input: col.String, t1: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const q = join({ t2: s, __typedhouse_input: s, t0: s }).on(r => [r.t2.id.eq(r.__typedhouse_input.id), r.t2.id.eq(r.t0.id)]).map(r => ({ id: r.t2.id, x: r.__typedhouse_input.__typedhouse_input, y: r.t0.t1 })).orderBy(r => r.id);
  await verify(backends, q, [{ id: 'a', x: 'i', y: 'j' }], async () => {
    const result = await driver.query({ query: 'SELECT a.id AS id,b.__typedhouse_input AS x,c.t1 AS y FROM t0 a INNER ALL JOIN t0 b ON a.id=b.id INNER ALL JOIN t0 c ON a.id=c.id ORDER BY id', format: 'JSONEachRow' });
    try { return await result.json<{ id: string; x: string; y: string }>(); } finally { result.close(); }
  }, true);
});
it('executes nested hint diamonds across scalar and IN scopes with case-sensitive alias collisions', async () => {
  const source = from(table('pruning_wide', { id: col.String, amount: col.UInt64 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] }));
  const hinted = source.where(r => r.amount.gt(2n)).cte();
  const pair = crossJoin({ t0: hinted, T0: hinted });
  const diamond = unionAll(pair, pair).cte();
  const total = hinted.aggregate(g => sum(g.amount));
  const n = scalar(diamond.aggregate(() => count()));
  const set = hinted.map(r => r.id);
  const q = diamond.map(r => ({ id: r.t0.id, amount: r.T0.amount, total: scalar(total), first: n, second: n, member: r.t0.id.in(set) }));
  const expected = ['a', 'b'].flatMap(id => [3n, 3n, 5n, 5n].map(amount => ({ id, amount, total: 8n, first: 8n, second: 8n, member: true })));
  await verify(backends, q, expected, async () => {
    const result = await driver.query({ query: `SELECT a.id AS id,b.amount AS amount,(SELECT sum(amount) FROM pruning_wide WHERE amount>2) AS total,toUInt64(8) AS first,toUInt64(8) AS second,a.id IN (SELECT id FROM pruning_wide WHERE amount>2) AS member FROM (SELECT id FROM pruning_wide WHERE amount>2) a CROSS JOIN (SELECT amount FROM pruning_wide WHERE amount>2) b CROSS JOIN numbers(2) copies ORDER BY id,amount`, format: 'JSONEachRow' });
    try { return (await result.json<{ id: string; amount: string; total: string; first: string; second: string; member: number }>()).map(r => ({ ...r, amount: BigInt(r.amount), total: BigInt(r.total), first: BigInt(r.first), second: BigInt(r.second), member: Boolean(r.member) })); }
    finally { result.close(); }
  });
});
it('executes quoted dotted table names without confusing qualified paths or CTE names', async () => {
  await driver.command({ query: 'CREATE TABLE `t0.part` (id String) ENGINE=Memory' });
  await driver.insert({ table: '`t0.part`', values: [{ id: 'dotted' }, { id: 'dotted' }], format: 'JSONEachRow' });
  const s = from(table('t0.part', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const q = crossJoin({ t0: s, 't0.part': s, T0: s }).map(r => ({ id: r['t0.part'].id }));
  await verify(backends, q, Array.from({ length: 8 }, () => ({ id: 'dotted' })), async () => {
    const result = await driver.query({ query: 'SELECT a.id AS id FROM `t0.part` a CROSS JOIN `t0.part` b CROSS JOIN `t0.part` c', format: 'JSONEachRow' });
    try { return await result.json<{ id: string }>(); } finally { result.close(); }
  });
});
it('detects a genuine missing-CTE-occurrence wrong result after IO, shrinks and replays', async () => {
  let executions = 0;
  const property = fc.asyncProperty(recipeArbitrary, async r => {
    if (r.mode !== 'union') return;
    const q = build(r);
    if (q.ir.kind !== 'Union') throw new Error('expected union');
    // Simulate erroneously deduplicating repeated same-parent reference slots.
    // Prepare the corrupted graph through the official Backend too: plans are
    // instance-owned and must not be forged to bypass the driver's preparation.
    const faultyPlan = backends[0]!.compile({ ...q.ir, inputs: q.ir.inputs.slice(1) });
    const faulty = faultyPlan.compiled, prepared = backends[0]!.compile(q.ir);
    const actual = (await collect(backends[0]!.run(faultyPlan))).flat();
    executions++;
    const expected = await direct(r);
    try { expect(keys<unknown, Caps>(q, actual)).toEqual(keys<unknown, Caps>(q, expected)); }
    catch (cause) { throw new Error(`wrong-result after IO\n${JSON.stringify({ faulty: { sql: faulty.sql, params: faulty.params }, correct: prepared.compiled.sql, naive: backends[1]!.compile(q.ir).compiled.sql })}`, { cause }); }
  });
  const result = await fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true); expect(result.numShrinks).toBeGreaterThan(0); expect(executions).toBeGreaterThan(0);
  expect(String(result.errorInstance)).toContain('wrong-result after IO');
  const replay = await fc.check(property, { seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  console.info('CTE occurrence-loss fault', { seed, shrinks: result.numShrinks, path: result.counterexamplePath, recipe: JSON.stringify(result.counterexample), executions, evidence: String(result.errorInstance) });
}, 120000);
it('records focused real EXPLAIN and SQL for supported latest and scalar-total shapes', async () => {
  for (const mode of ['latest', 'scalar'] as const) {
    const q = build({ ...anchor, mode }), compiled = backends[0]!.compile(q.ir).compiled;
    const result = await driver.query({ query: `EXPLAIN PLAN actions = 1 ${compiled.sql}`, query_params: compiled.params, format: 'TabSeparatedRaw' });
    try { const text = await result.text(); expect(text).toContain('ReadFromMergeTree'); expect(text).toContain(mode === 'latest' ? 'Aggregating' : 'COLUMN Const(Nullable(UInt64))'); console.info('CTE focused EXPLAIN', { mode, sql: compiled.sql, plan: text }); }
    finally { result.close(); }
  }
});
