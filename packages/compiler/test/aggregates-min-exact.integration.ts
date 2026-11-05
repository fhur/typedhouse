import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClickHouseBackend, createClient, createClientFromBackend, rowDecoder } from '@typedhouse/client';
import { argMaxIf, argMin, argMinIf, avgIf, col, count, countIf, from, leftJoin, max, maxIf, min, minIf, print, quantile, quantileExact, quantileExactIf, quantileIf, sumIf, table, type Query } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const settings = 'date_time_output_format=iso&output_format_json_quote_64bit_integers=1&output_format_json_quote_denormals=1&output_format_json_quote_decimals=1';
let container: StartedTestContainer;
let optimized: ReturnType<typeof createClient>;
let naive: ReturnType<typeof createClientFromBackend>;
let closeNaive: () => Promise<void>;
let url: string;

async function post(body: string, params: Readonly<Record<string, string>> = {}, extra = '') {
  const endpoint = new URL(`${url}/?${settings}${extra}`);
  for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(`param_${name}`, value);
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text;
}
const json = async (body: string, params?: Readonly<Record<string, string>>, extra?: string) => JSON.parse(await post(`${body} FORMAT JSON`, params, extra)) as { meta: { name: string; type: string }[]; data: unknown[] };

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  const options = { url, username: 'fixture', password: 'fixture' };
  optimized = createClient(options);
  const backend = createClickHouseBackend(options, 'clickhouse-naive');
  naive = createClientFromBackend(backend);
  closeNaive = backend.close;
}, 120000);
afterAll(async () => { await optimized?.close(); await closeNaive?.(); await container?.stop(); });

/** One result, five ways: run and stream on both emitters, and handwritten SQL through the same decoders. Declared types must equal the server's. */
async function verify(query: Query<Record<string, unknown>, never>, handwritten: string, expected: readonly Record<string, unknown>[]) {
  for (const client of [optimized, naive]) {
    expect(await client.run(query as never)).toEqual(expected);
    const rows: unknown[] = [];
    for await (const row of client.stream(query as never)) rows.push(row);
    expect(rows).toEqual(expected);
  }
  const compiled = compile(query.ir);
  const declared = Object.entries(compiled.columns).map(([name, type]) => ({ name, type: print(type) }));
  for (const plan of [compiled, emitNaive(query.ir)]) {
    expect((await json(plan.sql, plan.params)).meta).toEqual(declared);
  }
  // Handwritten SQL reuses column names as aliases, as the typed queries' output names do.
  const direct = await json(handwritten, {}, '&prefer_column_name_to_alias=1');
  expect(direct.meta).toEqual(declared);
  expect(direct.data.map(rowDecoder(compiled.columns))).toEqual(expected);
}
const q = <T>(query: T) => query as unknown as Query<Record<string, unknown>, never>;

const epoch = new Date(0);

