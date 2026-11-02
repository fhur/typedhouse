import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, count, max, sum, from, join, leftJoin, fullJoin, scalar, table, parseCHType, print, type Rel, type CHType } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

// Tester probes for slice 4c (join-block aggregate alias capture) on clickhouse/clickhouse-server:24.8.
// Contract cells: both emitters x prefer_column_name_to_alias 0/1 x optimize_move_to_prewhere 0/1 (default analyzer).
// allow_experimental_analyzer = 0 is recorded per probe as out-of-contract and never asserted.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const cols = { id: col.UInt32, s: col.String, n: col.Int64, lc: col.LowCardinality(col.String) };
const DDL = '(id UInt32, s String, n Int64, lc LowCardinality(String)) ENGINE=MergeTree ORDER BY id';
const A = from(table('xa', cols, meta)), B = from(table('xb', cols, meta)), C = from(table('xc', { id: col.UInt32, v: col.String, N: col.Int64 }, meta));
// Odd names: Param-like, CTE-like, case-only, Unicode, a quoted backtick, and a leaf-like name.
const odd = { id: col.UInt32, p0: col.Int64, t0: col.Int64, 'ñ': col.Int64, 'q`x': col.Int64, __typedhouse_leaf_0: col.Int64 };
const O = from(table('xo', odd, meta));
let container: StartedTestContainer | undefined;
let url: string;
type Settings = Readonly<Record<string, string | number>>;
interface Result { meta?: string[]; data?: unknown[][]; error?: string }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, settings: Settings = {}, ordered = false): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  for (const [key, value] of Object.entries(settings)) endpoint.searchParams.set(key, String(value));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('wait_end_of_query', '1');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${sql} FORMAT JSONCompact` });
  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 200) };
  const json = JSON.parse(text) as { meta: { type: string }[]; data: unknown[][] };
  const data = ordered ? json.data : [...json.data].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return { meta: json.meta.map(m => print(parseCHType(m.type))), data };
}
const raw = async (sql: string) => { const res = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: sql }); if (!res.ok) throw new Error(await res.text()); return res.text(); };
beforeAll(async () => {
  if (process.env.TH_PROBE_URL) url = process.env.TH_PROBE_URL;
  else {
    container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
    url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  }
  for (const t of ['xa', 'xb', 'xc', 'xo', 'xm']) await raw(`DROP TABLE IF EXISTS ${t}`);
  await raw('CREATE TABLE xm (id UInt32, v String, hidden Int64 ALIAS toInt64(id) * 10) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO xm (id, v) VALUES (2, 'm2'), (2, 'm2b'), (3, 'm3')");
  await raw(`CREATE TABLE xa ${DDL}`);
  await raw(`CREATE TABLE xb ${DDL}`);
  await raw('CREATE TABLE xc (id UInt32, v String, N Int64) ENGINE=MergeTree ORDER BY id');
  await raw('CREATE TABLE xo (id UInt32, p0 Int64, t0 Int64, `ñ` Int64, `q``x` Int64, __typedhouse_leaf_0 Int64) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO xa VALUES (1, 'v', 10, 'u'), (2, 'w', 20, 'v'), (2, 'v', 21, 'v'), (3, 'u', 30, ''), (5, 'v', 50, 'w')");
  await raw("INSERT INTO xb VALUES (2, 'v', 7, 'v'), (2, 'u', 8, 'u'), (3, 'w', 9, ''), (4, 'v', 4, 'o'), (6, 'z', 6, 'z')");
  await raw("INSERT INTO xc VALUES (1, 'c1', 100), (2, 'c2', 200), (3, 'c3', 300), (7, 'c7', 700)");
  await raw("INSERT INTO xo VALUES (1, 11, 12, 13, 14, 15), (2, 21, 22, 23, 24, 25), (3, 31, 32, 33, 34, 35)");
}, 120000);
afterAll(async () => { await container?.stop(); });

const cells: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });
const printed = (columns: Readonly<Record<string, CHType>>) => Object.values(columns).map(t => print(t) === 'Bool' ? 'UInt8' : print(t));
interface Report { opt: string; folded: boolean; cells: string[]; analyzer0: string }
const brief = (r: Result) => r.error ? `E${r.error}` : JSON.stringify([r.meta, r.data]);
/** Runs both emitters in every contract cell; asserts rows/meta/error agreement, meta = columns, and the oracle when given. */
async function check(root: Rel, label: string, oracle?: string, ordered = false): Promise<Report> {
  const optimized = compile(root), naive = emitNaive(root);
  expect(optimized.columns, label).toEqual(naive.columns);
  const outs: string[] = [];
  let first: Result | undefined;
  for (const settings of cells) for (const [name, c] of [['optimized', optimized], ['naive', naive]] as const) {
    const r = await execute(c.sql, c.params, settings, ordered);
    outs.push(`${name} ${JSON.stringify(settings)}: ${brief(r)}`);
    const where = `${label}\n${name} ${JSON.stringify(settings)}\n${c.sql}`;
    first ??= r;
    expect(r, where).toEqual(first);
    if (!r.error) expect(r.meta, where).toEqual(printed(optimized.columns));
  }
  if (oracle) expect(await execute(oracle, {}, {}, ordered), `${label}\noracle`).toEqual(first);
  const a0 = await execute(optimized.sql, optimized.params, { allow_experimental_analyzer: 0 }, ordered);
  const n0 = await execute(naive.sql, naive.params, { allow_experimental_analyzer: 0 }, ordered);
  const report = { opt: optimized.sql, folded: !/AS `__typedhouse_input`\s*(\n|$|GROUP|WHERE|HAVING|ORDER)/.test(optimized.sql), cells: outs, analyzer0: `opt ${brief(a0)} | naive ${brief(n0)}` };
  if (process.env.TH_PROBE_DUMP) console.log(label, JSON.stringify(report, null, 1));
  return report;
}
const ij = () => join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id));
const lj = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
const conv = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n));
const J = ' SETTINGS join_use_nulls = 1';
const joins = [['inner', ij, 'INNER', ''], ['left', lj, 'LEFT', J], ['converted', conv, 'LEFT', J]] as const;
const fromSql = (k: string, kw: string) => `FROM xa a ${kw} ALL JOIN xb b ON a.id = b.id${k === 'converted' ? ' WHERE b.n > 0' : ''}`;

it('1. identity-read exemption: shared name `id` beside aggregate/WHERE/ON/second key/DISTINCT/scalar readers', async () => {
  for (const [k, q, kw, s] of joins) {
    const f = fromSql(k, kw);
    await check(q().groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ m: max(g.b.id) })).ir, `${k} aggregate max(b.id)`, `SELECT a.id AS id, max(b.id) AS m ${f} GROUP BY a.id${s}`);
    await check(q().where((r: any) => r.b.id.gt(2)).groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ c: count() })).ir, `${k} folded WHERE b.id`, `SELECT a.id AS id, count() AS c ${f}${k === 'converted' ? ' AND' : ' WHERE'} b.id > 2 GROUP BY a.id${s}`);
    await check(q().groupBy((r: any) => ({ id: r.a.id, bid: r.b.id })).aggregate(() => ({ c: count() })).ir, `${k} second key b.id`, `SELECT a.id AS id, b.id AS bid, count() AS c ${f} GROUP BY a.id, b.id${s}`);
    await check(q().groupBy((r: any) => ({ id: r.b.id })).aggregate((g: any) => ({ m: max(g.a.id), c: count() })).ir, `${k} key b.id with max(a.id)`, `SELECT b.id AS id, max(a.id) AS m, count() AS c ${f} GROUP BY b.id${s}`);
    await check(q().groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ c: count() })).distinct().ir, `${k} DISTINCT`, `SELECT DISTINCT a.id AS id, count() AS c ${f} GROUP BY a.id${s}`);
    await check(q().groupBy((r: any) => ({ id: r.a.id, t: scalar(C.aggregate(g => ({ t: max(g.id) }))) })).aggregate(() => ({ c: count() })).ir, `${k} scalar key`, `SELECT a.id AS id, (SELECT max(id) FROM xc) AS t, count() AS c ${f} GROUP BY a.id, t${s}`);
    // ORDER BY / HAVING by the shared identity name fence.
    await check(q().groupBy((r: any) => ({ id: r.b.id })).aggregate((g: any) => ({ m: max(g.a.id) })).orderBy((r: any) => r.id).ir, `${k} key b.id ORDER BY id`, `SELECT kk AS id, mm AS m FROM (SELECT b.id AS kk, max(a.id) AS mm ${f} GROUP BY b.id) ORDER BY kk${s}`, true);
  }
}, 300000);

it('1b. three inputs and composition', async () => {
  const three = join({ a: A, b: B, c: C }).on(r => [r.a.id.eq(r.b.id), r.b.id.eq(r.c.id)]);
  await check(three.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ m: max(g.c.id) })).ir, '3-way identity id, no clauses', 'SELECT a.id AS id, max(c.id) AS m FROM xa a INNER JOIN xb b ON a.id = b.id INNER JOIN xc c ON b.id = c.id GROUP BY a.id');
  await check(three.groupBy(r => ({ id: r.c.id })).aggregate(g => ({ m: max(g.a.n) })).orderBy(r => r.id).ir, '3-way identity c.id ORDER BY id', 'SELECT c.id AS id, max(a.n) AS m FROM xa a INNER JOIN xb b ON a.id = b.id INNER JOIN xc c ON b.id = c.id GROUP BY c.id ORDER BY c.id', true);
  await check(three.groupBy(r => ({ v: r.c.v })).aggregate(g => ({ c: count() })).where(r => r.v.ne('c9')).orderBy(r => r.v).ir, '3-way unique identity v HAVING/ORDER', 'SELECT c.v AS v, count() AS c FROM xa a INNER JOIN xb b ON a.id = b.id INNER JOIN xc c ON b.id = c.id GROUP BY c.v HAVING v != \'c9\' ORDER BY v', true);
  // N is case-sensitive: `N` (xc) vs `n` (xa/xb).
  await check(three.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: max(g.c.N) })).where(r => r.n.gt(0n)).ir, '3-way n: max(c.N) HAVING n', 'SELECT kk AS id, mm AS n FROM (SELECT a.id AS kk, max(c.N) AS mm FROM xa a INNER JOIN xb b ON a.id = b.id INNER JOIN xc c ON b.id = c.id GROUP BY a.id) WHERE mm > 0');
  await check(three.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ N: max(g.a.n) })).where(r => r.N.gt(0n)).orderBy(r => r.N).ir, '3-way N: max(a.n) HAVING/ORDER N', 'SELECT kk AS id, mm AS N FROM (SELECT a.id AS kk, max(a.n) AS mm FROM xa a INNER JOIN xb b ON a.id = b.id INNER JOIN xc c ON b.id = c.id GROUP BY a.id) WHERE mm > 0 ORDER BY mm', true);
  const comp = leftJoin({ ab: join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)) }, { c: C }).on(r => r.ab.b.id.eq(r.c.id));
  await check(comp.groupBy(r => ({ id: r.c.id })).aggregate(g => ({ m: max(g.ab.a.n) })).ir, 'composition identity c.id', `SELECT c.id AS id, max(a.n) AS m FROM xa a INNER JOIN xb b ON a.id = b.id LEFT JOIN xc c ON b.id = c.id GROUP BY c.id${J}`);
  await check(comp.groupBy(r => ({ id: r.ab.a.id })).aggregate(g => ({ c: count() })).orderBy(r => r.id).ir, 'composition nested a.id ORDER BY id', `SELECT a.id AS id, count() AS c FROM xa a INNER JOIN xb b ON a.id = b.id LEFT JOIN xc c ON b.id = c.id GROUP BY a.id ORDER BY a.id${J}`, true);
  await check(comp.groupBy(r => ({ v: r.c.v })).aggregate(g => ({ m: max(g.ab.b.n) })).where(r => r.v.ne('zz')).orderBy(r => r.v).ir, 'composition unique v', `SELECT c.v AS v, max(b.n) AS m FROM xa a INNER JOIN xb b ON a.id = b.id LEFT JOIN xc c ON b.id = c.id GROUP BY c.v HAVING v != 'zz' ORDER BY v${J}`, true);
}, 300000);

it('2. clausesRead completeness', async () => {
  for (const [k, q, kw, s] of joins) {
    const f = fromSql(k, kw);
    const base = () => q().groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ n: count(), top: max(g.b.n) }));
    await check(base().limit(10).where((r: any) => r.n.gt(1n)).ir, `${k} HAVING above Limit`, `SELECT * FROM (SELECT a.id AS id, count() AS cc, max(b.n) AS top ${f} GROUP BY a.id LIMIT 10) WHERE cc > 1${s}`.replace('SELECT *', 'SELECT id, cc AS n, top'));
    await check(base().distinct().orderBy((r: any) => r.n).thenBy((r: any) => r.id).ir, `${k} ORDER BY through Distinct`, `SELECT DISTINCT a.id AS id, count() AS cc, max(b.n) AS top ${f} GROUP BY a.id ORDER BY cc, id${s}`.replace('SELECT DISTINCT a.id AS id, count() AS cc, max(b.n) AS top', 'SELECT id, cc AS n, top FROM (SELECT DISTINCT a.id AS id, count() AS cc, max(b.n) AS top') .replace(' ORDER BY', ') ORDER BY'), true);
    await check(base().orderBy((r: any) => r.n.plus(1n)).thenBy((r: any) => r.id).ir, `${k} Sort key expression over alias`, `SELECT id, cc AS n, top FROM (SELECT a.id AS id, count() AS cc, max(b.n) AS top ${f} GROUP BY a.id) ORDER BY cc + 1, id${s}`, true);
    await check(base().where((r: any) => r.n.in(C.map(c => ({ x: c.N.minus(98n) })))).ir, `${k} IN-subquery HAVING`, `SELECT id, cc AS n, top FROM (SELECT a.id AS id, count() AS cc, max(b.n) AS top ${f} GROUP BY a.id) WHERE cc IN (SELECT N - 98 FROM xc)${s}`);
    // Only the parent walk sees these: `n` (count) is in N but read by nothing except a clause above a Distinct/Limit.
    // A CTE side exposes every CTE column whatever the demand, so `n` is visible in the join block although nothing reads a.n:
    // only the parent walk (Filter -> Sort) sees the ORDER BY n.
    if (k === 'inner') {
      const shared = A.where(r => r.id.gt(0)).map(r => ({ id: r.id, n: r.n, s: r.s })).cte();
      const cj = join({ a: shared, b: B }).on(r => r.a.id.eq(r.b.id));
      const w3 = await check(cj.groupBy(r => ({ id: r.a.id })).aggregate(() => ({ n: count(), c: count() })).where(r => r.c.gt(0n)).orderBy(r => r.n).thenBy(r => r.id).ir, 'CTE side: n ORDER BY above an unrelated HAVING', 'SELECT id, cc AS n, c FROM (SELECT a.id AS id, count() AS cc, count() AS c FROM (SELECT id, n, s FROM xa WHERE id > 0) a INNER JOIN xb b ON a.id = b.id GROUP BY a.id) WHERE c > 0 ORDER BY cc, id', true);
      expect(w3.folded, w3.opt).toBe(false);
      // Also the shared CTE consumed twice so it really is a WITH: the CTE's own aggregate is a second consumer.
      const twice = join({ a: shared, b: shared.where(r => r.id.gt(1)) }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ id: r.a.id })).aggregate(() => ({ s: count(), c: count() })).where(r => r.c.gt(0n)).orderBy(r => r.s).thenBy(r => r.id);
      const w4 = await check(twice.ir, 'CTE both sides: s ORDER BY above an unrelated HAVING', 'SELECT id, cc AS s, c FROM (SELECT a.id AS id, count() AS cc, count() AS c FROM (SELECT id, n, s FROM xa WHERE id > 0) a INNER JOIN (SELECT id, n, s FROM xa WHERE id > 1) b ON a.id = b.id GROUP BY a.id) WHERE c > 0 ORDER BY cc, id', true);
      expect(w4.folded, w4.opt).toBe(false);
    }
    const bare = () => q().groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ n: count() }));
    const w2 = await check(q().groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ n: count(), c: count() })).where((r: any) => r.c.gt(0n)).orderBy((r: any) => r.n).thenBy((r: any) => r.id).ir, `${k} n ORDER BY above an unrelated HAVING`, `SELECT id, cc AS n, c FROM (SELECT a.id AS id, count() AS cc, count() AS c ${f} GROUP BY a.id) WHERE c > 0 ORDER BY cc, id${s}`, true);
    expect(w2.folded, w2.opt).toBe(false);
    const w1 = await check(bare().distinct().orderBy((r: any) => r.n).thenBy((r: any) => r.id).ir, `${k} bare n ORDER BY through Distinct`, `SELECT id, cc AS n FROM (SELECT DISTINCT a.id AS id, count() AS cc ${f} GROUP BY a.id) ORDER BY cc, id${s}`, true);
    // Recorded: without the walk this folds and still agrees natively (ORDER BY after DISTINCT binds the select list), so the
    // Distinct step is conservative; the Filter step below is the one a capture needs.
    expect(w1.folded, w1.opt).toBe(false);
    await check(bare().distinct().where((r: any) => r.n.gt(1n)).ir, `${k} bare n HAVING above Distinct`, `SELECT id, cc AS n FROM (SELECT DISTINCT a.id AS id, count() AS cc ${f} GROUP BY a.id) WHERE cc > 1${s}`);
    await check(q().groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ n2: sum(g.b.n), n: max(g.b.n) })).ir, `${k} sum(b.n) AS n2, max(b.n) AS n`, `SELECT a.id AS id, sum(b.n) AS n2, max(b.n) AS n ${f} GROUP BY a.id${s}`);
    await check(q().groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ n2: sum(g.b.n), n: max(g.b.n) })).where((r: any) => r.n.gt(5n)).ir, `${k} n2/n HAVING n`, `SELECT id, n2, mm AS n FROM (SELECT a.id AS id, sum(b.n) AS n2, max(b.n) AS mm ${f} GROUP BY a.id) WHERE mm > 5${s}`);
  }
}, 300000);

it('2b. odd names: Param-like, CTE-like, case, Unicode, quoted, leaf-like', async () => {
  const oj = () => join({ a: A, o: O }).on(r => r.a.id.eq(r.o.id));
  const f = 'FROM xa a INNER JOIN xo o ON a.id = o.id';
  for (const name of ['p0', 't0', 'ñ', 'q`x', '__typedhouse_leaf_0', 'ID'] as const) {
    const q = oj().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ [name]: max(g.a.n), c: count() }) as any).where((r: any) => r[name].gt(0n)).orderBy((r: any) => r[name]);
    await check(q.ir, `odd alias ${name} (agg over a.n) HAVING/ORDER`, `SELECT kk AS id, mm, cc FROM (SELECT a.id AS kk, max(a.n) AS mm, count() AS cc ${f} GROUP BY a.id) WHERE mm > 0 ORDER BY mm`, true);
    const identity = oj().groupBy((r: any) => ({ [name === 'ID' ? 'id' : name]: name === 'ID' ? r.o.id : r.o[name] })).aggregate(() => ({ c: count() })).orderBy((r: any) => r[name === 'ID' ? 'id' : name]);
    await check(identity.ir, `odd identity key ${name}`, undefined, true);
  }
  // A CTE named t0 as a join input, beside an aggregate alias t0.
  const shared = A.where(r => r.id.gt(0)).map(r => ({ id: r.id, n: r.n })).cte();
  const q = join({ a: shared, b: B }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ t0: max(g.a.n), c: count() })).where(r => r.t0.gt(0n)).orderBy(r => r.t0);
  await check(q.ir, 'CTE input with alias t0', undefined, true);
  // A leaf-like alias over a fenced (derived) join block: the derived table's leaf names are chosen without seeing it.
  const leafy = join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ __typedhouse_leaf_0: count(), n: max(g.b.n) })).where(r => r.n.gt(0n)).where(r => r.__typedhouse_leaf_0.gt(1n)).orderBy(r => r.__typedhouse_leaf_0);
  await check(leafy.ir, 'leaf-like alias over a fenced join block', 'SELECT id, c AS __typedhouse_leaf_0, n FROM (SELECT a.id AS id, count() AS c, max(b.n) AS mm FROM xa a INNER JOIN xb b ON a.id = b.id GROUP BY a.id) WHERE mm > 0 AND c > 1 ORDER BY c'.replace('SELECT id, c AS __typedhouse_leaf_0, n', 'SELECT id, c AS __typedhouse_leaf_0, mm AS n'), true);
}, 300000);

