import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, exprNode, from, join, leftJoin, max, relNode, scalar, sql, sum, table, unionAll, val, type Expr, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient as createTypedClient, QueryError } from '../src/index.js';
import { collect, differential } from './backend-harness.js';
import { resultsContract, type QueryOutcome } from './results-contract.js';
import { flatten, parseExplainJson, readTable, structure } from '../../compiler/test/explain-corpus-support.js';

/** Track C9 Tester probes on clickhouse/clickhouse-server:24.8. Each query runs naive and optimized in every cell of
 * prefer_column_name_to_alias x optimize_move_to_prewhere, and is compared with a JavaScript oracle or handwritten SQL. */
const merge = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const t = table('pwa', { id: col.UInt32, cat: col.String, s: col.String, v: col.UInt32, n: col.Nullable(col.UInt32), ok: col.Nullable(col.Bool), tags: col.Array(col.String), a: col.UInt64, m: col.UInt64 }, merge);
const h = table('pwa_h', { id: col.UInt32, v: col.UInt32 }, { ...merge, hiddenColumns: ['a', 'm'] });
const u = table('pwa_u', { id: col.UInt32, w: col.String }, merge);
const rep = table('pwa_r', { id: col.UInt32, ver: col.UInt32, status: col.String }, { ...merge, engine: 'ReplacingMergeTree' });
const smp = table('pwa_s', { id: col.UInt32, h: col.UInt32, v: col.UInt32 }, { ...merge, sortingKey: ['h', 'id'] });
const srep = table('pwa_rs', { id: col.UInt32, h: col.UInt32, ver: col.UInt32, status: col.String }, { ...merge, engine: 'ReplacingMergeTree', sortingKey: ['h', 'id'] });
const flow = table('pwa_big', { id: col.UInt32, s: col.String }, merge);
const q = from(t);

interface Row { id: number; cat: string; s: string; v: number; n: number | null; ok: boolean | null; tags: string[]; a: bigint; m: bigint }
const rows: Row[] = Array.from({ length: 40 }, (_, i) => {
  const id = i + 1, v = (id * 7) % 17;
  return { id, cat: ['a', 'b', 'c'][i % 3]!, s: id % 13 === 0 ? 'bad' : String(id), v, n: id % 5 === 0 ? null : id % 4, ok: id % 6 === 0 ? null : id % 2 === 0, tags: id % 4 === 0 ? [] : [`t${id % 2}`, `x${id % 3}`], a: BigInt(v) + 1000n, m: BigInt(v) * 2n };
});
const uRows = rows.filter(r => r.id % 2 === 0).map(r => ({ id: r.id, w: r.id % 4 === 0 ? 'p' : 'q' }));
const wOf = (id: number) => uRows.find(x => x.id === id)?.w;

let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
let options: Parameters<typeof createClient>[0];
const cells: ReturnType<typeof createClickHouseBackend>[][] = [];

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { output_format_json_quote_64bit_integers: 1 } };
  driver = createClient(options);
  for (const prefer of [0, 1] as const) for (const move of [1, 0] as const) {
    cells.push((['clickhouse-naive', 'clickhouse'] as const).map(mode => createClickHouseBackend({ ...options, clickhouse_settings: { ...options!.clickhouse_settings, prefer_column_name_to_alias: prefer, optimize_move_to_prewhere: move } }, mode)));
  }
  const ddl = 'id UInt32, cat String, s String, v UInt32, n Nullable(UInt32), ok Nullable(Bool), tags Array(String), a UInt64 ALIAS v + 1000, m UInt64 MATERIALIZED v * 2';
  await driver.command({ query: `CREATE TABLE pwa (${ddl}) ENGINE=MergeTree ORDER BY id SETTINGS index_granularity=4` });
  await driver.command({ query: 'SYSTEM STOP MERGES pwa' });
  for (let part = 0; part < 4; part++) {
    const values = rows.filter(r => r.id % 4 === part).map(r => `(${r.id}, '${r.cat}', '${r.s}', ${r.v}, ${r.n ?? 'NULL'}, ${r.ok ?? 'NULL'}, [${r.tags.map(x => `'${x}'`).join(',')}])`);
    await driver.command({ query: `INSERT INTO pwa (id, cat, s, v, n, ok, tags) VALUES ${values.join(',')}` });
  }
  await driver.command({ query: 'CREATE TABLE pwa_h (id UInt32, v UInt32, a UInt64 ALIAS v + 1000, m UInt64 MATERIALIZED v * 2) ENGINE=MergeTree ORDER BY id' });
  await driver.command({ query: `INSERT INTO pwa_h (id, v) VALUES ${rows.map(r => `(${r.id}, ${r.v})`).join(',')}` });
  await driver.command({ query: 'CREATE TABLE pwa_u (id UInt32, w String) ENGINE=MergeTree ORDER BY id' });
  await driver.insert({ table: 'pwa_u', values: uRows, format: 'JSONEachRow' });
  await driver.command({ query: 'CREATE TABLE pwa_r (id UInt32, ver UInt32, status String) ENGINE=ReplacingMergeTree(ver) ORDER BY id' });
  await driver.command({ query: 'SYSTEM STOP MERGES pwa_r' });
  await driver.command({ query: "INSERT INTO pwa_r VALUES (1,1,'open'),(2,1,'open')" });
  await driver.command({ query: "INSERT INTO pwa_r VALUES (1,2,'closed')" });
  await driver.command({ query: 'CREATE TABLE pwa_s (id UInt32, h UInt32, v UInt32) ENGINE=MergeTree ORDER BY (h, id) SAMPLE BY h' });
  await driver.command({ query: 'INSERT INTO pwa_s SELECT number, cityHash64(number) % 4294967295, number % 10 FROM numbers(20000)' });
  await driver.command({ query: 'CREATE TABLE pwa_rs (id UInt32, h UInt32, ver UInt32, status String) ENGINE=ReplacingMergeTree(ver) ORDER BY (h, id) SAMPLE BY h' });
  await driver.command({ query: 'SYSTEM STOP MERGES pwa_rs' });
  await driver.command({ query: "INSERT INTO pwa_rs SELECT number, cityHash64(number) % 4294967295, 1, 'open' FROM numbers(5000)" });
  await driver.command({ query: "INSERT INTO pwa_rs SELECT number, cityHash64(number) % 4294967295, 2, if(number % 2 = 0, 'closed', 'open') FROM numbers(5000)" });
  await driver.command({ query: 'CREATE TABLE pwa_big (id UInt32, s String) ENGINE=MergeTree ORDER BY id' });
  await driver.command({ query: 'SYSTEM STOP MERGES pwa_big' });
  await driver.command({ query: 'INSERT INTO pwa_big SELECT number, toString(number) FROM numbers(100000)' });
  await driver.command({ query: "INSERT INTO pwa_big SELECT number + 100000, if(number = 50000, 'bad', toString(number)) FROM numbers(100000)" });
  for (const ddlEngine of ['Memory', 'Log', 'TinyLog']) {
    await driver.command({ query: `CREATE TABLE pwa_${ddlEngine.toLowerCase()} (id UInt32) ENGINE=${ddlEngine}` });
    await driver.command({ query: `INSERT INTO pwa_${ddlEngine.toLowerCase()} VALUES (1)` });
  }
  await driver.command({ query: 'CREATE VIEW pwa_view AS SELECT id, v FROM pwa' });
}, 180000);