it('min and minIf over every probed type: values, empty groups and no qualifying rows', async () => {
  await post("CREATE TABLE m1 (id UInt32, u32 UInt32, u64 UInt64, s String, lc LowCardinality(String), d Date, nu Nullable(UInt32), ns Nullable(String), allNull Nullable(UInt32), ok Bool) ENGINE=Memory");
  await post("INSERT INTO m1 VALUES (1,5,18446744073709551615,'b','y','2026-01-02',7,'q',NULL,false),(2,3,9007199254740993,'a','x','2026-01-01',NULL,NULL,NULL,true),(3,4,18446744073709551614,'c','z','2026-01-03',2,'p',NULL,true)");
  const m1 = from(table('m1', { id: col.UInt32, u32: col.UInt32, u64: col.UInt64, s: col.String, lc: col.LowCardinality(col.String), d: col.Date, nu: col.Nullable(col.UInt32), ns: col.Nullable(col.String), allNull: col.Nullable(col.UInt32), ok: col.Bool }, meta));
  const select = 'min(u32) AS u32,min(u64) AS u64,min(s) AS s,min(lc) AS lc,min(d) AS d,min(nu) AS nu,min(ns) AS ns,min(allNull) AS allNull';
  const none = m1.where(r => r.id.gt(99));
  const build = (source: typeof none) => source.aggregate(g => ({ u32: min(g.u32), u64: min(g.u64), s: min(g.s), lc: min(g.lc), d: min(g.d), nu: min(g.nu), ns: min(g.ns), allNull: min(g.allNull) }));
  await verify(q(build(m1 as unknown as typeof none)), `SELECT ${select} FROM m1`, [{ u32: 3, u64: 9007199254740993n, s: 'a', lc: 'x', d: new Date('2026-01-01'), nu: 2, ns: 'p', allNull: null }]);
  await verify(q(build(none)), `SELECT ${select} FROM m1 WHERE id > 99`, [{ u32: 0, u64: 0n, s: '', lc: '', d: epoch, nu: null, ns: null, allNull: null }]);
  const ifSelect = 'minIf(u32,ok) AS u32,minIf(s,ok) AS s,minIf(d,ok) AS d,minIf(nu,ok) AS nu,minIf(u32,id>99) AS noneU32,minIf(s,id>99) AS noneS,minIf(d,id>99) AS noneD,minIf(nu,id>99) AS noneN';
  await verify(q(m1.aggregate(g => ({ u32: minIf(g.u32, g.ok), s: minIf(g.s, g.ok), d: minIf(g.d, g.ok), nu: minIf(g.nu, g.ok), noneU32: minIf(g.u32, g.id.gt(99)), noneS: minIf(g.s, g.id.gt(99)), noneD: minIf(g.d, g.id.gt(99)), noneN: minIf(g.nu, g.id.gt(99)) }))), `SELECT ${ifSelect} FROM m1`, [{ u32: 3, s: 'a', d: new Date('2026-01-01'), nu: 2, noneU32: 0, noneS: '', noneD: epoch, noneN: null }]);
});

it('min over NaN within one block: NaN when the first row is NaN, otherwise skipped', async () => {
  await post('CREATE TABLE m2 (id UInt32, g UInt32, f Float64) ENGINE=Memory');
  await post('INSERT INTO m2 VALUES (1,1,nan),(2,1,2),(3,1,1),(4,2,3),(5,2,nan),(6,2,1)');
  const m2 = from(table('m2', { id: col.UInt32, g: col.UInt32, f: col.Float64 }, meta));
  await verify(q(m2.where(r => r.g.eq(1)).aggregate(g => ({ low: min(g.f) }))), 'SELECT min(f) AS low FROM m2 WHERE g = 1', [{ low: NaN }]);
  await verify(q(m2.where(r => r.g.eq(2)).aggregate(g => ({ low: min(g.f) }))), 'SELECT min(f) AS low FROM m2 WHERE g = 2', [{ low: 1 }]);
});

