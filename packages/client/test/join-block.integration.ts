import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, print, parseCHType, table, type Caps } from '@typedhouse/core';
import { createClickHouseBackend } from '../src/index.js';
import { collect, keys } from './backend-harness.js';
import { build, buildColliding, colliding, collidingShape, native, nativeColliding, recipes, seed, shape, type Colliding, type Recipe } from './join-block-arbitrary.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
// Slice 4c: the same two emitters with prefer_column_name_to_alias = 1 sent as a client setting.
const preferColumn: ReturnType<typeof createClickHouseBackend>[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) preferColumn.push(createClickHouseBackend({ ...options, clickhouse_settings: { prefer_column_name_to_alias: 1 } }, mode));
  await driver.command({ query: 'CREATE TABLE pruning_wide (id String,tenant String,amount UInt64,spare String,ids Array(String),waste String) ENGINE=MergeTree ORDER BY (tenant,id)' });
  await driver.insert({ table: 'pruning_wide', format: 'JSONEachRow', values: [
    { id: 'a', tenant: 'acme', amount: '2', spare: 'x', ids: ['p', 'p'], waste: 'unused' },
    { id: 'b', tenant: 'acme', amount: '3', spare: 'y', ids: [], waste: 'unused' },
    { id: 'a', tenant: 'other', amount: '5', spare: 'z', ids: ['orphan'], waste: 'unused' },
  ] });
}, 120000);
afterAll(async () => { for (const b of [...backends, ...preferColumn]) await b.close(); await driver?.close(); await container?.stop(); });
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
  }), { seed: Number(process.env.TYPEDHOUSE_JOIN_BLOCK_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_JOIN_BLOCK_PATH ? { path: process.env.TYPEDHOUSE_JOIN_BLOCK_PATH } : {}) });
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

// Slice 4c: aggregate aliases colliding with join-input columns (identity read of a name both inputs carry, alias = another
// column, alias = a pruned/nested-scan column, colliding aggregate aliases, HAVING/ORDER BY by those names). Both emitters ×
// prefer_column_name_to_alias 0/1 agree in rows with an independent setting-free oracle, and server meta equals
// print(compiled.columns) in every cell. Both the folded and the fenced aggregate shapes must be generated.
async function serverMeta(sql: string, params: Record<string, string>, prefer: number) {
  const response = await driver.query({ query: sql, query_params: params, format: 'JSONCompact', clickhouse_settings: { prefer_column_name_to_alias: prefer ? 1 : 0, output_format_json_quote_64bit_integers: 1 } });
  try { return ((await response.json()) as { meta: { type: string }[] }).meta.map(m => print(parseCHType(m.type))); } finally { response.close(); }
}
async function directColliding(r: Colliding) {
  const response = await driver.query({ query: nativeColliding(r), format: 'JSONEachRow', clickhouse_settings: { output_format_json_quote_64bit_integers: 1 } });
  try { return (await response.json()).map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, ['amount', 'spare', 'n', 'total'].includes(k) ? BigInt(v as string) : v]))); } finally { response.close(); }
}
it('4c: runs 500 colliding-alias join aggregate recipes in both emitters x prefer_column_name_to_alias 0/1 (rows and meta)', async () => {
  const shapes = new Set<string>();
  const forms = { folded: 0, fenced: 0 };
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(colliding, async r => {
    shapes.add(collidingShape(r));
    const q = buildColliding(r);
    const cells = [...backends, ...preferColumn];
    const plans = cells.map(b => b.compile(q.ir));
    const optimized = plans[0]!.compiled.sql;
    // A root join block uses newline separators: folded = the root groups by a side read, fenced = by a derived leaf.
    forms[/\nGROUP BY `[ab]`\./.test(optimized) ? 'folded' : 'fenced']++;
    const expected = await directColliding(r);
    try {
      for (const p of plans) expect(p.compiled.columns).toEqual(plans[0]!.compiled.columns);
      const printed = Object.values(plans[0]!.compiled.columns).map(print);
      for (const [i, b] of cells.entries()) {
        expect(keys<unknown, Caps>(q, (await collect(b.run(plans[i]!))).flat()), b.name).toEqual(keys<unknown, Caps>(q, expected));
        expect(await serverMeta(plans[i]!.compiled.sql, plans[i]!.compiled.params, i < 2 ? 0 : 1)).toEqual(printed);
      }
    } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.slice(0, 2).map(p => ({ sql: p.compiled.sql, params: p.compiled.params })))}\n${nativeColliding(r)}`, { cause }); }
  }), { seed: Number(process.env.TYPEDHOUSE_JOIN_BLOCK_SEED ?? seed), numRuns: 500, ...(process.env.TYPEDHOUSE_JOIN_BLOCK_PATH ? { path: process.env.TYPEDHOUSE_JOIN_BLOCK_PATH } : {}) });
  console.info('join-block 4c colliding differential', { runs: result.numRuns, seed: result.seed, shapes: shapes.size, forms, milliseconds: Math.round(performance.now() - start) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBe(500); expect(shapes.size).toBeGreaterThan(200);
  expect(forms.folded).toBeGreaterThan(0); expect(forms.fenced).toBeGreaterThan(0);
}, 400000);
it('4c: the colliding variant detects a lost join condition under prefer_column_name_to_alias = 1, shrinks and replays', async () => {
  let executions = 0;
  const property = fc.asyncProperty(colliding, async r => {
    const q = buildColliding(r), correct = preferColumn[1]!.compile(q.ir), faulty = preferColumn[0]!.compile(buildColliding(r, true).ir);
    const expected = (await collect(preferColumn[1]!.run(correct))).flat();
    const actual = (await collect(preferColumn[0]!.run(faulty))).flat(); executions++;
    try { expect(keys<unknown, Caps>(q, actual)).toEqual(keys<unknown, Caps>(q, expected)); }
    catch (cause) { throw new Error(`wrong-result after IO ${JSON.stringify({ faulty: faulty.compiled.sql, naive: correct.compiled.sql })}`, { cause }); }
  });
  const result = await fc.check(property, { seed, numRuns: 500 });
  expect(result.failed).toBe(true); expect(result.numShrinks).toBeGreaterThan(0); expect(String(result.errorInstance)).toContain('wrong-result after IO');
  const replay = await fc.check(property, { seed, path: result.counterexamplePath!, numRuns: 500 });
  expect(replay.counterexample).toEqual(result.counterexample);
  console.info('join-block 4c colliding fault', { seed, path: result.counterexamplePath, shrinks: result.numShrinks, executions, recipe: JSON.stringify(result.counterexample) });
}, 180000);