afterAll(async () => {
  for (const b of cells.flat()) await b.close();
  await driver?.close();
  await container?.stop();
});

const prewheres = (text: string) => text.match(/PREWHERE/g)?.length ?? 0;
async function agree(query: { ir: Rel }, ordered: boolean, check?: (result: unknown[]) => void) {
  // Never silently dropped, on either path.
  expect(prewheres(compile(query.ir).sql), compile(query.ir).sql).toBeGreaterThan(0);
  expect(prewheres(emitNaive(query.ir).sql)).toBeGreaterThan(0);
  const first = await differential(cells[0]!, query, ordered);
  for (const cell of cells.slice(1)) {
    const rows = await differential(cell, query, ordered);
    if (ordered) expect(rows).toEqual(first);
  }
  check?.(first);
  return first;
}
const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
const ids = (result: readonly unknown[]) => (result as { id: number }[]).map(r => r.id);
async function native(query: string, settings: Record<string, string | number> = {}) {
  const result = await driver.query({ query, format: 'JSONEachRow', clickhouse_settings: settings as never });
  try { return await result.json<Record<string, unknown>>(); } finally { result.close(); }
}
const guard = q.prewhere(r => r.v.gt(5));
const kept = rows.filter(r => r.v > 5);
const key = (x: unknown) => JSON.stringify(x, (_, v: unknown) => typeof v === 'bigint' ? `${v}n` : v);
const bag = (xs: readonly unknown[]) => xs.map(key).sort();