it('1c. folded cross-side WHERE beside identity reads; converted unique identity; output alias equal to an input alias', async () => {
  for (const [k, q, kw, s] of joins) {
    const f = fromSql(k, kw);
    const w = k === 'converted' ? ' AND' : ' WHERE';
    // `n: a.n` is an identity read of a name both inputs carry; the WHERE reads `b.n` and `a.n` qualified in the same block.
    const r1 = await check(q().where((r: any) => r.a.n.gt(r.b.n)).groupBy((r: any) => ({ n: r.a.n })).aggregate((g: any) => ({ c: count(), m: max(g.b.n) })).ir, `${k} identity n: a.n beside WHERE a.n > b.n`, `SELECT a.n AS n, count() AS c, max(b.n) AS m ${f}${w} a.n > b.n GROUP BY a.n${s}`);
    expect(r1.folded, r1.opt).toBe(true);
    const r2 = await check(q().where((r: any) => r.a.n.gt(r.b.n)).groupBy((r: any) => ({ n: r.b.n })).aggregate((g: any) => ({ c: count(), m: max(g.a.n) })).ir, `${k} identity n: b.n beside WHERE a.n > b.n`, `SELECT b.n AS n, count() AS c, max(a.n) AS m ${f}${w} a.n > b.n GROUP BY b.n${s}`);
    expect(r2.folded, r2.opt).toBe(true);
    // Output alias `a` / `b` equal to a join input alias (not a column): plan-ctes renames the physical alias.
    const r3 = await check(q().groupBy((r: any) => ({ a: r.b.s })).aggregate((g: any) => ({ b: max(g.a.n) })).where((r: any) => r.b.gt(0n)).orderBy((r: any) => r.a).ir, `${k} output aliases a/b`, `SELECT y.s AS a, max(x.n) AS bb ${f.replace('xa a', 'xa x').replace('xb b', 'xb y').replaceAll('a.', 'x.').replaceAll('b.', 'y.')} GROUP BY y.s HAVING bb > 0 ORDER BY a${s}`, true);
    expect(r3.folded, r3.opt).toBe(true);
  }
  // LeftToInner-converted join with an identity key only xc carries: `toNullable(c.v) AS v ... GROUP BY c.v ... HAVING/ORDER BY v`.
  const cj = leftJoin({ a: A }, { c: C }).on(r => r.a.id.eq(r.c.id)).where(r => r.c.N.gt(0n));
  const r4 = await check(cj.groupBy(r => ({ v: r.c.v })).aggregate(() => ({ k: count() })).where(r => r.v.ne('c3')).orderBy(r => r.v).ir, 'converted unique identity v', `SELECT c.v AS v, count() AS k FROM xa a LEFT JOIN xc c ON a.id = c.id WHERE c.N > 0 GROUP BY c.v HAVING v != 'c3' ORDER BY v${J}`, true);
  expect(r4.opt).toContain('toNullable(`c`.`v`) AS `v`');
  expect(r4.folded, r4.opt).toBe(true);
}, 300000);

