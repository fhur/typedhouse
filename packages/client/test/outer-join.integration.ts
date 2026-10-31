import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, join, leftJoin, outerColumnType, parseCHType, print, table, type CHType, type Column, type CompiledQuery } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend } from '../src/index.js';
import { rowDecoder } from '../src/decode.js';
import { collect, keys } from './backend-harness.js';
import { build, ddl, inserts, native, recipes, seed, shape, type Recipe } from './outer-join-arbitrary.js';
import { components, db, forTenant, latest } from '../../compiler/test/fixtures/corpus/low-stock.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const experimental = { allow_experimental_variant_type: 1, allow_experimental_dynamic_type: 1, allow_experimental_json_type: 1, allow_suspicious_low_cardinality_types: 1 } as const;
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  for (const file of ['schema.sql', 'seed.sql', 'type-corpus.sql']) {
    const sql = readFileSync(new URL(`../../compiler/test/fixtures/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.split(/;\s*\n/).filter(s => s.replace(/--[^\n]*/g, '').trim())) await driver.command({ query: statement });
  }
  // Kinds the fixture lacks, next to a one-row key table that never matches an empty side.
  await driver.command({ query: "CREATE TABLE probe_synthetic (id UInt8, v Variant(String, UInt64), d Dynamic, j JSON, lcfs LowCardinality(FixedString(4)), lcd LowCardinality(Date), lcu LowCardinality(UInt32), lcnf LowCardinality(Nullable(Float64)), ip4n Nullable(IPv4), nested Nested(a UInt8, b String), safn SimpleAggregateFunction(any, Nullable(String)), safa SimpleAggregateFunction(groupArrayArray, Array(UInt8)), safu SimpleAggregateFunction(sum, UInt64)) ENGINE=Memory", clickhouse_settings: experimental });
  // Fix round 1: SimpleAggregateFunction over LowCardinality (the server drops the SAF wrapper) and the Tester's extra kinds.
  await driver.command({ query: "CREATE TABLE probe_synthetic2 (saflc SimpleAggregateFunction(max, LowCardinality(String)), saflcu SimpleAggregateFunction(max, LowCardinality(UInt32)), saflcf SimpleAggregateFunction(max, LowCardinality(FixedString(2))), saflcn SimpleAggregateFunction(max, LowCardinality(Nullable(String))), safnu SimpleAggregateFunction(anyLast, Nullable(UInt64)), safdt SimpleAggregateFunction(anyLast, DateTime64(3, 'UTC')), safe SimpleAggregateFunction(max, Enum8('a' = 1)), safuuid SimpleAggregateFunction(anyLast, UUID), safm SimpleAggregateFunction(anyLast, Map(String, UInt64)), lcdt LowCardinality(DateTime('UTC')), lcuuid LowCardinality(UUID), lcip LowCardinality(IPv4), lcb LowCardinality(Bool), lcf32 LowCardinality(Float32), lcd32 LowCardinality(Date32), lci128 LowCardinality(Int128), lcfs3 LowCardinality(FixedString(3)), d256 Decimal256(10), ip6 IPv6, mn Map(String, Nullable(UInt64)), tn Tuple(a Nullable(String)), an Array(Nullable(String)), pt Point, rg Ring, pg Polygon, nn Nested(a Nullable(UInt8))) ENGINE=Memory", clickhouse_settings: experimental });
  await driver.command({ query: 'CREATE TABLE probe_key (id UInt8) ENGINE=Memory' });
  await driver.command({ query: 'CREATE TABLE types_probe AS type_corpus.types_1 ENGINE=Memory' });
  await driver.command({ query: 'INSERT INTO probe_key VALUES (1)' });
  for (const statement of [...ddl, ...inserts]) await driver.command({ query: statement });
  // The seed matches every acme component; one orphan makes the spec example's NULL stock observable.
  await driver.command({ query: "INSERT INTO entity_ots_component (tenantId, entityId, category, state) VALUES ('acme', 'cmp_orphan', NULL, 'active')" });
}, 180000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });

async function json(query: string, params: Record<string, string> = {}, cell: Record<string, number> = {}): Promise<{ meta: { name: string; type: string }[]; data: Record<string, unknown>[] }> {
  const response = await driver.query({ query, query_params: params, format: 'JSON', clickhouse_settings: { ...experimental, ...cell, date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1 } });
  try { return await response.json() as never; } finally { response.close(); }
}
const metaOf = (compiled: CompiledQuery) => Object.entries(compiled.columns).map(([name, type]) => ({ name, type: print(type) }));

it('probe: every fixture and synthetic column kind through LEFT ALL JOIN under join_use_nulls = 1 returns print(outerColumnType(declared))', async () => {
  const declared = await json("SELECT database, table, name, type FROM system.columns WHERE (database = 'type_corpus' AND table = 'types_1') OR (database = currentDatabase() AND (table IN ('probe_synthetic', 'probe_synthetic2') OR table IN ('entity_ots_component', 'entity_off_the_shelf_part', 'metric_group_ots_component_indices', 'metric_group_ots_component_market_availability', 'metric_group_off_the_shelf_part_indices', 'metric_group_off_the_shelf_part_market_price'))) ORDER BY database, table, position");
  const rows: { kind: string; server: string; wrapped: string }[] = [];
  const byTable = new Map<string, { name: string; type: string }[]>();
  for (const c of declared.data as { database: string; table: string; name: string; type: string }[]) {
    const id = `${c.database}.${c.table}`;
    byTable.set(id, [...(byTable.get(id) ?? []), c]);
  }
  for (const [id, cs] of byTable) {
    // A one-row preserved side and a never-matching key: every right column is null-extended.
    const result = await json(`SELECT ${cs.map((c, i) => `r.\`${c.name}\` AS c${i}`).join(', ')} FROM probe_key AS l LEFT ALL JOIN (SELECT *, toUInt8(0) AS __probe FROM ${id}) AS r ON l.id = r.__probe SETTINGS join_use_nulls = 1`);
    for (const [i, c] of cs.entries()) rows.push({ kind: `${id}.${c.name} ${c.type}`, server: result.meta[i]!.type, wrapped: print(outerColumnType(parseCHType(c.type))) });
  }
  const disagreements = rows.filter(r => print(parseCHType(r.server)) !== r.wrapped);
  console.info('outer-join probe', JSON.stringify(rows.map(r => [r.kind, r.server, r.wrapped])));
  expect(disagreements).toEqual([]);
  expect(rows.length).toBeGreaterThan(150);
  // Fix round 1: the SAF wrapper over LowCardinality(T) is dropped by the server, never kept.
  expect(rows.filter(r => /\.saflc[uf]? /.test(r.kind)).map(r => r.server)).toEqual(['LowCardinality(Nullable(String))', 'LowCardinality(Nullable(UInt32))', 'LowCardinality(Nullable(FixedString(2)))']);
  // The kinds the rule leaves alone are really left alone, and unmatched rows carry server defaults.
  expect(rows.filter(r => r.server === r.kind.slice(r.kind.indexOf(' ') + 1).replaceAll("\\'", "'")).map(r => r.kind.split(' ')[0]!.split('.').at(-1))).toEqual(expect.arrayContaining(['c37', 'c39', 'c40', 'c43', 'c46', 'c50', 'v', 'd', 'j', 'safn', 'safa']));
}, 120000);

it('probe: builder descriptors equal the server meta for the fixture tables and the type corpus, on both backends', async () => {
  const declared = await json("SELECT name, type FROM system.columns WHERE database = 'type_corpus' AND table = 'types_1' AND type NOT LIKE 'AggregateFunction%' ORDER BY position");
  const columns = Object.fromEntries((declared.data as { name: string; type: string }[]).map(c => [c.name, { type: parseCHType(c.type) } as Column]));
  const corpus = from(table('types_probe', columns, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const key = from(table('probe_key', { id: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const queries = [
    leftJoin({ l: key }, { r: corpus }).on(r => (r.l as any).id.eq((r.r as any).c01)),
    ...Object.values(db).map(t => leftJoin({ l: from(t) }, { r: from(t) }).on(r => (r.l as any).entityId.eq((r.r as any).entityId))),
    // A composed outer join: the right input is itself a left join, wrapped again idempotently.
    ...Object.values(db).filter(t => Object.hasOwn(t.columns, 'version')).map(t => leftJoin({ l: key }, { rs: leftJoin({ r: from(t) }, { s: from(t) }).on(r => (r.r as any).entityId.eq((r.s as any).entityId)) }).on(r => (r.l as any).id.eq((r.rs as any).r.version))),
  ];
  // compile/emitNaive directly: the client decoder does not cover UUID/Decimal/Enum yet, the server meta is the subject here.
  // LIMIT 0: the seed self-joins are large and only the meta is under test.
  for (const q of queries.map(q => q.limit(0))) for (const compiled of [compile(q.ir), emitNaive(q.ir)]) {
    expect(compiled.sql).toContain('SETTINGS join_use_nulls = 1');
    const result = await json(compiled.sql, compiled.params as Record<string, string>);
    expect(result.meta.map(m => ({ name: m.name, type: print(parseCHType(m.type)) }))).toEqual(metaOf(compiled));
  }
}, 120000);

it('spec leftJoin example: components keep NULL stock on the right, ifNull(0) maps it, against the native oracle', async () => {
  const availability = from(db.metric_group_ots_component_market_availability);
  const q = leftJoin({ c: components.where(forTenant('acme')) }, { a: latest(availability.final().where(forTenant('acme'))) })
    .on(r => r.c.entityId.eq(r.a.entityId))
    .map(r => ({ entityId: r.c.entityId, stock: r.a.market_stock_total.ifNull(0) }));
  const oracle = "SELECT c.entityId AS entityId, ifNull(a.market_stock_total, 0) AS stock FROM (SELECT * FROM entity_ots_component WHERE tenantId = 'acme') AS c LEFT ALL JOIN (SELECT m.* FROM (SELECT * FROM metric_group_ots_component_market_availability FINAL WHERE tenantId = 'acme') AS m INNER ALL JOIN (SELECT tenantId, entityId, max(version) AS version FROM metric_group_ots_component_market_availability FINAL WHERE tenantId = 'acme' GROUP BY tenantId, entityId) AS v ON m.tenantId = v.tenantId AND m.entityId = v.entityId AND m.version = v.version) AS a ON c.entityId = a.entityId SETTINGS join_use_nulls = 1";
  const expected = (await json(oracle)).data.map(rowDecoder({ entityId: { kind: 'scalar', name: 'String' }, stock: { kind: 'scalar', name: 'Float64' } }));
  expect(expected.length).toBeGreaterThan(0);
  for (const backend of backends) {
    const plan = backend.compile(q.ir);
    expect(plan.compiled.columns).toEqual({ entityId: { kind: 'scalar', name: 'String' }, stock: { kind: 'scalar', name: 'Float64' } });
    expect(keys(q, (await collect(backend.run(plan))).flat()), backend.name).toEqual(keys(q, expected));
  }
  // The orphan component is kept, with stock 0 from ifNull over the null-extended side.
  expect(expected).toContainEqual({ entityId: 'cmp_orphan', stock: 0 });
  const unmatched = await json("SELECT count() AS n FROM (SELECT entityId FROM entity_ots_component WHERE tenantId = 'acme') AS c LEFT ALL JOIN (SELECT entityId FROM metric_group_ots_component_market_availability FINAL WHERE tenantId = 'acme') AS a ON c.entityId = a.entityId WHERE a.entityId IS NULL SETTINGS join_use_nulls = 1");
  expect(Number(unmatched.data[0]!.n)).toBeGreaterThan(0);
}, 120000);

it('inner-only and cross-only queries never carry join_use_nulls; an outer join nested anywhere does', () => {
  const t = from(table('oj_a', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const inner = join({ a: t, b: t }).on(r => r.a.id.eq(r.b.id));
  for (const backend of backends) {
    expect(backend.compile(inner.ir).compiled.sql).not.toContain('join_use_nulls');
    const nested = join({ x: leftJoin({ a: t }, { b: t }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })), y: t }).on(r => r.x.id.eq(r.y.id));
    expect(backend.compile(nested.ir).compiled.sql).toMatch(/LEFT ALL JOIN[\s\S]*SETTINGS join_use_nulls = 1 \/\*[^*]*\*\/$/);
    expect(backend.compile(t.where(r => r.id.in(nested.map(n => n.x.id))).ir).compiled.sql).toContain('SETTINGS join_use_nulls = 1');
  }
});

const plain = { fallible: null, order: null, distinct: false } as const;
/** Every comparison runs in each cell; the server may reorder conjuncts (PREWHERE) or rebind aliases. */
const cells = [0, 1].flatMap(alias => [0, 1].map(prewhere => ({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere })));
async function check(r: Recipe) {
  const q = build(r);
  const plans = backends.map(b => b.compile(q.ir));
  const [optimized, naive] = plans.map(p => p.compiled) as [CompiledQuery, CompiledQuery];
  expect(optimized.columns).toEqual(naive.columns);
  expect(optimized.columnPaths).toEqual(naive.columnPaths);
  const names = Object.keys(optimized.columns);
  const oracle = native(r, names);
  const decode = rowDecoder(optimized.columns, optimized.columnPaths);
  const meta = metaOf(optimized);
  const typed = (m: { name: string; type: string }[]) => m.map(x => ({ name: x.name, type: print(parseCHType(x.type)) }));
  let expected: Record<string, unknown>[] = [];
  for (const [c, cell] of cells.entries()) {
    const direct = await json(oracle, {}, cell);
    const rows = direct.data.map(decode);
    expect(typed(direct.meta), `oracle meta ${JSON.stringify(cell)}`).toEqual(meta);
    if (c === 0) expected = rows;
    else expect(keys(q, rows), `oracle ${JSON.stringify(cell)}`).toEqual(keys(q, expected));
    for (const [i, backend] of backends.entries()) {
      const compiled = plans[i]!.compiled;
      expect(compiled.sql).toContain('SETTINGS join_use_nulls = 1');
      const raw = await json(compiled.sql, compiled.params as Record<string, string>, cell);
      expect(typed(raw.meta), `${backend.name} meta ${JSON.stringify(cell)}`).toEqual(meta);
      expect(keys(q, raw.data.map(decode)), `${backend.name} ${JSON.stringify(cell)}`).toEqual(keys(q, expected));
    }
  }
  // The client path (run, default settings) decodes the same multiset.
  for (const [i, backend] of backends.entries()) expect(keys(q, (await collect(backend.run(plans[i]!))).flat()), backend.name).toEqual(keys(q, expected));
  return expected.length;
}
it('runs 500 shrinkable binary left/right/full recipes, composed with nested inner/outer joins (orphans, NULL keys, duplicates) against both backends and native SQL, rows and meta', async () => {
  const shapes = new Set<string>();
  let rows = 0, empty = 0, nulls = 0;
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipes, async r => {
    shapes.add(shape(r));
    const plans = backends.map(b => b.compile(build(r).ir).compiled);
    try {
      const n = await check(r);
      rows += n; if (!n) empty++;
      if (Object.values(plans[0]!.columns).some(t => t.kind === 'Nullable' || (t.kind === 'LowCardinality' && t.inner.kind === 'Nullable'))) nulls++;
    } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.map(p => ({ sql: p.sql, params: p.params })))}`, { cause }); }
  }), { seed: Number(process.env.TYPEDHOUSE_OUTER_JOIN_SEED ?? seed), numRuns: Number(process.env.TYPEDHOUSE_OUTER_JOIN_RUNS ?? 500), ...(process.env.TYPEDHOUSE_OUTER_JOIN_PATH ? { path: process.env.TYPEDHOUSE_OUTER_JOIN_PATH } : {}) });
  console.info('outer-join differential', { runs: result.numRuns, seed: result.seed, shapes: shapes.size, rows, empty, nullable: nulls, milliseconds: Math.round(performance.now() - start) });
  if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks} recipe=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
  expect(result.numRuns).toBeGreaterThanOrEqual(500);
  expect(shapes.size).toBeGreaterThan(300);
  for (const kind of ['left', 'right', 'full']) {
    expect([...shapes].filter(s => s.startsWith(`${kind}(`)).length, kind).toBeGreaterThan(50);
    // Composed: an outer join whose input is itself an outer join, on either side.
    expect([...shapes].filter(s => s.startsWith(`${kind}(`) && /^\w+\(.*(?:left|right|full)\(/.test(s)).length, `${kind} composed`).toBeGreaterThan(20);
  }
  expect([...shapes].filter(s => s.includes('inner(')).length).toBeGreaterThan(20);
  // Fix round 1 features: a guarded fallible WHERE, ORDER BY NULLS FIRST/LAST, DISTINCT, sum/avg/uniq/countIf over nullable sides.
  for (const feature of [':cast', ':first:', ':last:', ':distinct', ':aggregates:']) expect([...shapes].filter(s => s.includes(feature)).length, feature).toBeGreaterThan(40);
}, 600000);

