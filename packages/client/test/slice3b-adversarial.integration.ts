import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, defineFunction, from, join, max, multiIf, scalar, table, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

// Tester native probes for slice 3b on clickhouse/clickhouse-server:24.8. The optimizing and naive emissions must agree in
// rows, `meta` and failure code cell by cell under prefer_column_name_to_alias 0/1 × optimize_move_to_prewhere 0/1 ×
// max_threads 1/default (the contract matrix) plus two cells with query_plan_filter_push_down = 0 (where the server's own
// predicate push-down below ARRAY JOIN / JOIN is switched off), and with a hand-written nested oracle where given.
// `wait_end_of_query = 1` so a failure after the first streamed block is still an HTTP error with its code.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const adv = table('adv_s3b', { id: col.UInt32, k: col.String, n: col.Int64, s: col.String, nn: col.Nullable(col.String), ids: col.Array(col.String), f: col.Float64 }, meta);
const other = table('adv_s3b_other', { id: col.UInt32, v: col.UInt32, s2: col.String }, meta);
const t = from(adv), u = from(other);
const rand = defineFunction({ name: 'rand', args: [], returns: col.UInt32, deterministic: false });
const userDiv = defineFunction({ name: 'intDiv', args: [col.UInt64, col.UInt64], returns: col.UInt64, deterministic: true });
const bad = (r: typeof t.row) => cast(r.s, col.UInt64).gt(0n);
/** 10 / (id - 1): ILLEGAL_DIVISION (153) on id 1. */
const bad2 = (r: typeof t.row) => userDiv(val(10n, col.UInt64), cast(r.id.minus(1), col.UInt64)).gt(0n);
let container: StartedTestContainer;
let url: string;
type Settings = Readonly<Record<string, string | number>>;
interface Result { meta?: { name: string; type: string }[]; data?: Record<string, unknown>[]; error?: string }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, settings: Settings = {}, ordered = false): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  for (const [key, value] of Object.entries(settings)) endpoint.searchParams.set(key, String(value));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('wait_end_of_query', '1');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${sql} FORMAT JSON` });
  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 120) };
  const json = JSON.parse(text) as Required<Result>;
  const data = ordered ? json.data : [...json.data].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return { meta: json.meta, data };
}
const raw = async (sql: string) => { const res = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: sql }); if (!res.ok) throw new Error(await res.text()); };
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  // Bad rows: id 2 (s = 'x', empty array, no join partner) and id 4 (s = 'y', empty array, join partner (4, 3, 'y')). Clean rows: 1 and 3.
  await raw('CREATE TABLE adv_s3b (id UInt32, k String, n Int64, s String, nn Nullable(String), ids Array(String), f Float64) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO adv_s3b VALUES (1, 'a', 10, '1', 'x', ['p','q'], 0.5), (2, 'b', 20, 'x', NULL, [], 1.5), (3, 'a', 30, '3', 'y', ['q'], 2.5), (4, 'c', 40, 'y', NULL, [], 3.5)");
  await raw('CREATE TABLE adv_s3b_other (id UInt32, v UInt32, s2 String) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO adv_s3b_other VALUES (1, 5, '1'), (3, 2, '3'), (3, 40, '3'), (4, 3, 'y')");
}, 120000);
const notes: string[] = [];
afterAll(async () => { if (notes.length) console.info(`slice 3b server-dependent outcomes:\n${notes.join('\n')}`); await container?.stop(); });

const contract: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) for (const threads of [1, 0]) contract.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere, ...(threads ? { max_threads: 1 } : {}) });
for (const prewhere of [0, 1]) contract.push({ prefer_column_name_to_alias: 0, optimize_move_to_prewhere: prewhere, max_threads: 1, query_plan_filter_push_down: 0 });
/** Both emissions agree with each other in every cell (rows, meta, error code), and with the oracle; `error` pins the code of
 * every cell; `perCell` allows the outcome to differ between cells (server push-down decisions) while still requiring the two
 * emitters to agree in each and records what the server did. */
async function agree(root: Rel, options: { oracle?: string; selects?: number; ordered?: boolean; error?: string; label?: string; perCell?: boolean } = {}) {
  const optimized = compile(root), naive = emitNaive(root);
  const context = `${options.label ?? ''}\n${optimized.sql}\n${naive.sql}`;
  if (options.selects !== undefined) expect(optimized.sql.match(/SELECT /g)?.length, context).toBe(options.selects);
  expect(optimized.sql, context).not.toMatch(/SELECT \*/);
  expect(Object.keys(optimized.params), context).toEqual(Object.keys(naive.params));
  expect(optimized.parameterTypes, context).toEqual(naive.parameterTypes);
  expect(optimized.columns, context).toEqual(naive.columns);
  let first: Result | undefined;
  const outcomes: string[] = [];
  for (const settings of contract) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);
    const label = `${context}\n${JSON.stringify(settings)}`;
    expect(a, label).toEqual(b);
    if (options.error !== undefined) expect(a.error, label).toBe(options.error);
    else if (!options.perCell) expect(a.error, label).toBeUndefined();
    first ??= a;
    if (options.perCell) outcomes.push(`${JSON.stringify(settings)} → ${a.error ? `code ${a.error}` : `${a.data!.length} rows`}`);
    else expect(a, label).toEqual(first);
  }
  if (options.perCell) notes.push(`${options.label}:\n  ${outcomes.join('\n  ')}`);
  if (options.oracle && !options.perCell) expect(first, context).toEqual(await execute(options.oracle, {}, {}, options.ordered));
  return { optimized, naive, first: first!, outcomes };
}

/** Per-cell outcomes of both emitters without any equality assertion, plus the lift-up-off cell. */
async function cells(root: Rel, label: string): Promise<[Settings, Result, Result][]> {
  const optimized = compile(root), naive = emitNaive(root);
  const out: [Settings, Result, Result][] = [];
  for (const settings of [...contract, { prefer_column_name_to_alias: 0, optimize_move_to_prewhere: 0, max_threads: 1, query_plan_filter_push_down: 0, query_plan_lift_up_array_join: 0 }]) {
    out.push([settings, await execute(optimized.sql, optimized.params, settings), await execute(naive.sql, naive.params, settings)]);
  }
  notes.push(`${label}:\n  ${out.map(([s, a, b]) => `${JSON.stringify(s)} → optimized ${a.error ? `code ${a.error}` : `${a.data!.length} rows`}, naive ${b.error ? `code ${b.error}` : `${b.data!.length} rows`}`).join('\n  ')}`);
  return out;
}

it('scan blocks: chains of total and fallible filters agree in rows, meta and failure code; each fallible filter sees exactly the rows the earlier filters pass', async () => {
  const out = await agree(t.where(r => r.k.eq('a')).where(bad).map(r => ({ id: r.id })).ir, { selects: 2, oracle: "SELECT id FROM (SELECT id, s FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0", label: 'total, cast: bad rows filtered out' });
  expect(out.first).toEqual({ meta: [{ name: 'id', type: 'UInt32' }], data: [{ id: 1 }, { id: 3 }] });
  await agree(t.where(r => r.k.ne('c')).where(bad).map(r => ({ id: r.id })).ir, { selects: 2, error: '6', label: 'total, cast: bad row 2 kept' });
  // total, cast, total, intDiv, total: id 1 is removed by the third filter before the division reaches it; [3] in every cell.
  const chain = t.where(r => r.k.eq('a')).where(bad).where(r => r.id.ne(1)).where(bad2).where(r => r.n.gt(0n)).map(r => ({ id: r.id, n: r.n }));
  const c = await agree(chain.ir, { selects: 5, oracle: "SELECT id, n FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0) WHERE id != 1) WHERE intDiv(10, toUInt64(id - 1)) > 0) WHERE n > 0", label: 'total, cast, total, intDiv, total' });
  expect(c.first.data).toEqual([{ id: 3, n: '30' }]);
  await agree(t.where(r => r.k.eq('a')).where(bad).where(bad2).map(r => ({ id: r.id })).ir, { selects: 3, error: '153', label: 'total, cast, intDiv: id 1 reaches the division' });
  await agree(t.where(bad).where(r => r.k.eq('a')).map(r => ({ id: r.id })).ir, { selects: 2, error: '6', label: 'cast, total: the cast sees every row' });
  await agree(t.where(bad2).where(bad).map(r => ({ id: r.id })).ir, { selects: 2, error: '153', label: 'intDiv, cast: the first fallible filter fails first' });
  await agree(t.where(r => r.id.ne(1)).where(bad2).where(r => r.k.eq('a')).where(bad).map(r => ({ id: r.id })).ir, { selects: 4, oracle: "SELECT id FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM adv_s3b WHERE id != 1) WHERE intDiv(10, toUInt64(id - 1)) > 0) WHERE k = 'a') WHERE toUInt64(s) > 0", label: 'total, intDiv, total, cast → [3]' });
  // Other predicate classes outside the fragment over a total filter: known-origin, multiIf, Float, user call, IN-subquery with its own chain, scalar subquery.
  await agree(t.where(r => r.k.eq('a')).where(r => r.s.startsWith('1')).map(r => ({ id: r.id })).ir, { selects: 2, oracle: "SELECT id FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE startsWith(s, '1')", label: 'startsWith over total' });
  await agree(t.where(r => r.k.eq('a')).where(r => multiIf([r.s.eq('1'), 'x'], 'y').eq('x')).map(r => ({ id: r.id })).ir, { selects: 2, oracle: "SELECT id FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE multiIf(s = '1', 'x', 'y') = 'x'", label: 'multiIf over total' });
  await agree(t.where(r => r.k.eq('a')).where(r => r.f.gt(1)).map(r => ({ id: r.id, f: r.f })).ir, { selects: 2, oracle: "SELECT id, f FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE f > 1", label: 'Float over total' });
  const inner = await agree(t.where(r => r.k.eq('a')).where(r => r.id.in(u.where(x => x.v.gt(3)).where(x => cast(x.s2, col.UInt64).gt(0n)).map(x => ({ id: x.id })))).map(r => ({ id: r.id })).ir, { selects: 4, oracle: "SELECT id FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE id IN (SELECT id FROM (SELECT * FROM adv_s3b_other WHERE v > 3) WHERE toUInt64(s2) > 0)", label: 'IN-subquery whose own chain isolates its cast' });
  expect(inner.first.data).toEqual([{ id: 1 }, { id: 3 }]);
  expect(inner.optimized.sql).toContain("(SELECT `__typedhouse_input`.`id` FROM (SELECT `id`, `s2` FROM `adv_s3b_other` WHERE `v` > {p1:UInt32}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s2` AS UInt64) > {p2:UInt64})");
  await agree(t.where(r => r.k.eq('a')).where(r => r.id.in(u.where(x => x.v.ge(3)).where(x => cast(x.s2, col.UInt64).gt(0n)).map(x => ({ id: x.id })))).map(r => ({ id: r.id })).ir, { selects: 4, error: '6', label: 'IN-subquery chain keeps the bad row' });
  await agree(t.where(r => r.k.eq('a')).where(r => r.n.gt(scalar(u.aggregate(() => ({ m: count() }))))).map(r => ({ id: r.id })).ir, { selects: 3, oracle: "SELECT id FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE n > (SELECT count() FROM adv_s3b_other)", label: 'scalar subquery over total' });
  // Non-deterministic predicates (never total): both texts nest them; rows agree because the predicate is constant-valued here.
  const r1 = await agree(t.where(r => r.k.eq('a')).where(() => rand().ge(0)).map(r => ({ id: r.id })).ir, { selects: 2, label: 'rand() >= 0 over total' });
  expect(r1.first.data).toEqual([{ id: 1 }, { id: 3 }]);
  expect((await agree(t.where(() => rand().lt(0)).where(r => r.k.eq('a')).map(r => ({ id: r.id })).ir, { selects: 2, label: 'total over rand() < 0' })).first.data).toEqual([]);
  // A total pair and a total-arithmetic pair still share one WHERE; an isNull total conjunct too.
  await agree(t.where(r => r.k.eq('a')).where(r => r.n.plus(1n).gt(0n)).where(r => r.nn.isNotNull()).map(r => ({ id: r.id })).ir, { selects: 1, oracle: "SELECT id FROM adv_s3b WHERE k = 'a' AND n + 1 > 0 AND nn IS NOT NULL", label: 'total triple shares' });
  // Computed selection folded below a fallible filter on its alias; identity selection between; Sort/Limit above the isolated filter; DISTINCT over it; aggregate over it; FINAL below.
  const sel = await agree(t.where(r => r.k.eq('a')).map(r => ({ next: r.id.plus(1), s: r.s })).where(r => cast(r.s, col.UInt64).gt(0n)).ir, { selects: 2, oracle: "SELECT next, s FROM (SELECT id + 1 AS next, s FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0", label: 'computed selection below the fallible filter' });
  expect(sel.first).toEqual({ meta: [{ name: 'next', type: 'UInt64' }, { name: 's', type: 'String' }], data: [{ next: '2', s: '1' }, { next: '4', s: '3' }] });
  await agree(t.where(r => r.k.eq('a')).map(r => ({ id: r.id, s: r.s })).where(r => cast(r.s, col.UInt64).gt(0n)).orderBy(r => r.id.desc()).limit(1).ir, { selects: 2, ordered: true, oracle: "SELECT id, s FROM (SELECT id, s FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0 ORDER BY id DESC LIMIT 1", label: 'identity selection, sort and limit above' });
  await agree(t.where(r => r.k.eq('a')).where(bad).distinct().map(r => ({ k: r.k })).ir, { selects: 3, oracle: "SELECT k FROM (SELECT DISTINCT * FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0)", label: 'distinct above' });
  await agree(t.where(r => r.k.eq('a')).where(bad).groupBy(r => ({ k: r.k })).aggregate(() => ({ c: count() })).ir, { selects: 3, oracle: "SELECT k, count() AS c FROM (SELECT * FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0) GROUP BY k", label: 'aggregate above' });
  // FINAL is illegal on a plain MergeTree (181): both texts carry it on the scan block below the isolated filter and fail alike (the ReplacingMergeTree case is slice 3's probe).
  await agree(from(adv).final().where(r => r.k.eq('a')).where(bad).map(r => ({ id: r.id })).ir, { selects: 2, error: '181', label: 'FINAL below' });
});