describe('every shape keeps PREWHERE, with the rows a JavaScript oracle gives', () => {
  const cases: readonly (readonly [string, () => { ir: Rel }, () => readonly unknown[], boolean])[] = [
    ['bare', () => guard.map(r => ({ id: r.id })), () => kept.map(r => ({ id: r.id })), false],
    ['full row, with ALIAS and MATERIALIZED selected', () => guard.orderBy(r => r.id), () => kept, true],
    ['where above', () => guard.where(r => r.cat.eq('a')).orderBy(r => r.id).map(r => ({ id: r.id })), () => kept.filter(r => r.cat === 'a').map(r => ({ id: r.id })), false],
    ['two where above', () => guard.where(r => r.cat.eq('a')).where(r => r.id.gt(10)).map(r => ({ id: r.id })), () => kept.filter(r => r.cat === 'a' && r.id > 10).map(r => ({ id: r.id })), false],
    ['where on the column it reads', () => guard.where(r => r.v.lt(9)).map(r => ({ id: r.id })), () => rows.filter(r => r.v > 5 && r.v < 9).map(r => ({ id: r.id })), false],
    ['the predicate column is read only by the predicate', () => q.prewhere(r => r.tags.notEmpty()).map(r => ({ id: r.id })), () => rows.filter(r => r.tags.length).map(r => ({ id: r.id })), false],
    ['two predicate columns, neither selected', () => q.prewhere(r => r.v.gt(5).and(r.cat.eq('a'))).map(r => ({ s: r.s })), () => rows.filter(r => r.v > 5 && r.cat === 'a').map(r => ({ s: r.s })), false],
    ['one column selected through a chain of maps', () => guard.map(r => ({ x: r.s, y: r.id })).map(r => ({ z: r.y })), () => kept.map(r => ({ z: r.id })), false],
    ['orderBy, limit, offset', () => guard.orderBy(r => r.id.desc()).limit(3, 2).map(r => ({ id: r.id })), () => [...kept].reverse().slice(2, 5).map(r => ({ id: r.id })), true],
    ['limit over a total computed map', () => guard.orderBy(r => r.id).map(r => ({ id: r.id, k: r.v.plus(1) })).limit(2), () => kept.slice(0, 2).map(r => ({ id: r.id, k: BigInt(r.v + 1) })), false],
    ['limitBy, unselected key, offset', () => guard.orderBy(r => r.id).limitBy(r => r.cat).take(2).offset(1).map(r => ({ id: r.id })), () => { const seen = new Map<string, number>(); return kept.filter(r => { const at = seen.get(r.cat) ?? 0; seen.set(r.cat, at + 1); return at >= 1 && at < 3; }).map(r => ({ id: r.id })); }, false],
    ['distinct', () => guard.map(r => ({ cat: r.cat })).distinct(), () => [...new Set(kept.map(r => r.cat))].map(cat => ({ cat })), false],
    ['distinct of the row, then limit', () => guard.distinct().orderBy(r => r.id).limit(2).map(r => ({ id: r.id })), () => kept.slice(0, 2).map(r => ({ id: r.id })), false],
    ['aggregate', () => guard.groupBy(r => ({ cat: r.cat })).aggregate(g => ({ c: count(), s: sum(g.v) })), () => ['a', 'b', 'c'].map(cat => { const g = kept.filter(r => r.cat === cat); return { cat, c: BigInt(g.length), s: BigInt(g.reduce((n, r) => n + r.v, 0)) }; }), false],
    ['aggregate over where, with HAVING', () => guard.where(r => r.id.gt(3)).groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).where(r => r.c.gt(0n)).orderBy(r => r.cat).limit(1), () => [{ cat: 'a', c: BigInt(kept.filter(r => r.id > 3 && r.cat === 'a').length) }], true],
    ['keyless aggregate', () => guard.aggregate(() => ({ c: count() })), () => [{ c: BigInt(kept.length) }], false],
    ['count', () => guard.count(), () => [{ count: BigInt(kept.length) }], false],
    ['aggregate over a column it does not select', () => q.prewhere(r => r.cat.eq('a')).aggregate(g => ({ m: max(g.id) })), () => [{ m: Math.max(...rows.filter(r => r.cat === 'a').map(r => r.id)) }], false],
    ['arrayJoin', () => guard.arrayJoin(r => r.tags, 'tag').map(r => ({ id: r.id, tag: r.tag })), () => kept.flatMap(r => r.tags.map(tag => ({ id: r.id, tag }))), false],
    ['leftArrayJoin', () => guard.leftArrayJoin(r => r.tags, 'tag').map(r => ({ id: r.id, tag: r.tag })), () => kept.flatMap(r => r.tags.length ? r.tags.map(tag => ({ id: r.id, tag })) : [{ id: r.id, tag: '' }]), false],
    ['arrayJoin, where on a source column and on the alias', () => guard.arrayJoin(r => r.tags, 'tag').where(r => r.cat.eq('a')).where(r => r.tag.eq('t1')).map(r => ({ id: r.id })), () => kept.filter(r => r.cat === 'a' && r.tags.includes('t1')).map(r => ({ id: r.id })), false],
    ['arrayJoin, aggregate', () => guard.arrayJoin(r => r.tags, 'tag').groupBy(r => ({ tag: r.tag })).aggregate(() => ({ c: count() })), () => [...new Set(kept.flatMap(r => r.tags))].map(tag => ({ tag, c: BigInt(kept.flatMap(r => r.tags).filter(x => x === tag).length) })), false],
    ['predicate on the array the expansion reads', () => q.prewhere(r => r.tags.notEmpty()).arrayJoin(r => r.tags, 'tag').map(r => ({ id: r.id, tag: r.tag })), () => rows.flatMap(r => r.tags.map(tag => ({ id: r.id, tag }))), false],
    ['union of two', () => unionAll(guard.map(r => ({ id: r.id })), q.prewhere(r => r.v.le(5)).map(r => ({ id: r.id }))), () => rows.map(r => ({ id: r.id })), false],
    ['union with a filter pushed into branches', () => unionAll(guard, q.prewhere(r => r.cat.eq('a'))).where(r => r.id.le(9)).map(r => ({ id: r.id })), () => [...kept, ...rows.filter(r => r.cat === 'a')].filter(r => r.id <= 9).map(r => ({ id: r.id })), false],
    ['one Prewhere shared in a union is a CTE', () => unionAll(guard, guard).map(r => ({ id: r.id })), () => [...kept, ...kept].map(r => ({ id: r.id })), false],
    ['one Prewhere shared, filtered on one use', () => unionAll(guard, guard.where(r => r.cat.eq('a'))).map(r => ({ id: r.id })), () => [...kept, ...kept.filter(r => r.cat === 'a')].map(r => ({ id: r.id })), false],
    ['one Scan, PREWHERE and WHERE', () => unionAll(q.prewhere(r => r.v.gt(5)), q.where(r => r.v.le(5))).map(r => ({ id: r.id })), () => rows.map(r => ({ id: r.id })), false],
    ['one Scan, a PREWHERE and two uses that make it a CTE', () => unionAll(q.prewhere(r => r.v.gt(5)).map(r => ({ id: r.id })), q.where(r => r.v.eq(1)).map(r => ({ id: r.id })), q.where(r => r.v.eq(2)).map(r => ({ id: r.id }))), () => [...kept, ...rows.filter(r => r.v === 1), ...rows.filter(r => r.v === 2)].map(r => ({ id: r.id })), false],
    ['one Scan, a self join under PREWHERE on one side', () => join({ a: q.prewhere(r => r.v.gt(5)), b: q }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id })), () => kept.map(r => ({ id: r.id })), false],
    ['explicit cte', () => guard.cte().where(r => r.cat.eq('a')).map(r => ({ id: r.id })), () => kept.filter(r => r.cat === 'a').map(r => ({ id: r.id })), false],
    ['inner join, each side', () => join({ a: guard, b: from(u).prewhere(r => r.w.eq('p')) }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, w: r.b.w })), () => kept.filter(r => wOf(r.id) === 'p').map(r => ({ id: r.id, w: 'p' })), false],
    ['left join, on the preserved side', () => leftJoin({ a: guard }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, w: r.b.w })), () => kept.map(r => ({ id: r.id, w: wOf(r.id) ?? null })), false],
    ['left join, on the extended side: unmatched rows keep NULL', () => leftJoin({ a: q }, { b: from(u).prewhere(r => r.w.eq('p')) }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, w: r.b.w })), () => rows.map(r => ({ id: r.id, w: wOf(r.id) === 'p' ? 'p' : null })), false],
    ['left join, a null-rejecting filter above (LeftToInner)', () => leftJoin({ a: guard }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('p')).map(r => ({ id: r.a.id })), () => kept.filter(r => wOf(r.id) === 'p').map(r => ({ id: r.id })), false],
    ['join, a filter on the side pushed above PREWHERE', () => join({ a: guard, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.cat.eq('a')).map(r => ({ id: r.a.id })), () => kept.filter(r => r.cat === 'a' && wOf(r.id)).map(r => ({ id: r.id })), false],
    ['membership subquery under PREWHERE', () => q.where(r => r.id.in(guard.map(g => g.id))).map(r => ({ id: r.id })), () => kept.map(r => ({ id: r.id })), false],
    ['membership subquery in the predicate', () => q.prewhere(r => r.id.in(from(u).map(x => x.id))).map(r => ({ id: r.id })), () => rows.filter(r => wOf(r.id)).map(r => ({ id: r.id })), false],
    ['one subquery shared by the predicate and a key is a CTE', () => { const sub = from(u).where(x => x.id.gt(1)).map(x => x.id); return q.prewhere(r => r.id.in(sub)).orderBy(r => r.id).limitBy(r => r.id.in(sub)).take(1).map(r => ({ id: r.id })); }, () => rows.filter(r => wOf(r.id)).slice(0, 1).map(r => ({ id: r.id })), false],
    ['parameters number in text order: select, prewhere, where', () => q.prewhere(r => r.cat.eq('a')).where(r => r.s.ne('2')).map(r => ({ id: r.id, tag: val('zz', col.String) })), () => rows.filter(r => r.cat === 'a' && r.s !== '2').map(r => ({ id: r.id, tag: 'zz' })), false],
    ['array parameter in the predicate', () => q.prewhere(r => r.cat.in(['a', 'b'])).map(r => ({ id: r.id })), () => rows.filter(r => r.cat !== 'c').map(r => ({ id: r.id })), false],
    ['ALIAS column in the predicate', () => q.prewhere(r => r.a.gt(1005n)).map(r => ({ id: r.id })), () => kept.map(r => ({ id: r.id })), false],
    ['MATERIALIZED column in the predicate', () => q.prewhere(r => r.m.gt(10n)).map(r => ({ id: r.id })), () => kept.map(r => ({ id: r.id })), false],
    ['Nullable(Bool) predicate: NULL drops the row', () => q.prewhere(r => r.ok).map(r => ({ id: r.id })), () => rows.filter(r => r.ok === true).map(r => ({ id: r.id })), false],
    ['Nullable comparison: NULL drops the row', () => q.prewhere(r => r.n.gt(1)).map(r => ({ id: r.id })), () => rows.filter(r => r.n !== null && r.n > 1).map(r => ({ id: r.id })), false],
    ['or in the predicate, and in a filter above', () => q.prewhere(r => r.v.gt(14).or(r.v.lt(2))).where(r => r.cat.eq('a').or(r.cat.eq('b'))).map(r => ({ id: r.id })), () => rows.filter(r => (r.v > 14 || r.v < 2) && r.cat !== 'c').map(r => ({ id: r.id })), false],
  ];
  it.each(cases)('%s', async (_name, build, expected, ordered) => {
    await agree(build(), ordered, result => {
      if (ordered) expect(result).toEqual(expected());
      else expect(bag(result)).toEqual(bag(expected()));
    });
  });
  it('scalar subquery in the predicate', async () => {
    const query = q.prewhere(r => r.id.gt(scalar(from(u).aggregate(g => ({ m: max(g.id) }))).ifNull(0))).map(r => ({ id: r.id }));
    await agree(query, false, result => expect(result).toEqual([]));
    const lower = q.prewhere(r => r.id.gt(scalar(from(u).where(x => x.id.eq(38)).aggregate(g => ({ m: max(g.id) }))).ifNull(0))).map(r => ({ id: r.id }));
    await agree(lower, false, result => expect(sorted(ids(result))).toEqual([39, 40]));
  });
});