it('argMin and argMinIf: value types, NULL at the extreme, empty and no qualifying rows', async () => {
  await post("CREATE TABLE a1 (id UInt32, s String, n Nullable(UInt32), f Float32, b Bool, version UInt64, ok Bool, maybe Nullable(UInt32)) ENGINE=Memory");
  await post("INSERT INTO a1 VALUES (1,'mid',20,2.5,false,18446744073709551615,true,1),(2,'low',NULL,1.5,true,9007199254740993,false,NULL),(3,'high',30,3.5,false,18446744073709551614,true,100)");
  const a1 = from(table('a1', { id: col.UInt32, s: col.String, n: col.Nullable(col.UInt32), f: col.Float32, b: col.Bool, version: col.UInt64, ok: col.Bool, maybe: col.Nullable(col.UInt32) }, meta));
  // Row 2 holds the smallest version with a NULL `n`: argMin skips it and moves to the next version.
  await verify(q(a1.aggregate(g => ({ s: argMin(g.s, g.version), n: argMin(g.n, g.version), f: argMin(g.f, g.version), b: argMin(g.b, g.version) }))), 'SELECT argMin(s,version) AS s,argMin(n,version) AS n,argMin(f,version) AS f,argMin(b,version) AS b FROM a1', [{ s: 'low', n: 30, f: 1.5, b: true }]);
  await verify(q(a1.where(r => r.id.gt(99)).aggregate(g => ({ s: argMin(g.s, g.version), n: argMin(g.n, g.version), f: argMin(g.f, g.version), b: argMin(g.b, g.version) }))), 'SELECT argMin(s,version) AS s,argMin(n,version) AS n,argMin(f,version) AS f,argMin(b,version) AS b FROM a1 WHERE id > 99', [{ s: '', n: null, f: 0, b: false }]);
  await verify(q(a1.aggregate(g => ({ s: argMinIf(g.s, g.version, g.ok), n: argMinIf(g.n, g.version, g.ok), noneS: argMinIf(g.s, g.version, g.id.gt(99)), noneN: argMinIf(g.n, g.version, g.id.gt(99)), nullPredicate: argMinIf(g.s, g.version, g.maybe.lt(10)) }))), 'SELECT argMinIf(s,version,ok) AS s,argMinIf(n,version,ok) AS n,argMinIf(s,version,id>99) AS noneS,argMinIf(n,version,id>99) AS noneN,argMinIf(s,version,maybe<10) AS nullPredicate FROM a1', [{ s: 'high', n: 30, noneS: '', noneN: null, nullPredicate: 'mid' }]);
});

it('argMin picks the earliest value by all four date versions, including pre-1970', async () => {
  await post("CREATE TABLE a2 (id UInt32, value Float64, d Date, d32 Date32, dt DateTime('UTC'), dt64 DateTime64(3,'UTC')) ENGINE=Memory");
  // The least version is neither the first row inserted nor the least value, and Date32/DateTime64 cross 1970.
  await post("INSERT INTO a2 VALUES (1,40,'2026-01-02','1955-01-01','2026-01-01 00:00:01','1969-12-31 23:59:59.998'),(1,38.5,'2026-01-01','1950-01-01','2026-01-01 00:00:00','1969-12-31 23:59:59.997'),(1,10,'2026-01-03','1960-01-01','2026-01-01 00:00:02','1969-12-31 23:59:59.999')");
  const a2 = from(table('a2', { id: col.UInt32, value: col.Float64, d: col.Date, d32: col.Date32, dt: col.DateTime('UTC'), dt64: col.DateTime64(3, 'UTC') }, meta));
  await verify(q(a2.groupBy(r => r.id).aggregate(g => ({ d: argMin(g.value, g.d), d32: argMin(g.value, g.d32), dt: argMin(g.value, g.dt), dt64: argMin(g.value, g.dt64), conditional: argMinIf(g.value, g.d, g.value.lt(39)) }))), 'SELECT id,argMin(value,d) AS d,argMin(value,d32) AS d32,argMin(value,dt) AS dt,argMin(value,dt64) AS dt64,argMinIf(value,d,value<39) AS conditional FROM a2 GROUP BY id', [{ id: 1, d: 38.5, d32: 38.5, dt: 38.5, dt64: 38.5, conditional: 38.5 }]);
});

it('argMin over a NaN first version returns the value default', async () => {
  await post('CREATE TABLE a3 (id UInt32, s String, v Float64) ENGINE=Memory');
  await post("INSERT INTO a3 VALUES (1,'first',nan),(2,'second',2),(3,'third',1)");
  const a3 = from(table('a3', { id: col.UInt32, s: col.String, v: col.Float64 }, meta));
  await verify(q(a3.aggregate(g => ({ s: argMin(g.s, g.v) }))), 'SELECT argMin(s,v) AS s FROM a3', [{ s: '' }]);
});

