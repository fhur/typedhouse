import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, from, join, leftJoin, max, sum, table, unionAll, type Caps, type Query, type Rel } from '@typedhouse/core';
import { createClickHouseBackend, createClient as createTypedClient, QueryError } from '../src/index.js';
import { collect, differential } from './backend-harness.js';

const merge = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] };
const t = table('pw', { id: col.UInt32, cat: col.String, s: col.String, v: col.UInt32, tags: col.Array(col.String) }, merge);
const u = table('pw_u', { id: col.UInt32, w: col.String }, merge);
const r = table('pw_r', { id: col.UInt32, ver: col.UInt32, status: col.String }, { ...merge, engine: 'ReplacingMergeTree' });
const sampled = table('pw_s', { id: col.UInt32, h: col.UInt32, v: col.UInt32 }, { ...merge, sortingKey: ['h', 'id'] });
const memory = table('pw_m', { id: col.UInt32 }, { ...merge, engine: 'Memory' });
const q = from(t);

let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
let options: Parameters<typeof createClient>[0];
const matrix: { name: string; backends: ReturnType<typeof createClickHouseBackend>[] }[] = [];
const all = () => matrix.flatMap(m => m.backends);
const plain = () => matrix[0]!.backends;
const planned = () => matrix[0]!.backends[1]!;

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const [name, settings] of [['default', {}], ['prefer column', { prefer_column_name_to_alias: 1 as const }], ['no move', { optimize_move_to_prewhere: 0 as const }]] as const) {
    matrix.push({ name, backends: (['clickhouse-naive', 'clickhouse'] as const).map(mode => createClickHouseBackend({ ...options, clickhouse_settings: settings }, mode)) });
  }
  for (const query of [
    'CREATE TABLE pw (id UInt32, cat String, s String, v UInt32, tags Array(String)) ENGINE=MergeTree ORDER BY id SETTINGS index_granularity=2',
    "INSERT INTO pw VALUES (1,'x','1',10,['a','b']),(2,'x','2',20,[])",
    "INSERT INTO pw VALUES (3,'y','bad',30,['c']),(4,'y','4',40,['d'])",
    "INSERT INTO pw VALUES (5,'z','5',50,[])",
    'CREATE TABLE pw_u (id UInt32, w String) ENGINE=MergeTree ORDER BY id',
    "INSERT INTO pw_u VALUES (1,'p'),(3,'q'),(4,'q')",
    'CREATE TABLE pw_r (id UInt32, ver UInt32, status String) ENGINE=ReplacingMergeTree(ver) ORDER BY id',
    'SYSTEM STOP MERGES pw_r',
    "INSERT INTO pw_r VALUES (1,1,'open')",
    "INSERT INTO pw_r VALUES (1,2,'closed')",
    "INSERT INTO pw_r VALUES (2,1,'open')",
    'CREATE TABLE pw_s (id UInt32, h UInt32, v UInt32) ENGINE=MergeTree ORDER BY (h,id) SAMPLE BY h',
    'INSERT INTO pw_s SELECT number, cityHash64(number) % 4294967295, number % 10 FROM numbers(10000)',
    'CREATE TABLE pw_m (id UInt32) ENGINE=Memory',
    'INSERT INTO pw_m VALUES (1)',
  ]) await driver.command({ query });
}, 120000);

afterAll(async () => {
  for (const b of all()) await b.close();
  await driver?.close();
  await container?.stop();
});

type Executable = { ir: Query<unknown, Caps>['ir'] };
/** Naive and optimized agree in every settings cell; returns the default cell's rows. */
async function both(query: Executable, ordered = false) {
  const results = [];
  for (const cell of matrix) results.push(await differential(cell.backends, query, ordered));
  return results[0]!;
}
const ids = (rows: readonly unknown[]) => (rows as { id: number }[]).map(row => row.id).sort((a, b) => a - b);
async function native(query: string) {
  const result = await driver.query({ query, format: 'JSONEachRow' });
  try { return await result.json<Record<string, unknown>>(); } finally { result.close(); }
}
async function failure(query: { ir: Rel }) {
  return Promise.all(plain().map(async backend => {
    const error = await collect(backend.run(backend.compile(query.ir))).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(QueryError);
    return (error as QueryError).cause as { code?: string; message: string };
  }));
}
/** A cast can fail after a first part has streamed, when the client reports the broken stream rather than the server code. */
async function failsToCast(query: { ir: Rel }) {
  for (const cause of await failure(query)) expect(cause.code === '6' || /decode_missing_column/.test(cause.message)).toBe(true);
}