describe('modifiers', () => {
  it('final alone: a non-key predicate returns the stale version, where does not, on both paths, and each matches handwritten SQL', async () => {
    const stale = from(rep).final().prewhere(r => r.status.eq('open')).orderBy(r => r.id).thenBy(r => r.ver);
    await agree(stale, true, result => expect(result).toEqual([{ id: 1, ver: 1, status: 'open' }, { id: 2, ver: 1, status: 'open' }]));
    expect(await native("SELECT id, ver, status FROM pwa_r FINAL PREWHERE status = 'open' ORDER BY id, ver")).toEqual([{ id: 1, ver: 1, status: 'open' }, { id: 2, ver: 1, status: 'open' }]);
    for (const cell of cells) expect((await differential(cell, from(rep).final().where(r => r.status.eq('open')), true))).toEqual([{ id: 2, ver: 1, status: 'open' }]);
    // A later WHERE sees the stale row too, since PREWHERE already ran.
    await agree(from(rep).final().prewhere(r => r.status.eq('open')).where(r => r.id.eq(1)), false, result => expect(result).toEqual([{ id: 1, ver: 1, status: 'open' }]));
    // Merges stayed stopped, so this was not a merged part.
    expect((await native("SELECT count() AS c FROM system.parts WHERE table = 'pwa_r' AND active"))[0]!.c).toBe('2');
  });
  it('final with a key predicate matches where', async () => {
    const pre = from(rep).final().prewhere(r => r.id.eq(1));
    await agree(pre, false, result => expect(result).toEqual([{ id: 1, ver: 2, status: 'closed' }]));
  });
  it('final, aggregate, map and shared use keep it', async () => {
    const open = from(rep).final().prewhere(r => r.status.eq('open'));
    await agree(open.count(), false, result => expect(result).toEqual([{ count: 2n }]));
    await agree(open.map(r => ({ id: r.id })), false, result => expect(sorted(ids(result))).toEqual([1, 2]));
    await agree(unionAll(open, open).map(r => ({ id: r.id })), false, result => expect(sorted(ids(result))).toEqual([1, 1, 2, 2]));
  });
  it('sample: the same rows as handwritten SQL, on both paths', async () => {
    const query = from(smp).sample(0.1).prewhere(r => r.v.lt(5)).orderBy(r => r.id).map(r => ({ id: r.id }));
    expect(compile(query.ir).sql).toContain('SAMPLE 0.1');
    const handwritten = (await native('SELECT id FROM pwa_s SAMPLE 0.1 PREWHERE v < 5 ORDER BY id')).map(r => r.id);
    expect(handwritten.length).toBeGreaterThan(100);
    expect(handwritten.length).toBeLessThan(5000);
    await agree(query, false, result => expect(sorted(ids(result))).toEqual(sorted(handwritten as number[])));
    await agree(from(smp).sample(0.1).prewhere(r => r.v.lt(5)).count(), false, result => expect(result).toEqual([{ count: BigInt(handwritten.length) }]));
  });
  it('final and sample together: the same rows as handwritten SQL, in both orders of the modifiers', async () => {
    const handwritten = (await native("SELECT id, ver FROM pwa_rs FINAL SAMPLE 0.1 PREWHERE status = 'open' ORDER BY id")) as { id: number; ver: number }[];
    expect(handwritten.length).toBeGreaterThan(50);
    expect(handwritten.some(r => r.ver === 1)).toBe(true); // Stale versions, as for final alone.
    const first = from(srep).final().sample(0.1).prewhere(r => r.status.eq('open')).map(r => ({ id: r.id, ver: r.ver }));
    const second = from(srep).sample(0.1).final().prewhere(r => r.status.eq('open')).map(r => ({ id: r.id, ver: r.ver }));
    for (const query of [first, second]) {
      expect(compile(query.ir).sql).toMatch(/FINAL SAMPLE 0\.1 PREWHERE/);
      await agree(query, false, result => expect(bag(result)).toEqual(bag(handwritten)));
    }
  });
});

