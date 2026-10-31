import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, sum, max, uniq, val, from, join, leftJoin, rightJoin, fullJoin, scalar, table, unionAll, parseCHType, print, type Rel, type CHType } from '@typedhouse/core';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createKnownFunctions } from '@typedhouse/core';
import fc from 'fast-check';
import { recipeArbitrary, seed as aggSeed } from './aggregate-union-arbitrary.js';
const { fn } = createKnownFunctions({ intDiv: { isAggregate: false, deterministic: true, aliasTo: '' }, throwIf: { isAggregate: false, deterministic: true, aliasTo: '' } } as const);

const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const cols = { id: col.UInt32, s: col.String, n: col.Int64, k: col.Nullable(col.UInt32), lc: col.LowCardinality(col.String) };
const DDL = '(id UInt32, s String, n Int64, k Nullable(UInt32), lc LowCardinality(String)) ENGINE=MergeTree ORDER BY id';
const KDDL = "(id UInt32, nl Nullable(String), lcs LowCardinality(String), lcn LowCardinality(Nullable(String)), saf SimpleAggregateFunction(max, LowCardinality(String)), e Enum8('a' = 1, 'b' = 2), d Decimal(10, 2), dt DateTime64(3, 'Asia/Tokyo'), fs FixedString(2), arr Array(String), tup Tuple(x UInt8, y String), m Map(String, UInt8)) ENGINE=MergeTree ORDER BY id";
const kcols = { id: col.UInt32, nl: col.Nullable(col.String), lcs: col.LowCardinality(col.String), lcn: col.LowCardinality(col.Nullable(col.String)), saf: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)), e: col.Enum8({ a: 1, b: 2 }), d: col.Decimal(10, 2), dt: col.DateTime64(3, 'Asia/Tokyo'), fs: col.FixedString(2), arr: col.Array(col.String), tup: col.Tuple({ x: col.UInt8, y: col.String }), m: col.Map(col.String, col.UInt8) };
const K = from(table('qk', kcols, meta));
const A = from(table('qa', cols, meta)), B = from(table('qb', cols, meta));
let container: StartedTestContainer;
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
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  await raw(`CREATE TABLE qa ${DDL}`);
  await raw(`CREATE TABLE qb ${DDL}`);
  // qa: orphan 4; qb: 'x' (not castable) only on row id 2 with n = -1, orphan 9.
  await raw("INSERT INTO qa VALUES (1, '1', 10, 1, 'u'), (2, '2', 20, NULL, 'v'), (3, 'y', 30, 3, ''), (4, '4', 40, 4, 'w')");
  await raw(`CREATE TABLE qk ${KDDL}`);
  await raw("INSERT INTO qk VALUES (1, 'n1', 'l1', 'c1', 's1', 'a', 1.25, '2024-01-02 03:04:05.678', 'ab', ['p','q'], (1,'t'), {'k':1}), (2, NULL, 'l2', NULL, 's2', 'b', 2.5, '2024-05-06 07:08:09.123', 'cd', [], (2,'u'), {}), (2, 'n2', 'l2', 'c2', 's2', 'a', 3.75, '2023-01-01 00:00:00.000', 'ef', ['r'], (3,'v'), {'z':3}), (7, 'n7', 'l7', 'c7', 's7', 'b', 7, '2022-02-02 02:02:02.002', 'gh', ['s'], (7,'w'), {'k':7})");
  await raw("INSERT INTO qb VALUES (1, '5', 5, 1, 'u'), (2, 'x', -1, NULL, 'v'), (3, '7', 7, 3, ''), (9, '9', 9, 9, 'z')");
}, 120000);
afterAll(async () => { await container?.stop(); });

// Tester native probes for slice 4b (LeftToInner, outer PushFilterJoin, toNullable rewrap) on clickhouse/clickhouse-server:24.8.
// Cells: prefer_column_name_to_alias 0/1 x optimize_move_to_prewhere 0/1 x query_plan_filter_push_down 0/1 x max_threads 1/default;
// wait_end_of_query = 1; hand-written oracles set join_use_nulls = 1 themselves.
const cells: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) for (const push of [0, 1]) for (const threads of [1, 0]) cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere, query_plan_filter_push_down: push, ...(threads ? { max_threads: threads } : {}) });
const printed = (columns: Readonly<Record<string, CHType>>) => Object.values(columns).map(t => print(t) === 'Bool' ? 'UInt8' : print(t));
async function observe(root: Rel, label: string, oracle?: string) {
  const optimized = compile(root), naive = emitNaive(root);
  const out: Record<string, unknown> = { label, hits: rewriteRel(root).hits.LeftToInner, opt: optimized.sql, naive: naive.sql };
  const seen = new Map<string, string[]>();
  for (const settings of cells) {
    const a = await execute(optimized.sql, optimized.params, settings);
    const b = await execute(naive.sql, naive.params, settings);
    const key = `${JSON.stringify(a.error ?? a.data)} | ${JSON.stringify(b.error ?? b.data)}`;
    seen.set(key, [...(seen.get(key) ?? []), JSON.stringify(settings)]);
  }
  out.cells = Object.fromEntries(seen);
  if (oracle) out.oracle = await execute(oracle);
  console.log(JSON.stringify(out, null, 1));
}