it('detects a lost null extension after IO (outer → inner), shrinks and replays the exact counterexample', async () => {
  let executions = 0;
  const property = fc.asyncProperty(recipes, async r => {
    const q = build(r), correct = backends[1]!.compile(q.ir), faulty = backends[0]!.compile(build(r, true).ir);
    const expected = (await collect(backends[1]!.run(correct))).flat();
    const actual = (await collect(backends[0]!.run(faulty))).flat(); executions++;
    try { expect(keys(q, actual)).toEqual(keys(q, expected)); }
    catch (cause) { throw new Error(`wrong-result after IO ${JSON.stringify({ faulty: faulty.compiled.sql, naive: correct.compiled.sql })}`, { cause }); }
  });
  const result = await fc.check(property, { seed, numRuns: 200 });
  expect(result.failed).toBe(true); expect(result.numShrinks).toBeGreaterThan(0); expect(String(result.errorInstance)).toContain('wrong-result after IO');
  const replay = await fc.check(property, { seed, path: result.counterexamplePath!, numRuns: 200 });
  expect(replay.counterexample).toEqual(result.counterexample);
  console.info('outer-join fault', { seed, path: result.counterexamplePath, shrinks: result.numShrinks, executions, recipe: JSON.stringify(result.counterexample) });
}, 300000);