it('4. narrowed CTE exception: name: agg(name) over t0 with HAVING/ORDER BY through Distinct/Limit, and lowStock-like folds', async () => {
  const shared = A.where(r => r.id.gt(0)).map(r => ({ id: r.id, n: r.n, s: r.s })).cte();
  const plain = () => shared.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: max(g.n), c: count() }));
  const inner = 'SELECT id, max(n) AS mm, count() AS c FROM xa WHERE id > 0 GROUP BY id';
  const fold = await check(plain().ir, 'CTE plain (keeps fold)', `SELECT id, max(n) AS n, count() AS c FROM xa WHERE id > 0 GROUP BY id`);
  expect(fold.opt).toContain('max(`n`) AS `n`, count() AS `c` FROM `t0` GROUP BY `id`');
  const d = await check(plain().distinct().orderBy(r => r.n).ir, 'CTE ORDER BY n through Distinct', `SELECT DISTINCT id, mm AS n, c FROM (${inner}) ORDER BY mm`, true);
  expect(d.opt).not.toMatch(/max\(`n`\) AS `n`[^)]*FROM `t0`/);
  await check(plain().limit(10).where(r => r.n.gt(20n)).ir, 'CTE HAVING above Limit', `SELECT id, mm AS n, c FROM (${inner} LIMIT 10) WHERE mm > 20`);
  await check(plain().where(r => r.c.gt(0n)).orderBy(r => r.id).ir, 'CTE clauses that do not name n: keeps fold', `SELECT id, mm AS n, c FROM (${inner}) WHERE c > 0 ORDER BY id`, true).then(r => expect(r.opt).toContain('max(`n`) AS `n`'));
  // Key alias over a CTE (`s: n`-style rename is not an Agg, so it never took the exception).
  await check(shared.groupBy(r => ({ s: r.id })).aggregate(g => ({ m: max(g.s) })).orderBy(r => r.s).ir, 'CTE key rename s: id ORDER BY s', `SELECT kk AS s, m FROM (SELECT id AS kk, max(s) AS m FROM xa WHERE id > 0 GROUP BY id) ORDER BY kk`, true);
  // CTE consumed by a join and by an aggregate (two uses), with alias n on the join aggregate.
  const j = join({ a: shared, b: B }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: max(g.a.n) })).orderBy(r => r.n);
  await check(j.ir, 'CTE join side, n: max(a.n) ORDER BY n', `SELECT id, mm AS n FROM (SELECT a.id AS id, max(a.n) AS mm FROM (SELECT id, n FROM xa WHERE id > 0) a INNER JOIN xb b ON a.id = b.id GROUP BY a.id) ORDER BY mm`, true);
}, 300000);

