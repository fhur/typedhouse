import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, defineFunction, from, join, table, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

// Tester native probes for slice 3 on clickhouse/clickhouse-server:24.8. The optimizing and naive emissions must agree in
// rows, `meta` and failure class under every combination of prefer_column_name_to_alias 0/1, optimize_move_to_prewhere 0/1
// and max_threads 1/default (the contract matrix, analyzer on), and with a hand-written oracle where given. The old
// analyzer (allow_experimental_analyzer = 0) is outside the spec's contract (ClickHouse >= 24.3, analyzer default) and
// is only recorded.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const adv = table('adv_s3', {
  id: col.UInt32, k: col.String, n: col.Int64, s: col.String, nn: col.Nullable(col.String), lc: col.LowCardinality(col.Nullable(col.String)),
  ids: col.Array(col.String), extra: col.UInt8, alias_id: col.UInt32, mat_id: col.UInt32, tup: col.Tuple({ a: col.String, b: col.UInt8 }),
  parts: col.Array(col.Tuple({ id: col.String, w: col.UInt8 })),
}, meta);
const other = table('adv_s3_other', { id: col.UInt32, v: col.UInt32 }, meta);
const rmt = table('adv_s3_rmt', { id: col.UInt32, ver: col.UInt32, k: col.String, s: col.String, ids: col.Array(col.String) }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] });
const smp = table('adv_s3_smp', { id: col.UInt32, k: col.String, s: col.String, ids: col.Array(col.String) }, { engine: 'MergeTree', sortingKey: ['k', 'intHash32(id)'], partitionKey: [] });
const t = from(adv), u = from(other), r = from(rmt), sm = from(smp);
const rand = defineFunction({ name: 'rand', args: [], returns: col.UInt32, deterministic: false });
let container: StartedTestContainer;
let url: string;
type Settings = Readonly<Record<string, string | number>>;
interface Result { meta?: { name: string; type: string }[]; data?: Record<string, unknown>[]; error?: string }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, settings: Settings = {}, ordered = false): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  for (const [key, value] of Object.entries(settings)) endpoint.searchParams.set(key, String(value));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  // Without this a failure raised after the first block streamed arrives inside a 200 response (`exception` field, or a
  // trailer the JSON parser rejects); with it every server failure is an HTTP error carrying its code.
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
  // ALIAS and MATERIALIZED columns are real codegen output (the fixture `coverage` table has them): they read their
  // underlying column by name on the server, which is exactly what a select alias could shadow.
  await raw('CREATE TABLE adv_s3 (id UInt32, k String, n Int64, s String, nn Nullable(String), lc LowCardinality(Nullable(String)), ids Array(String), extra UInt8, alias_id UInt32 ALIAS id, mat_id UInt32 MATERIALIZED id * 10, tup Tuple(a String, b UInt8), parts Array(Tuple(id String, w UInt8))) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO adv_s3 (id, k, n, s, nn, lc, ids, extra, tup, parts) VALUES (1, 'a', 10, '1', 'x', NULL, ['p','q'], 7, ('t', 1), [('i1', 1)]), (2, 'b', 20, 'x', NULL, 'l', [], 8, ('u', 2), []), (3, 'a', 30, '3', 'y', 'm', ['q'], 9, ('t', 3), [('i3', 3), ('i3', 4)])");
  await raw('CREATE TABLE adv_s3_other (id UInt32, v UInt32) ENGINE=MergeTree ORDER BY id');
  await raw('INSERT INTO adv_s3_other VALUES (1, 5), (2, 25), (3, 2), (3, 40)');
  await raw('CREATE TABLE adv_s3_rmt (id UInt32, ver UInt32, k String, s String, ids Array(String)) ENGINE=ReplacingMergeTree(ver) ORDER BY id');
  await raw('SYSTEM STOP MERGES adv_s3_rmt'); // keep both versions of id 1 in separate parts so FINAL is observable
  await raw("INSERT INTO adv_s3_rmt VALUES (1, 1, 'a', 'bad', ['o','o']), (2, 1, 'b', '2', ['keep'])");
  await raw("INSERT INTO adv_s3_rmt VALUES (1, 2, 'a', '1', ['n']), (3, 1, 'a', '3', [])");
  await raw('CREATE TABLE adv_s3_smp (id UInt32, k String, s String, ids Array(String)) ENGINE=MergeTree ORDER BY (k, intHash32(id)) SAMPLE BY intHash32(id)');
  await raw("INSERT INTO adv_s3_smp SELECT number, ['a','b'][number % 2 + 1], toString(number), arrayMap(i -> toString(i), range(number % 3)) FROM numbers(40)");
}, 120000);
afterAll(async () => { await container?.stop(); });