it('anchors: unmatched rows on every side, NULL keys never match, duplicates multiply, structured columns keep server defaults', async () => {
  const t = (table: 0 | 1 | 2) => ({ node: 'table' as const, table, pre: null });
  const on = (leftKey: 'id' | 'k', rightKey: 'id' | 'k', text = false) => ({ left: 0, right: 0, leftKey, rightKey, text });
  const anchors: Recipe[] = [
    { root: { node: 'join', kind: 'left', left: t(0), right: t(1), on: on('id', 'id') }, shared: false, post: null, project: 'none', ...plain },
    { root: { node: 'join', kind: 'right', left: t(0), right: t(1), on: on('k', 'k') }, shared: false, post: null, project: 'direct', ...plain },
    // Composed three-way: (oj_a FULL oj_b) FULL oj_c, and oj_a LEFT (oj_a LEFT oj_a) self-joins sharing one CTE.
    { root: { node: 'join', kind: 'full', left: { node: 'join', kind: 'full', left: t(0), right: t(1), on: on('id', 'id') }, right: t(2), on: { left: 1, right: 0, leftKey: 'k', rightKey: 'id', text: false } }, shared: false, post: null, project: 'none', ...plain },
    { root: { node: 'join', kind: 'left', left: t(0), right: { node: 'join', kind: 'left', left: t(0), right: t(0), on: on('k', 'id') }, on: on('k', 'id', true) }, shared: true, post: { side: 1, op: 'isNull' }, project: 'computed', ...plain },
    { root: { node: 'join', kind: 'left', left: { node: 'join', kind: 'inner', left: t(0), right: t(1), on: on('id', 'id') }, right: t(2), on: { left: 1, right: 0, leftKey: 'k', rightKey: 'k', text: false } }, shared: false, post: null, project: 'aggregate', ...plain },
  ];
  const counts = [];
  for (const r of anchors) counts.push(await check(r));
  // oj_a (5 rows: id 2 twice) LEFT oj_b on id (b: id 2 twice, 4 once): 1→none, 2×2, 2×2, 3→none, 4→1 = 7 rows.
  expect(counts[0]).toBe(7);
  const left = (await collect(backends[0]!.run(backends[0]!.compile(build(anchors[0]!).ir)))).flat() as { a0: { id: number }; a1: { id: number | null; k: number | null; tags: string[]; lc: string | null; flag: boolean | null } }[];
  expect(left.filter(r => r.a1.id === null).map(r => r.a0.id).sort()).toEqual([1, 3]);
  expect(left.find(r => r.a0.id === 1)!.a1).toEqual({ id: null, k: null, s: null, tags: [], lc: null, at: null, flag: null });
  // NULL k on both sides never matches: oj_b k=NULL row is kept by RIGHT only as unmatched.
  const right = (await collect(backends[1]!.run(backends[1]!.compile(build(anchors[1]!).ir)))).flat() as { x: number | null; y: string }[];
  expect(right.filter(r => r.x === null).length).toBeGreaterThan(0);
}, 120000);

it('the comparison bites: without join_use_nulls, or as an inner join, the oracle disagrees with the compiled descriptors and rows', async () => {
  const r: Recipe = { root: { node: 'join', kind: 'left', left: { node: 'table', table: 0, pre: null }, right: { node: 'table', table: 1, pre: null }, on: { left: 0, right: 0, leftKey: 'id', rightKey: 'id', text: false } }, shared: false, post: null, project: 'none', ...plain };
  const compiled = compile(build(r).ir);
  const names = Object.keys(compiled.columns);
  const defaults = await json(native(r, names).replace(' SETTINGS join_use_nulls = 1', ''));
  expect(defaults.meta.map(m => print(parseCHType(m.type)))).not.toEqual(metaOf(compiled).map(m => m.type));
  expect(defaults.data.some(row => row[names[7]!] === 0)).toBe(true); // unmatched a1.id is the type default 0, not NULL
  const inner = await json(native(r, names).replace('LEFT ALL JOIN', 'INNER ALL JOIN'));
  expect(inner.data.length).toBeLessThan((await json(native(r, names))).data.length);
});