describe('alias capture', () => {
  it('computed aliases named like predicate columns', async () => {
    await agree(q.prewhere(r => r.v.gt(5)).map(r => ({ id: r.id, v: r.v.plus(1000) })), false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, v: BigInt(r.v + 1000) })))));
    await agree(q.prewhere(r => r.v.gt(5)).map(r => ({ id: r.id, v: r.cat })), false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, v: r.cat })))));
    await agree(q.prewhere(r => r.v.gt(5).and(r.cat.eq('a'))).map(r => ({ id: r.id, cat: r.s, v: r.id })), false, result => expect(bag(result)).toEqual(bag(kept.filter(r => r.cat === 'a').map(r => ({ id: r.id, cat: r.s, v: r.id })))));
  });
  it('swapped names', async () => {
    await agree(q.prewhere(r => r.cat.eq('a')).map(r => ({ id: r.id, cat: r.s, s: r.cat })), false, result => expect(bag(result)).toEqual(bag(rows.filter(r => r.cat === 'a').map(r => ({ id: r.id, cat: r.s, s: r.cat })))));
  });
  it('after narrowing: a chain of maps that hides the predicate column and then reuses its name', async () => {
    const chain = guard.map(r => ({ id: r.id, c: r.cat })).map(r => ({ id: r.id, v: r.c }));
    await agree(chain, false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, v: r.cat })))));
  });
  it('an alias named like a column the predicate does not read still reads the right rows', async () => {
    await agree(q.prewhere(r => r.v.gt(5)).map(r => ({ id: r.id, cat: r.v.plus(1) })), false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, cat: BigInt(r.v + 1) })))));
  });
  it('an alias named like the column behind an ALIAS column the predicate reads', async () => {
    // `a` is `v + 1000` on the server. The select alias `v` must not reach into that definition.
    await agree(q.prewhere(r => r.a.gt(1005n)).map(r => ({ id: r.id, v: r.id })), false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, v: r.id })))));
    await agree(q.prewhere(r => r.m.gt(10n)).map(r => ({ id: r.id, v: r.id })), false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, v: r.id })))));
  });
  it('an alias named like a hidden column', async () => {
    const hidden = from(h);
    const query = hidden.prewhere(r => r.v.gt(5)).map(r => ({ id: r.id, a: r.id.plus(1), m: r.v }));
    await agree(query, false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ id: r.id, a: BigInt(r.id + 1), m: r.v })))));
    const onlyHiddenNamed = hidden.prewhere(r => r.v.gt(5)).groupBy(r => ({ a: r.id })).aggregate(() => ({ m: count() }));
    await agree(onlyHiddenNamed, false, result => expect(bag(result)).toEqual(bag(kept.map(r => ({ a: r.id, m: 1n })))));
  });
  it('aggregate outputs named like a predicate column', async () => {
    const byValue = q.prewhere(r => r.v.gt(5)).groupBy(r => ({ cat: r.cat })).aggregate(() => ({ v: count() }));
    const counts = ['a', 'b', 'c'].map(cat => ({ cat, v: BigInt(kept.filter(r => r.cat === cat).length) }));
    await agree(byValue, false, result => expect(bag(result)).toEqual(bag(counts)));
    await agree(byValue.where(r => r.v.gt(0n)), false, result => expect(bag(result)).toEqual(bag(counts)));
    await agree(byValue.orderBy(r => r.cat).limitBy(r => r.v).take(100), true, result => expect(result).toEqual(counts));
    const key = q.prewhere(r => r.v.gt(5)).groupBy(r => ({ v: r.cat })).aggregate(() => ({ c: count() }));
    await agree(key, false, result => expect(bag(result)).toEqual(bag(counts.map(x => ({ v: x.cat, c: x.v })))));
    const narrowed = q.prewhere(r => r.v.gt(5)).map(r => ({ id: r.id, cat: r.cat })).groupBy(r => ({ v: r.cat })).aggregate(g => ({ id: max(g.id) }));
    await agree(narrowed, false);
  });
  it('an expansion alias named like a predicate column', async () => {
    const narrowed = q.prewhere(r => r.cat.eq('a')).map(r => ({ id: r.id, tags: r.tags })).arrayJoin(r => r.tags, 'cat').map(r => ({ id: r.id, cat: r.cat }));
    const expected = rows.filter(r => r.cat === 'a').flatMap(r => r.tags.map(cat => ({ id: r.id, cat })));
    await agree(narrowed, false, result => expect(bag(result)).toEqual(bag(expected)));
    const left = q.prewhere(r => r.cat.eq('a')).map(r => ({ id: r.id, tags: r.tags })).leftArrayJoin(r => r.tags, 'cat').map(r => ({ id: r.id }));
    await agree(left, false, result => expect(result).toHaveLength(rows.filter(r => r.cat === 'a').reduce((n, r) => n + Math.max(1, r.tags.length), 0)));
  });
  it('an alias named like the expansion alias over a predicate', async () => {
    const query = guard.arrayJoin(r => r.tags, 'tag').map(r => ({ id: r.id, cat: r.tag }));
    await agree(query, false, result => expect(bag(result)).toEqual(bag(kept.flatMap(r => r.tags.map(cat => ({ id: r.id, cat }))))));
  });
});