const J = 'SETTINGS join_use_nulls = 1';
/** Strict cell-by-cell agreement: optimized vs naive (rows, meta, error), meta = print(compiled.columns), and a hand-written oracle. */
async function agree(root: Rel, options: { label: string; oracle?: string; ordered?: boolean; error?: string; converted?: number; match?: boolean }) {
  const optimized = compile(root), naive = emitNaive(root);
  const context = `${options.label}\n${optimized.sql}`;
  expect.soft(optimized.columns, context).toEqual(naive.columns);
  if (options.converted !== undefined) expect.soft(rewriteRel(root).hits.LeftToInner, context).toBe(options.converted);
  const outerLeft = /(LEFT|RIGHT|FULL) ALL JOIN/.test(optimized.sql);
  expect.soft(/join_use_nulls = 1/.test(optimized.sql), context).toBe(outerLeft);
  let first: Result | undefined;
  for (const settings of cells) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);
    const label = `${context}\n${JSON.stringify(settings)}`;
    expect.soft(a, label).toEqual(b);
    if (options.match) { /* agreement only */ }
    else if (options.error !== undefined) expect.soft(a.error, label).toBe(options.error);
    else { expect.soft(a.error, label).toBeUndefined(); expect.soft(a.meta, label).toEqual(printed(optimized.columns)); }
    first ??= a;
    expect.soft(a, label).toEqual(first);
  }
  if (options.oracle) {
    const o = await execute(options.oracle, {}, {}, options.ordered);
    if (options.error !== undefined) expect.soft(o.error, `${context}\noracle`).toBe(options.error);
    else expect.soft({ meta: o.meta, data: o.data }, `${context}\noracle`).toEqual({ meta: first!.meta, data: first!.data });
  }
  return { optimized, naive, first: first! };
}
const lk = () => leftJoin({ a: A }, { b: K }).on(r => r.a.id.eq(r.b.id));

const bad = (s: any): any => cast(s, col.UInt8);
const DEFAULT: Settings = {};
/** Runs one emission in every cell and returns the distinct outcomes keyed by cell. */
async function outcomes(sql: string, params: Readonly<Record<string, string>>) {
  const out: { settings: Settings; result: Result }[] = [];
  for (const settings of [...cells, DEFAULT]) out.push({ settings, result: await execute(sql, params, settings) });
  return out;
}

/** DEFECT (blocker) pin: LeftToInner fires over a join input that holds a fallible computation (cast, known intDiv,
 * known throwIf, an ARRAY JOIN projection), or over a preserved input with one (via the ON copy). As INNER, 24.8's filter
 * push-down (query_plan_filter_push_down = 1, the default) moves the null-rejecting guard (or its ON-equality image) into
 * that input below the computation, so the bad row is never computed: the optimized text returns rows where naive and the
 * hand-written LEFT oracle fail. `fallibleExposure` only looks at Filter conjuncts at or above the join, never at the
 * inputs' own expressions. Pinned as observed (expected: optimized fails with the same code in every cell). */