it('quantileExact picks an element and quantile interpolates over [1,2,3,4]', async () => {
  await post('CREATE TABLE q1 (v UInt32) ENGINE=Memory');
  await post('INSERT INTO q1 VALUES (1),(2),(3),(4)');
  const q1 = from(table('q1', { v: col.UInt32 }, meta));
  await verify(q(q1.aggregate(g => ({ exact: quantileExact(0.5)(g.v), approx: quantile(0.5)(g.v) }))), 'SELECT quantileExact(0.5)(v) AS exact,quantile(0.5)(v) AS approx FROM q1', [{ exact: 3, approx: 2.5 }]);
  await verify(q(q1.aggregate(g => ({ low: quantileExact(0)(g.v), high: quantileExact(1)(g.v), conditional: quantileExactIf(0.5)(g.v, g.v.lt(4)) }))), 'SELECT quantileExact(0)(v) AS low,quantileExact(1)(v) AS high,quantileExactIf(0.5)(v,v<4) AS conditional FROM q1', [{ low: 1, high: 4, conditional: 2 }]);
});

it('quantileExact keeps integers above 2^53 and the input result type', async () => {
  await post('CREATE TABLE q2 (u64 UInt64, i128 Int128, f32 Float32, nu Nullable(UInt32), nu64 Nullable(UInt64)) ENGINE=Memory');
  await post("INSERT INTO q2 VALUES (9007199254740993,-170141183460469231731687303715884105727,1.5,1,9007199254740993),(9007199254740995,170141183460469231731687303715884105727,2.5,NULL,NULL),(9007199254740997,170141183460469231731687303715884105725,3.5,5,9007199254740997)");
  const q2 = from(table('q2', { u64: col.UInt64, i128: col.Int128, f32: col.Float32, nu: col.Nullable(col.UInt32), nu64: col.Nullable(col.UInt64) }, meta));
  await verify(q(q2.aggregate(g => ({ u64: quantileExact(0.5)(g.u64), i128: quantileExact(1)(g.i128), f32: quantileExact(0.5)(g.f32), nu: quantileExact(1)(g.nu), nu64: quantileExact(1)(g.nu64) }))), 'SELECT quantileExact(0.5)(u64) AS u64,quantileExact(1)(i128) AS i128,quantileExact(0.5)(f32) AS f32,quantileExact(1)(nu) AS nu,quantileExact(1)(nu64) AS nu64 FROM q2', [{ u64: 9007199254740995n, i128: 170141183460469231731687303715884105727n, f32: 2.5, nu: 5, nu64: 9007199254740997n }]);
});

it('quantileExact and quantileExactIf: empty, all-NULL, NaN and NULL predicates', async () => {
  await post('CREATE TABLE q3 (id UInt32, u UInt32, f Float64, nf Float64, nu Nullable(UInt32), allNull Nullable(Float64), maybe Nullable(UInt32)) ENGINE=Memory');
  await post('INSERT INTO q3 VALUES (1,1,nan,nan,NULL,NULL,1),(2,2,1,nan,NULL,NULL,NULL),(3,3,2,nan,7,NULL,100)');
  const q3 = from(table('q3', { id: col.UInt32, u: col.UInt32, f: col.Float64, nf: col.Float64, nu: col.Nullable(col.UInt32), allNull: col.Nullable(col.Float64), maybe: col.Nullable(col.UInt32) }, meta));
  const select = 'quantileExact(0.5)(u) AS u,quantileExact(0.5)(f) AS f,quantileExact(0.5)(nu) AS nu,quantileExact(0.5)(allNull) AS allNull';
  const none = q3.where(r => r.id.gt(99));
  const build = (source: typeof none) => source.aggregate(g => ({ u: quantileExact(0.5)(g.u), f: quantileExact(0.5)(g.f), nu: quantileExact(0.5)(g.nu), allNull: quantileExact(0.5)(g.allNull) }));
  await verify(q(build(q3 as unknown as typeof none)), `SELECT ${select} FROM q3`, [{ u: 2, f: 2, nu: 7, allNull: null }]);
  await verify(q(build(none)), `SELECT ${select} FROM q3 WHERE id > 99`, [{ u: 0, f: NaN, nu: null, allNull: null }]);
  await verify(q(q3.aggregate(g => ({ allNaN: quantileExact(0.5)(g.nf) }))), 'SELECT quantileExact(0.5)(nf) AS allNaN FROM q3', [{ allNaN: NaN }]);
  await verify(q(q3.aggregate(g => ({ none: quantileExactIf(0.5)(g.u, g.id.gt(99)), noneF: quantileExactIf(0.5)(g.f, g.id.gt(99)), noneN: quantileExactIf(0.5)(g.nu, g.id.gt(99)), nullPredicate: quantileExactIf(0.5)(g.u, g.maybe.lt(10)) }))), 'SELECT quantileExactIf(0.5)(u,id>99) AS none,quantileExactIf(0.5)(f,id>99) AS noneF,quantileExactIf(0.5)(nu,id>99) AS noneN,quantileExactIf(0.5)(u,maybe<10) AS nullPredicate FROM q3', [{ none: 0, noneF: NaN, noneN: null, nullPredicate: 1 }]);
});

