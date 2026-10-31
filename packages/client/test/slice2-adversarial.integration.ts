import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, crossJoin, defineFunction, from, join, table, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';

// Tester native probes for slice 2: rows AND meta must agree between the optimizing and naive emissions under both
// prefer_column_name_to_alias settings (and max_threads = 1 for reproducible row numbering), and with hand-written
// SQL where given; server failures must agree too.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const adv = table('adv_s2', {
  id: col.UInt32, k: col.String, n: col.Int64, small: col.UInt8, nn: col.Nullable(col.Int64), s: col.String,
  ids: col.Array(col.String), nids: col.Array(col.Nullable(col.String)), lcids: col.Array(col.LowCardinality(col.String)), uids: col.Array(col.UInt64),
  parts: col.Array(col.Tuple({ id: col.String, mpn: col.Nullable(col.String) })), tup: col.Tuple({ a: col.String, b: col.UInt8 }),
}, meta);
const rmt = table('adv_s2_rmt', { id: col.UInt32, ver: col.UInt32, ids: col.Array(col.String) }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] });
const other = table('adv_s2_other', { id: col.UInt32, v: col.UInt64 }, meta);
const t = from(adv), r = from(rmt), u = from(other);
const volatile = defineFunction({ name: 'rowNumberInAllBlocks', args: [], returns: col.UInt64, deterministic: false });
let container: StartedTestContainer;
let url: string;
interface Result { meta: { name: string; type: string }[]; data: Record<string, unknown>[] }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, preferColumn: 0 | 1 = 0, sort = true): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  endpoint.searchParams.set('prefer_column_name_to_alias', String(preferColumn));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('max_threads', '1');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${sql} FORMAT JSON` });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  const json = JSON.parse(text) as Result;
  const data = sort ? [...json.data].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) : json.data;
  return { meta: json.meta, data };
}
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  const raw = async (sql: string) => { const res = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: sql }); if (!res.ok) throw new Error(await res.text()); };
  await raw('CREATE TABLE adv_s2 (id UInt32, k String, n Int64, small UInt8, nn Nullable(Int64), s String, ids Array(String), nids Array(Nullable(String)), lcids Array(LowCardinality(String)), uids Array(UInt64), parts Array(Tuple(id String, mpn Nullable(String))), tup Tuple(a String, b UInt8)) ENGINE=MergeTree ORDER BY id');
  // Empty arrays (id 2, twice: a duplicate row for DISTINCT), duplicate elements, NULL elements, duplicate tuples.
  await raw("INSERT INTO adv_s2 VALUES (1, 'a', 5, 200, 1, '7', ['p','p','q'], ['p',NULL], ['x','y'], [1,2], [('s1','m1'),('s2',NULL)], ('t',1)), (2, 'b', -5, 1, NULL, '8', [], [], [], [], [], ('u',2)), (3, 'a', 0, 255, -3, '9', ['q'], [NULL], ['x'], [0], [('s3','m1'),('s3','m1')], ('t',3)), (4, 'c', 10, 0, 5, '10', ['p'], ['z'], ['y','y'], [7,7], [('s4','m4')], ('v',4)), (2, 'b', -5, 1, NULL, '8', [], [], [], [], [], ('u',2))");
  await raw('CREATE TABLE adv_s2_rmt (id UInt32, ver UInt32, ids Array(String)) ENGINE=ReplacingMergeTree(ver) ORDER BY id');
  await raw("INSERT INTO adv_s2_rmt VALUES (1, 1, ['old','old']), (2, 1, ['keep'])");
  await raw("INSERT INTO adv_s2_rmt VALUES (1, 2, ['new']), (3, 1, [])");
  await raw('CREATE TABLE adv_s2_other (id UInt32, v UInt64) ENGINE=MergeTree ORDER BY id');
  await raw('INSERT INTO adv_s2_other VALUES (1, 1), (2, 9), (3, 2), (3, 2), (5, 0)');
}, 120000);
afterAll(async () => { await container?.stop(); });

/** Four executions (two emitters x two alias settings) must be identical in meta and data; optional oracle SQL. */
async function agree(root: Rel, oracle?: string, expectedRules: Partial<Record<string, number>> = {}, selects?: number) {
  const optimized = compile(root), naive = emitNaive(root);
  const hits = rewriteRel(root).hits;
  for (const [rule, n] of Object.entries(expectedRules)) expect(hits[rule as keyof typeof hits], rule).toBe(n);
  if (selects !== undefined) expect(optimized.sql.match(/SELECT /g)?.length, optimized.sql).toBe(selects);
  const first = await execute(optimized.sql, optimized.params, 0);
  const context = JSON.stringify({ optimized: optimized.sql, naive: naive.sql });
  for (const [plan, setting] of [[optimized, 1], [naive, 0], [naive, 1]] as const) expect(await execute(plan.sql, plan.params, setting), context).toEqual(first);
  if (oracle) expect(first, context).toEqual(await execute(oracle));
  return first;
}
/** Same server outcome for both emitters: identical rows, or identical failure class. */
async function sameOutcome(root: Rel) {
  const optimized = compile(root), naive = emitNaive(root);
  const outcomes: string[] = [];
  for (const plan of [optimized, naive]) for (const setting of [0, 1] as const) {
    outcomes.push(await execute(plan.sql, plan.params, setting).then(x => JSON.stringify(x), e => `error:${/Code: (\d+)/.exec(String(e))?.[1] ?? String(e)}`));
  }
  expect(new Set(outcomes).size, JSON.stringify({ optimized: optimized.sql, naive: naive.sql, outcomes })).toBe(1);
  return outcomes[0]!;
}
const safe = (x: typeof t.row) => x.id.gt(1);
const unsafe = (x: typeof t.row) => cast(x.s, col.UInt64).gt(7n);

it('FINDING 1 natively (fixed in fix round 1, flipped from it.fails): a pruned Sort/Limit over a folded DISTINCT returns the naive row set', async () => {
  // Naive: DISTINCT over all columns keeps both `k = 'a'` rows (ids 1 and 3); optimized collapses them to one.
  const sorted = t.distinct().orderBy(x => x.k).map(x => ({ k: x.k }));
  await agree(sorted.ir, "SELECT k FROM (SELECT DISTINCT * FROM adv_s2 ORDER BY k) ORDER BY k");
});

it('fix round 1: wider DISTINCT lists in derived tables, CTEs, union branches and join sides never change consumer rows or meta', async () => {
  // Alias collision: the consumer names its output after a non-demanded DISTINCT leaf (`k`); qualified refs keep it apart.
  const collide = t.distinct().orderBy(x => x.id).map(x => ({ k: x.id }));
  const r1 = await agree(collide.ir, 'SELECT d.id AS k FROM (SELECT DISTINCT * FROM adv_s2 ORDER BY id) AS d');
  expect(r1.meta).toEqual([{ name: 'k', type: 'UInt32' }]);
  expect(r1.data).toEqual([{ k: 1 }, { k: 2 }, { k: 3 }, { k: 4 }]);
  // CTE definition: a shared Sort over Distinct, consumed by two narrowing selections.
  const shared = t.distinct().orderBy(x => x.id);
  const cte = crossJoin({ a: shared.map(x => ({ id: x.id })), b: shared.map(x => ({ k: x.k })) }).map(x => ({ id: x.a.id, k: x.b.k }));
  expect(compile(cte.ir).sql).toContain('WITH `t0` AS (SELECT DISTINCT `id`, `k`, `n`, `small`, `nn`, `s`, `ids`, `nids`, `lcids`, `uids`, `parts`, `tup` FROM `adv_s2` ORDER BY `id` ASC)');
  expect((await agree(cte.ir, 'SELECT a.id AS id, b.k AS k FROM (SELECT id FROM (SELECT DISTINCT * FROM adv_s2)) AS a CROSS JOIN (SELECT k FROM (SELECT DISTINCT * FROM adv_s2)) AS b')).data).toHaveLength(16);
  // Union branch and join side, each pruned to one column above the DISTINCT.
  const union = unionAll(t.distinct().orderBy(x => x.id).limit(3), from(adv).orderBy(x => x.id).limit(3)).map(x => ({ k: x.k })).orderBy(x => x.k);
  expect((await agree(union.ir, 'SELECT k FROM (SELECT * FROM (SELECT DISTINCT * FROM adv_s2 ORDER BY id LIMIT 3) UNION ALL SELECT * FROM (SELECT * FROM adv_s2 ORDER BY id LIMIT 3)) ORDER BY k')).data).toEqual([{ k: 'a' }, { k: 'a' }, { k: 'a' }, { k: 'b' }, { k: 'b' }, { k: 'b' }]);
  const side = join({ a: t.distinct().limit(10), b: u }).on(x => x.a.id.eq(x.b.id)).map(x => ({ id: x.a.id, v: x.b.v })).orderBy(x => x.id).thenBy(x => x.v);
  expect((await agree(side.ir, 'SELECT a.id AS id, b.v AS v FROM (SELECT DISTINCT * FROM adv_s2 LIMIT 10) AS a INNER JOIN adv_s2_other AS b ON a.id = b.id ORDER BY id, v')).data).toEqual([{ id: 1, v: '1' }, { id: 2, v: '9' }, { id: 3, v: '2' }, { id: 3, v: '2' }]);
  // Nested join leaves (no selection before DISTINCT), pruned to one side; tuple leaf through an expansion; FINAL scan.
  const nestedQ = join({ a: t, b: u }).on(x => x.a.id.eq(x.b.id)).distinct().orderBy(x => x.a.id).map(x => ({ id: x.a.id }));
  expect((await agree(nestedQ.ir, 'SELECT id FROM (SELECT DISTINCT a.id AS id, a.k, b.v FROM adv_s2 AS a INNER JOIN adv_s2_other AS b ON a.id = b.id) ORDER BY id')).data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const tuple = t.arrayJoin(x => x.parts, 'p').distinct().limit(10).map(x => ({ p: x.p }));
  const r2 = await agree(tuple.ir, 'SELECT p FROM (SELECT DISTINCT *, p FROM adv_s2 ARRAY JOIN parts AS p)');
  expect(r2.data).toHaveLength(4);
  const final = r.final().distinct().orderBy(x => x.id).map(x => ({ id: x.id }));
  expect((await agree(final.ir, 'SELECT id FROM (SELECT DISTINCT * FROM adv_s2_rmt FINAL) ORDER BY id')).data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  // Computed selection below the DISTINCT, pruned above: all projected expressions stay in the DISTINCT list.
  const computed = t.map(x => ({ w: x.small.plus(1), k: x.k })).distinct().orderBy(x => x.w).map(x => ({ w: x.w }));
  // A Sort never folds over a block carrying a selection, so it opens its own block and the Distinct node is the DISTINCT root.
  expect(compile(computed.ir).sql).toBe('SELECT `__typedhouse_input`.`w` AS `w` FROM (SELECT `__typedhouse_input`.`w` FROM (SELECT DISTINCT `small` + {p0:UInt8} AS `w`, `k` AS `k` FROM `adv_s2`) AS `__typedhouse_input` ORDER BY `__typedhouse_input`.`w` ASC) AS `__typedhouse_input`');
  expect((await agree(computed.ir, 'SELECT w FROM (SELECT DISTINCT small + 1 AS w, k FROM adv_s2) ORDER BY w')).data.map(d => d.w as number).sort((a, b) => a - b)).toEqual([1, 2, 201, 256]);
});

it('expansions over empty arrays, duplicates, NULL/LowCardinality/UInt64/Tuple elements agree in rows and meta, with LEFT defaults', async () => {
  // Inner over a safe filter folds (one SELECT); the empty-array rows (id 2) vanish; duplicates survive.
  const inner = t.where(safe).arrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x }));
  const r1 = await agree(inner.ir, 'SELECT id, x FROM adv_s2 ARRAY JOIN ids AS x WHERE id > 1', {}, 1);
  expect(r1.data).toEqual([{ id: 3, x: 'q' }, { id: 4, x: 'p' }]);
  // LEFT over an unsafe filter folds: id 2 keeps '' / NULL / 0 defaults, evaluated on every source row (all parse).
  const leftS = t.where(unsafe).leftArrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x }));
  const r2 = await agree(leftS.ir, "SELECT id, x FROM adv_s2 LEFT ARRAY JOIN ids AS x WHERE toUInt64(s) > 7", {}, 1);
  expect(r2.data).toEqual([{ id: 2, x: '' }, { id: 2, x: '' }, { id: 3, x: 'q' }, { id: 4, x: 'p' }]);
  const leftN = t.where(unsafe).leftArrayJoin(x => x.nids, 'x').map(x => ({ id: x.id, x: x.x }));
  const r3 = await agree(leftN.ir, undefined, {}, 1);
  expect(r3.meta).toEqual([{ name: 'id', type: 'UInt32' }, { name: 'x', type: 'Nullable(String)' }]);
  expect(r3.data).toEqual([{ id: 2, x: null }, { id: 2, x: null }, { id: 3, x: null }, { id: 4, x: 'z' }]);
  const leftU = t.where(unsafe).leftArrayJoin(x => x.uids, 'x').map(x => ({ id: x.id, x: x.x }));
  const r4 = await agree(leftU.ir, undefined, {}, 1);
  expect(r4.meta[1]).toEqual({ name: 'x', type: 'UInt64' });
  expect(r4.data).toEqual([{ id: 2, x: '0' }, { id: 2, x: '0' }, { id: 3, x: '0' }, { id: 4, x: '7' }, { id: 4, x: '7' }]);
  const lc = t.arrayJoin(x => x.lcids, 'x').where(x => x.x.eq('y')).map(x => ({ id: x.id, x: x.x }));
  const r5 = await agree(lc.ir, undefined, {}, 1);
  expect(r5.meta[1]).toEqual({ name: 'x', type: 'LowCardinality(String)' });
  expect(r5.data).toEqual([{ id: 1, x: 'y' }, { id: 4, x: 'y' }, { id: 4, x: 'y' }]);
  const tuples = t.arrayJoin(x => x.parts, 'p').where(safe).map(x => ({ id: x.id, p: x.p }));
  const r6 = await agree(tuples.ir, undefined, { PushFilterArrayJoin: 1 }, 1);
  expect(r6.meta[1]!.name).toBe('p');
  expect(r6.meta[1]!.type).toBe('Tuple(id String, mpn Nullable(String))');
  expect(r6.data).toHaveLength(3);
  // Tuple extraction: total expansion, filter on the alias stays above, NULL mpns survive, LEFT over empty yields NULL.
  const mpn = t.leftArrayJoin(x => x.parts.element('mpn'), 'm').where(x => x.m.isNull().or(x.id.eq(3))).map(x => ({ id: x.id, m: x.m }));
  const r7 = await agree(mpn.ir, "SELECT id, m FROM adv_s2 LEFT ARRAY JOIN tupleElement(parts, 'mpn') AS m WHERE isNull(m) OR id = 3", {}, 1);
  expect(r7.data).toEqual([{ id: 1, m: null }, { id: 2, m: null }, { id: 2, m: null }, { id: 3, m: 'm1' }, { id: 3, m: 'm1' }]);
});

it('FINAL and SAMPLE precede the expansion; two expansions, LIMIT before/after, count() above an inner expansion agree', async () => {
  const final = r.final().arrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x }));
  expect(compile(final.ir).sql).toBe('SELECT `id`, `x` FROM `adv_s2_rmt` FINAL ARRAY JOIN `ids` AS `x`');
  expect((await agree(final.ir, 'SELECT id, x FROM adv_s2_rmt FINAL ARRAY JOIN ids AS x')).data).toEqual([{ id: 1, x: 'new' }, { id: 2, x: 'keep' }]);
  const finalLeft = r.final().where(x => x.ver.ge(1)).leftArrayJoin(x => x.ids, 'x').orderBy(x => x.id).thenBy(x => x.x).limit(5).map(x => ({ id: x.id, x: x.x }));
  expect((await agree(finalLeft.ir, undefined, {}, 2)).data).toEqual([{ id: 1, x: 'new' }, { id: 2, x: 'keep' }, { id: 3, x: '' }]);
  const two = t.arrayJoin(x => x.ids, 'x').arrayJoin(x => x.uids, 'y').where(x => x.y.gt(0n)).map(x => ({ id: x.id, x: x.x, y: x.y }));
  const r2 = await agree(two.ir, 'SELECT id, x, y FROM adv_s2 ARRAY JOIN ids AS x ARRAY JOIN uids AS y WHERE y > 0', {}, 3);
  expect(r2.data).toHaveLength(3 * 2 + 1 * 2);
  const before = t.orderBy(x => x.id).limit(2).arrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x }));
  expect((await agree(before.ir, 'SELECT id, x FROM (SELECT * FROM adv_s2 ORDER BY id LIMIT 2) ARRAY JOIN ids AS x', {}, 3)).data).toEqual([{ id: 1, x: 'p' }, { id: 1, x: 'p' }, { id: 1, x: 'q' }]);
  const after = t.arrayJoin(x => x.ids, 'x').orderBy(x => x.id).thenBy(x => x.x).limit(2).map(x => ({ id: x.id, x: x.x }));
  expect((await agree(after.ir, undefined, {}, 2)).data).toEqual([{ id: 1, x: 'p' }, { id: 1, x: 'p' }]);
  const counted = t.where(safe).arrayJoin(x => x.ids, 'x').aggregate(() => ({ c: count() }));
  expect((await agree(counted.ir, 'SELECT count() AS c FROM adv_s2 ARRAY JOIN ids AS x WHERE id > 1')).data).toEqual([{ c: '2' }]);
  const perId = t.leftArrayJoin(x => x.ids, 'x').groupBy(x => ({ id: x.id })).aggregate(() => ({ c: count() })).orderBy(x => x.id);
  expect((await agree(perId.ir, 'SELECT id, count() AS c FROM adv_s2 LEFT ARRAY JOIN ids AS x GROUP BY id ORDER BY id')).data).toEqual([{ id: 1, c: '3' }, { id: 2, c: '2' }, { id: 3, c: '1' }, { id: 4, c: '1' }]);
});

it('volatile filter below a LEFT expansion keeps the nested emission (fix round 1); both emitters select the first source row', async () => {
  // rowNumberInAllBlocks() = 0 selects the first *source* row in the nested emission (then expands it to three rows).
  // Fix round 1: the LEFT fold requires deterministic filters, so the optimized text keeps the derived table too.
  // Deterministic with max_threads = 1.
  const q = t.where(() => volatile().eq(0n)).leftArrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x }));
  const optimized = compile(q.ir), naive = emitNaive(q.ir);
  expect(optimized.sql).toContain('WHERE rowNumberInAllBlocks() = {p0:UInt64}) AS `__typedhouse_input` LEFT ARRAY JOIN');
  const n = await execute(naive.sql, naive.params, 0, false), o = await execute(optimized.sql, optimized.params, 0, false);
  console.info('volatile LEFT fold', { naive: n.data, optimized: o.data });
  expect(n.data).toEqual([{ id: 1, x: 'p' }, { id: 1, x: 'p' }, { id: 1, x: 'q' }]);
  expect(o.data).toEqual(n.data);
  // The same predicate written above the expansion: both emitters place it after the ARRAY JOIN and the server still
  // evaluates it before (three rows again), so the fold cannot be distinguished from the nested form on 24.8.
  const above = t.leftArrayJoin(x => x.ids, 'x').where(() => volatile().eq(0n)).map(x => ({ id: x.id, x: x.x }));
  expect((await agree(above.ir)).data).toEqual(n.data);
});

it('mixed conjuncts over a join and an expansion, merged total filters, HAVING with DISTINCT and distinct shapes agree', async () => {
  const k = val(1n, col.Int64);
  const joined = join({ a: t, b: u }).on(x => x.a.id.eq(x.b.id)).where(x => x.a.id.gt(1).and(x.a.n.plus(k).gt(-100n)).and(cast(x.a.s, col.UInt64).gt(7n)).and(x.b.v.lt(5n))).map(x => ({ id: x.a.id, v: x.b.v }));
  const r1 = await agree(joined.ir, 'SELECT a.id AS id, b.v AS v FROM adv_s2 a INNER JOIN adv_s2_other b ON a.id = b.id WHERE a.id > 1 AND a.n + 1 > -100 AND toUInt64(a.s) > 7 AND b.v < 5', { PushFilterJoin: 1 });
  expect(r1.data).toEqual([{ id: 3, v: '2' }, { id: 3, v: '2' }]);
  const expanded = t.arrayJoin(x => x.ids, 'x').where(x => x.id.gt(1).and(x.n.plus(k).gt(-100n)).and(cast(x.s, col.UInt64).gt(7n)).and(x.x.eq('q'))).map(x => ({ id: x.id, x: x.x }));
  // Slice 3b (flipped from 1 SELECT): the residual carries a cast, so it keeps its own SELECT above the pushed safe WHERE.
  expect((await agree(expanded.ir, "SELECT id, x FROM adv_s2 ARRAY JOIN ids AS x WHERE id > 1 AND n + 1 > -100 AND toUInt64(s) > 7 AND x = 'q'", { PushFilterArrayJoin: 1 }, 2)).data).toEqual([{ id: 3, x: 'q' }]);
  const merged = t.where(safe).where(x => x.n.plus(k).gt(-100n)).arrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x }));
  expect((await agree(merged.ir, 'SELECT id, x FROM (SELECT * FROM adv_s2 WHERE id > 1 AND n + 1 > -100) ARRAY JOIN ids AS x', { MergeFilter: 1 }, 3)).data).toEqual([{ id: 3, x: 'q' }, { id: 4, x: 'p' }]);
  const grouped = t.groupBy(x => ({ k: x.k })).aggregate(() => ({ c: count() })).where(x => x.c.gt(1n)).distinct().orderBy(x => x.c).limit(5);
  const r2 = await agree(grouped.ir, 'SELECT DISTINCT k, count() AS c FROM adv_s2 GROUP BY k HAVING c > 1 ORDER BY c LIMIT 5', {}, 1);
  expect(r2.data).toEqual([{ k: 'a', c: '2' }, { k: 'b', c: '2' }]);
  // DISTINCT over an expansion with an ORDER BY expression over a selected column; duplicate source rows collapse.
  const dist = t.arrayJoin(x => x.ids, 'x').map(x => ({ id: x.id, x: x.x })).distinct().orderBy(x => x.id.plus(1));
  expect((await agree(dist.ir, 'SELECT DISTINCT id, x FROM adv_s2 ARRAY JOIN ids AS x ORDER BY id + 1', {}, 1)).data).toEqual([{ id: 1, x: 'p' }, { id: 1, x: 'q' }, { id: 3, x: 'q' }, { id: 4, x: 'p' }]);
  const whole = t.distinct().map(x => ({ id: x.id, k: x.k }));
  expect((await agree(whole.ir, 'SELECT id, k FROM (SELECT DISTINCT * FROM adv_s2)')).data).toHaveLength(4);
  const filtered = t.distinct().where(x => x.k.eq('b')).map(x => ({ id: x.id }));
  expect((await agree(filtered.ir, "SELECT id FROM (SELECT DISTINCT * FROM adv_s2) WHERE k = 'b'", {}, 2)).data).toEqual([{ id: 2 }]);
});

it('(v) folded untyped-Param selections and the expansion-alias shadow guard agree under both alias settings', async () => {
  const widen = t.map(x => ({ w: x.small.plus(1), id: x.id })).where(x => x.w.gt(200));
  const r1 = await agree(widen.ir, 'SELECT small + 1 AS w, id FROM adv_s2 WHERE small + 1 > 200', { PushFilterProject: 1 }, 1);
  expect(r1.meta).toEqual([{ name: 'w', type: 'UInt16' }, { name: 'id', type: 'UInt32' }]);
  expect(r1.data).toEqual([{ w: 201, id: 1 }, { w: 256, id: 3 }]);
  const nullable = t.map(x => ({ m: x.nn.plus(1n), id: x.id })).where(x => x.m.ge(0n));
  const r2 = await agree(nullable.ir, 'SELECT nn + 1 AS m, id FROM adv_s2 WHERE nn + 1 >= 0', { PushFilterProject: 1 }, 1);
  expect(r2.meta[0]).toEqual({ name: 'm', type: 'Nullable(Int64)' });
  expect(r2.data).toEqual([{ m: '2', id: 1 }, { m: '6', id: 4 }]);
  const chained = t.map(x => ({ a: x.n.plus(1n) })).map(x => ({ b: x.a.multiply(2n) })).where(x => x.b.lt(0n));
  expect((await agree(chained.ir, 'SELECT (n + 1) * 2 AS b FROM adv_s2 WHERE (n + 1) * 2 < 0', { MergeProject: 1, PushFilterProject: 1 }, 1)).data).toEqual([{ b: '-8' }, { b: '-8' }]);
  // Expansion alias as a plain column next to a computed alias; a computed alias named like the expansion keeps a block.
  const x = t.arrayJoin(v => v.ids, 'x');
  expect((await agree(x.where(v => v.x.eq('p')).map(v => ({ w: v.id.plus(1), x: v.x })).ir, "SELECT id + 1 AS w, x FROM adv_s2 ARRAY JOIN ids AS x WHERE x = 'p'", {}, 1)).data).toEqual([{ w: '2', x: 'p' }, { w: '2', x: 'p' }, { w: '5', x: 'p' }]);
  const shadow = x.where(v => v.x.eq('p')).map(v => ({ x: v.id.plus(1), y: v.x }));
  // (An unqualified `x AS y` oracle falls into the alias trap itself; the compiler qualifies and does not.)
  expect((await agree(shadow.ir, "SELECT t.id + 1 AS x, t.x AS y FROM (SELECT id, x FROM adv_s2 ARRAY JOIN ids AS x WHERE x = 'p') AS t", {}, 2)).data).toEqual([{ x: '2', y: 'p' }, { x: '2', y: 'p' }, { x: '5', y: 'p' }]);
  // A cast inside the expansion's filter fails identically on both emitters when a row cannot parse.
  const failing = t.where(v => cast(v.k, col.UInt64).gt(0n)).leftArrayJoin(v => v.ids, 'x').map(v => ({ id: v.id }));
  expect(await sameOutcome(failing.ir)).toMatch(/^error:/);
});