const contract: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) for (const threads of [1, 0]) contract.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere, ...(threads ? { max_threads: 1 } : {}) });
const legacy: Settings[] = [0, 1].map(alias => ({ allow_experimental_analyzer: 0, prefer_column_name_to_alias: alias }));
const legacyNotes: string[] = [];
/** Both emissions agree with each other under every contract setting (and with the oracle); the old analyzer is recorded. */
async function agree(root: Rel, options: { oracle?: string; selects?: number; ordered?: boolean; error?: string; label?: string } = {}) {
  const optimized = compile(root), naive = emitNaive(root);
  const context = `${options.label ?? ''}\n${optimized.sql}\n${naive.sql}`;
  if (options.selects !== undefined) expect(optimized.sql.match(/SELECT /g)?.length, context).toBe(options.selects);
  expect(Object.keys(optimized.params), context).toEqual(Object.keys(naive.params));
  expect(optimized.columns, context).toEqual(naive.columns);
  let first: Result | undefined;
  for (const settings of contract) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);
    const label = `${context}\n${JSON.stringify(settings)}`;
    expect(a, label).toEqual(b);
    if (options.error !== undefined) expect(a.error, label).toBe(options.error);
    else expect(a.error, label).toBeUndefined();
    first ??= a;
    expect(a, label).toEqual(first);
  }
  if (options.oracle) expect(first, context).toEqual(await execute(options.oracle, {}, {}, options.ordered));
  for (const settings of legacy) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);
    if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(first)) legacyNotes.push(`${options.label ?? optimized.sql} ${JSON.stringify(settings)}: optimized=${JSON.stringify(a).slice(0, 160)} naive=${JSON.stringify(b).slice(0, 160)}`);
  }
  return { optimized, naive, first: first! };
}