it('fixed DEFECT (4b fix round 1): LeftToInner never fires over an input with a fallible computation; same failure in every cell', async () => {
  const projB = B.map(r => ({ id: r.id, n: r.n, c: bad(r.s) }));
  const projA = A.map(r => ({ id: r.id, c: bad(r.s) }));
  const divB = B.map(r => ({ id: r.id, n: r.n, c: fn.intDiv(r.n, r.n.plus(1n)).as(col.Int64) }));
  const thrB = B.map(r => ({ id: r.id, n: r.n, c: fn.throwIf(r.s.eq('x')).as(col.UInt8) }));
  const ajK = K.arrayJoin(r => r.arr, 'p').map(r => ({ id: r.id, c: bad(r.p) }));
  const aggB = B.groupBy(r => ({ id: r.id })).aggregate(x => ({ n: max(x.n), c: sum(bad(x.s)) }));
  const cases: [string, Rel, string, string][] = [
    ['left, cast projection in extended input', leftJoin({ a: A }, { b: projB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '6', `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, n, CAST(s AS UInt8) AS c FROM qb) b ON a.id = b.id WHERE b.n > 0 ${J}`],
    ['right, cast projection in extended input', rightJoin({ b: projB }, { a: A }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '6', `SELECT a.id, b.c FROM (SELECT id, n, CAST(s AS UInt8) AS c FROM qb) b RIGHT ALL JOIN qa a ON a.id = b.id WHERE b.n > 0 ${J}`],
    ['full -> right, cast projection in extended input', fullJoin({ a: A }, { b: projB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '6', `SELECT a.id, b.c FROM qa a FULL ALL JOIN (SELECT id, n, CAST(s AS UInt8) AS c FROM qb) b ON a.id = b.id WHERE b.n > 0 ${J}`],
    ['left, guard on the join key', leftJoin({ a: A }, { b: projB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.ne(2)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '6', `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, n, CAST(s AS UInt8) AS c FROM qb) b ON a.id = b.id WHERE b.id != 2 ${J}`],
    ['left, known intDiv by zero in extended input', leftJoin({ a: A }, { b: divB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '153', `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, n, intDiv(n, n + 1) AS c FROM qb) b ON a.id = b.id WHERE b.n > 0 ${J}`],
    ['left, known throwIf in extended input', leftJoin({ a: A }, { b: thrB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '395', `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, n, throwIf(s = 'x') AS c FROM qb) b ON a.id = b.id WHERE b.n > 0 ${J}`],
    ['left, ARRAY JOIN + cast in extended input', leftJoin({ a: A }, { b: ajK }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.gt(100)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '6', `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, CAST(p AS UInt8) AS c FROM qk ARRAY JOIN arr AS p) b ON a.id = b.id WHERE b.id > 100 ${J}`],
    ['left, fallible aggregate in extended input, key guard', leftJoin({ a: A }, { b: aggB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.ne(2)).map(r => ({ id: r.a.id, c: r.b.c })).ir, '6', `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, max(n) AS n, sum(CAST(s AS UInt8)) AS c FROM qb GROUP BY id) b ON a.id = b.id WHERE b.id != 2 ${J}`],
    ['left, cast projection in the preserved input, extended-side guard copied across ON', leftJoin({ a: projA }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.lt(3)).map(r => ({ id: r.a.id, c: r.a.c })).ir, '6', `SELECT a.id, a.c FROM (SELECT id, CAST(s AS UInt8) AS c FROM qa) a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.id < 3 ${J}`],
  ];
  // 4b fix round 1: flipped from the DEFECT pin. `fallibleWithin` fences the join (no LeftToInner, no PushFilterJoin), so the
  // optimized text fails with naive's code in every cell, default settings included, and so does the LEFT oracle.
  for (const [label, root, code, oracle] of cases) {
    const optimized = compile(root), naive = emitNaive(root);
    expect(rewriteRel(root).hits, label).toMatchObject({ LeftToInner: 0, PushFilterJoin: 0 });
    expect((await execute(oracle)).error, `${label} oracle`).toBe(code);
    const opt = await outcomes(optimized.sql, optimized.params), nai = await outcomes(naive.sql, naive.params);
    for (const [i, { settings, result }] of nai.entries()) {
      expect(result.error, `${label} naive ${JSON.stringify(settings)}`).toBe(code);
      expect(opt[i]!.result, `${label} optimized ${JSON.stringify(settings)}`).toEqual(result);
    }
  }
});

/** FINDING (pre-existing, not 4b: PushFilterJoin on inner joins at HEAD): the reverse direction. A preserved/inner-side
 * conjunct pushed into input a's subquery is no longer copied by 24.8 across the ON equality into b, so b's cast runs on
 * every row and the optimized text fails where naive (filter above the join, copied into both inputs) and the oracle
 * return rows. The LEFT twin agrees (the server does not copy a preserved-side filter into the extended side there). */
it('fixed FINDING (4b fix round 1, pre-existing inner PushFilterJoin): no push beside a fallible input; same outcome as naive in every cell', async () => {
  const projB = B.map(r => ({ id: r.id, n: r.n, c: bad(r.s) }));
  const inner = join({ a: A, b: projB }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.gt(2)).map(r => ({ id: r.a.id, c: r.b.c }));
  // 4b fix round 1: flipped from the FINDING pin. Input b evaluates a cast, so PushFilterJoin no longer moves `a.id > 2` into a;
  // the optimized text keeps the guard in the join WHERE and has naive's outcome in every cell (rows at default settings).
  const optimized = compile(inner.ir), naive = emitNaive(inner.ir);
  expect(rewriteRel(inner.ir).hits.PushFilterJoin).toBe(0);
  expect((await execute(`SELECT a.id, b.c FROM qa a INNER ALL JOIN (SELECT id, n, CAST(s AS UInt8) AS c FROM qb) b ON a.id = b.id WHERE a.id > 2`)).data).toEqual([[3, 7]]);
  const opt = await outcomes(optimized.sql, optimized.params), nai = await outcomes(naive.sql, naive.params);
  for (const [i, { settings, result }] of nai.entries()) expect(opt[i]!.result, JSON.stringify(settings)).toEqual(result);
  expect(opt.at(-1)!.result.data).toEqual([[3, 7]]);
  const left = leftJoin({ a: A }, { b: projB }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.gt(2)).map(r => ({ id: r.a.id, c: r.b.c }));
  await agree(left.ir, { label: 'left twin agrees', match: true, oracle: `SELECT a.id, b.c FROM qa a LEFT ALL JOIN (SELECT id, n, CAST(s AS UInt8) AS c FROM qb) b ON a.id = b.id WHERE a.id > 2 ${J}` });
});

it('fallible expressions above a converted join (select list, sort key, group key, aggregate argument, HAVING) agree in every cell', async () => {
  const g = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n));
  await agree(g().map(r => ({ id: r.a.id, c: bad(r.b.s.ifNull('0')) })).ir, { label: 'select list', converted: 1, oracle: `SELECT a.id, CAST(ifNull(b.s, '0') AS UInt8) FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0 ${J}` });
  await agree(g().orderBy(r => bad(r.b.s.ifNull('0'))).map(r => ({ id: r.a.id })).ir, { label: 'sort key', ordered: true, converted: 1, oracle: `SELECT a.id FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0 ORDER BY CAST(ifNull(b.s, '0') AS UInt8) ${J}` });
  await agree(g().groupBy(r => ({ c: bad(r.b.s.ifNull('0')) })).aggregate(() => ({ n: count() })).ir, { label: 'group key', converted: 1, oracle: `SELECT CAST(ifNull(b.s, '0') AS UInt8) c, count() FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0 GROUP BY c ${J}` });
  await agree(g().groupBy(r => ({ id: r.a.id })).aggregate(x => ({ n: sum(bad(x.b.s.ifNull('0'))) })).ir, { label: 'aggregate argument', converted: 1, oracle: `SELECT a.id, sum(CAST(ifNull(b.s, '0') AS UInt8)) FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0 GROUP BY a.id ${J}` });
  await agree(g().groupBy(r => ({ id: r.a.id })).aggregate(x => ({ m: max(x.b.s) })).where(r => bad(r.m.ifNull('0')).gt(0)).ir, { label: 'HAVING (fence: a fallible HAVING exposes the join under the Aggregate; over-wide but sound)', converted: 0, oracle: `SELECT id, m FROM (SELECT a.id AS id, max(b.s) AS m FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0 GROUP BY a.id) WHERE CAST(ifNull(m, '0') AS UInt8) > 0 ${J}` });
  // A fallible WHERE above keeps the join LEFT (fence) and runs after the guard, like naive and the nested oracle.
  await agree(g().where(r => bad(r.b.s.ifNull('x')).gt(0)).map(r => ({ id: r.a.id })).ir, { label: 'fallible WHERE fences', converted: 0, oracle: `SELECT id FROM (SELECT a.id AS id, b.s AS s FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0) WHERE CAST(ifNull(s, 'x') AS UInt8) > 0 ${J}` });
});

it('rewrap: every kind and read position over a converted join; meta = columns on both emitters and the LEFT oracle', async () => {
  const conv = lk().where(r => r.b.id.gt(0));
  await agree(conv.map(r => ({ id: r.a.id, nl: r.b.nl, lcs: r.b.lcs, lcn: r.b.lcn, saf: r.b.saf, e: r.b.e, d: r.b.d, dt: r.b.dt, fs: r.b.fs, arr: r.b.arr, tup: r.b.tup, m: r.b.m, x: r.b.tup.element('x') })).ir,
    { label: 'kinds in select list', converted: 1, oracle: `SELECT a.id, b.nl, b.lcs, b.lcn, b.saf, b.e, b.d, b.dt, b.fs, b.arr, b.tup, b.m, tupleElement(b.tup, 'x') FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 ${J}` });
  await agree(conv.groupBy(r => ({ e: r.b.e, lcs: r.b.lcs, fs: r.b.fs })).aggregate(g => ({ c: count(), mx: max(g.b.d), dt: max(g.b.dt) })).where(r => r.c.gt(0n)).ir,
    { label: 'group keys, aggregate args, HAVING', converted: 1, oracle: `SELECT b.e, b.lcs, b.fs, count() AS c, max(b.d), max(b.dt) FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY b.e, b.lcs, b.fs HAVING c > 0 ${J}` });
  await agree(conv.orderBy(r => r.b.nl.asc().nullsFirst()).thenBy(r => r.b.d.desc()).map(r => ({ nl: r.b.nl, d: r.b.d })).ir,
    { label: 'order by nulls first', ordered: true, converted: 1, oracle: `SELECT b.nl, b.d FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 ORDER BY b.nl ASC NULLS FIRST, b.d DESC ${J}` });
  await agree(conv.map(r => ({ lcs: r.b.lcs, e: r.b.e })).distinct().ir,
    { label: 'distinct', converted: 1, oracle: `SELECT DISTINCT b.lcs, b.e FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 ${J}` });
  await agree(conv.arrayJoin(r => r.b.arr, 'v').map(r => ({ id: r.a.id, v: r.v })).ir,
    { label: 'array join over converted side', converted: 1, oracle: `SELECT a.id, v FROM qa a LEFT ALL JOIN qk b ON a.id = b.id ARRAY JOIN b.arr AS v WHERE b.id > 0 ${J}` });
  await agree(conv.groupBy(r => ({ k: r.b.lcn })).aggregate(() => ({ c: count() })).orderBy(r => r.k.desc().nullsFirst()).ir,
    { label: 'group by LC(Nullable) + order by key', ordered: true, converted: 1, oracle: `SELECT b.lcn AS k, count() FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY k ORDER BY k DESC NULLS FIRST ${J}` });
  await agree(conv.groupBy(r => ({ s: r.b.lcs })).aggregate(g => ({ total: sum(g.b.d) })).where(r => r.total.isNotNull()).orderBy(r => r.total.desc()).ir,
    { label: 'aggregate over Decimal, HAVING isNotNull (not totalPredicate over Decimal: fenced, minor) and ORDER BY by alias', ordered: true, converted: 0, oracle: `SELECT b.lcs, sum(b.d) AS total FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY b.lcs HAVING total IS NOT NULL ORDER BY total DESC ${J}` });
  const shared = conv.map(r => ({ id: r.a.id, d: r.b.d, lcs: r.b.lcs })).cte();
  await agree(unionAll(shared, shared.where(r => r.lcs.ne('l1'))).ir, { label: 'converted CTE consumed twice (union)', converted: 1, oracle: `SELECT a.id, b.d, b.lcs FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 UNION ALL SELECT * FROM (SELECT a.id, b.d, b.lcs AS l FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0) WHERE l != 'l1' ${J}` });
  await agree(join({ x: shared, y: shared }).on(r => r.x.id.eq(r.y.id)).map(r => ({ id: r.x.id, d: r.y.d, l: r.x.lcs })).ir, { label: 'converted CTE self join', converted: 1 });
  // 4b fix round 2 (D2): a key named like its own column, by key name in ORDER BY for every kind and in HAVING for the
  // String kinds (a HAVING over Decimal/Enum/DateTime64 is not total and fences the conversion), in every cell.
  for (const k of ['nl', 'lcs', 'lcn', 'saf', 'e', 'd', 'dt', 'fs', 'arr'] as const) {
    const ordered = conv.groupBy(r => ({ [k]: (r.b as any)[k] }) as any).aggregate(() => ({ c: count() })).orderBy((r: any) => r[k].desc().nullsFirst());
    const sql = await agree(ordered.ir, { label: `ORDER BY key name ${k}`, ordered: true, converted: 1, oracle: `SELECT b.${k} AS ${k}, count() AS c FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY ${k} ORDER BY ${k} DESC NULLS FIRST ${J}` });
    if (['lcs', 'saf', 'e', 'd', 'dt', 'fs'].includes(k)) expect(sql.optimized.sql, k).toMatch(new RegExp(`toNullable\\(\`b\`\\.\`${k}\`\\) AS \`${k}\`[^]*GROUP BY \`b\`\\.\`${k}\`[^]*ORDER BY \`${k}\``));
  }
  await agree(conv.groupBy(r => ({ m: r.b.id.plus(1), f: r.b.nl.ifNull('z'), lcs: r.b.lcs })).aggregate(() => ({ c: count() })).orderBy(r => r.lcs).thenBy(r => r.m).thenBy(r => r.f).ir,
    { label: 'compound keys (wrapped whole / unwrapped non-null) ordered by key name', ordered: true, converted: 1, oracle: `SELECT b.id + 1 AS m, ifNull(b.nl, 'z') AS f, b.lcs AS lcs, count() AS c FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY m, f, lcs ORDER BY lcs, m, f ${J}` });
  for (const k of ['nl', 'lcs', 'lcn'] as const) {
    const having = conv.groupBy(r => ({ [k]: (r.b as any)[k] }) as any).aggregate(() => ({ c: count() })).where((r: any) => r[k].ne('zz')).orderBy((r: any) => r[k].asc());
    await agree(having.ir, { label: `HAVING key name ${k}`, ordered: true, converted: 1, oracle: `SELECT b.${k} AS ${k}, count() AS c FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY ${k} HAVING ${k} != 'zz' ORDER BY ${k} ASC ${J}` });
  }
});

/** Pre-existing class (slice 4c, join-block aggregate alias capture), reproduced over a converted join: alias `nl` equals
 * b's column; HAVING by alias binds the column under prefer_column_name_to_alias = 1 (215). Not counted against 4b.
 * 4c: FIXED, flipped. `nl` is a column of `qk`, so the aggregate reads the join block as a derived table and agrees. */
it('4c (was pin) over a converted join: alias equal to a side column in HAVING', async () => {
  const q = lk().where(r => r.b.id.gt(0)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ nl: max(g.b.nl) })).where(r => r.nl.isNotNull());
  const optimized = compile(q.ir), naive = emitNaive(q.ir);
  expect(optimized.sql).toMatch(/\) AS `__typedhouse_input` GROUP BY `__typedhouse_input`\.`__typedhouse_leaf_0` HAVING isNotNull\(`nl`\)/);
  for (const alias of [0, 1]) {
    const a = await execute(optimized.sql, optimized.params, { prefer_column_name_to_alias: alias }), b = await execute(naive.sql, naive.params, { prefer_column_name_to_alias: alias });
    expect(a.error, `4c nl ${alias}`).toBeUndefined();
    expect(a, `4c nl ${alias}`).toEqual(b);
  }
});

it('full -> left/right/inner and nested outer joins match hand-written oracles; join_use_nulls iff an outer join survives', async () => {
  const fj = () => fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
  const sel = (r: any) => ({ aid: r.a.id, as: r.a.s, bid: r.b.id, bn: r.b.n, blc: r.b.lc });
  const out = 'a.id, a.s, b.id, b.n, b.lc';
  const l = await agree(fj().where(r => r.a.n.gt(0n)).map(sel).ir, { label: 'full -> left', converted: 1, oracle: `SELECT ${out} FROM qa a FULL ALL JOIN qb b ON a.id = b.id WHERE a.n > 0 ${J}` });
  expect(l.optimized.sql).toMatch(/LEFT ALL JOIN[^]*join_use_nulls = 1/);
  const r = await agree(fj().where(r => r.b.lc.ne('zz')).map(sel).ir, { label: 'full -> right', converted: 1, oracle: `SELECT ${out} FROM qa a FULL ALL JOIN qb b ON a.id = b.id WHERE b.lc != 'zz' ${J}` });
  expect(r.optimized.sql).toMatch(/RIGHT ALL JOIN[^]*join_use_nulls = 1/);
  const i = await agree(fj().where(r => r.a.s.eq(r.b.s).or(r.a.n.gt(r.b.n))).where(r => r.b.n.gt(0n)).where(r => r.a.k.isNotNull()).map(sel).ir, { label: 'full -> inner', converted: 1, oracle: `SELECT ${out} FROM qa a FULL ALL JOIN qb b ON a.id = b.id WHERE (a.s = b.s OR a.n > b.n) AND b.n > 0 AND a.k IS NOT NULL ${J}` });
  expect(i.optimized.sql).not.toMatch(/join_use_nulls|FULL|LEFT|RIGHT/);
  await agree(fj().where(r => r.a.id.isNull().or(r.b.id.isNull())).map(sel).ir, { label: 'full symmetric difference stays', converted: 0, oracle: `SELECT ${out} FROM qa a FULL ALL JOIN qb b ON a.id = b.id WHERE a.id IS NULL OR b.id IS NULL ${J}` });
  // Nested: left over left. A conjunct on the nested join's extended side converts the outer join only.
  const C2 = from(table('qb', cols, meta));
  const nested = leftJoin({ a: A }, { bc: leftJoin({ b: B }, { c: C2 }).on(r => r.b.id.eq(r.c.k)) }).on(r => r.a.id.eq(r.bc.b.id));
  const n1 = await agree(nested.where(r => r.bc.c.n.gt(0n)).map(r => ({ a: r.a.id, b: r.bc.b.id, c: r.bc.c.id })).ir, { label: 'left over left, nested extended side', converted: 1, oracle: `SELECT a.id, bc.bid, bc.cid FROM qa a LEFT ALL JOIN (SELECT b.id AS bid, c.id AS cid, c.n AS cn FROM qb b LEFT ALL JOIN qb c ON b.id = c.k) bc ON a.id = bc.bid WHERE bc.cn > 0 ${J}` });
  expect(n1.optimized.sql).toMatch(/INNER ALL JOIN[^]*LEFT ALL JOIN|LEFT ALL JOIN[^]*INNER ALL JOIN/);
  const nestedLeft = leftJoin({ ab: leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)) }, { c: C2 }).on(r => r.ab.a.id.eq(r.c.k));
  const n2 = await agree(nestedLeft.where(r => r.ab.b.n.gt(0n)).map(r => ({ a: r.ab.a.id, b: r.ab.b.id, c: r.c.id })).ir, { label: 'left(left) on preserved nested side: pushed, then inner converts', converted: 1, oracle: `SELECT ab.aid, ab.bid, c.id FROM (SELECT a.id AS aid, b.id AS bid, b.n AS bn FROM qa a LEFT ALL JOIN qb b ON a.id = b.id) ab LEFT ALL JOIN qb c ON ab.aid = c.k WHERE ab.bn > 0 ${J}` });
  expect(n2.optimized.sql).toMatch(/INNER ALL JOIN[^]*LEFT ALL JOIN[^]*join_use_nulls = 1/);
  // Converted joins in a scalar subquery, an IN subquery and a union branch: the setting follows the survivors only.
  const conv = leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n));
  const s = await agree(A.map(r => ({ id: r.id, c: scalar(conv.aggregate(() => ({ c: count() }))), m: r.id.in(conv.map(x => ({ id: x.b.id }))) })).ir, { label: 'scalar + IN over converted (one shared occurrence)', converted: 1, oracle: `SELECT id, (SELECT count() FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0), id IN (SELECT b.id FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0) FROM qa ${J}` });
  expect(s.optimized.sql).not.toMatch(/join_use_nulls/);
  const u = await agree(unionAll(conv.map(r => ({ id: r.a.id, n: r.b.n })), leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, n: r.b.n }))).ir, { label: 'union: one converted, one surviving', converted: 1, oracle: `SELECT a.id, b.n FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0 UNION ALL SELECT a.id, b.n FROM qa a LEFT ALL JOIN qb b ON a.id = b.id ${J}` });
  expect(u.optimized.sql).toMatch(/join_use_nulls = 1/);
});

it('m3 (4b fix round 1): a bare key read in the folded WHERE gives the hand-written INNER index condition; meta = columns', async () => {
  const q = leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.gt(2)).map(r => ({ id: r.a.id, n: r.b.n }));
  const optimized = compile(q.ir);
  // 4b fix round 1 (m3): the total WHERE reads the converted key bare; only the select list keeps the descriptor.
  expect(optimized.sql).toContain('WHERE (`b`.`id` >');
  const explain = async (sql: string, params: Readonly<Record<string, string>> = {}) => {
    const endpoint = new URL(url);
    for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
    const res = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `EXPLAIN indexes = 1, actions = 1 ${sql}` });
    return res.text();
  };
  const planned = await explain(optimized.sql, optimized.params);
  const hand = await explain('SELECT a.id, b.n FROM qa a INNER ALL JOIN qb b ON a.id = b.id WHERE b.id > 2');
  // OBSERVATION (minor, performance only): PREWHERE still happens, but the primary-key condition is lost on both inputs
  // (toNullable is not seen through by KeyCondition), where the hand-written INNER uses the key range on both.
  const conditions = (text: string) => [...text.matchAll(/Condition: (.*)$/gm)].map(m => m[1]!.replace(/\\'/g, "'"));
  // Fixed (m3): the primary-key range is used on both inputs, exactly as in the hand-written INNER join.
  expect(conditions(planned)).toEqual(conditions(hand));
  expect(conditions(hand)).toEqual(['(id in [3, +Inf))', '(id in [3, +Inf))']);
  const run = await execute(optimized.sql, optimized.params);
  expect(run.meta).toEqual(printed(optimized.columns));
  expect(run.data).toEqual((await execute(emitNaive(q.ir).sql, emitNaive(q.ir).params)).data);
});