it('a key filter pushed below min and max returns the rows a naive plan returns', async () => {
  await post("CREATE TABLE r1 (k String, v UInt64) ENGINE=MergeTree ORDER BY k");
  await post("INSERT INTO r1 VALUES ('a',5),('a',3),('b',1),('b',9)");
  const r1 = from(table('r1', { k: col.String, v: col.UInt64 }, { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] }));
  await verify(q(r1.groupBy(r => ({ key: r.k })).aggregate(g => ({ low: min(g.v), high: max(g.v) })).where(r => r.key.eq('a'))), "SELECT k AS key,min(v) AS low,max(v) AS high FROM r1 WHERE k = 'a' GROUP BY k", [{ key: 'a', low: 3n, high: 5n }]);
});

// A4 reproduction: on these rows the unwrapped `maxIf(v, n < 10)` returns 100 on ClickHouse 24.8.
it('a NULL predicate excludes the row from minIf and maxIf for every value type', async () => {
  await post("CREATE TABLE p1 (id UInt32, n Nullable(UInt32), stored Nullable(Bool), u32 UInt32, u64 UInt64, f64 Float64, d Date, dt DateTime('UTC'), i128 Int128, dec Decimal64(2), dt64 DateTime64(3,'UTC'), s String, fs FixedString(1), arr Array(UInt32), nv Nullable(UInt32)) ENGINE=Memory");
  await post("INSERT INTO p1 VALUES (1,1,true,2,2,2,'2026-01-02','2026-01-02 00:00:00',2,2,'2026-01-02 00:00:00.000','b','b',[2],2),(2,NULL,NULL,100,100,100,'2026-12-31','2026-12-31 00:00:00',100,100,'2026-12-31 00:00:00.000','z','z',[100],100),(3,NULL,NULL,1,1,1,'2026-01-01','2026-01-01 00:00:00',1,1,'2026-01-01 00:00:00.000','a','a',[1],1)");
  const p1 = from(table('p1', { id: col.UInt32, n: col.Nullable(col.UInt32), stored: col.Nullable(col.Bool), u32: col.UInt32, u64: col.UInt64, f64: col.Float64, d: col.Date, dt: col.DateTime('UTC'), i128: col.Int128, dec: col.Decimal64(2), dt64: col.DateTime64(3, 'UTC'), s: col.String, fs: col.FixedString(1), arr: col.Array(col.UInt32), nv: col.Nullable(col.UInt32) }, meta));
  const values = ['u32', 'u64', 'f64', 'd', 'dt', 'i128', 'dec', 'dt64', 's', 'fs', 'arr', 'nv'] as const;
  const kept = { u32: 2, u64: 2n, f64: 2, d: new Date('2026-01-02'), dt: new Date('2026-01-02T00:00:00Z'), i128: 2n, dec: '2', dt64: new Date('2026-01-02T00:00:00Z'), s: 'b', fs: 'b', arr: [2], nv: 2 };
  for (const [fn, name] of [[maxIf, 'maxIf'], [minIf, 'minIf']] as const) {
    const aggregate = fn as typeof maxIf;
    const expected = Object.fromEntries(values.map(v => [v, kept[v]]));
    // Computed predicate, the owner's reproduction shape, and a stored Nullable(Bool).
    await verify(q(p1.aggregate(g => Object.fromEntries(values.map(v => [v, aggregate(g[v] as never, g.n.lt(10))])) as never)), `SELECT ${values.map(v => `${name}(${v},ifNull(n<10,false)) AS ${v}`).join(',')} FROM p1`, [expected]);
    await verify(q(p1.aggregate(g => Object.fromEntries(values.map(v => [v, aggregate(g[v] as never, g.stored)])) as never)), `SELECT ${values.map(v => `${name}(${v},ifNull(stored,false)) AS ${v}`).join(',')} FROM p1`, [expected]);
  }
  // A nullable predicate that is NULL on every row selects nothing.
  await verify(q(p1.where(r => r.id.gt(1)).aggregate(g => ({ high: maxIf(g.u32, g.n.lt(10)), low: minIf(g.u32, g.n.lt(10)) }))), 'SELECT maxIf(u32,ifNull(n<10,false)) AS high,minIf(u32,ifNull(n<10,false)) AS low FROM p1 WHERE id > 1', [{ high: 0, low: 0 }]);
});