it('alias guard: self-read, pruned-only and fenced shadows agree natively; ALIAS/MATERIALIZED columns resolve against the table', async () => {
  const selfRead = await agree(t.where(x => x.k.eq('a')).map(x => ({ n: cast(x.n, col.String), k: x.k })).ir, { selects: 1, oracle: "SELECT toString(n) AS n, k FROM adv_s3 WHERE k = 'a'", label: 'self-read cast' });
  expect(selfRead.first.meta).toEqual([{ name: 'n', type: 'String' }, { name: 'k', type: 'String' }]);
  const plusOne = await agree(t.where(x => x.extra.gt(7)).map(x => ({ n: x.n.plus(1n), k: x.k })).ir, { selects: 1, oracle: 'SELECT n + 1 AS n, k FROM adv_s3 WHERE extra > 7', label: 'self-read plus' });
  expect(plusOne.first.data).toEqual([{ n: '21', k: 'b' }, { n: '31', k: 'a' }]);
  await agree(t.where(x => x.k.eq('a')).map(x => ({ extra: cast(x.n, col.String) })).ir, { selects: 1, oracle: "SELECT toString(n) AS extra FROM adv_s3 WHERE k = 'a'", label: 'pruned shadow' });
  await agree(t.map(x => ({ id: x.id.plus(x.extra), extra: x.extra })).ir, { selects: 1, oracle: 'SELECT id + extra AS id, extra FROM adv_s3', label: 'self-read with identity sibling' });
  // Fenced shapes (another item / the WHERE reads the shadowed column) still agree, with the values of the physical column.
  const fenced = await agree(t.map(x => ({ k: cast(x.n, col.String), flag: x.k.eq('a') })).ir, { selects: 2, oracle: "SELECT toString(n) AS k, flag FROM (SELECT n, k = 'a' AS flag FROM adv_s3)", label: 'other item reads shadow' }); // the first oracle draft fell into the alias trap itself
  expect(fenced.first.data).toEqual([{ k: '10', flag: 1 }, { k: '20', flag: 0 }, { k: '30', flag: 1 }]);
  const pushed = await agree(t.map(x => ({ n: x.n.plus(1n) })).where(x => x.n.gt(15n)).ir, { selects: 2, oracle: 'SELECT n + 1 AS n FROM adv_s3 WHERE n + 1 > 15', label: 'pushed WHERE reads shadow' });
  expect(pushed.first.data).toEqual([{ n: '21' }, { n: '31' }]);
  await agree(t.where(x => x.n.gt(15n)).map(x => ({ n: cast(x.id, col.Int64) })).ir, { selects: 2, oracle: 'SELECT toInt64(id) AS n FROM (SELECT id FROM adv_s3 WHERE n > 15)', label: 'WHERE reads shadow, cast' });
  // Sort / Limit / Distinct around the fold; a later WHERE on the fallible alias.
  await agree(t.map(x => ({ n: cast(x.k, col.String) })).orderBy(x => x.n).ir, { selects: 2, ordered: true, label: 'sort after fold' });
  await agree(t.where(x => x.k.eq('a')).map(x => ({ n: cast(x.k, col.String) })).distinct().ir, { selects: 1, oracle: "SELECT DISTINCT toString(k) AS n FROM adv_s3 WHERE k = 'a'", label: 'distinct after fold' });
  await agree(t.map(x => ({ n: cast(x.s, col.Int64) })).where(x => x.n.gt(1n)).ir, { error: '6', label: 'fallible alias filtered above' });
  // ALIAS / MATERIALIZED columns beside a shadow of their underlying column, as an item and as the WHERE.
  const aliasItem = await agree(t.map(x => ({ id: cast(x.k, col.String), alias_id: x.alias_id, mat_id: x.mat_id })).ir, { selects: 1, oracle: 'SELECT k AS id, alias_id, mat_id FROM (SELECT k, alias_id, mat_id FROM adv_s3)', label: 'ALIAS column item' });
  expect(aliasItem.first.data).toEqual([{ id: 'a', alias_id: 1, mat_id: 10 }, { id: 'a', alias_id: 3, mat_id: 30 }, { id: 'b', alias_id: 2, mat_id: 20 }]);
  await agree(t.where(x => x.alias_id.gt(1)).map(x => ({ id: cast(x.k, col.String) })).ir, { selects: 1, oracle: 'SELECT k AS id FROM adv_s3 WHERE alias_id > 1', label: 'ALIAS column WHERE' });
  await agree(t.where(x => x.mat_id.gt(10)).map(x => ({ id: x.k.eq('a') })).ir, { selects: 1, oracle: "SELECT k = 'a' AS id FROM adv_s3 WHERE mat_id > 10", label: 'MATERIALIZED column WHERE' });
  // Nullable / LowCardinality self-reads keep the nested form's meta.
  const typed = await agree(t.where(x => x.k.eq('a')).map(x => ({ lc: x.lc.isNotNull(), nn: x.nn.ifNull('w') })).ir, { selects: 1, oracle: "SELECT isNotNull(lc) AS lc, ifNull(nn, 'w') AS nn FROM adv_s3 WHERE k = 'a'", label: 'nullable self-reads' });
  expect(typed.first.meta).toEqual([{ name: 'lc', type: 'UInt8' }, { name: 'nn', type: 'String' }]);
});

