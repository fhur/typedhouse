import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, defineFunction, from, join, table, unwrap, type CompiledQuery, type Rel } from '@typedhouse/core';
import { createClickHouseBackend } from '../src/index.js';
import { compile, emitNaive } from '@typedhouse/compiler';
import { collect } from './backend-harness.js';
import { entries, type FenceKind } from '../../compiler/test/fixtures/corpus/explain-corpus.js';
import { components, db, forTenant } from '../../compiler/test/fixtures/corpus/low-stock.js';
import { sharedPart } from '../../compiler/test/fixtures/corpus/supported-types.js';
import { columnName, flatten, headerColumns, parseExplainJson, parseExplainText, readTable, stepTypes, structure, type PlanStep, type Structure } from '../../compiler/test/explain-corpus-support.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { max_execution_time: 20, max_result_rows: '10000', result_overflow_mode: 'throw' as const } };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  for (const file of ['schema.sql', 'seed.sql']) {
    const sql = readFileSync(new URL(`../../compiler/test/fixtures/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').filter(s => s.trim())) await driver.command({ query: statement });
  }
}, 180000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });

/** `EXPLAIN PLAN json = 1, header = 1` on 24.8, with the backend's Array-parameter transport; text form is the fallback. */
async function explain(compiled: Pick<CompiledQuery, 'sql' | 'params' | 'parameterTypes'>): Promise<PlanStep[]> {
  const params: Record<string, string> = {}, settings: Record<string, string> = {};
  for (const [name, value] of Object.entries(compiled.params)) {
    const type = compiled.parameterTypes?.[name];
    if (type && unwrap(type).kind === 'Array') settings[`param_${name}`] = value; else params[name] = value;
  }
  for (const [options, parse] of [['json = 1, header = 1', parseExplainJson], ['header = 1', parseExplainText]] as const) {
    const result = await driver.query({ query: `EXPLAIN PLAN ${options} ${compiled.sql}`, query_params: params, format: 'TabSeparatedRaw', clickhouse_settings: settings });
    try { return parse(await result.text()); }
    catch (error) { if (options.startsWith('json') && /json/i.test(String(error))) continue; throw error; }
    finally { result.close(); }
  }
  throw new Error('unreachable');
}
/** Fence clause (ii): every step type is a base step or justified by a fence kind present in the IR; every fence
 * kind ClickHouse plans in the main pipeline leaves at least one step. */
function fenceClause(steps: readonly PlanStep[], s: Pick<Structure, 'fences' | 'planned'>): string[] {
  const allowed = new Set([...stepTypes.base, ...[...s.fences].flatMap(k => stepTypes.byFence[k])]);
  const types = flatten(steps).map(step => step.type);
  const problems = types.filter(t => !allowed.has(t) || /Subquery/.test(t) && !s.fences.has('Subquery')).map(t => `unjustified step ${t}`);
  for (const kind of ['Aggregate', 'Sort', 'Limit', 'Distinct', 'Union', 'Join', 'ArrayJoin'] as const satisfies readonly FenceKind[]) {
    if (s.planned.has(kind) && !types.some(t => stepTypes.byFence[kind].includes(t))) problems.push(`no step for ${kind}`);
  }
  return problems;
}
/** Read-set clause: each MergeTree read's header is inside the pruned demand of a Scan of that table, and the
 * number of reads per table is the number of scan occurrences ClickHouse plans (CTE bodies once per reference). */
function readSetClause(steps: readonly PlanStep[], s: Pick<Structure, 'scans' | 'demand'>): string[] {
  const problems: string[] = [], reads = new Map<string, number>();
  for (const step of flatten(steps)) {
    const table = readTable(step);
    if (!table) continue;
    reads.set(table, (reads.get(table) ?? 0) + 1);
    const sets = s.demand.get(table) ?? [], header = headerColumns(step.header, [...new Set(sets.flat())]);
    if (!sets.some(set => header.every(c => set.includes(c)))) problems.push(`${table} reads ${JSON.stringify(header)} outside every pruned demand ${JSON.stringify(sets)}`);
  }
  for (const table of new Set([...reads.keys(), ...s.scans.keys()])) if ((reads.get(table) ?? 0) !== (s.scans.get(table) ?? 0)) problems.push(`${table}: ${reads.get(table) ?? 0} reads for ${s.scans.get(table) ?? 0} planned scans`);
  return problems;
}
const executable = entries.filter(e => e.run !== false);
it('covers every executable corpus id', () => { expect(executable.length).toBeGreaterThanOrEqual(30); });
for (const entry of executable) {
  it(`${entry.id}: EXPLAIN PLAN step types are fenced and MergeTree reads stay inside the pruned demand`, async () => {
    const compiled = compile(entry.query.ir), s = structure(entry.query.ir);
    const steps = await explain(compiled);
    const context = `${compiled.sql}\n${JSON.stringify(flatten(steps).map(x => [x.type, x.description, x.header]))}`;
    expect(fenceClause(steps, s), context).toEqual([]);
    expect(readSetClause(steps, s), context).toEqual([]);
  });
}

it('negative controls: naive emission, an over-reading select list, an injected sort and an injected IN subquery', async () => {
  // Naive nesting on 24.8: the analyzer absorbs the derived tables into Expression steps and prunes their columns
  // itself, so the native clauses do not separate naive from planned text here; the Docker-free SELECT-count clause does.
  for (const id of ['composition/lowStock', 'entities/componentsLatest']) {
    const entry = entries.find(e => e.id === id)!, s = structure(entry.query.ir), naive = emitNaive(entry.query.ir);
    const steps = await explain(naive);
    expect(naive.sql.match(/SELECT /g)!.length).toBeGreaterThan(s.selects.length);
    console.info('naive native clauses', { id, fence: fenceClause(steps, s), readSet: readSetClause(steps, s) });
  }
  // An over-read: the final select list names a column the IR never demands.
  const pruned = entries.find(e => e.id === 'rule/prune-columns')!, s = structure(pruned.query.ir), compiled = compile(pruned.query.ir);
  expect(compiled.sql).toBe('SELECT `entityId` FROM `entity_ots_component`');
  expect(readSetClause(await explain({ ...compiled, sql: 'SELECT `entityId`, `updatedAt` FROM `entity_ots_component`' }), s)).toEqual(['entity_ots_component reads ["entityId","updatedAt"] outside every pruned demand [["entityId"]]']);
  // An injected ORDER BY with no Sort node, and an injected IN subquery with no Subquery fence.
  expect(fenceClause(await explain({ ...compiled, sql: compiled.sql + ' ORDER BY `entityId`' }), s)).toEqual(['unjustified step Sorting']);
  expect(fenceClause(await explain({ ...compiled, sql: compiled.sql + ' WHERE `entityId` IN (SELECT `entityId` FROM `entity_off_the_shelf_part`)' }), s)).toEqual(['unjustified step CreatingSets']);
  // An injected unfenced derived table changes the SELECT count, not the plan: the server absorbs it.
  const wrapped = await explain({ ...compiled, sql: `SELECT \`entityId\` FROM (${compiled.sql}) AS \`x\`` });
  expect(fenceClause(wrapped, s)).toEqual([]);
  expect(flatten(wrapped).map(x => x.type)).toEqual(flatten(await explain(compiled)).map(x => x.type));
  // A missing read: a hand-written text that drops a scan the IR plans.
  const self = entries.find(e => e.id === 'rule/push-filter-join')!;
  expect(readSetClause(await explain({ ...compile(self.query.ir), sql: 'SELECT `entityId`, `category` FROM `entity_ots_component`' }), structure(self.query.ir))).toEqual(['entity_ots_component: 1 reads for 2 planned scans']);
});