it('the exact reproduction: maxIf(v, n < 10) returns 2, and null-extended join columns exclude rows too', async () => {
  await post('CREATE TABLE p2 (v UInt32, n Nullable(UInt32)) ENGINE=Memory');
  await post('INSERT INTO p2 VALUES (2,1),(100,NULL)');
  const p2 = from(table('p2', { v: col.UInt32, n: col.Nullable(col.UInt32) }, meta));
  await verify(q(p2.aggregate(g => ({ high: maxIf(g.v, g.n.lt(10)) }))), 'SELECT maxIf(v,ifNull(n<10,false)) AS high FROM p2', [{ high: 2 }]);
  await post('CREATE TABLE p3 (id UInt32, v UInt32) ENGINE=Memory');
  await post('CREATE TABLE p4 (id UInt32, ok Bool) ENGINE=Memory');
  await post('INSERT INTO p3 VALUES (1,2),(2,100)');
  await post('INSERT INTO p4 VALUES (1,true)');
  const left = from(table('p3', { id: col.UInt32, v: col.UInt32 }, meta)), right = from(table('p4', { id: col.UInt32, ok: col.Bool }, meta));
  const joined = leftJoin({ a: left }, { b: right }).on(r => r.a.id.eq(r.b.id));
  await verify(q(joined.aggregate(g => ({ high: maxIf(g.a.v, g.b.ok) }))), 'SELECT maxIf(a.v,ifNull(b.ok,false)) AS high FROM p3 AS a LEFT JOIN p4 AS b ON a.id = b.id SETTINGS join_use_nulls = 1', [{ high: 2 }]);
});

it('other conditional aggregates exclude a NULL predicate without the wrapper', async () => {
  await post('CREATE TABLE p5 (v UInt32, n Nullable(UInt32)) ENGINE=Memory');
  await post('INSERT INTO p5 VALUES (2,1),(100,NULL)');
  const p5 = from(table('p5', { v: col.UInt32, n: col.Nullable(col.UInt32) }, meta));
  await verify(q(p5.aggregate(g => ({ c: countIf(g.n.lt(10)), s: sumIf(g.v, g.n.lt(10)), a: avgIf(g.v, g.n.lt(10)), am: argMaxIf(g.v, g.v, g.n.lt(10)), an: argMinIf(g.v, g.v, g.n.lt(10)), qi: quantileIf(0.5)(g.v, g.n.lt(10)), qe: quantileExactIf(0.5)(g.v, g.n.lt(10)), rows: count() }))), 'SELECT countIf(n<10) AS c,sumIf(v,n<10) AS s,avgIf(v,n<10) AS a,argMaxIf(v,v,n<10) AS am,argMinIf(v,v,n<10) AS an,quantileIf(0.5)(v,n<10) AS qi,quantileExactIf(0.5)(v,n<10) AS qe,count() AS rows FROM p5', [{ c: 1n, s: 2n, a: 2, am: 2, an: 2, qi: 2, qe: 2, rows: 2n }]);
});