it('expansion blocks: alias renames, shadows and casts over ARRAY JOIN; FINAL and SAMPLE scans under folded selections', async () => {
  const x = t.arrayJoin(a => a.ids, 'x');
  await agree(x.map(a => ({ n: a.x })).ir, { selects: 1, oracle: 'SELECT x AS n FROM adv_s3 ARRAY JOIN ids AS x', label: 'rename expansion alias to physical name' });
  await agree(x.where(a => a.x.eq('q')).map(a => ({ n: cast(a.x, col.String), x: a.x })).ir, { selects: 1, oracle: "SELECT x AS n, x FROM adv_s3 ARRAY JOIN ids AS x WHERE x = 'q'", label: 'cast of alias + WHERE on alias' });
  // Fenced: the expansion reads `ids` which the item shadows (ClickHouse would otherwise ARRAY JOIN a String).
  await agree(x.map(a => ({ ids: cast(a.id, col.String), x: a.x })).ir, { selects: 2, oracle: 'SELECT toString(id) AS ids, x FROM (SELECT id, x FROM adv_s3 ARRAY JOIN ids AS x)', label: 'expansion input shadowed' });
  await agree(x.map(a => ({ x: cast(a.id, col.String) })).ir, { selects: 2, label: 'expansion alias redefined' });
  await agree(t.where(a => a.k.eq('a')).leftArrayJoin(a => a.ids, 'x').map(a => ({ v: cast(a.s, col.UInt64), x: a.x })).ir, { selects: 1, oracle: "SELECT toUInt64(s) AS v, x FROM adv_s3 LEFT ARRAY JOIN ids AS x WHERE k = 'a'", label: 'cast over LEFT expansion' });
  // FINAL: the superseded version carries the unparsable `s`; the cast folds over `FROM t FINAL WHERE`.
  const final = await agree(r.final().where(a => a.k.eq('a')).map(a => ({ v: cast(a.s, col.UInt64), id: a.id })).ir, { selects: 1, oracle: "SELECT toUInt64(s) AS v, id FROM adv_s3_rmt FINAL WHERE k = 'a'", label: 'FINAL cast' });
  expect(final.optimized.sql).toBe('SELECT CAST(`s` AS UInt64) AS `v`, `id` AS `id` FROM `adv_s3_rmt` FINAL WHERE `k` = {p0:String}');
  expect(final.first.data).toEqual([{ v: '1', id: 1 }, { v: '3', id: 3 }]);
  await agree(r.where(a => a.k.eq('a')).map(a => ({ v: cast(a.s, col.UInt64), id: a.id })).ir, { error: '6', label: 'no FINAL: the bad version is read' });
  // SAMPLE: deterministic on the sampling key, so both forms select the same rows.
  const sampled = await agree(sm.sample(0.5).where(a => a.k.eq('a')).map(a => ({ v: cast(a.s, col.UInt64), id: a.id })).ir, { selects: 1, oracle: "SELECT toUInt64(s) AS v, id FROM adv_s3_smp SAMPLE 0.5 WHERE k = 'a'", label: 'SAMPLE cast' });
  expect(sampled.optimized.sql).toBe('SELECT CAST(`s` AS UInt64) AS `v`, `id` AS `id` FROM `adv_s3_smp` SAMPLE 0.5 WHERE `k` = {p0:String}');
  expect(sampled.first.data!.length).toBeGreaterThan(0);
});