async function rows(sql: string, params: Record<string, string> = {}) {
  const result = await driver.query({ query: sql, query_params: params, format: 'JSON', clickhouse_settings: { output_format_json_quote_64bit_integers: 1 } });
  try { const json = await result.json<Record<string, unknown>>(); return { meta: json.meta, data: json.data }; } finally { result.close(); }
}
it('(vii) aggregates over an expanded scan block in one SELECT with the same per-key counts as hand-written SQL', async () => {
  const shared = components.where(forTenant('acme')).arrayJoin(c => c.matched_part_ids, 'partId')
    .groupBy(r => ({ partId: r.partId })).aggregate(() => ({ components: count() })).where(r => r.components.gt(1n)).orderBy(r => r.partId);
  const plans = backends.map(b => b.compile(shared.ir).compiled);
  expect(plans[0]!.sql).toBe('SELECT `partId`, count() AS `components` FROM `entity_ots_component` ARRAY JOIN `matched_part_ids` AS `partId` WHERE `tenantId` = {p0:String} GROUP BY `partId` HAVING `components` > {p1:UInt64} ORDER BY `partId` ASC');
  const oracle = await rows("SELECT partId, count() AS components FROM entity_ots_component ARRAY JOIN matched_part_ids AS partId WHERE tenantId = 'acme' GROUP BY partId HAVING components > 1 ORDER BY partId");
  // Seed: components 400..449 pair up on part_400..part_424; every other matched part is unique.
  expect(oracle.data).toEqual(Array.from({ length: 25 }, (_, i) => ({ partId: `part_${400 + i}`, components: '2' })));
  for (const plan of plans) expect(await rows(plan.sql, plan.params)).toEqual(oracle);
  for (const backend of backends) expect((await collect(backend.run(backend.compile(shared.ir)))).flat()).toEqual(oracle.data.map(r => ({ partId: r.partId, components: 2n })));
  const steps = await explain(plans[0]!);
  expect(flatten(steps).map(x => x.type).filter(t => t !== 'Expression')).toEqual(['Sorting', 'Filter', 'Aggregating', 'ArrayJoin', 'ReadFromMergeTree']);
  expect(flatten(steps).find(readTable)!.header.map(columnName).sort()).toEqual(['matched_part_ids', 'tenantId']);
  // LEFT keeps the 400 empty-array components as one row each: 1,600 expanded rows + 400.
  const left = components.where(forTenant('acme')).leftArrayJoin(c => c.matched_part_ids, 'partId').aggregate(() => ({ n: count() }));
  const inner = components.where(forTenant('acme')).arrayJoin(c => c.matched_part_ids, 'partId').aggregate(() => ({ n: count() }));
  for (const [q, n] of [[left, 2000n], [inner, 1600n]] as const) {
    expect(backends[0]!.compile(q.ir).compiled.sql.match(/SELECT /g)).toHaveLength(1);
    for (const backend of backends) expect((await collect(backend.run(backend.compile(q.ir)))).flat()).toEqual([{ n }]);
  }
});
it('(viii) a whole-row selection after DISTINCT folds into one SELECT and keeps rows, order and meta', async () => {
  const q = components.where(forTenant('acme')).map(c => ({ entityId: c.entityId, category: c.category })).distinct()
    .map(r => ({ category: r.category, entityId: r.entityId })).orderBy(r => r.entityId).limit(3);
  const plans = backends.map(b => b.compile(q.ir).compiled);
  expect(plans[0]!.sql).toBe('SELECT DISTINCT `category`, `entityId` FROM `entity_ots_component` WHERE `tenantId` = {p0:String} ORDER BY `entityId` ASC LIMIT 3');
  const oracle = await rows("SELECT DISTINCT category, entityId FROM entity_ots_component WHERE tenantId = 'acme' ORDER BY entityId LIMIT 3");
  expect(oracle.data).toEqual([{ category: null, entityId: 'cmp_0' }, { category: null, entityId: 'cmp_1' }, { category: null, entityId: 'cmp_10' }]);
  for (const plan of plans) expect(await rows(plan.sql, plan.params)).toEqual(oracle);
  expect(flatten(await explain(plans[0]!)).map(x => x.type)).toContain('Distinct');
});