it('hazard: an ALIAS column omitted from the descriptor (`typedhouse generate --skip-alias`) is outside N', async () => {
  const M = from(table('xm', { id: col.UInt32, v: col.String }, meta));
  const q = join({ a: A, m: M }).on(r => r.a.id.eq(r.m.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ hidden: count(), top: max(g.m.v) })).where(r => r.hidden.gt(1n));
  // Scan-block twin (pre-existing slice 1/3 guard, same descriptor-based schema).
  const scan = M.groupBy(r => ({ id: r.id })).aggregate(g => ({ hidden: count(), top: max(g.v) })).where(r => r.hidden.gt(1n));
  const results: Record<string, string> = {};
  for (const [label, root] of [['join', q.ir], ['scan', scan.ir]] as const) {
    const optimized = compile(root), naive = emitNaive(root);
    for (const s of cells) {
      const o = brief(await execute(optimized.sql, optimized.params, s)), n = brief(await execute(naive.sql, naive.params, s));
      results[`${label} alias=${s.prefer_column_name_to_alias} prewhere=${s.optimize_move_to_prewhere}`] = o === n ? 'agree' : `optimized ${o.startsWith('E') ? o : 'rows'} vs naive ${n.startsWith('E') ? n : 'rows'}`;
    }
  }
  // PIN (Tester finding 4c-1): the descriptor-faithful N cannot see an undeclared ALIAS column; both the 4c join rule and the
  // pre-existing scan guard fold, and `HAVING hidden` binds xm.hidden under prefer_column_name_to_alias = 1.
  expect(results).toEqual({
    'join alias=0 prewhere=0': 'agree', 'join alias=0 prewhere=1': 'agree', 'join alias=1 prewhere=0': 'optimized E215 vs naive rows', 'join alias=1 prewhere=1': 'optimized E215 vs naive rows',
    'scan alias=0 prewhere=0': 'agree', 'scan alias=0 prewhere=1': 'agree', 'scan alias=1 prewhere=0': 'optimized E215 vs naive rows', 'scan alias=1 prewhere=1': 'optimized E215 vs naive rows',
  });
});