/** Prefetch equivalence (aggregate-union.integration.ts): the always-true synchronous `fc.assert` pass records exactly the
 * value stream that `fc.check(fc.asyncProperty(...))` then generates for the same seed and numRuns (Docker-free). */
it('aggregate-union prefetch: fc.assert and fc.check generate the identical 500-recipe stream for the seed', async () => {
  const options = { seed: aggSeed, numRuns: 500 };
  const planned: string[] = [], checked: string[] = [];
  fc.assert(fc.property(recipeArbitrary, r => { planned.push(JSON.stringify(r)); }), options);
  const result = await fc.check(fc.asyncProperty(recipeArbitrary, async r => { checked.push(JSON.stringify(r)); }), options);
  expect(result.failed).toBe(false);
  expect(checked).toHaveLength(500);
  expect(checked).toEqual(planned);
  expect(new Set(planned).size).toBe(498); // two duplicates: the second occurrence evaluates live (prefetched 498/500)
});

// Re-verification (4b fix round 1).
it('re-verification: total aggregates in a converted input, fallible projection above the filter, m3 bare reads in every cell', async () => {
  // totalAggregate list against the server: max over String/LC/Nullable, uniq, count, integer sum in the extended input.
  const aggB = B.groupBy(r => ({ id: r.id })).aggregate(g => ({ c: count(), m: max(g.s), l: max(g.lc), k: max(g.k), u: uniq(g.s), t: sum(g.n) }));
  await agree(leftJoin({ a: A }, { b: aggB }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.ne(2)).map(r => ({ id: r.a.id, c: r.b.c, m: r.b.m, l: r.b.l, k: r.b.k, u: r.b.u, t: r.b.t })).ir,
    { label: 'total aggregates in the extended input', converted: 1, oracle: `SELECT a.id, b.c, b.m, b.l, b.k, b.u, b.t FROM qa a LEFT ALL JOIN (SELECT id, count() c, max(s) m, max(lc) l, max(k) k, uniq(s) u, sum(n) t FROM qb GROUP BY id) b ON a.id = b.id WHERE b.id != 2 ${J}` });
  // A fallible select item *below* the guard: the filter crosses the Project (total predicate) and converts; naive's
  // Project would cast the extended rows' ifNull default. Checked in every cell, including push-down off.
  await agree(leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, n: r.b.n, c: bad(r.b.s.ifNull('x')) })).where(r => r.n.gt(0n)).ir,
    { label: 'fallible projection under the guard', match: true, oracle: `SELECT id, n, c FROM (SELECT a.id AS id, b.n AS n, CAST(ifNull(b.s, 'x') AS UInt8) AS c FROM qa a LEFT ALL JOIN qb b ON a.id = b.id) WHERE n > 0 ${J}` });
  // m3: bare reads beside a Nullable Param, inside ifNull/isNull, ORDER BY NULLS FIRST over LC and Enum, HAVING, and a
  // `toNullable(b.x) AS x` select item named like the bare WHERE column (alias cells 0/1 are in `cells`).
  const conv = () => lk().where(r => r.b.id.gt(0));
  await agree(conv().where(r => r.b.id.ne(val(null, col.Nullable(col.UInt32)))).map(r => ({ id: r.a.id })).ir, { label: 'bare UInt32 vs NULL Param', converted: 1, oracle: `SELECT a.id FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 AND b.id != NULL ${J}` });
  await agree(conv().where(r => r.b.id.eq(val(7, col.Nullable(col.UInt32)))).map(r => ({ id: r.a.id, lcs: r.b.lcs })).ir, { label: 'bare UInt32 vs Nullable Param', converted: 1, oracle: `SELECT a.id, b.lcs FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 AND b.id = 7 ${J}` });
  await agree(conv().where(r => r.b.id.ifNull(0).ne(7).and(r.b.lcs.isNull().not()).and(r.b.nl.ifNull('zz').ne('n1'))).map(r => ({ id: r.a.id, lcs: r.b.lcs, e: r.b.e })).ir, { label: 'bare inside ifNull/isNull/isNotNull ', converted: 1, oracle: `SELECT a.id, b.lcs, b.e FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 AND ifNull(b.id, 0) != 7 AND NOT (b.lcs IS NULL) AND ifNull(b.nl, 'zz') != 'n1' ${J}` });
  await agree(conv().orderBy(r => r.b.lcs.desc().nullsFirst()).thenBy(r => r.b.e.asc().nullsFirst()).thenBy(r => r.b.fs.desc()).thenBy(r => r.b.dt).map(r => ({ lcs: r.b.lcs, e: r.b.e, fs: r.b.fs, dt: r.b.dt })).ir, { label: 'ORDER BY NULLS FIRST over bare LC/Enum/FixedString/DateTime64', ordered: true, converted: 1, oracle: `SELECT b.lcs, b.e, b.fs, b.dt FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 ORDER BY b.lcs DESC NULLS FIRST, b.e ASC NULLS FIRST, b.fs DESC, b.dt ASC ${J}` });
  await agree(conv().groupBy(r => ({ ek: r.b.e })).aggregate(g => ({ c: count(), m: max(g.b.lcs) })).where(r => r.c.gt(0n)).orderBy(r => r.ek.desc().nullsFirst()).ir, { label: 'HAVING + ORDER BY over a grouped key (non-colliding alias)', ordered: true, converted: 1, oracle: `SELECT b.e AS ek, count() AS c, max(b.lcs) FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY ek HAVING c > 0 ORDER BY ek DESC NULLS FIRST ${J}` });
  const shadow = await agree(conv().map(r => ({ lcs: r.b.lcs, id: r.b.id, e: r.b.e })).where(r => r.lcs.ne('l1')).ir, { label: 'toNullable(b.lcs) AS lcs beside a bare WHERE b.lcs in one block', converted: 1, oracle: `SELECT b.lcs, b.id, b.e FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 AND b.lcs != 'l1' ${J}` });
  expect(shadow.optimized.sql).toMatch(/toNullable\(`b`\.`lcs`\) AS `lcs`[^]*WHERE[^]*`b`\.`lcs` !=/);
});