// Slice 3 fix round 1 (a)/(b): native proof that folding any selection over a filtered scan block keeps rows, failures and
// Param order, under both alias settings and with/without PREWHERE, and that a direct selection over a filtered join folds.
type Outcome = { rows?: unknown[]; error?: string };
async function outcome(compiled: Pick<CompiledQuery, 'sql' | 'params'>, settings: Record<string, 0 | 1>): Promise<Outcome> {
  try {
    const result = await driver.query({ query: compiled.sql, query_params: compiled.params, format: 'JSONEachRow', clickhouse_settings: settings });
    try { return { rows: await result.json<unknown>() }; } finally { result.close(); }
  } catch (error) { return { error: String((error as { type?: string }).type ?? error) }; }
}
const settingsMatrix = [0, 1].flatMap(alias => [0, 1].map(prewhere => ({ prefer_column_name_to_alias: alias as 0 | 1, optimize_move_to_prewhere: prewhere as 0 | 1 })));
async function agree(root: Rel, expected: Outcome) {
  const optimized = compile(root), naive = emitNaive(root);
  expect(optimized.parameterTypes, optimized.sql).toEqual(naive.parameterTypes);
  for (const settings of settingsMatrix) for (const plan of [optimized, naive]) {
    const actual = await outcome(plan, settings);
    expect(actual, `${plan.sql} ${JSON.stringify(settings)}`).toEqual(expected);
  }
  return optimized;
}
it('fix round 1 (a): fallible, volatile and shadow-aliased selections fold over a filtered scan with the same rows and failures as the nested form', async () => {
  await driver.command({ query: 'CREATE TABLE fallible (id UInt32, s String, k String, n UInt64) ENGINE = MergeTree ORDER BY id' });
  await driver.insert({ table: 'fallible', values: [{ id: 1, s: '1', k: 'a', n: '10' }, { id: 2, s: 'x', k: 'b', n: '20' }, { id: 3, s: '3', k: 'a', n: '30' }], format: 'JSONEachRow' });
  const t = from(table('fallible', { id: col.UInt32, s: col.String, k: col.String, n: col.UInt64 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] }));
  // (i) the bad row is filtered out: both forms succeed with the same rows; (ii) it is kept: both fail with the same class.
  const filtered = await agree(t.where(r => r.id.ne(2)).map(r => ({ id: r.id, v: cast(r.s, col.UInt64) })).ir, { rows: [{ id: 1, v: '1' }, { id: 3, v: '3' }] });
  expect(filtered.sql).toBe('SELECT `id` AS `id`, CAST(`s` AS UInt64) AS `v` FROM `fallible` WHERE `id` != {p0:UInt32}');
  await agree(t.map(r => ({ id: r.id, v: cast(r.s, col.UInt64) })).ir, { error: 'CANNOT_PARSE_TEXT' });
  await agree(t.where(r => r.k.eq('b')).map(r => ({ id: r.id, v: cast(r.s, col.UInt64) })).ir, { error: 'CANNOT_PARSE_TEXT' });
  // Params: SELECT-list Params precede WHERE Params in both texts.
  const ordered = await agree(t.where(r => r.k.eq('a')).map(r => ({ id: r.id, v: cast(r.s, col.UInt64).plus(5n) })).ir, { rows: [{ id: 1, v: '6' }, { id: 3, v: '8' }] });
  expect(ordered.params).toEqual({ p0: '5', p1: 'a' });
  // A volatile selection folds: one row per filtered source row.
  const rand = defineFunction({ name: 'rand', args: [], returns: col.UInt32, deterministic: false });
  for (const q of [t.where(r => r.k.eq('a')).map(r => ({ id: r.id, r: rand() })), t.where(r => r.k.eq('a')).map(r => ({ id: r.id, at: cast(r.n, col.String) }))]) {
    const optimized = compile(q.ir), naive = emitNaive(q.ir);
    expect(optimized.sql.match(/SELECT /g)).toHaveLength(1);
    for (const settings of settingsMatrix) for (const plan of [optimized, naive]) expect((await outcome(plan, settings)).rows?.map(r => (r as { id: number }).id)).toEqual([1, 3]);
  }
  // A computed alias equal to a column nothing else in the block reads folds and reads its own column; one read by the
  // WHERE keeps its scope; both agree with the nested form under every setting.
  const self = await agree(t.where(r => r.id.gt(1)).map(r => ({ k: cast(r.n, col.String), id: r.id })).ir, { rows: [{ k: '20', id: 2 }, { k: '30', id: 3 }] });
  expect(self.sql).toBe('SELECT CAST(`n` AS String) AS `k`, `id` AS `id` FROM `fallible` WHERE `id` > {p0:UInt32}');
  const unread = await agree(t.where(r => r.id.gt(1)).map(r => ({ n: cast(r.n, col.String), id: r.id })).ir, { rows: [{ n: '20', id: 2 }, { n: '30', id: 3 }] });
  expect(unread.sql).toBe('SELECT CAST(`n` AS String) AS `n`, `id` AS `id` FROM `fallible` WHERE `id` > {p0:UInt32}');
  const read = await agree(t.where(r => r.n.gt(15n)).map(r => ({ n: cast(r.id, col.String) })).ir, { rows: [{ n: '2' }, { n: '3' }] });
  expect(read.sql).toContain(') AS `__typedhouse_input`');
});
it('fix round 1 (b): the spec self-join example folds its direct selection over the filtered join block', async () => {
  const compiled = compile(sharedPart.ir);
  expect(compiled.sql.match(/SELECT /g)).toHaveLength(2); // the shared expansion is a CTE; the query itself is one SELECT
  expect(compiled.sql).toContain('FROM `t0` AS `a_`\nINNER ALL JOIN `t0` AS `b_` ON `a_`.`partId` = `b_`.`partId`\nWHERE (`a_`.`entityId` < `b_`.`entityId`)');
  const oracle = await rows("SELECT a.entityId AS a, b.entityId AS b, a.partId AS partId FROM (SELECT entityId, partId FROM entity_ots_component ARRAY JOIN matched_part_ids AS partId WHERE tenantId = 'acme') a INNER JOIN (SELECT entityId, partId FROM entity_ots_component ARRAY JOIN matched_part_ids AS partId WHERE tenantId = 'acme') b ON a.partId = b.partId WHERE a.entityId < b.entityId ORDER BY a, b");
  expect(oracle.data).toHaveLength(25); // components 400..449 pair up on part_400..part_424
  for (const backend of backends) {
    const result = (await collect(backend.run(backend.compile(sharedPart.ir)))).flat() as { a: string; b: string; partId: string }[];
    expect(result.map(r => ({ a: r.a, b: r.b, partId: r.partId })).sort((x, y) => x.a.localeCompare(y.a))).toEqual(oracle.data);
  }
  const fences = structure(sharedPart.ir).selects.map(x => x.fence);
  expect(fences).toEqual(['CTE', 'root']);
  const small = join({ a: components.where(forTenant('acme')), b: from(db.entity_ots_component) }).on(r => r.a.entityId.eq(r.b.entityId)).where(r => r.b.countOfParts.gt(0n)).map(r => ({ id: r.a.entityId, n: r.b.countOfParts }));
  expect(compile(small.ir).sql.match(/SELECT /g)).toHaveLength(3); // the two pruned join inputs are derived tables
  const expected = await rows("SELECT a.entityId AS id, b.countOfParts AS n FROM entity_ots_component a INNER JOIN entity_ots_component b ON a.entityId = b.entityId WHERE a.tenantId = 'acme' AND b.countOfParts > 0 ORDER BY id");
  expect(expected.data.length).toBeGreaterThan(1000); // every acme component with a matched part, per matching tenant row
  for (const plan of backends.map(b => b.compile(small.ir).compiled)) expect((await rows(plan.sql + ' ORDER BY `id`', plan.params)).data).toEqual(expected.data);
});
