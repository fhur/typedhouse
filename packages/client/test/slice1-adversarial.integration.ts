import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, crossJoin, from, join, table, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';

// Tester native probes for slice 1: rows AND meta must agree between the optimizing and naive emissions under both
// prefer_column_name_to_alias settings, and with hand-written SQL where given; server failures must agree too.
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const adv = table('adv_native', { id: col.UInt32, n: col.Int64, small: col.UInt8, extra: col.Int32, text: col.Nullable(col.String), s: col.String, lc: col.LowCardinality(col.String), nn: col.Nullable(col.Int64) }, meta);
const other = table('adv_native2', { id: col.UInt32, k: col.Int64 }, meta);
const q = from(adv), q2 = from(other);
let container: StartedTestContainer;
let url: string;
interface Result { meta: { name: string; type: string }[]; data: Record<string, unknown>[] }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, preferColumn: 0 | 1 = 0): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  endpoint.searchParams.set('prefer_column_name_to_alias', String(preferColumn));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${sql} FORMAT JSON` });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  const json = JSON.parse(text) as Result;
  const sorted = [...json.data].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return { meta: json.meta, data: sorted };
}
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  const raw = async (sql: string) => { const r = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: sql }); if (!r.ok) throw new Error(await r.text()); };
  await raw('CREATE TABLE adv_native (id UInt32, n Int64, small UInt8, extra Int32, text Nullable(String), s String, lc LowCardinality(String), nn Nullable(Int64)) ENGINE=Memory');
  await raw("INSERT INTO adv_native VALUES (1, 9223372036854775807, 255, 1, 'a', '7', 'x', 1), (2, -5, 1, 2, NULL, 'x', 'y', NULL), (3, 0, 200, 3, 'b', '8', 'x', -3), (4, 10, 0, 4, '', 'notnum', 'z', 5), (2, -5, 1, 2, NULL, 'x', 'y', NULL)");
  await raw('CREATE TABLE adv_native2 (id UInt32, k Int64) ENGINE=Memory');
  await raw('INSERT INTO adv_native2 VALUES (1, 1), (2, 9), (3, 2), (3, 2), (5, 0)');
}, 120000);
afterAll(async () => { await container?.stop(); });

/** Four executions (two emitters x two alias settings) must be identical in meta and data; optional oracle SQL. */
async function agree(root: Rel, oracle?: string, expectedRules: Partial<Record<string, number>> = {}) {
  const optimized = compile(root), naive = emitNaive(root);
  const hits = rewriteRel(root).hits;
  for (const [rule, n] of Object.entries(expectedRules)) expect(hits[rule as keyof typeof hits], rule).toBe(n);
  const first = await execute(optimized.sql, optimized.params, 0);
  const context = JSON.stringify({ optimized: optimized.sql, naive: naive.sql });
  for (const [plan, setting] of [[optimized, 1], [naive, 0], [naive, 1]] as const) expect(await execute(plan.sql, plan.params, setting), context).toEqual(first);
  if (oracle) expect(first, context).toEqual(await execute(oracle));
  expect(first.data.length, context).toBeGreaterThan(0);
  return first;
}
/** Same server outcome for both emitters: identical rows, or identical failure class. */
async function sameOutcome(root: Rel) {
  const optimized = compile(root), naive = emitNaive(root);
  const outcomes: string[] = [];
  for (const plan of [optimized, naive]) for (const setting of [0, 1] as const) {
    outcomes.push(await execute(plan.sql, plan.params, setting).then(r => JSON.stringify(r), e => `error:${/Code: (\d+)/.exec(String(e))?.[1] ?? String(e)}`));
  }
  expect(new Set(outcomes).size, JSON.stringify({ optimized: optimized.sql, naive: naive.sql, outcomes })).toBe(1);
  return outcomes[0]!;
}

it('alias shadowing (pruned and read columns, swap) is identical under both alias settings and matches hand SQL', async () => {
  const k = val(1n, col.Int64);
  const pruned = q.map(r => ({ a: r.n.plus(k) })).map(r => ({ extra: r.a })).where(r => r.extra.gt(1n));
  const r1 = await agree(pruned.ir, 'SELECT t.n + 1 AS extra FROM (SELECT n FROM adv_native) AS t WHERE t.n + 1 > 1', { MergeProject: 1, PushFilterProject: 1 });
  expect(r1.meta).toEqual([{ name: 'extra', type: 'Int64' }]);
  expect(r1.data).toEqual([{ extra: '11' }]); // n=9223372036854775807 wraps negative; n=0 gives 1 (not > 1); n=10 gives 11
  const same = q.map(r => ({ n: r.n.plus(k) })).where(r => r.n.gt(1n));
  expect((await agree(same.ir, 'SELECT t.n + 1 AS n FROM (SELECT n FROM adv_native) AS t WHERE t.n + 1 > 1')).data).toEqual([{ n: '11' }]);
  const swap = q.map(r => ({ id: r.n, n: r.id })).where(r => r.id.gt(1n));
  const r3 = await agree(swap.ir, 'SELECT t.n AS id, t.id AS n FROM (SELECT id, n FROM adv_native) AS t WHERE t.n > 1');
  expect(r3.data).toEqual([{ id: '10', n: 4 }, { id: '9223372036854775807', n: 1 }]);
  const chain = q.map(r => ({ a: r.id, b: r.n })).map(r => ({ a: r.b, b: r.a })).map(r => ({ a: r.b, b: r.a })).where(r => r.a.gt(1));
  const r4 = await agree(chain.ir, 'SELECT t.id AS a, t.n AS b FROM (SELECT id, n FROM adv_native) AS t WHERE t.id > 1', { MergeProject: 2, PushFilterProject: 1 });
  expect(r4.data).toHaveLength(4);
  const shadowRead = q.map(r => ({ id: r.n.plus(k), n: r.id })).map(r => ({ x: r.id, y: r.n })).where(r => r.x.gt(1n).and(r.y.lt(10)));
  await agree(shadowRead.ir, 'SELECT t.n + 1 AS x, t.id AS y FROM (SELECT id, n FROM adv_native) AS t WHERE t.n + 1 > 1 AND t.id < 10');
});

it('integer wrap, UInt8 widening, Nullable arithmetic, ifNull and LowCardinality keep rows and meta types', async () => {
  const k = val(1n, col.Int64);
  const wrap = q.map(r => ({ t: r.n.plus(k) })).map(r => ({ u: r.t.plus(k) })).where(r => r.u.lt(0n));
  const r1 = await agree(wrap.ir, 'SELECT t.n + 1 + 1 AS u FROM (SELECT n FROM adv_native) AS t WHERE t.n + 1 + 1 < 0');
  expect(r1.data).toEqual([{ u: '-3' }, { u: '-3' }, { u: '-9223372036854775807' }]);
  const widen = q.map(r => ({ w: r.small.plus(r.small), id: r.id })).where(r => r.w.gt(255));
  const r2 = await agree(widen.ir, 'SELECT t.small + t.small AS w, t.id AS id FROM (SELECT small, id FROM adv_native) AS t WHERE t.small + t.small > 255');
  expect(r2.meta).toEqual([{ name: 'w', type: 'UInt16' }, { name: 'id', type: 'UInt32' }]);
  expect(r2.data).toEqual([{ w: 400, id: 3 }, { w: 510, id: 1 }]);
  const mul = q.map(r => ({ m: r.n.multiply(r.n) })).where(r => r.m.lt(0n).or(r.m.eq(25n)));
  await agree(mul.ir, 'SELECT t.n * t.n AS m FROM (SELECT n FROM adv_native) AS t WHERE t.n * t.n < 0 OR t.n * t.n = 25');
  const nullable = q.map(r => ({ m: r.nn.plus(k), id: r.id })).map(r => ({ m2: r.m.minus(k), id: r.id })).where(r => r.m2.ge(0n));
  const r3 = await agree(nullable.ir, 'SELECT t.nn + 1 - 1 AS m2, t.id AS id FROM (SELECT nn, id FROM adv_native) AS t WHERE t.nn + 1 - 1 >= 0', { MergeProject: 1, PushFilterProject: 1 });
  expect(r3.meta[0]).toEqual({ name: 'm2', type: 'Nullable(Int64)' });
  expect(r3.data).toEqual([{ m2: '1', id: 1 }, { m2: '5', id: 4 }]);
  const labels = q.map(r => ({ label: r.text.ifNull(r.lc), lc: r.lc, id: r.id })).map(r => ({ l: r.label, lc: r.lc, id: r.id })).where(r => r.l.eq('x').or(r.lc.eq('x')));
  const r4 = await agree(labels.ir, "SELECT ifNull(t.text, t.lc) AS l, t.lc AS lc, t.id AS id FROM (SELECT text, lc, id FROM adv_native) AS t WHERE ifNull(t.text, t.lc) = 'x' OR t.lc = 'x'", { MergeProject: 1, PushFilterProject: 1 });
  expect(r4.meta).toEqual([{ name: 'l', type: 'String' }, { name: 'lc', type: 'LowCardinality(String)' }, { name: 'id', type: 'UInt32' }]);
  expect(r4.data).toEqual([{ l: 'a', lc: 'x', id: 1 }, { l: 'b', lc: 'x', id: 3 }]);
  const isNull = q.map(r => ({ gone: r.text.isNull(), id: r.id })).where(r => r.gone.eq(true));
  expect((await agree(isNull.ir, 'SELECT isNull(t.text) AS gone, t.id AS id FROM (SELECT text, id FROM adv_native) AS t WHERE isNull(t.text) = true')).data).toHaveLength(2);
});

it('house invariant natively: a dropped or duplicated cast keeps failing on both emitters; a surviving one filters identically', async () => {
  // ClickHouse 24.8 itself prunes unused subquery columns and pushes predicates into subqueries, so a dropped or
  // post-filtered CAST does not fail on the server for either emitter; the invariant is about the emitted text.
  const droppedCast = q.map(r => ({ id: r.id, bad: cast(r.s, col.UInt64) })).map(r => ({ id: r.id }));
  expect(rewriteRel(droppedCast.ir).hits.MergeProject).toBe(0);
  expect(compile(droppedCast.ir).sql).toContain('CAST(');
  await sameOutcome(droppedCast.ir);
  const filteredCast = q.map(r => ({ id: r.id, bad: cast(r.s, col.UInt64) })).where(r => r.id.lt(4));
  expect(rewriteRel(filteredCast.ir).hits.PushFilterProject).toBe(0);
  expect(compile(filteredCast.ir).sql).toContain('CAST(');
  await sameOutcome(filteredCast.ir);
  // A cast in the final select list on a row that cannot parse fails on both.
  const finalCast = q.map(r => ({ id: r.id, bad: cast(r.s, col.UInt64) }));
  expect(await sameOutcome(finalCast.ir)).toMatch(/^error:/);
  const duplicated = q.where(r => r.id.eq(1).or(r.id.eq(3))).map(r => ({ c: cast(r.s, col.UInt64) })).map(r => ({ a: r.c, b: r.c }));
  const r1 = await agree(duplicated.ir, 'SELECT CAST(t.s AS UInt64) AS a, CAST(t.s AS UInt64) AS b FROM (SELECT s, id FROM adv_native) AS t WHERE t.id = 1 OR t.id = 3', { MergeProject: 1 });
  expect(r1.data).toEqual([{ a: '7', b: '7' }, { a: '8', b: '8' }]);
  const divideZero = q.map(r => ({ id: r.id, ratio: r.n.divide(val(0n, col.Int64)) })).map(r => ({ id: r.id }));
  expect(rewriteRel(divideZero.ir).hits.MergeProject).toBe(0);
  await agree(divideZero.ir, 'SELECT t.id AS id FROM (SELECT id FROM adv_native) AS t');
});

it('nested-input selections over a join, shared diamonds and shared Params agree natively', async () => {
  const k = val(1n, col.Int64);
  const joined = join({ a: q, b: q2 }).on(r => r.a.id.eq(r.b.id));
  const nested = joined.map(r => ({ ...r.a, k: r.b.k })).map(r => ({ id: r.id, n2: r.n.plus(k), k: r.k })).where(r => r.n2.lt(5n).and(r.k.lt(3n)));
  const r1 = await agree(nested.ir, 'SELECT a.id AS id, a.n + 1 AS n2, b.k AS k FROM adv_native AS a INNER JOIN adv_native2 AS b ON a.id = b.id WHERE a.n + 1 < 5 AND b.k < 3', { MergeProject: 1, PushFilterProject: 1, PushFilterJoin: 0 });
  expect(r1.data).toEqual([{ id: 1, n2: '-9223372036854775808', k: '1' }, { id: 3, n2: '1', k: '2' }, { id: 3, n2: '1', k: '2' }]);
  const shared = q.map(r => ({ id: r.id, total: r.n.plus(k) }));
  const diamond = crossJoin({ a: shared.where(r => r.total.gt(5n)), b: shared.map(r => ({ id: r.id })) }).map(r => ({ x: r.a.id, y: r.b.id, t: r.a.total }));
  const r2 = await agree(diamond.ir, 'SELECT a.id AS x, b.id AS y, a.total AS t FROM (SELECT t.id AS id, t.n + 1 AS total FROM (SELECT id, n FROM adv_native) AS t WHERE t.n + 1 > 5) AS a CROSS JOIN (SELECT id FROM adv_native) AS b', { MergeProject: 1, PushFilterProject: 1 });
  expect(r2.data).toHaveLength(5);
  const twoParents = crossJoin({ a: shared.map(r => ({ id: r.id })), b: shared.map(r => ({ total: r.total })) }).map(r => ({ x: r.a.id, t: r.b.total }));
  expect(compile(twoParents.ir).sql).toContain('WITH `t0` AS');
  expect((await agree(twoParents.ir, 'SELECT a.id AS x, b.total AS t FROM (SELECT id FROM adv_native) AS a CROSS JOIN (SELECT n + 1 AS total FROM adv_native) AS b', { MergeProject: 0 })).data).toHaveLength(25);
  const p = val(1, col.UInt32);
  const sharedParam = q.map(r => ({ a: r.id.plus(p), b: r.id.plus(p) })).map(r => ({ s: r.a.plus(r.b), t: r.a })).where(r => r.s.gt(4n)); // a typed UInt32 Param against the UInt64 sum would be rejected as a width coercion
  const plan = compile(sharedParam.ir);
  expect(Object.keys(plan.params)).toEqual(['p0', 'p1']);
  const r3 = await agree(sharedParam.ir, 'SELECT t.id + 1 + (t.id + 1) AS s, t.id + 1 AS t FROM (SELECT id FROM adv_native) AS t WHERE t.id + 1 + (t.id + 1) > 4', { MergeProject: 1, PushFilterProject: 1 });
  expect(r3.data.map(d => d.t).sort()).toEqual(['3', '3', '4', '5']);
});