it('house invariant: fallible selections fail or succeed identically under PREWHERE moves, OR conditions, LIMIT and thread counts', async () => {
  const bad = (q: Rel, label: string) => agree(q, { error: '6', label });
  // Filtered out by a predicate on the very column the cast reads (PREWHERE-movable), split with an array predicate, OR.
  await agree(t.where(a => a.s.ne('x')).map(a => ({ v: cast(a.s, col.UInt64) })).ir, { selects: 1, oracle: "SELECT toUInt64(s) AS v FROM adv_s3 WHERE s != 'x'", label: 'same-column filter' });
  await agree(t.where(a => a.s.ne('x').and(a.ids.has('q'))).map(a => ({ v: cast(a.s, col.UInt64) })).ir, { selects: 1, oracle: "SELECT toUInt64(s) AS v FROM adv_s3 WHERE s != 'x' AND has(ids, 'q')", label: 'prewhere split' });
  await agree(t.where(a => a.s.ne('x').or(a.k.eq('zzz'))).map(a => ({ v: cast(a.s, col.UInt64) })).ir, { selects: 1, oracle: "SELECT toUInt64(s) AS v FROM adv_s3 WHERE s != 'x' OR k = 'zzz'", label: 'OR condition' });
  await agree(t.where(a => a.alias_id.ne(2)).map(a => ({ v: cast(a.s, col.UInt64) })).ir, { selects: 1, oracle: 'SELECT toUInt64(s) AS v FROM adv_s3 WHERE alias_id != 2', label: 'ALIAS column filter' });
  // Kept: both fail with CANNOT_PARSE_TEXT (code 6).
  await bad(t.map(a => ({ v: cast(a.s, col.UInt64) })).ir, 'unfiltered');
  await bad(t.where(a => a.s.ne('1')).map(a => ({ v: cast(a.s, col.UInt64) })).ir, 'bad row kept');
  await bad(t.where(a => a.k.eq('b')).map(a => ({ v: cast(a.s, col.UInt64), k: a.k })).ir, 'bad row selected by another column');
  // LIMIT above the fold: ClickHouse may stop before the bad row; whatever it does, both forms do the same (asserted by agree).
  const limited = await agree(t.map(a => ({ v: cast(a.s, col.UInt64) })).limit(1).ir, { selects: 2, label: 'LIMIT 1 over an unfiltered cast' });
  console.info('slice3 probe: LIMIT 1 over a cast with a bad row', limited.first);
  await agree(t.where(a => a.k.eq('a')).map(a => ({ v: cast(a.s, col.UInt64) })).limit(1).ir, { selects: 2, label: 'LIMIT 1 over a filtered cast' });
  await agree(t.map(a => ({ v: cast(a.s, col.UInt64) })).orderBy(a => a.v).limit(1).ir, { selects: 2, ordered: true, error: '6', label: 'ORDER BY + LIMIT over an unfiltered cast' });
  // Volatile: one row per filtered source row.
  const volatile = await agree(t.where(a => a.k.eq('a')).map(a => ({ id: a.id, z: rand().multiply(0) })).ir, { selects: 1, oracle: "SELECT id, rand() * 0 AS z FROM adv_s3 WHERE k = 'a'", label: 'volatile' });
  expect(volatile.first.data).toEqual([{ id: 1, z: '0' }, { id: 3, z: '0' }]);
});

it('join-bound selections over Filter(Join), the spec self-join shape and a CTE-name alias agree natively', async () => {
  const j = join({ a: t, b: u }).on(x => x.a.id.eq(x.b.id));
  const renamed = await agree(j.where(x => x.a.id.lt(x.b.v)).map(x => ({ x: x.a.id, id: x.b.v })).ir, { selects: 2, oracle: 'SELECT a.id AS x, b.v AS id FROM adv_s3 AS a INNER JOIN adv_s3_other AS b ON a.id = b.id WHERE a.id < b.v', label: 'rename shadow over join residual' });
  expect(renamed.first.data).toEqual([{ x: 1, id: 5 }, { x: 2, id: 25 }, { x: 3, id: 40 }]);
  await agree(j.where(x => x.a.id.lt(x.b.v)).where(x => cast(x.a.s, col.UInt64).gt(0n)).map(x => ({ id: x.a.id })).ir, { error: '6', label: 'fallible second WHERE on the join block' });
  await agree(j.where(x => x.a.id.ne(2)).where(x => cast(x.a.s, col.UInt64).gt(0n)).map(x => ({ id: x.a.id })).ir, { selects: 3, oracle: 'SELECT a.id AS id FROM (SELECT id, s FROM adv_s3 WHERE id != 2) AS a INNER JOIN adv_s3_other AS b ON a.id = b.id WHERE toUInt64(a.s) > 0', label: 'fallible WHERE above a pushed total one' }); // a flat `id != 2 AND toUInt64(s) > 0` oracle fails under PREWHERE: ClickHouse reorders conjuncts

  const shared = t.where(x => x.k.eq('a'));
  const named = await agree(join({ a: shared, b: shared }).on(x => x.a.id.eq(x.b.id)).where(x => x.a.n.le(x.b.n)).map(x => ({ t0: x.a.id, b: x.b.n })).ir, { selects: 2, oracle: "SELECT a.id AS t0, b.n AS b FROM adv_s3 AS a INNER JOIN adv_s3 AS b ON a.id = b.id WHERE a.k = 'a' AND b.k = 'a' AND a.n <= b.n", label: 'alias equal to CTE name' });
  expect(named.optimized.sql).toContain('AS `t0`');
  await agree(join({ a: t, b: t }).on(x => [x.a.id.eq(x.b.id), x.a.n.lt(x.b.n.plus(1n))]).map(x => ({ a: x.a.id, b: x.b.n })).ir, { selects: 2, oracle: 'SELECT a.id AS a, b.n AS b FROM adv_s3 AS a INNER JOIN adv_s3 AS b ON a.id = b.id WHERE a.n < b.n + 1', label: 'spec eq+lt ON shape' });
});