/** FINDING (pre-existing at HEAD, not a 4b rule; the Worker's MergeFilter finding, minimal form): two total Filters over
 * an outer join whose preserved input projects a failing cast. Naive nests them; 24.8 does not push the outer guard
 * through the inner non-pushable `isNull(b.id)` filter, so the cast runs on every row of qa (code 6, as the oracle).
 * MergeFilter merges them into one WHERE and the server pushes the `a.id != 3` part below the cast: rows. */
it('FINDING pin (pre-existing, MergeFilter + join-block fold): merged filters let the server guard a fallible input projection', async () => {
  const projA = A.map(r => ({ id: r.id, c: bad(r.s) }));
  const q = leftJoin({ a: projA }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.id.isNull()).where(r => r.a.id.ne(3)).map(r => ({ id: r.a.id, c: r.a.c }));
  expect(rewriteRel(q.ir).hits).toMatchObject({ MergeFilter: 1, LeftToInner: 0, PushFilterJoin: 0 });
  const optimized = compile(q.ir), naive = emitNaive(q.ir);
  expect((await execute(`SELECT id, c FROM (SELECT a.id AS id, a.c AS c FROM (SELECT id, CAST(s AS UInt8) AS c FROM qa) a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.id IS NULL) WHERE id != 3 ${J}`)).error).toBe('6');
  expect((await execute(naive.sql, naive.params)).error).toBe('6');
  expect((await execute(optimized.sql, optimized.params)).data).toEqual([[4, 4]]); // observed; expected once fixed: code 6
  expect((await execute(optimized.sql, optimized.params, { query_plan_filter_push_down: 0 })).error).toBe('6');
});