describe('PREWHERE on ClickHouse 24.8', () => {
  it('matches handwritten SQL, alone and with WHERE', async () => {
    expect(ids(await both(q.prewhere(x => x.v.gt(10))))).toEqual((await native('SELECT id FROM pw PREWHERE v > 10')).map(x => x.id).sort());
    expect(ids(await both(q.prewhere(x => x.v.gt(10)).where(x => x.id.lt(4))))).toEqual([2, 3]);
  });

  it('every shape returns the same rows on both paths, in every settings cell', async () => {
    const guard = q.prewhere(x => x.v.gt(10));
    expect(ids(await both(guard.map(x => ({ id: x.id }))))).toEqual([2, 3, 4, 5]);
    expect(await both(guard.map(x => ({ k: x.v.plus(1) })).orderBy(x => x.k).limit(1), true)).toEqual([{ k: 21n }]);
    expect(await both(guard.groupBy(x => ({ cat: x.cat })).aggregate(() => ({ c: count() })).where(x => x.c.gt(1n)))).toEqual([{ cat: 'y', c: 2n }]);
    expect(await both(guard.count())).toEqual([{ count: 4n }]);
    expect(await both(guard.map(x => ({ cat: x.cat })).distinct().orderBy(x => x.cat), true)).toEqual([{ cat: 'x' }, { cat: 'y' }, { cat: 'z' }]);
    expect(ids(await both(guard.orderBy(x => x.id).limitBy(x => x.cat).take(1), true))).toEqual([2, 3, 5]);
    expect(ids(await both(guard.orderBy(x => x.id).limit(10, 1).map(x => ({ id: x.id }))))).toHaveLength(3);
    expect(ids(await both(unionAll(guard.map(x => ({ id: x.id })), guard.map(x => ({ id: x.id })))))).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
    expect(ids(await both(guard.cte().where(x => x.id.gt(2))))).toEqual([3, 4, 5]);
    expect(ids(await both(q.where(x => x.id.in(guard.map(g => g.id)))))).toEqual([2, 3, 4, 5]);
  });

  it('expansion: PREWHERE runs on the table row, and a later WHERE on the expanded row', async () => {
    const expanded = q.prewhere(x => x.v.lt(30)).arrayJoin(x => x.tags, 'tag');
    expect(await both(expanded.map(x => ({ id: x.id, tag: x.tag })).orderBy(x => x.tag), true)).toEqual([{ id: 1, tag: 'a' }, { id: 1, tag: 'b' }]);
    expect(await both(expanded.where(x => x.tag.ne('b')).map(x => ({ id: x.id })))).toEqual([{ id: 1 }]);
    expect(await both(q.prewhere(x => x.tags.notEmpty()).arrayJoin(x => x.tags, 'tag').groupBy(x => ({ id: x.id })).aggregate(() => ({ c: count() })).orderBy(x => x.id), true)).toEqual([{ id: 1, c: 2n }, { id: 3, c: 1n }, { id: 4, c: 1n }]);
    expect(ids(await both(q.prewhere(x => x.v.lt(30)).leftArrayJoin(x => x.tags, 'tag').map(x => ({ id: x.id, tag: x.tag }))))).toEqual([1, 1, 2]);
  });

  it('an alias never captures a predicate column', async () => {
    expect(await both(q.prewhere(x => x.v.lt(20)).map(x => ({ v: x.v.plus(1000), id: x.id })))).toEqual([{ v: 1010n, id: 1 }]);
    expect(await both(q.prewhere(x => x.v.lt(30)).groupBy(x => ({ cat: x.cat })).aggregate(x => ({ v: sum(x.v) })))).toEqual([{ cat: 'x', v: 30n }]);
    expect(await both(q.prewhere(x => x.v.lt(30)).groupBy(x => ({ cat: x.cat })).aggregate(x => ({ v: max(x.v) })).orderBy(x => x.v).limitBy(x => x.v).take(1))).toEqual([{ cat: 'x', v: 20 }]);
    const shadowExpansion = q.prewhere(x => x.cat.eq('x')).map(x => ({ id: x.id, tags: x.tags })).arrayJoin(x => x.tags, 'cat').map(x => ({ id: x.id, cat: x.cat }));
    expect(await both(shadowExpansion.orderBy(x => x.cat), true)).toEqual([{ id: 1, cat: 'a' }, { id: 1, cat: 'b' }]);
  });

  it('a guard in PREWHERE protects a fallible WHERE, select item, key, aggregate and expansion', async () => {
    const guarded = q.prewhere(x => x.s.ne('bad'));
    expect(ids(await both(guarded.where(x => cast(x.s, col.UInt32).gt(0))))).toEqual([1, 2, 4, 5]);
    expect(await both(guarded.map(x => ({ n: cast(x.s, col.UInt32) })).orderBy(x => x.n).limit(1), true)).toEqual([{ n: 1 }]);
    expect(await both(guarded.groupBy(x => ({ n: cast(x.s, col.UInt32) })).aggregate(() => ({ c: count() })).orderBy(x => x.n).limit(1), true)).toEqual([{ n: 1, c: 1n }]);
    expect(await both(guarded.aggregate(x => ({ m: max(cast(x.s, col.UInt32)) })))).toEqual([{ m: 5 }]);
    const joined = join({ a: guarded, b: from(u) }).on(x => x.a.id.eq(x.b.id)).where(x => cast(x.a.s, col.UInt32).gt(0));
    expect(await both(joined.map(x => ({ id: x.a.id })).orderBy(x => x.id), true)).toEqual([{ id: 1 }, { id: 4 }]);
  });

  it('a fallible PREWHERE fails over a total WHERE guard, on both paths', async () => {
    await failsToCast(q.prewhere(x => cast(x.s, col.UInt32).gt(0)).where(x => x.s.ne('bad')));
  });

  it('the predicate is never reordered: guard first passes, guard last fails', async () => {
    expect(ids(await both(q.prewhere(x => x.s.ne('bad').and(cast(x.s, col.UInt32).gt(0)))))).toEqual([1, 2, 4, 5]);
    await failsToCast(q.prewhere(x => cast(x.s, col.UInt32).gt(0).and(x.s.ne('bad'))));
  });

  it('join sides are derived tables, inner and left', async () => {
    const side = from(u).prewhere(x => x.w.eq('q'));
    expect(ids((await both(join({ a: q.prewhere(x => x.v.gt(30)), b: side }).on(x => x.a.id.eq(x.b.id)).map(x => ({ id: x.a.id })))))).toEqual([4]);
    const left = leftJoin({ a: q.prewhere(x => x.v.lt(40)) }, { b: side }).on(x => x.a.id.eq(x.b.id)).map(x => ({ id: x.a.id, w: x.b.w })).orderBy(x => x.id);
    expect(await both(left, true)).toEqual([{ id: 1, w: null }, { id: 2, w: null }, { id: 3, w: 'q' }]);
  });

  it('a shared Scan and a shared Prewhere both stay valid', async () => {
    const a = q.prewhere(x => x.v.gt(30)).map(x => ({ id: x.id }));
    const b = q.where(x => x.v.lt(20)).map(x => ({ id: x.id }));
    const c = q.where(x => x.v.eq(30)).map(x => ({ id: x.id }));
    expect(ids(await both(unionAll(a, b, c)))).toEqual([1, 3, 4, 5]);
    const shared = q.prewhere(x => x.v.gt(30));
    expect(planned().compile(unionAll(shared, shared).ir).compiled.sql).toContain('WITH');
    expect(ids(await both(unionAll(shared, shared)))).toEqual([4, 4, 5, 5]);
  });

  it('FINAL with a non-key predicate returns the stale row, and WHERE does not', async () => {
    const stale = await both(from(r).final().prewhere(x => x.status.eq('open')).orderBy(x => x.id).thenBy(x => x.ver), true);
    expect(stale).toEqual([{ id: 1, ver: 1, status: 'open' }, { id: 2, ver: 1, status: 'open' }]);
    expect(await both(from(r).final().where(x => x.status.eq('open')), true)).toEqual([{ id: 2, ver: 1, status: 'open' }]);
    expect(stale).toEqual(await native("SELECT id, ver, status FROM pw_r FINAL PREWHERE status = 'open' ORDER BY id, ver"));
    expect(planned().compile(from(r).final().prewhere(x => x.status.eq('open')).ir).compiled.sql).toContain('FINAL PREWHERE');
  });

  it('FINAL with a key predicate matches WHERE', async () => {
    const pre = await both(from(r).final().prewhere(x => x.id.eq(1)));
    expect(pre).toEqual(await both(from(r).final().where(x => x.id.eq(1))));
    expect(pre).toEqual([{ id: 1, ver: 2, status: 'closed' }]);
  });

  it('SAMPLE keeps the count WHERE gets, and takes FINAL and PREWHERE after it', async () => {
    const pre = (await both(from(sampled).sample(0.1).prewhere(x => x.v.lt(5)).count())) as { count: bigint }[];
    const where = (await both(from(sampled).sample(0.1).where(x => x.v.lt(5)).count())) as { count: bigint }[];
    expect(pre).toEqual(where);
    expect(pre[0]!.count).toBeGreaterThan(0n);
    expect(pre[0]!.count).toBeLessThan(5000n);
  });

  it('an engine without PREWHERE surfaces code 182 as QueryError', async () => {
    for (const cause of await failure(from(memory).prewhere(x => x.id.gt(0)))) expect(cause.code).toBe('182');
  });

  it('run and stream return the same rows, through the public client', async () => {
    const client = createTypedClient(options);
    try {
      const query = q.prewhere(x => x.v.gt(10)).where(x => x.id.lt(5)).orderBy(x => x.id);
      const streamed: unknown[] = [];
      for await (const row of client.stream(query)) streamed.push(row);
      expect(streamed).toEqual(await client.run(query));
      expect(ids(streamed)).toEqual([2, 3, 4]);
    } finally { await client.close(); }
  });
});