/** Outcome through the raw driver, with order canonicalized by the caller's `order` query. */
async function outcome(compiled: { sql: string; params: Record<string, string> }, settings: Record<string, string | number> = {}): Promise<QueryOutcome> {
  try {
    const result = await driver.query({ query: compiled.sql, query_params: compiled.params, format: 'JSON', clickhouse_settings: settings as never });
    try {
      const body = await result.json<Record<string, unknown>>() as { data: unknown[]; meta?: unknown[]; exception?: unknown };
      // After rows have streamed the server answers 200 and ends the JSON with this field.
      if (body.exception !== undefined) return { error: String(body.exception) };
      return { data: [...body.data].map(key).sort(), meta: body.meta ?? [] };
    } finally { result.close(); }
  } catch (error) { return { error: String(error) }; }
}
const number = (r: { readonly s: Expr<string, string, 'row'> }) => cast(r.s, col.UInt32);
describe('results-only contract, and guards', () => {
  const settings = [{}, { prefer_column_name_to_alias: 1 }, { optimize_move_to_prewhere: 0 }, { max_threads: 1 }, { query_plan_filter_push_down: 0 }];
  const good = rows.filter(r => r.s !== 'bad');
  /** Naive must succeed, so optimized must too with the same rows. */
  const passing: readonly (readonly [string, () => { ir: Rel }, number])[] = [
    ['guard then cast in one predicate', () => q.prewhere(r => r.s.ne('bad').and(number(r).gt(0))).map(r => ({ id: r.id })), good.length],
    ['guarded WHERE', () => q.prewhere(r => r.s.ne('bad')).where(r => number(r).gt(0)).map(r => ({ id: r.id })), good.length],
    ['guarded select item', () => q.prewhere(r => r.s.ne('bad')).map(r => ({ x: number(r) })), good.length],
    ['guarded sort key', () => q.prewhere(r => r.s.ne('bad')).orderBy(r => number(r)), good.length],
    ['guarded LIMIT BY key', () => q.prewhere(r => r.s.ne('bad')).limitBy(r => number(r)).take(1), good.length],
    ['guarded group key', () => q.prewhere(r => r.s.ne('bad')).groupBy(r => ({ x: number(r) })).aggregate(() => ({ c: count() })), good.length],
    ['guarded aggregate', () => q.prewhere(r => r.s.ne('bad')).aggregate(g => ({ x: max(cast(g.s, col.UInt32)) })), 1],
    ['guarded expansion, a cast in WHERE above', () => q.prewhere(r => r.s.ne('bad')).arrayJoin(r => r.tags, 'tag').where(r => number(r).gt(0)).map(r => ({ tag: r.tag })), good.reduce((n, r) => n + r.tags.length, 0)],
    ['guarded WHERE above a join', () => join({ a: q.prewhere(r => r.s.ne('bad')), b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => number(r.a).gt(0)).map(r => ({ id: r.a.id })), good.filter(r => wOf(r.id)).length],
    ['guarded WHERE above a left join', () => leftJoin({ a: q.prewhere(r => r.s.ne('bad')) }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => number(r.a).gt(0)).map(r => ({ id: r.a.id })), good.length],
    ['a total filter over a guard, a cast above', () => q.prewhere(r => r.s.ne('bad')).where(r => r.id.gt(0)).where(r => number(r).gt(0)).map(r => ({ id: r.id })), good.length],
    ['guarded WHERE in a union branch', () => unionAll(q.prewhere(r => r.s.ne('bad')), q.prewhere(r => r.s.ne('bad'))).where(r => number(r).gt(0)).map(r => ({ id: r.id })), good.length * 2],
    ['guarded WHERE in a CTE', () => q.prewhere(r => r.s.ne('bad')).cte().where(r => number(r).gt(0)).map(r => ({ id: r.id })), good.length],
    ['guarded WHERE in a subquery', () => q.where(r => r.id.in(q.prewhere(x => x.s.ne('bad')).where(x => number(x).gt(0)).map(x => x.id))).map(r => ({ id: r.id })), good.length],
    ['a guard on another column, a cast in WHERE', () => q.prewhere(r => r.id.lt(13)).where(r => number(r).gt(0)).map(r => ({ id: r.id })), 12],
    ['a guard on another column, a cast in a select item', () => q.prewhere(r => r.id.lt(13)).map(r => ({ x: number(r) })), 12],
    ['a guard on another column, a cast in a group key', () => q.prewhere(r => r.id.lt(13)).groupBy(r => ({ x: number(r) })).aggregate(() => ({ c: count() })), 12],
  ];
  it.each(passing)('%s', async (_name, build, length) => {
    const query = build();
    for (const cell of settings) {
      const optimized = await outcome(compile(query.ir), cell), naive = await outcome(emitNaive(query.ir), cell);
      expect(naive.error, `naive ${JSON.stringify(cell)} ${emitNaive(query.ir).sql}`).toBeUndefined();
      expect(resultsContract(optimized, naive), `${JSON.stringify(cell)} ${compile(query.ir).sql}`).toEqual({ ok: true, kind: 'equal' });
      expect(naive.data).toHaveLength(length);
    }
  });
  it('a WHERE cannot guard a fallible PREWHERE, on either path', async () => {
    const query = q.prewhere(r => number(r).gt(0)).where(r => r.s.ne('bad'));
    for (const cell of settings) {
      const optimized = await outcome(compile(query.ir), cell), naive = await outcome(emitNaive(query.ir), cell);
      expect(naive.error).toMatch(/Cannot parse/);
      expect(optimized.error).toMatch(/Cannot parse/);
      expect(resultsContract(optimized, naive)).toEqual({ ok: true, kind: 'both-failed' });
    }
  });
  it('conjunct order is kept: guard first passes, guard last fails, on both paths', async () => {
    const first = q.prewhere(r => r.s.ne('bad').and(number(r).gt(0)));
    const last = q.prewhere(r => number(r).gt(0).and(r.s.ne('bad')));
    for (const emit of [compile, emitNaive]) {
      expect((await outcome(emit(first.ir))).error).toBeUndefined();
      expect((await outcome(emit(last.ir))).error).toMatch(/Cannot parse/);
    }
    const three = compile(q.prewhere(r => r.id.gt(0).and(r.cat.ne('z')).and(r.s.ne('bad'))).ir).sql;
    expect(three.indexOf('`id`', three.indexOf('PREWHERE'))).toBeLessThan(three.indexOf('`cat`', three.indexOf('PREWHERE')));
    expect(three.indexOf('`cat`', three.indexOf('PREWHERE'))).toBeLessThan(three.indexOf('`s`', three.indexOf('PREWHERE')));
  });
  it('inside one predicate, a guard on another column does not protect a cast, whichever comes first, on either path', async () => {
    // Multi-step PREWHERE (enable_multiple_prewhere_read_steps, on by default) does not keep text order across columns.
    const guarded = q.prewhere(r => r.id.lt(13).and(number(r).gt(0))).where(r => r.cat.eq('a')).map(r => ({ id: r.id }));
    const reversed = q.prewhere(r => number(r).gt(0).and(r.id.lt(13))).where(r => r.cat.eq('a')).map(r => ({ id: r.id }));
    const nonKey = q.prewhere(r => r.v.lt(100).and(r.id.lt(13)).and(number(r).gt(0))).map(r => ({ id: r.id }));
    for (const query of [guarded, reversed, nonKey]) {
      const optimized = await outcome(compile(query.ir)), naive = await outcome(emitNaive(query.ir));
      expect(naive.error, emitNaive(query.ir).sql).toMatch(/Cannot parse/);
      expect(resultsContract(optimized, naive)).toEqual({ ok: true, kind: 'both-failed' });
    }
    expect((await outcome({ sql: 'SELECT id FROM pwa PREWHERE id < 13 AND CAST(s AS UInt32) > 0', params: {} })).error).toMatch(/Cannot parse/);
    // With one step, text order holds again, on both paths.
    const single = { enable_multiple_prewhere_read_steps: 0 };
    for (const emit of [compile, emitNaive]) expect((await outcome(emit(guarded.ir), single)).data).toHaveLength(rows.filter(r => r.id < 13 && r.cat === 'a').length);
    expect(resultsContract(await outcome(compile(guarded.ir), single), await outcome(emitNaive(guarded.ir), single))).toEqual({ ok: true, kind: 'equal' });
  });
  it('a pushed filter never joins the predicate: its conjunct stays in WHERE', async () => {
    const pushed = compile(q.prewhere(r => r.s.ne('bad')).map(r => ({ id: r.id, s: r.s })).where(r => r.id.gt(1)).ir).sql;
    expect(pushed.indexOf('PREWHERE')).toBeLessThan(pushed.indexOf(' WHERE '));
    expect(pushed.slice(pushed.indexOf('PREWHERE'), pushed.indexOf(' WHERE '))).not.toContain('`id`');
  });
});

describe('EXPLAIN', () => {
  const explain = async (compiled: { sql: string; params: Record<string, string> }, settings: Record<string, number> = {}) => {
    const result = await driver.query({ query: `EXPLAIN PLAN actions = 1 ${compiled.sql}`, query_params: compiled.params, format: 'TabSeparatedRaw', clickhouse_settings: settings as never });
    try { return await result.text(); } finally { result.close(); }
  };
  const prewhereColumn = (plan: string) => plan.match(/Prewhere filter column: (.*)/)?.[1] ?? '';
  it.each([[{ optimize_move_to_prewhere: 1 }], [{ optimize_move_to_prewhere: 0 }]])('shows Prewhere info on the read and a separate Filter for WHERE, on both paths, under %j', async cell => {
    const query = q.prewhere(r => r.v.gt(5)).where(r => r.cat.eq('a'));
    for (const emit of [compile, emitNaive]) {
      const plan = await explain(emit(query.ir), cell);
      expect(plan, emit.name).toContain('Prewhere info');
      expect(prewhereColumn(plan)).toContain('v');
      expect(prewhereColumn(plan)).not.toContain('cat');
      expect(plan).toMatch(/Filter \(/);
    }
  });
  it('a WHERE alone has no explicit Prewhere when moving is off, so the marker is not vacuous', async () => {
    const plan = await explain(compile(q.where(r => r.v.gt(5)).ir), { optimize_move_to_prewhere: 0 });
    expect(plan).not.toContain('Prewhere info');
  });
  it('every folded and join-side shape keeps Prewhere info', async () => {
    const shapes = [guard.count(), guard.distinct(), guard.orderBy(r => r.id).limitBy(r => r.cat).take(1), guard.arrayJoin(r => r.tags, 'tag'), guard.map(r => ({ id: r.id })),
      join({ a: guard, b: from(u) }).on(r => r.a.id.eq(r.b.id)), leftJoin({ a: q }, { b: from(u).prewhere(r => r.w.eq('p')) }).on(r => r.a.id.eq(r.b.id)), from(rep).final().prewhere(r => r.status.eq('open'))];
    for (const shape of shapes) for (const emit of [compile, emitNaive]) expect(await explain(emit(shape.ir), { optimize_move_to_prewhere: 0 }), emit(shape.ir).sql).toContain('Prewhere info');
  });
});

describe('server rejections', () => {
  const failure = async (query: { ir: Rel }) => {
    for (const backend of cells[0]!) {
      const error = await collect(backend.run(backend.compile(query.ir))).then(() => undefined, (e: unknown) => e);
      expect(error, backend.name).toBeInstanceOf(QueryError);
    }
    return Promise.all(cells[0]!.map(async backend => ((await collect(backend.run(backend.compile(query.ir))).catch((e: QueryError) => e)) as QueryError).cause as { code?: string }));
  };
  it.each(['pwa_memory', 'pwa_log', 'pwa_tinylog', 'pwa_view'])('%s raises code 182 as QueryError on both paths', async name => {
    const query = from(table(name, { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).prewhere(r => r.id.gt(0));
    for (const cause of await failure(query)) expect(cause.code).toBe('182');
    const client = createTypedClient(options);
    try { await expect(client.run(query)).rejects.toBeInstanceOf(QueryError); } finally { await client.close(); }
  });
  it('a bare Nullable(UInt32) is stopped by the types and the compiler, and raises code 59 on the server', async () => {
    // As for where, the builder checks that it is a row expression, and the compiler checks its type.
    const js = q as unknown as { prewhere(f: (r: typeof q.row) => unknown): { ir: Rel } };
    expect(() => js.prewhere(() => 'n')).toThrow(/invalid_predicate/);
    for (const emit of [compile, emitNaive]) expect(() => emit(js.prewhere(r => r.n).ir)).toThrow(/invalid_predicate/);
    const hand = relNode({ kind: 'Prewhere', input: q.ir as Extract<Rel, { kind: 'Scan' }>, pred: q.row.n.ir, output: q.ir.output });
    expect(() => compile(hand)).toThrow(/invalid_predicate/);
    expect(() => emitNaive(hand)).toThrow(/invalid_predicate/);
    await expect(native('SELECT id FROM pwa PREWHERE n')).rejects.toMatchObject({ code: '59' });
    // Only a declared sql snippet can reach the server, and the code then surfaces.
    for (const cause of await failure(q.prewhere(r => sql`${r.n}`.as(col.Bool)))) expect(cause.code).toBe('59');
  });
  it('an aggregate predicate is stopped by the compiler, and raises code 184 on the server', async () => {
    const hand = relNode({ kind: 'Prewhere', input: q.ir as Extract<Rel, { kind: 'Scan' }>, pred: count().gt(1n).ir, output: q.ir.output });
    for (const emit of [compile, emitNaive]) expect(() => emit(hand)).toThrow(/invalid_/);
    await expect(native('SELECT id FROM pwa PREWHERE count() > 1')).rejects.toMatchObject({ code: '184' });
    for (const cause of await failure(q.prewhere(() => sql`count() > 1`.as(col.Bool)))) expect(cause.code).toBe('184');
  });
  it('hand-built IR with a non-Scan input is rejected on both paths', () => {
    const inputs: readonly Rel[] = [q.where(r => r.v.gt(1)).ir, q.map(r => ({ id: r.id, v: r.v })).ir, q.cte().ir, q.prewhere(r => r.v.gt(1)).ir, unionAll(q, q).ir];
    for (const input of inputs) {
      const hand = relNode({ kind: 'Prewhere', input: input as Extract<Rel, { kind: 'Scan' }>, pred: exprNode({ kind: 'Param', type: col.Bool.type, value: true } as never), output: input.output });
      for (const emit of [compile, emitNaive]) expect(() => emit(hand)).toThrow(/invalid_prewhere_input/);
    }
  });
});

describe('run and stream', () => {
  it('return the same rows as handwritten SQL, with types decoded', async () => {
    const client = createTypedClient(options);
    try {
      const query = q.prewhere(r => r.v.gt(5)).where(r => r.cat.eq('a')).orderBy(r => r.id);
      const buffered = await client.run(query);
      const streamed: unknown[] = [];
      for await (const row of client.stream(query)) streamed.push(row);
      expect(streamed).toEqual(buffered);
      expect(buffered).toEqual(kept.filter(r => r.cat === 'a'));
      const handwritten = await native("SELECT id FROM pwa PREWHERE v > 5 WHERE cat = 'a' ORDER BY id");
      expect(buffered.map(r => r.id)).toEqual(handwritten.map(r => r.id));
      const joined = join({ a: guard.orderBy(r => r.id).limit(1), b: from(u).prewhere(r => r.id.gt(0)) }).on(r => r.a.id.eq(r.b.id));
      const nested = await client.run(joined);
      for (const row of nested) expect(row.a.v).toBeGreaterThan(5);
    } finally { await client.close(); }
  });
});

describe('a failure after rows have streamed', () => {
  /** A characterization, not a contract: see the C11 report. ClickHouse answers HTTP 200 and ends the body with an
   * {"exception": ...} line, which `run` decodes as a row. Not specific to PREWHERE: WHERE and a select item do the same. */
  it('prewhere, where and map all report the broken stream the same way on both paths, and it is never silent', async () => {
    const big = from(flow);
    const shapes = [['prewhere', big.prewhere(r => number(r).ge(0))], ['where', big.where(r => number(r).ge(0))], ['map', big.map(r => ({ id: number(r) }))]] as const;
    const seen = new Map<string, string>();
    for (const [name, query] of shapes) for (const mode of ['clickhouse-naive', 'clickhouse'] as const) {
      const backend = createClickHouseBackend({ ...options, clickhouse_settings: { max_threads: 1, max_block_size: '1000' } as never }, mode);
      try {
        let rows = 0;
        const error = await (async () => { for await (const _ of backend.run(backend.compile(query.ir))) rows++; })().then(() => undefined, (e: unknown) => e);
        expect(error, `${name} ${mode}`).toBeInstanceOf(QueryError);
        expect(rows, `${name} ${mode}`).toBeGreaterThan(0);
        const cause = (error as QueryError).cause as { code?: string; message: string };
        expect(cause.code === '6' || /decode_missing_column/.test(cause.message)).toBe(true);
        seen.set(`${name} ${mode}`, cause.code ?? cause.message);
      } finally { await backend.close(); }
    }
    expect(new Set(seen.values())).toEqual(new Set(['decode_missing_column: id']));
  }, 60000);
});

describe('C11: why limit-by/subquery-key is run: false', () => {
  /** An IN set outside WHERE is a CreatingSet with its own read, for a LIMIT BY key, a sort key and a select item alike;
   * a WHERE's set shows no second read. The read-set clause counts main scans only (`structure().scans` excludes subquery scopes). */
  it('a sort key and a LIMIT BY key read the set in the main plan; a WHERE does not', async () => {
    const set = () => q.map(r => r.id);
    const plan = async (query: { ir: Rel }) => {
      const compiled = compile(query.ir);
      const result = await driver.query({ query: `EXPLAIN PLAN json = 1, header = 1 ${compiled.sql}`, query_params: compiled.params, format: 'TabSeparatedRaw' });
      try {
        const steps = flatten(parseExplainJson(await result.text()));
        return { reads: steps.filter(s => readTable(s) === 'pwa').length, creatingSet: steps.some(s => s.type === 'CreatingSet'), scans: structure(query.ir).scans.get('pwa') };
      } finally { result.close(); }
    };
    expect(await plan(q.limitBy(r => r.id.in(set())).take(1))).toEqual({ reads: 2, creatingSet: true, scans: 1 });
    expect(await plan(q.orderBy(r => r.id.in(set())))).toEqual({ reads: 2, creatingSet: true, scans: 1 });
    expect(await plan(q.map(r => ({ x: r.id.in(set()) })))).toEqual({ reads: 2, creatingSet: true, scans: 1 });
    expect((await plan(q.where(r => r.id.in(set()))))).toEqual({ reads: 1, creatingSet: false, scans: 1 });
  });
});

describe('random compositions over PREWHERE', () => {
  type Step = 'where' | 'whereKey' | 'identity' | 'narrow' | 'shadow' | 'sort' | 'limit' | 'limitBy' | 'distinct' | 'cte' | 'union' | 'self';
  const steps: fc.Arbitrary<Step[]> = fc.array(fc.constantFrom<Step>('where', 'whereKey', 'identity', 'narrow', 'shadow', 'sort', 'limit', 'limitBy', 'distinct', 'cte', 'union', 'self'), { maxLength: 5 });
  const ends = fc.constantFrom('bag', 'aggregate', 'expand', 'countAll');
  const leaf = from(table('pwa', { id: col.UInt32, cat: col.String, v: col.UInt32, tags: col.Array(col.String) }, merge));
  type Leaf = typeof leaf;
  /** Same chain over either source, so the PREWHERE form is checked against the WHERE form, the independent oracle here. */
  function chain(source: ReturnType<Leaf['where']>, plan: readonly Step[], end: string) {
    let current = source;
    for (const step of plan) {
      switch (step) {
        case 'where': current = current.where(r => r.id.gt(2)); break;
        case 'whereKey': current = current.where(r => r.cat.ne('c').or(r.id.lt(30))); break;
        case 'identity': current = current.map(r => ({ id: r.id, cat: r.cat, v: r.v, tags: r.tags })); break;
        case 'narrow': current = current.map(r => ({ id: r.id, cat: r.cat, tags: r.tags, v: r.v })); break;
        case 'shadow': current = current.map(r => ({ id: r.id, cat: r.cat, v: r.id, tags: r.tags })) as typeof current; break;
        case 'sort': current = current.orderBy(r => r.id); break;
        case 'limit': current = current.orderBy(r => r.id).thenBy(r => r.v).limit(25); break;
        case 'limitBy': current = current.orderBy(r => r.id).thenBy(r => r.v).limitBy(r => r.cat).take(6); break;
        case 'distinct': current = current.distinct(); break;
        case 'cte': current = current.cte(); break;
        case 'union': current = unionAll(current, current).map(r => ({ id: r.id, cat: r.cat, v: r.v, tags: r.tags })) as typeof current; break;
        case 'self': current = join({ a: current, b: from(u) }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, cat: r.a.cat, v: r.a.v, tags: r.a.tags })) as typeof current; break;
      }
    }
    if (end === 'aggregate') return current.groupBy(r => ({ cat: r.cat })).aggregate(g => ({ c: count(), v: max(g.id) }));
    if (end === 'expand') return current.arrayJoin(r => r.tags, 'tag').map(r => ({ id: r.id, tag: r.tag }));
    if (end === 'countAll') return current.aggregate(() => ({ c: count() }));
    return current;
  }
  it('naive, optimized and the WHERE form agree, and PREWHERE is always in the text', async () => {
    const predicates = [(r: Leaf['row']) => r.v.gt(5), (r: Leaf['row']) => r.cat.eq('a'), (r: Leaf['row']) => r.tags.notEmpty().and(r.id.lt(35))];
    let runs = 0;
    const result = await fc.check(fc.asyncProperty(fc.integer({ min: 0, max: 2 }), steps, ends, async (p, plan, end) => {
      runs++;
      const pre = chain(leaf.prewhere(predicates[p]!) as never, plan, end);
      const oracle = chain(leaf.where(predicates[p]!) as never, plan, end);
      expect(prewheres(compile(pre.ir).sql), compile(pre.ir).sql).toBeGreaterThan(0);
      for (const cell of [cells[0]!, cells[2]!]) {
        const rows = await differential(cell, pre);
        const where = await differential(cell, oracle);
        expect(bag(rows), compile(pre.ir).sql).toEqual(bag(where));
      }
    }), { seed: Number(process.env.TYPEDHOUSE_PREWHERE_SEED ?? 20261105), numRuns: 150 });
    if (result.failed) throw new Error(`seed=${result.seed} path=${result.counterexamplePath} ${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`);
    expect(runs).toBe(150);
  }, 240000);
});