/** DEFECT (4b rewrap; the 4c alias-capture class, but introduced by the conversion): an identity group key `e: r.b.e`
 * over a LEFT join folds as `b.e AS e ... GROUP BY b.e ... ORDER BY e`, harmless under prefer_column_name_to_alias = 1
 * because `e` then binds the grouped column itself. After LeftToInner the key becomes `toNullable(b.e) AS e` and
 * `GROUP BY toNullable(b.e)`, so `ORDER BY e` (or HAVING e) binds the ungrouped column b.e: NOT_AN_AGGREGATE (215)
 * where naive and the unconverted query return rows. The 4c brief exempts identity reads, so 4c would not fix it. */
it('fixed D2 (4b fix round 2): an identity group key over a converted join groups bare; ORDER BY by key name agrees in every cell', async () => {
  const shape = (q: ReturnType<typeof lk>) => q.groupBy(r => ({ e: r.b.e })).aggregate(() => ({ c: count() })).orderBy(r => r.e.desc().nullsFirst());
  const converted = shape(lk().where(r => r.b.id.gt(0))), left = shape(lk().where(r => r.b.id.isNull().or(r.b.id.gt(0))));
  expect(rewriteRel(converted.ir).hits.LeftToInner).toBe(1);
  expect(rewriteRel(left.ir).hits.LeftToInner).toBe(0);
  const run = async (q: { ir: Rel }, alias: number) => { const c = compile(q.ir); return execute(c.sql, c.params, { prefer_column_name_to_alias: alias }, true); };
  const naive = emitNaive(converted.ir);
  for (const alias of [0, 1]) {
    expect((await run(left, alias)).error, `left ${alias}`).toBeUndefined();
    expect((await execute(naive.sql, naive.params, { prefer_column_name_to_alias: alias }, true)).data).toEqual([['b', '1'], ['a', '2']]);
  }
  // 4b fix round 2: flipped from the DEFECT pin. The key groups by the bare column and only the select item wraps it, so
  // `ORDER BY e` binds either the alias (a function of the key) or the grouped column itself: naive's rows in every cell.
  expect(compile(converted.ir).sql).toMatch(/toNullable\(`b`\.`e`\) AS `e`[^]*GROUP BY `b`\.`e`[^]*ORDER BY `e`/);
  await agree(converted.ir, { label: 'D2: identity key read through toNullable, ORDER BY key name', ordered: true, converted: 1, oracle: `SELECT b.e AS e, count() AS c FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0 GROUP BY e ORDER BY e DESC NULLS FIRST ${J}` });
  for (const alias of [0, 1]) expect((await run(converted, alias)).data, `converted ${alias}`).toEqual([['b', '1'], ['a', '2']]);
});