it('(vii)/(viii): aggregates over expansions with FINAL, SAMPLE, Params and HAVING; whole-row selections over DISTINCT', async () => {
  const agg = r.final().where(a => a.k.eq('a')).leftArrayJoin(a => a.ids, 'x').where(a => a.x.ne('zz')).groupBy(a => ({ x: a.x })).aggregate(() => ({ c: count() })).where(a => a.c.ge(1n)).orderBy(a => a.x).limit(5);
  const folded = await agree(agg.ir, { selects: 1, ordered: true, oracle: "SELECT x, count() AS c FROM adv_s3_rmt FINAL LEFT ARRAY JOIN ids AS x WHERE k = 'a' AND x != 'zz' GROUP BY x HAVING c >= 1 ORDER BY x LIMIT 5", label: '(vii) FINAL LEFT expansion aggregate' });
  expect(folded.first.data).toEqual([{ x: '', c: '1' }, { x: 'n', c: '1' }]); // FINAL dropped ['o','o']; id 3 has an empty array
  await agree(sm.sample(0.5).arrayJoin(a => a.ids, 'x').groupBy(a => ({ k: a.k })).aggregate(() => ({ c: count() })).orderBy(a => a.k).ir, { selects: 1, ordered: true, oracle: 'SELECT k, count() AS c FROM adv_s3_smp SAMPLE 0.5 ARRAY JOIN ids AS x GROUP BY k ORDER BY k', label: '(vii) SAMPLE expansion aggregate' });
  // Param in the expansion expression and in a WHERE below it: the two texts number them differently; rows agree.
  const parameterised = t.where(a => a.k.eq('a')).arrayJoin(a => a.parts.element('id'), 'x').groupBy(a => ({ x: a.x })).aggregate(() => ({ c: count() })).orderBy(a => a.x);
  const p = await agree(parameterised.ir, { selects: 1, ordered: true, oracle: "SELECT x, count() AS c FROM adv_s3 ARRAY JOIN tupleElement(parts, 'id') AS x WHERE k = 'a' GROUP BY x ORDER BY x", label: '(vii) Param in expansion' });
  expect(p.optimized.params).toEqual({ p0: 'id', p1: 'a' });
  expect(p.naive.params).toEqual({ p0: 'a', p1: 'id' });
  expect(p.first.data).toEqual([{ x: 'i1', c: '1' }, { x: 'i3', c: '2' }]);
  await agree(t.arrayJoin(a => a.ids, 'x').aggregate(() => ({ c: count(), m: count() })).ir, { selects: 1, oracle: 'SELECT count() AS c, count() AS m FROM adv_s3 ARRAY JOIN ids AS x', label: '(vii) keyless' });
  // (viii) whole-row reorder over an expanded DISTINCT, sorted and limited: rows, meta names and order equal the oracle.
  const whole = t.arrayJoin(a => a.ids, 'x').distinct().map(a => ({ x: a.x, id: a.id, k: a.k, n: a.n, s: a.s, nn: a.nn, lc: a.lc, ids: a.ids, extra: a.extra, alias_id: a.alias_id, mat_id: a.mat_id, tup: a.tup, parts: a.parts })).orderBy(a => a.x).thenBy(a => a.id.desc()).limit(2);
  const w = await agree(whole.ir, { selects: 1, ordered: true, oracle: 'SELECT DISTINCT x, id, k, n, s, nn, lc, ids, extra, alias_id, mat_id, tup, parts FROM adv_s3 ARRAY JOIN ids AS x ORDER BY x, id DESC LIMIT 2', label: '(viii) whole-row over expanded distinct' });
  expect(w.first.meta!.map(m => m.name)).toEqual(['x', 'id', 'k', 'n', 's', 'nn', 'lc', 'ids', 'extra', 'alias_id', 'mat_id', 'tup', 'parts']);
  expect(w.first.data!.map(d => [d.x, d.id])).toEqual([['p', 1], ['q', 3]]);
  await agree(t.where(a => a.k.eq('a')).distinct().map(a => ({ k: a.k, id: a.id, n: a.n, s: a.s, nn: a.nn, lc: a.lc, ids: a.ids, extra: a.extra, alias_id: a.alias_id, mat_id: a.mat_id, tup: a.tup, parts: a.parts })).orderBy(a => a.id).map(a => ({ id: a.id })).ir, { selects: 2, ordered: true, oracle: "SELECT id FROM (SELECT DISTINCT * FROM adv_s3 WHERE k = 'a' ORDER BY id)", label: '(viii) pruned consumer above the fold' });
});

