import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, join, leftJoin, outerColumnType, parseCHType, print, table, type CHType, type Column, type CompiledQuery } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { createClickHouseBackend, QueryError } from '../src/index.js';
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

// 4b: `wait_end_of_query = 1` (as the slice 3/3b/4a probes do): a failure after the first streamed block (a FULL
// join's non-joined rows come last) is otherwise a 200 with partial JSON, not an error with its code.
async function json(query: string, params: Record<string, string> = {}, cell: Record<string, number> = {}): Promise<{ meta: { name: string; type: string }[]; data: Record<string, unknown>[] }> {
  const response = await driver.query({ query, query_params: params, format: 'JSON', clickhouse_settings: { ...experimental, ...cell, wait_end_of_query: 1, date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1 } });
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

// Slice 4b: after LeftToInner the formerly null-extended input is read through toNullable, so the compiled
// descriptors (the original graph's, Nullable) still equal the server meta of the INNER join, for every kind.
it('probe (4b): LeftToInner keeps descriptors equal to the server meta for every type-corpus and synthetic kind, on both backends', async () => {
  const columnsOf = async (where: string) => Object.fromEntries(((await json(`SELECT name, type FROM system.columns WHERE ${where} ORDER BY position`)).data as { name: string; type: string }[]).map(c => [c.name, { type: parseCHType(c.type) } as Column]));
  const corpus = from(table('types_probe', await columnsOf("database = 'type_corpus' AND table = 'types_1' AND type NOT LIKE 'AggregateFunction%'"), { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const synthetic = from(table('probe_synthetic2', await columnsOf("database = currentDatabase() AND table = 'probe_synthetic2'"), { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const key = from(table('probe_key', { id: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const queries: [any, number][] = [
    [leftJoin({ l: key }, { r: corpus }).on(r => (r.l as any).id.eq((r.r as any).c01)).where(r => (r.r as any).c01.gt(0)), 1],
    [leftJoin({ l: synthetic }, { r: synthetic }).on(r => (r.l as any).lcf32.eq((r.r as any).lcf32)).where(r => (r.r as any).lcb.isNotNull()), 1],
    ...Object.values(db).map(t => [leftJoin({ l: from(t) }, { r: from(t) }).on(r => (r.l as any).entityId.eq((r.r as any).entityId)).where(r => (r.r as any).entityId.ne('')), 1] as [any, number]),
    // Composed: only the outer join is rejected; the inner left join survives, and so does join_use_nulls.
    ...Object.values(db).filter(t => Object.hasOwn(t.columns, 'version')).map(t => [leftJoin({ l: key }, { rs: leftJoin({ r: from(t) }, { s: from(t) }).on(r => (r.r as any).entityId.eq((r.s as any).entityId)) }).on(r => (r.l as any).id.eq((r.rs as any).r.version)).where(r => (r.rs as any).r.entityId.isNotNull()), 1] as [any, number]),
  ];
  let wrapped = 0;
  for (const [query, converted] of queries) {
    const q = query.limit(0);
    expect(rewriteRel(q.ir).hits.LeftToInner).toBe(converted);
    for (const compiled of [compile(q.ir), emitNaive(q.ir)]) {
      const outer = /(LEFT|RIGHT|FULL) ALL JOIN/.test(compiled.sql);
      expect(compiled.sql.includes('SETTINGS join_use_nulls = 1')).toBe(outer);
      const result = await json(compiled.sql, compiled.params as Record<string, string>);
      expect(result.meta.map(m => ({ name: m.name, type: print(parseCHType(m.type)) }))).toEqual(metaOf(compiled));
      wrapped += compiled.sql.match(/toNullable\(/g)?.length ?? 0;
    }
    expect(compile(q.ir).sql).toMatch(/INNER ALL JOIN/);
  }
  expect(wrapped).toBeGreaterThan(100);
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

const plain = { fallible: null, order: null, distinct: false, inputCast: 'none' } as const;
/** Every comparison runs in each cell; the server may reorder conjuncts (PREWHERE) or rebind aliases. */
const cells = [0, 1].flatMap(alias => [0, 1].map(prewhere => ({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere })));
/** A server error's ClickHouse code (`6` CANNOT_PARSE_TEXT for the guarded cast); anything else is rethrown. */
async function outcome<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    // The client path wraps the server error in QueryError (its cause).
    const server = error instanceof QueryError ? error.cause : error;
    const code = (server as { code?: unknown }).code;
    // Observed, pre-existing (not 4b): `backend.run` streams, and a failure after the first block reaches it as a
    // ClickHouseError with the message but no code. The run path therefore compares failure, not the code.
    if (typeof code !== 'string') { if (error instanceof QueryError) return { ok: false, code: 'streamed' }; throw error; }
    return { ok: false, code };
  }
}
/** Rows, or -1 when the oracle and both emitters fail with the same code in every cell. */
async function check(r: Recipe): Promise<number> {
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
  let expected: Record<string, unknown>[] = [], failed: string | undefined;
  for (const [c, cell] of cells.entries()) {
    const direct = await outcome(() => json(oracle, {}, cell));
    if (c === 0 && !direct.ok) failed = direct.code;
    expect(direct.ok ? undefined : direct.code, `oracle outcome ${JSON.stringify(cell)}`).toBe(failed);
    if (direct.ok) {
      const rows = direct.value.data.map(decode);
      expect(typed(direct.value.meta), `oracle meta ${JSON.stringify(cell)}`).toEqual(meta);
      if (c === 0) expected = rows;
      else expect(keys(q, rows), `oracle ${JSON.stringify(cell)}`).toEqual(keys(q, expected));
    }
    for (const [i, backend] of backends.entries()) {
      const compiled = plans[i]!.compiled;
      // 4b: LeftToInner may remove every outer join; the setting is emitted exactly when one survives.
      expect(compiled.sql.includes('SETTINGS join_use_nulls = 1'), compiled.sql).toBe(/(LEFT|RIGHT|FULL) ALL JOIN/.test(compiled.sql));
      const raw = await outcome(() => json(compiled.sql, compiled.params as Record<string, string>, cell));
      expect(raw.ok ? undefined : raw.code, `${backend.name} outcome ${JSON.stringify(cell)}`).toBe(failed);
      if (!raw.ok) continue;
      expect(typed(raw.value.meta), `${backend.name} meta ${JSON.stringify(cell)}`).toEqual(meta);
      expect(keys(q, raw.value.data.map(decode)), `${backend.name} ${JSON.stringify(cell)}`).toEqual(keys(q, expected));
    }
  }
  // The client path (run, default settings) decodes the same multiset, or fails the same way.
  for (const [i, backend] of backends.entries()) {
    const run = await outcome(async () => (await collect(backend.run(plans[i]!))).flat());
    expect(run.ok ? undefined : run.code === 'streamed' ? failed : run.code, `${backend.name} run outcome`).toBe(failed);
    if (run.ok) expect(keys(q, run.value), backend.name).toEqual(keys(q, expected));
  }
  return failed === undefined ? expected.length : -1;
}
it('runs 500 shrinkable binary left/right/full recipes, composed with nested inner/outer joins (orphans, NULL keys, duplicates) against both backends and native SQL, rows and meta', async () => {
  const shapes = new Set<string>();
  let rows = 0, empty = 0, nulls = 0, castFailed = 0, castRows = 0, converted = 0, outerless = 0, inputCast = 0, fenced = 0;
  const hits = new Set<string>();
  const start = performance.now();
  const result = await fc.check(fc.asyncProperty(recipes, async r => {
    shapes.add(shape(r));
    const plans = backends.map(b => b.compile(build(r).ir).compiled);
    try {
      const n = await check(r);
      if (n < 0) castFailed++; else { rows += n; if (!n) empty++; if (r.fallible) castRows += n ? 1 : 0; }
      const result = rewriteRel(build(r).ir);
      if (r.inputCast !== 'none') {
        inputCast++;
        // Fix round 1: the fence fired when the cast-free twin gets join-rule hits this recipe does not.
        const twin = rewriteRel(build({ ...r, inputCast: 'none' }).ir).hits, joinHits = (h: typeof twin) => h.LeftToInner + h.PushFilterJoin;
        if (joinHits(twin) > joinHits(result.hits)) fenced++;
      }
      for (const [rule, count] of Object.entries(result.hits)) if (count) hits.add(rule);
      if (result.hits.LeftToInner) converted++;
      if (!plans[0]!.sql.includes('join_use_nulls')) outerless++;
      if (Object.values(plans[0]!.columns).some(t => t.kind === 'Nullable' || (t.kind === 'LowCardinality' && t.inner.kind === 'Nullable'))) nulls++;
    } catch (cause) { throw new Error(`${String(cause)}\n${JSON.stringify(plans.map(p => ({ sql: p.sql, params: p.params })))}`, { cause }); }
  }), { seed: Number(process.env.TYPEDHOUSE_OUTER_JOIN_SEED ?? seed), numRuns: Number(process.env.TYPEDHOUSE_OUTER_JOIN_RUNS ?? 500), ...(process.env.TYPEDHOUSE_OUTER_JOIN_PATH ? { path: process.env.TYPEDHOUSE_OUTER_JOIN_PATH } : {}) });
  console.info('outer-join differential', { runs: result.numRuns, seed: result.seed, shapes: shapes.size, rows, empty, nullable: nulls, castFailed, castRows, converted, outerless, inputCast, fenced, hits: [...hits].sort(), milliseconds: Math.round(performance.now() - start) });
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
  // 4b: the cast really fails in some runs (identically: oracle, both emitters, every cell, the client) and returns rows in others.
  expect(castFailed, 'cast failures').toBeGreaterThan(20);
  expect(castRows, 'cast runs with rows').toBeGreaterThan(10); // seed 20261131: 17 (the guard keeps only '7' rows)
  // LeftToInner fires on the post `gt` and guard filters over a null-extended side, sometimes removing every outer join.
  expect(converted, 'LeftToInner runs').toBeGreaterThan(50);
  expect(outerless, 'runs whose SQL lost every outer join').toBeGreaterThan(10);
  // Fix round 1: recipes with a fallible input projection exercise the `fallibleWithin` fence.
  expect(inputCast, 'fallible input recipes').toBeGreaterThan(100);
  expect(fenced, 'runs where the fence withheld a join-rule hit').toBeGreaterThan(20);
}, 600000);

// Slice 4b anchor, the shrunk counterexample of the first LeftToInner draft (seed 20261131): b.id > 2 is null-rejecting on b,
// but a cast reads b.s in the Filter above. Converted to INNER, 24.8 pushes the cast into b below the guard and fails on 'z'
// (code 6) where naive and the oracle return no rows; under the fallible Filter the join therefore stays LEFT.
it('anchor (4b): no LeftToInner under a fallible Filter; the INNER text fails natively where LEFT returns no rows', async () => {
  const r: Recipe = { root: { node: 'join', kind: 'left', left: { node: 'table', table: 0, pre: null }, right: { node: 'table', table: 1, pre: null }, on: { left: 0, right: 0, leftKey: 'id', rightKey: 'k', text: false } }, shared: false, post: { side: 0, op: 'gt' }, fallible: { side: 1, guard: 'id' }, project: 'none', order: 'first', distinct: false, inputCast: 'none' };
  expect(rewriteRel(build(r).ir).hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
  expect(await check(r)).toBe(0);
  const inner = await outcome(() => json("SELECT * FROM (SELECT a0.id AS id, toNullable(a1.s) AS s FROM (SELECT * FROM oj_a WHERE id > 2) AS a0 INNER ALL JOIN oj_b AS a1 ON a0.id = a1.k WHERE toNullable(a1.id) > 2) WHERE CAST(ifNull(s, '7') AS UInt8) > 1"));
  expect(inner.ok ? 'rows' : inner.code).toBe('6');
  const left = await json("SELECT * FROM (SELECT a0.id AS id, a1.s AS s FROM (SELECT * FROM oj_a WHERE id > 2) AS a0 LEFT ALL JOIN oj_b AS a1 ON a0.id = a1.k WHERE a1.id > 2) WHERE CAST(ifNull(s, '7') AS UInt8) > 1 SETTINGS join_use_nulls = 1");
  expect(left.data).toEqual([]);
  // Without the cast the same guard converts the join, and both texts and the oracle agree.
  const total: Recipe = { ...r, fallible: null, post: { side: 1, op: 'gt' } };
  expect(rewriteRel(build(total).ir).hits.LeftToInner).toBe(1);
  expect(backends[0]!.compile(build(total).ir).compiled.sql).not.toMatch(/LEFT ALL JOIN|join_use_nulls/);
  expect(await check(total)).toBeGreaterThan(0);
});

// FINDING (pre-existing, not a 4b rule: slice 1 MergeFilter + 4a outer-join block folding), pinned as observed. A non-pushable
// conjunct on the extended input (`isNull(a0.k)`) and a guard on the preserved input (`a1.s = '7'`) in two Filters: naive nests
// them and 24.8's push-down stops at the first, so a1's fallible projection (k = CAST(s AS UInt32)) runs on every a1 row and
// fails; MergeFilter merges them into one WHERE, the server pushes the guard into a1 below the projection, and the optimized
// text returns rows. No join rule fires (fallibleWithin fences them); the oracle (nested like naive) fails too.
it('FINDING pin (pre-existing, MergeFilter): merged filters let the server guard a fallible input projection that naive evaluates', async () => {
  const r: Recipe = { root: { node: 'join', kind: 'right', left: { node: 'table', table: 0, pre: 4 }, right: { node: 'table', table: 0, pre: null }, on: { left: 0, right: 0, leftKey: 'id', rightKey: 'id', text: false } }, shared: false, post: { side: 0, op: 'isNull' }, fallible: null, project: 'none', order: null, distinct: false, inputCast: 'failing' };
  const guarded = (build(r) as any).where((row: any) => row.a1.s.eq('7'));
  const hits = rewriteRel(guarded.ir).hits;
  expect(hits).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0, MergeFilter: 1 });
  const [optimized, naive] = backends.map(b => b.compile(guarded.ir).compiled) as [CompiledQuery, CompiledQuery];
  const opt = await outcome(() => json(optimized.sql, optimized.params as Record<string, string>));
  const nai = await outcome(() => json(naive.sql, naive.params as Record<string, string>));
  expect(nai.ok ? 'rows' : nai.code).toBe('6');
  expect(opt.ok ? opt.value.data.length : opt.code).toBe(1); // observed: one row (a1.id = 3, s = '7'); expected once fixed: code 6
});

it('detects a lost null extension after IO (outer → inner), shrinks and replays the exact counterexample', async () => {
  let executions = 0;
  // Recipes whose guarded cast can fail are excluded: the server may fail before any extension is lost.
  const property = fc.asyncProperty(recipes.filter(r => r.fallible?.guard !== 'id'), async r => {
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