// Re-verification (4b fix round 2): grouping by bare reads of converted columns, select items wrapped whole.
it('re-verification 2: aggregate blocks over converted joins in every cell (keys, aliases, compound keys, DISTINCT, CTE, global)', async () => {
  const ck = () => lk().where(r => r.b.id.gt(0));
  const cb = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n));
  const W = 'FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id > 0';
  const WB = 'FROM qa a LEFT ALL JOIN qb b ON a.id = b.id WHERE b.n > 0';
  await agree(ck().groupBy(r => ({ e: r.b.e })).aggregate(g => ({ c: count(), m: max(g.b.e), l: max(g.b.lcs) })).orderBy(r => r.e.desc().nullsFirst()).ir,
    { label: 'aggregate argument reads the key column (max(b.e) beside key e)', ordered: true, converted: 1, oracle: `SELECT b.e AS e, count(), max(b.e), max(b.lcs) ${W} GROUP BY b.e ORDER BY e DESC NULLS FIRST ${J}` });
  await agree(ck().groupBy(r => ({ k: r.b.lcs })).aggregate(() => ({ c: count() })).where(r => r.k.ne('zz')).orderBy(r => r.k.desc()).ir,
    { label: 'alias k differs from column; HAVING k, ORDER BY k', ordered: true, converted: 1, oracle: `SELECT b.lcs AS k, count() ${W} GROUP BY k HAVING k != 'zz' ORDER BY k DESC ${J}` });
  await agree(ck().groupBy(r => ({ bid: r.b.id, j: r.b.id.ifNull(0) })).aggregate(() => ({ c: count() })).where(r => r.j.gt(0)).orderBy(r => r.bid).thenBy(r => r.j.desc()).ir,
    { label: 'two keys over one column, wrapped and unwrapped', ordered: true, converted: 1, oracle: `SELECT b.id AS bid, ifNull(b.id, 0) AS j, count() ${W} GROUP BY bid, j HAVING j > 0 ORDER BY bid, j DESC ${J}` });
  await agree(cb().groupBy(r => ({ s: (r.b.id as any).plus(r.b.n) })).aggregate(g => ({ c: count(), t: sum(g.b.n) })).where(r => r.s.gt(0n)).orderBy(r => r.t.desc()).thenBy(r => r.s).ir,
    { label: 'compound key over two converted columns; ORDER BY aggregate alias beside it', ordered: true, converted: 1, oracle: `SELECT b.id + b.n AS s, count(), sum(b.n) AS t ${WB} GROUP BY s HAVING s > 0 ORDER BY t DESC, s ${J}` });
  await agree(ck().groupBy(r => ({ e: r.b.e, lcs: r.b.lcs })).aggregate(() => ({ c: count() })).map(r => ({ e: r.e, lcs: r.lcs })).distinct().ir,
    { label: 'DISTINCT over the aggregate block', converted: 1, oracle: `SELECT DISTINCT e, lcs FROM (SELECT b.e AS e, b.lcs AS lcs, count() ${W} GROUP BY e, lcs) ${J}` });
  const shared = ck().groupBy(r => ({ lcs: r.b.lcs })).aggregate(g => ({ c: count(), m: max(g.b.fs) })).cte();
  await agree(unionAll(shared, shared.where(r => r.lcs.ne('l1'))).ir, { label: 'aggregate over a converted join as a CTE consumed twice', converted: 1, oracle: `SELECT * FROM (SELECT b.lcs AS lcs, count(), max(b.fs) ${W} GROUP BY lcs) UNION ALL SELECT * FROM (SELECT b.lcs AS lcs, count(), max(b.fs) ${W} GROUP BY lcs) WHERE lcs != 'l1' ${J}` });
  await agree(ck().aggregate(g => ({ c: count(), m: max(g.b.e), d: sum(g.b.d) })).ir, { label: 'global aggregate', converted: 1, oracle: `SELECT count(), max(b.e), sum(b.d) ${W} ${J}` });
  await agree(ck().groupBy(r => ({ s: r.a.s, e: r.b.e })).aggregate(() => ({ c: count() })).where(r => r.s.ne('q')).orderBy(r => r.s).thenBy(r => r.e).ir,
    { label: 'preserved-side key (never wrapped) beside a wrapped key', ordered: true, converted: 1, oracle: `SELECT a.s AS s, b.e AS e, count() ${W} GROUP BY s, e HAVING s != 'q' ORDER BY s, e ${J}` });
  // Key alias `id` equals a column of BOTH inputs (a.id, b.id). Under prefer_column_name_to_alias = 1 `ORDER BY id` bound a
  // column, not the grouped b.id: 215. The unconverted LEFT twin failed identically: the 4c class (key alias = another
  // input's column). 4c: FIXED, flipped. An identity read of a name another input also carries is not exempt when HAVING
  // or ORDER BY names it, so both twins read the join block as a derived table and agree with naive in every cell.
  const shape = (q: ReturnType<typeof lk>) => q.groupBy(r => ({ id: r.b.id })).aggregate(g => ({ c: count(), id2: max(g.b.id) })).orderBy(r => r.id);
  const conv = shape(ck()), left = shape(lk().where(r => r.b.id.isNull().or(r.b.id.gt(0))));
  expect([rewriteRel(conv.ir).hits.LeftToInner, rewriteRel(left.ir).hits.LeftToInner]).toEqual([1, 0]);
  expect(compile(conv.ir).sql).toMatch(/toNullable\(`b`\.`id`\) AS `__typedhouse_leaf_\d+`[^]*\) AS `__typedhouse_input` GROUP BY `__typedhouse_input`\.`__typedhouse_leaf_\d+` ORDER BY `id`/);
  for (const q of [conv, left]) {
    const c = compile(q.ir), n = emitNaive(q.ir);
    for (const alias of [0, 1]) expect((await execute(c.sql, c.params, { prefer_column_name_to_alias: alias }, true)).error, `4c id ${alias}`).toBeUndefined();
    expect((await execute(n.sql, n.params, { prefer_column_name_to_alias: 1 })).error).toBeUndefined();
  }
  await agree(conv.ir, { label: '4c: key alias id = b.id beside a.id, ORDER BY id (converted)', ordered: true, converted: 1, oracle: `SELECT b.id AS bid, count(), max(b.id) ${W} GROUP BY b.id ORDER BY bid ${J}` });
  await agree(left.ir, { label: '4c: key alias id = b.id beside a.id, ORDER BY id (LEFT)', ordered: true, converted: 0, oracle: `SELECT b.id AS bid, count(), max(b.id) FROM qa a LEFT ALL JOIN qk b ON a.id = b.id WHERE b.id IS NULL OR b.id > 0 GROUP BY b.id ORDER BY bid ${J}` });
});