it('PRE-EXISTING (HEAD, not slice 3) as observed: stacked Filters rendered as one AND let ClickHouse evaluate a fallible conjunct on rows the earlier conjunct removes', async () => {
  // Block planning folds consecutive Filters into one WHERE joined by AND (MergeFilter deliberately keeps a non-total
  // predicate apart, but the planner joins them anyway). ClickHouse evaluates such conjuncts in its own order: on a scan
  // with optimize_move_to_prewhere = 1 (the default) the CAST runs before `id != 2`, and on a join block it runs on
  // every joined row. The naive nesting keeps the order, so the optimized text fails where the naive one succeeds.
  // Pinned as observed so a fix flips it deliberately; the same text was emitted before slice 3 (no new arm involved).
  const scan = t.where(a => a.id.ne(2)).where(a => cast(a.s, col.UInt64).gt(0n)).map(a => ({ id: a.id }));
  const o = compile(scan.ir), n = emitNaive(scan.ir);
  expect(o.sql).toBe('SELECT `id` FROM `adv_s3` WHERE `id` != {p0:UInt32} AND CAST(`s` AS UInt64) > {p1:UInt64}');
  for (const prewhere of [0, 1]) for (const threads of [1, 0]) {
    const settings = { optimize_move_to_prewhere: prewhere, ...(threads ? { max_threads: 1 } : {}) };
    expect((await execute(n.sql, n.params, settings)).data, JSON.stringify(settings)).toEqual([{ id: 1 }, { id: 3 }]);
    expect((await execute(o.sql, o.params, settings)).error, JSON.stringify(settings)).toBe(prewhere ? '6' : undefined);
  }
  const joined = join({ a: t, b: u }).on(x => x.a.id.eq(x.b.id)).where(x => x.a.id.plus(x.b.v).ne(27n)).where(x => cast(x.a.s, col.UInt64).gt(0n)).map(x => ({ id: x.a.id }));
  const jo = compile(joined.ir), jn = emitNaive(joined.ir);
  expect(jo.sql).toContain('WHERE (`a`.`id` + `b`.`v` != {p0:UInt64}) AND (CAST(`a`.`s` AS UInt64) > {p1:UInt64})');
  for (const settings of contract) {
    expect((await execute(jn.sql, jn.params, settings)).data, JSON.stringify(settings)).toEqual([{ id: 1 }, { id: 3 }, { id: 3 }]);
    expect((await execute(jo.sql, jo.params, settings)).error, JSON.stringify(settings)).toBe('6');
  }
});

it('records old-analyzer (allow_experimental_analyzer = 0) behaviour, outside the spec contract', () => {
  console.info('slice3 probe: old analyzer disagreements', legacyNotes.length ? legacyNotes : 'none');
});
