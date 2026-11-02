import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, count, max, from, join, leftJoin, rightJoin, fullJoin, table, unionAll, parseCHType, print, type Rel, type CHType } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

// Slice 4f (4c Tester Finding 1): descriptor-invisible ALIAS/MATERIALIZED columns. A descriptor may omit columns the
// server resolves by name (`typedhouse generate --skip-alias`, hand-written descriptors); it then declares them as
// shadow-only `hiddenColumns`, and every alias guard (slice 1/3 computed selection, the Aggregate arm, the 4c join
// guard) counts them in N. Contract cells: both emitters x prefer_column_name_to_alias 0/1 x optimize_move_to_prewhere 0/1.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const hidden = { ...meta, hiddenColumns: ['hidden', 'mat'] } as const;
const XH = from(table('xh', { id: col.UInt32, v: col.String, arr: col.Array(col.UInt32) }, hidden));
const bare = from(table('xh', { id: col.UInt32, v: col.String, arr: col.Array(col.UInt32) }, meta)); // out of contract
// Join sides: every declared column is read, so the side is emitted bare (`xm` AS `m`) and its hidden columns resolve.
const XM = from(table('xm', { id: col.UInt32, v: col.String }, hidden));
const bareM = from(table('xm', { id: col.UInt32, v: col.String }, meta)); // out of contract
const XJ = from(table('xj', { id: col.UInt32, w: col.String }, meta));
let container: StartedTestContainer | undefined;
let url: string;
type Settings = Readonly<Record<string, string | number>>;
interface Result { meta?: string[]; data?: unknown[][]; error?: string }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, settings: Settings = {}): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  for (const [key, value] of Object.entries(settings)) endpoint.searchParams.set(key, String(value));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('wait_end_of_query', '1');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${sql} FORMAT JSONCompact` });
  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 200) };
  const json = JSON.parse(text) as { meta: { type: string }[]; data: unknown[][] };
  return { meta: json.meta.map(m => print(parseCHType(m.type))), data: [...json.data].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) };
}
const raw = async (sql: string) => { const res = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: sql }); if (!res.ok) throw new Error(await res.text()); return res.text(); };
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  await raw('CREATE TABLE xh (id UInt32, v String, arr Array(UInt32), hidden Int64 ALIAS toInt64(id) * 10, mat Int64 MATERIALIZED toInt64(id) * 100) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO xh (id, v, arr) VALUES (1, 'a', [1, 2]), (2, 'b', [3]), (2, 'c', []), (3, 'd', [4, 5])");
  await raw('CREATE TABLE xm (id UInt32, v String, hidden Int64 ALIAS toInt64(id) * 10, mat Int64 MATERIALIZED toInt64(id) * 100) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO xm (id, v) VALUES (1, 'a'), (2, 'b'), (2, 'c'), (3, 'd')");
  await raw('CREATE TABLE xj (id UInt32, w String) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO xj VALUES (1, 'x'), (2, 'y'), (4, 'z')");
}, 120000);
afterAll(async () => { await container?.stop(); });

const cells: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });
const printed = (columns: Readonly<Record<string, CHType>>) => Object.values(columns).map(t => print(t) === 'Bool' ? 'UInt8' : print(t));
const brief = (r: Result) => r.error ? `E${r.error}` : JSON.stringify([r.meta, r.data]);
/** Every contract cell on both emitters: no error, identical rows and meta, meta = columns, and the oracle's rows. */
async function check(root: Rel, label: string, oracle: string): Promise<string> {
  const optimized = compile(root), naive = emitNaive(root);
  expect(optimized.columns, label).toEqual(naive.columns);
  const expected = await execute(oracle);
  expect(expected.error, `${label}\noracle`).toBeUndefined();
  for (const settings of cells) for (const [name, c] of [['optimized', optimized], ['naive', naive]] as const) {
    const r = await execute(c.sql, c.params, settings);
    const where = `${label}\n${name} ${JSON.stringify(settings)}\n${c.sql}`;
    expect(r.error, where).toBeUndefined();
    expect(r.data, where).toEqual(expected.data);
    expect(r.meta, where).toEqual(printed(optimized.columns));
  }
  return optimized.sql;
}
/** Out-of-contract record: the optimized/naive agreement per cell, for a descriptor that omits a resolvable column. */
async function cellMap(root: Rel): Promise<string[]> {
  const optimized = compile(root), naive = emitNaive(root), out: string[] = [];
  for (const s of cells) {
    const o = brief(await execute(optimized.sql, optimized.params, s)), n = brief(await execute(naive.sql, naive.params, s));
    out.push(o === n ? 'agree' : `optimized ${o.startsWith('E') ? o : 'rows'} vs naive ${n.startsWith('E') ? n : 'rows'}`);
  }
  return out;
}
const derived = (sql: string) => (sql.match(/SELECT /g) ?? []).length > 1;
/** A fenced join aggregate reads the join block as a derived table of `__typedhouse_leaf_N` columns (slice 4c). */
const fencedJoin = (sql: string) => sql.includes('__typedhouse_leaf_');

it('single-table aggregate: HAVING/ORDER BY on an alias equal to a hidden ALIAS or MATERIALIZED column keeps its scope', async () => {
  const having = XH.groupBy(r => ({ id: r.id })).aggregate(g => ({ hidden: count(), top: max(g.v) })).where(r => r.hidden.gt(1n));
  expect(derived(await check(having.ir, 'scan HAVING hidden (ALIAS)', 'SELECT id, c, t FROM (SELECT id, count() AS c, max(v) AS t FROM xh GROUP BY id) WHERE c > 1'))).toBe(true);
  const order = XH.groupBy(r => ({ id: r.id })).aggregate(g => ({ mat: max(g.v) })).orderBy(r => r.mat);
  expect(derived(await check(order.ir, 'scan ORDER BY mat (MATERIALIZED)', 'SELECT id, m FROM (SELECT id, max(v) AS m FROM xh GROUP BY id)'))).toBe(true);
  const filtered = XH.where(r => r.v.ne('z')).groupBy(r => ({ id: r.id })).aggregate(g => ({ mat: count() })).where(r => r.mat.gt(1n));
  expect(derived(await check(filtered.ir, 'scan WHERE + HAVING mat', "SELECT id, c FROM (SELECT id, count() AS c FROM xh WHERE v != 'z' GROUP BY id) WHERE c > 1"))).toBe(true);
  const expanded = XH.arrayJoin(r => r.arr, 'e').groupBy(r => ({ id: r.id })).aggregate(g => ({ hidden: count() })).where(r => r.hidden.gt(1n));
  expect(derived(await check(expanded.ir, 'expanded scan HAVING hidden', 'SELECT id, c FROM (SELECT id, count() AS c FROM xh ARRAY JOIN arr AS e GROUP BY id) WHERE c > 1'))).toBe(true);
  // Over a CTE (a shared filtered scan) the hidden columns do not resolve: the aggregate folds onto `t0` and agrees.
  const shared = XH.where(r => r.v.ne('z'));
  const overCte = () => shared.groupBy(r => ({ id: r.id })).aggregate(() => ({ hidden: count() })).where(r => r.hidden.gt(1n));
  const cteSql = await check(unionAll(overCte(), overCte()).ir, 'CTE HAVING hidden', "SELECT id, count() AS c FROM xh WHERE v != 'z' GROUP BY id HAVING c > 1 UNION ALL SELECT id, count() AS c FROM xh WHERE v != 'z' GROUP BY id HAVING c > 1");
  expect(cteSql).toContain('FROM `t0` GROUP BY');
  // Non-colliding aliases still fold into one SELECT (descriptors with hidden columns lose nothing else).
  const plain = XH.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: count() })).where(r => r.n.gt(1n));
  expect(derived(await check(plain.ir, 'scan HAVING n (no collision)', 'SELECT id, count() AS n FROM xh GROUP BY id HAVING n > 1'))).toBe(false);
  // A computed selection named like a hidden column folds when nothing else in the block reads the name.
  const selection = XH.where(r => r.v.ne('z')).map(r => ({ hidden: r.id.plus(1), v: r.v }));
  expect(derived(await check(selection.ir, 'selection alias hidden, unread', "SELECT id + 1, v FROM xh WHERE v != 'z'"))).toBe(false);
});

it('join aggregates over every kind: an output alias equal to a hidden column of a side keeps the join block derived', async () => {
  const kinds = {
    inner: () => join({ a: XJ, m: XM }).on(r => r.a.id.eq(r.m.id)),
    left: () => leftJoin({ a: XJ }, { m: XM }).on(r => r.a.id.eq(r.m.id)),
    right: () => rightJoin({ a: XJ }, { m: XM }).on(r => r.a.id.eq(r.m.id)),
    full: () => fullJoin({ a: XJ }, { m: XM }).on(r => r.a.id.eq(r.m.id)),
  };
  const sql = { inner: 'INNER', left: 'LEFT', right: 'RIGHT', full: 'FULL' } as const;
  for (const [kind, j] of Object.entries(kinds) as [keyof typeof kinds, () => ReturnType<typeof kinds.inner>][]) {
    const on = `FROM xj AS a ${sql[kind]} JOIN xm AS m ON a.id = m.id`;
    const having = j().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ hidden: count(), top: max(g.m.v) })).where(r => r.hidden.gt(1n));
    expect(fencedJoin(await check(having.ir, `${kind}: HAVING hidden`, `SELECT id, c, t FROM (SELECT a.id AS id, count() AS c, max(m.v) AS t ${on} GROUP BY a.id SETTINGS join_use_nulls = 1) WHERE c > 1`)), kind).toBe(true);
    const order = j().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ mat: count() })).orderBy(r => r.mat);
    expect(fencedJoin(await check(order.ir, `${kind}: ORDER BY mat`, `SELECT a.id AS id, count() AS c ${on} GROUP BY a.id SETTINGS join_use_nulls = 1`)), kind).toBe(true);
    const plain = j().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: count(), top: max(g.m.v) })).where(r => r.n.gt(1n));
    const folded = await check(plain.ir, `${kind}: HAVING n (no collision)`, `SELECT a.id AS id, count() AS n, max(m.v) AS top ${on} GROUP BY a.id HAVING n > 1 SETTINGS join_use_nulls = 1`);
    expect(fencedJoin(folded), kind).toBe(false);
    expect(folded, kind).toContain('`xm` AS `m`'); // non-vacuous: the side is the bare table, whose hidden columns resolve
  }
});

it('out of contract (recorded, the reason for the descriptor contract): the same descriptors without hiddenColumns', async () => {
  const join4c = join({ a: XJ, m: bareM }).on(r => r.a.id.eq(r.m.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ hidden: count(), top: max(g.m.v) })).where(r => r.hidden.gt(1n));
  const scan = bare.groupBy(r => ({ id: r.id })).aggregate(g => ({ hidden: count(), top: max(g.v) })).where(r => r.hidden.gt(1n));
  const capture = ['agree', 'agree', 'optimized E215 vs naive rows', 'optimized E215 vs naive rows'];
  expect(await cellMap(join4c.ir)).toEqual(capture);
  expect(await cellMap(scan.ir)).toEqual(capture);
});

it('ARRAY JOIN alias equal to a hidden column (probe; the alias is the expansion in every form)', async () => {
  const q = XH.arrayJoin(r => r.arr, 'hidden').map(r => ({ id: r.id, hidden: r.hidden }));
  await check(q.ir, 'ARRAY JOIN AS hidden', 'SELECT id, e FROM xh ARRAY JOIN arr AS e');
  const w = XH.arrayJoin(r => r.arr, 'mat').where(r => r.mat.gt(1)).map(r => ({ id: r.id, mat: r.mat }));
  await check(w.ir, 'ARRAY JOIN AS mat WHERE mat', 'SELECT id, e FROM xh ARRAY JOIN arr AS e WHERE e > 1');
});