it('HAVING sequences, expansions (server push-down recorded per cell), join blocks and deviation 2 selections agree in every cell', async () => {
  // HAVING: safe HAVING below, fallible above (its own SELECT), ORDER BY/LIMIT in the outer block. Merged as one HAVING the cast would see 'x'/'y'.
  const g = t.groupBy(r => ({ k: r.k })).aggregate(x => ({ c: count(), m: max(x.s) }));
  const h = await agree(g.where(r => r.c.gt(1n)).where(r => cast(r.m, col.UInt64).gt(0n)).orderBy(r => r.k).limit(2).ir, { selects: 2, ordered: true, oracle: "SELECT k, c, m FROM (SELECT k, count() AS c, max(s) AS m FROM adv_s3b GROUP BY k HAVING c > 1) WHERE toUInt64(m) > 0 ORDER BY k LIMIT 2", label: 'safe HAVING, fallible above, sort+limit' });
  expect(h.first.data).toEqual([{ k: 'a', c: '2', m: '3' }]);
  expect(h.optimized.sql).toMatch(/HAVING `c` > \{p0:UInt64\}\) AS `__typedhouse_input` WHERE CAST\(`__typedhouse_input`\.`m` AS UInt64\) > \{p1:UInt64\} ORDER BY `__typedhouse_input`\.`k` ASC LIMIT 2$/);
  await agree(g.where(r => r.c.gt(1n)).where(r => cast(r.m, col.UInt64).gt(0n)).where(r => r.c.lt(9n)).ir, { selects: 3, oracle: "SELECT k, c, m FROM (SELECT * FROM (SELECT k, count() AS c, max(s) AS m FROM adv_s3b GROUP BY k HAVING c > 1) WHERE toUInt64(m) > 0) WHERE c < 9", label: 'safe, fallible, safe HAVING' });
  await agree(g.where(r => cast(r.m, col.UInt64).gt(0n)).orderBy(r => r.k).ir, { selects: 2, error: '6', label: 'fallible first HAVING (deviation 1): its own block, sees every group' });
  await agree(g.where(r => r.c.ge(1n)).where(r => cast(r.m, col.UInt64).gt(0n)).ir, { selects: 2, error: '6', label: 'safe HAVING keeps the bad groups' });
  // Expansions. A fallible first WHERE above an inner expansion folds into the expanded block: in IR order the cast sees only expanded rows (1, 3),
  // but the server may push the alias-independent predicate below the ARRAY JOIN step and divide/cast rows 2 and 4 too. Both texts must agree per
  // cell under push-down on and off; the outcome per cell is recorded in the log.
  // FINDING 1 (as observed; recorded for the PM, outside the 8-cell contract matrix). ClickHouse 24.8 computes a WHERE expression that does
  // not depend on the expansion alias *before* the ARRAY JOIN step whenever the Filter step sits directly above the ArrayJoin step
  // (`query_plan_lift_up_array_join`, default on; the EXPLAIN shows `Filter (WHERE [split])`), so the cast also runs on the empty-array rows
  // 2 and 4 in both texts in every contract cell, push-down on or off: both fail with 6 (agreement). With `query_plan_filter_push_down = 0`
  // the slice 3b text for `where(total).arrayJoin().where(fallible)` keeps its own Filter step above the split total one, is not lifted,
  // and returns the IR-order rows while the naive text (one Filter directly above the ArrayJoin) is still lifted and fails: the two texts
  // disagree in that cell, in favour of IR order. At HEAD the folded `WHERE total AND fallible` failed there too (agreement by double
  // failure). With both server optimisations off every text returns the IR-order rows.
  const x1 = await cells(t.arrayJoin(r => r.ids, 'x').where(bad).map(r => ({ id: r.id, x: r.x })).ir, 'inner expansion, fallible first WHERE above (folded)');
  for (const [settings, a, b] of x1) { expect(a, JSON.stringify(settings)).toEqual(b); expect(a.error, JSON.stringify(settings)).toBe(settings.query_plan_lift_up_array_join === 0 ? undefined : '6'); }
  expect(x1.at(-1)![1].data).toEqual([{ id: 1, x: 'p' }, { id: 1, x: 'q' }, { id: 3, x: 'q' }]);
  const x2 = await cells(t.where(r => r.k.ne('zz')).arrayJoin(r => r.ids, 'x').where(bad).map(r => ({ id: r.id, x: r.x })).ir, 'inner expansion over a total WHERE, fallible above (own block)');
  for (const [settings, a, b] of x2) {
    const label = JSON.stringify(settings);
    if (settings.query_plan_filter_push_down === 0 && settings.query_plan_lift_up_array_join !== 0) { expect(a.data, label).toEqual([{ id: 1, x: 'p' }, { id: 1, x: 'q' }, { id: 3, x: 'q' }]); expect(b.error, label).toBe('6'); } // FINDING 1 as observed
    else { expect(a, label).toEqual(b); expect(a.error, label).toBe(settings.query_plan_lift_up_array_join === 0 ? undefined : '6'); }
  }
  await agree(t.leftArrayJoin(r => r.ids, 'x').where(bad).map(r => ({ id: r.id })).ir, { selects: 1, error: '6', label: 'LEFT expansion, fallible first WHERE above: every row survives the expansion' });
  await agree(t.where(bad).leftArrayJoin(r => r.ids, 'x').where(r => r.x.eq('q')).map(r => ({ id: r.id })).ir, { selects: 2, error: '6', label: 'fallible below a LEFT expansion, total above (own block)' });
  const lx = await agree(t.where(r => r.k.eq('a')).leftArrayJoin(r => r.ids, 'x').where(bad).where(r => r.x.eq('q')).map(r => ({ id: r.id, x: r.x })).ir, { selects: 3, oracle: "SELECT id, x FROM (SELECT id, s, x FROM (SELECT id, s, x FROM adv_s3b LEFT ARRAY JOIN ids AS x WHERE k = 'a') WHERE toUInt64(s) > 0) WHERE x = 'q'", label: 'total below LEFT expansion, fallible, total' });
  expect(lx.first.data).toEqual([{ id: 1, x: 'q' }, { id: 3, x: 'q' }]);
  // Join blocks. The residual `a.id < b.v` keeps (1,5) and (3,40) and drops the bad partner (4,3): the cast above it succeeds in IR order.
  const jr = await agree(join({ a: t, b: u }).on(r => [r.a.id.eq(r.b.id), r.a.id.lt(r.b.v)]).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id, v: r.b.v })).ir, { selects: 4, perCell: true, label: 'join residual below, cast above' });
  expect(jr.outcomes.filter(o => o.includes('query_plan_filter_push_down')).every(o => o.endsWith('2 rows'))).toBe(true);
  await agree(join({ a: t, b: u }).on(r => [r.a.id.eq(r.b.id), r.a.id.ne(r.b.v)]).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id })).ir, { selects: 4, error: '6', label: 'join residual keeps the bad partner' });
  // Fallible first WHERE on a join block whose bad rows never join (b filtered to v != 3; row 2 has no partner): IR order never casts them.
  const jb = join({ a: t, b: u.where(x => x.v.ne(3)) }).on(r => r.a.id.eq(r.b.id));
  const j1 = await agree(jb.where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id })).ir, { selects: 3, perCell: true, label: 'join block, fallible first WHERE (folded), bad rows unjoined' });
  expect(j1.outcomes.filter(o => o.includes('query_plan_filter_push_down')).every(o => o.endsWith('3 rows'))).toBe(true);
  const j2 = await agree(jb.where(r => cast(r.a.s, col.UInt64).gt(0n)).where(r => r.a.id.plus(r.b.v).ne(27n)).map(r => ({ id: r.a.id })).ir, { selects: 4, perCell: true, label: 'join block, fallible first WHERE, total above (own block)' });
  expect(j2.outcomes.map(o => o.split(' → ')[1])).toEqual(j1.outcomes.map(o => o.split(' → ')[1]));
  // Deviation 2: direct selections (with renames) fold over the derived Filter-only block above join, sorted, limited, distinct and expanded join blocks.
  const d1b = await agree(jb.where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ s: r.b.s2, id: r.b.v, v: r.a.id })).ir, { selects: 4, oracle: "SELECT bs2 AS s, bv AS id, aid AS v FROM (SELECT a.id AS aid, a.s AS as_, b.v AS bv, b.s2 AS bs2 FROM adv_s3b a INNER JOIN (SELECT * FROM adv_s3b_other WHERE v != 3) b ON a.id = b.id WHERE a.id + b.v != 27) WHERE toUInt64(as_) > 0", label: 'deviation 2: renamed direct selection over the isolated cast' });
  expect(d1b.first).toEqual({ meta: [{ name: 's', type: 'String' }, { name: 'id', type: 'UInt32' }, { name: 'v', type: 'UInt32' }], data: [{ s: '1', id: 5, v: 1 }, { s: '3', id: 2, v: 3 }, { s: '3', id: 40, v: 3 }] });
  expect(d1b.optimized.sql).toMatch(/^SELECT `__typedhouse_input`\.`__typedhouse_leaf_9` AS `s`, `__typedhouse_input`\.`__typedhouse_leaf_8` AS `id`, `__typedhouse_input`\.`__typedhouse_leaf_0` AS `v` FROM \(SELECT /);
  const cap = await agree(jb.where(r => r.a.id.plus(r.b.v).ne(27n)).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ __typedhouse_leaf_3: r.b.s2, id: r.a.id })).ir, { selects: 4, oracle: "SELECT bs2 AS __typedhouse_leaf_3, aid AS id FROM (SELECT a.id AS aid, a.s AS as_, b.s2 AS bs2 FROM adv_s3b a INNER JOIN (SELECT * FROM adv_s3b_other WHERE v != 3) b ON a.id = b.id WHERE a.id + b.v != 27) WHERE toUInt64(as_) > 0", label: 'deviation 2: user alias equal to the leaf name the isolated WHERE reads' });
  expect(cap.first.data).toEqual([{ __typedhouse_leaf_3: '1', id: 1 }, { __typedhouse_leaf_3: '3', id: 3 }, { __typedhouse_leaf_3: '3', id: 3 }]);
  const ds = await agree(jb.orderBy(r => r.a.id).thenBy(r => r.b.v).where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id, v: r.b.v })).ir, { selects: 4, perCell: true, label: 'deviation 2: sorted join, cast above, direct selection' });
  expect(ds.outcomes.filter(o => o.includes('query_plan_filter_push_down')).every(o => o.endsWith('3 rows'))).toBe(true);
  const dl = await agree(join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.id).thenBy(r => r.b.v).limit(2).where(r => r.b.v.gt(1)).map(r => ({ id: r.a.id, v: r.b.v })).ir, { selects: 4, ordered: true, oracle: 'SELECT aid AS id, bv AS v FROM (SELECT a.id AS aid, b.v AS bv FROM adv_s3b a INNER JOIN adv_s3b_other b ON a.id = b.id ORDER BY a.id, b.v LIMIT 2) WHERE bv > 1', label: 'deviation 2: limited join, total above, direct selection' });
  expect(dl.first.data).toEqual([{ id: 1, v: 5 }, { id: 3, v: 2 }]);
  const dd = await agree(join({ a: t, b: u }).on(r => r.a.id.eq(r.b.id)).distinct().where(r => r.b.v.gt(2)).map(r => ({ id: r.a.id, v: r.b.v })).ir, { selects: 2, oracle: 'SELECT aid AS id, bv AS v FROM (SELECT DISTINCT a.id AS aid, b.v AS bv FROM adv_s3b a INNER JOIN adv_s3b_other b ON a.id = b.id) WHERE bv > 2', label: 'deviation 2: distinct join, total above, direct selection' });
  expect(dd.first.data).toEqual([{ id: 1, v: 5 }, { id: 3, v: 40 }, { id: 4, v: 3 }]);
  const dx = await agree(jb.arrayJoin(r => r.a.ids, 'x').where(r => cast(r.a.s, col.UInt64).gt(0n)).map(r => ({ id: r.a.id, x: r.x })).ir, { selects: 5, perCell: true, label: 'deviation 2: expanded join, cast above, direct selection' });
  expect(dx.outcomes.filter(o => o.includes('query_plan_filter_push_down')).every(o => o.endsWith('4 rows'))).toBe(true);
  // CTE-sourced block, union branches, a shared Materialize of the chain, and a filter above a union.
  await agree(t.cte().where(r => r.k.eq('a')).where(bad).map(r => ({ id: r.id })).ir, { selects: 3, oracle: "SELECT id FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0", label: 'CTE-sourced chain' });
  await agree(unionAll(t.where(r => r.k.eq('a')).where(bad), t.where(r => r.id.eq(3)).where(bad)).map(r => ({ id: r.id })).orderBy(r => r.id).ir, { selects: 9, ordered: true, oracle: "SELECT id FROM (SELECT id FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0 UNION ALL SELECT id FROM (SELECT * FROM adv_s3b WHERE id = 3) WHERE toUInt64(s) > 0) ORDER BY id", label: 'union branches each with an isolated cast' });
  const shared = t.where(r => r.k.eq('a')).where(bad).cte();
  const m = await agree(join({ a: shared, b: shared }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })).ir, { selects: 3, oracle: "WITH c AS (SELECT * FROM (SELECT * FROM adv_s3b WHERE k = 'a') WHERE toUInt64(s) > 0) SELECT a.id AS id FROM c a INNER JOIN c b ON a.id = b.id", label: 'Materialize of the chain consumed twice' });
  expect(m.first.data).toEqual([{ id: 1 }, { id: 3 }]);
  await agree(unionAll(t.where(r => r.k.eq('a')), t.where(r => r.id.eq(3))).where(r => r.id.ne(99)).where(bad).map(r => ({ id: r.id })).orderBy(r => r.id).ir, { selects: 6, ordered: true, oracle: "SELECT id FROM (SELECT * FROM (SELECT * FROM adv_s3b WHERE k = 'a' UNION ALL SELECT * FROM adv_s3b WHERE id = 3) WHERE id != 99) WHERE toUInt64(s) > 0 ORDER BY id", label: 'cast above a union with the total pushed into the branches' });
});
