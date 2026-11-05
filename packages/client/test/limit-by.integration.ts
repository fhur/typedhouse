import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, from, join, leftJoin, max, table, unionAll, val, type Caps, type Query } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient as createTypedClient, QueryError } from '../src/index.js';
import { collect, differential } from './backend-harness.js';

const t = table('lb', { id: col.UInt32, cat: col.String, ng: col.Nullable(col.String), f: col.Float64, v: col.UInt32, s: col.String, tags: col.Array(col.String) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const u = table('lb_u', { id: col.UInt32, w: col.String }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const d = table('lb_dup', { cat: col.String, v: col.UInt32 }, { engine: 'MergeTree', sortingKey: ['cat'], partitionKey: [] });
const q = from(t);
const total = q.orderBy(r => r.v.desc()).thenBy(r => r.id);

interface LbRow { id: number; cat: string; ng: string | null; f: number; v: number; s: string; tags: string[] }
const rows: LbRow[] = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  cat: ['a', 'b', 'c'][i % 3]!,
  ng: i % 4 === 0 ? null : ['x', 'y'][i % 2]!,
  f: i % 5 === 0 ? NaN : i % 2,
  v: (i * 7) % 10,
  s: i === 23 ? 'bad' : String(i),
  tags: i % 6 === 0 ? [] : [`t${i % 2}`, `t${i % 3}`],
}));

let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
let options: Parameters<typeof createClient>[0];
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const aliasBackends: ReturnType<typeof createClickHouseBackend>[] = [];

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { output_format_json_quote_denormals: 1 } };
  driver = createClient(options);
  for (const mode of ['clickhouse-naive', 'clickhouse'] as const) {
    backends.push(createClickHouseBackend(options, mode));
    aliasBackends.push(createClickHouseBackend({ ...options, clickhouse_settings: { ...options!.clickhouse_settings, prefer_column_name_to_alias: 1 } }, mode));
  }
  await driver.command({ query: "CREATE TABLE lb (id UInt32, cat String, ng Nullable(String), f Float64, v UInt32, s String, tags Array(String)) ENGINE=MergeTree ORDER BY id" });
  await driver.command({ query: 'SYSTEM STOP MERGES lb' });
  await driver.command({ query: 'CREATE TABLE lb_u (id UInt32, w String) ENGINE=MergeTree ORDER BY id' });
  await driver.command({ query: 'CREATE TABLE lb_dup (cat String, v UInt32) ENGINE=MergeTree ORDER BY cat' });
  // Several parts, so an unordered read is not accidentally sorted.
  for (let part = 0; part < 3; part++) {
    const values = rows.filter(r => r.id % 3 === part).map(r => `(${r.id}, '${r.cat}', ${r.ng === null ? 'NULL' : `'${r.ng}'`}, ${Number.isNaN(r.f) ? 'nan' : r.f}, ${r.v}, '${r.s}', [${r.tags.map(x => `'${x}'`).join(',')}])`);
    await driver.command({ query: `INSERT INTO lb VALUES ${values.join(',')}` });
  }
  await driver.insert({ table: 'lb_u', values: rows.filter(r => r.id % 2 === 0).map(r => ({ id: r.id, w: r.id % 4 === 0 ? 'p' : 'q' })), format: 'JSONEachRow' });
  await driver.command({ query: "INSERT INTO lb_dup VALUES ('x',1),('x',1),('x',2),('x',3),('y',1),('y',1)" });
}, 120000);

afterAll(async () => {
  for (const b of [...backends, ...aliasBackends]) await b.close();
  await driver?.close();
  await container?.stop();
});

const both = (query: { ir: Query<unknown, Caps>['ir'] }, ordered = false) => differential(backends, query, ordered);
/** Handwritten SQL over the same table, as JSON-compatible rows with a fixed column order. */
async function native(query: string) {
  const result = await driver.query({ query, format: 'JSONEachRow' });
  try { return await result.json<Record<string, unknown>>(); } finally { result.close(); }
}
/** Per-group top `n` after skipping `m`, with the order the query establishes. */
function oracle(input: readonly LbRow[], key: (r: LbRow) => unknown, n: number, m = 0): LbRow[] {
  const seen = new Map<unknown, number>();
  return input.filter(r => {
    const k = key(r), at = seen.get(k) ?? 0;
    seen.set(k, at + 1);
    return at >= m && at < m + n;
  });
}
const byTotal = [...rows].sort((a, b) => b.v - a.v || a.id - b.id);
const ids = (result: readonly unknown[]) => (result as { id: number }[]).map(r => r.id);

describe('LIMIT BY on ClickHouse 24.8', () => {
  it('matches a JavaScript oracle and handwritten SQL, with and without offset', async () => {
    const taken = await both(total.limitBy(r => r.cat).take(2), true);
    expect(ids(taken)).toEqual(ids(oracle(byTotal, r => r.cat, 2)));
    expect(ids(taken)).toEqual((await native('SELECT id FROM lb ORDER BY v DESC, id ASC LIMIT 2 BY cat')).map(r => r.id));
    const paged = await both(total.limitBy(r => r.cat).take(2).offset(1), true);
    expect(ids(paged)).toEqual(ids(oracle(byTotal, r => r.cat, 2, 1)));
    expect(ids(paged)).toEqual((await native('SELECT id FROM lb ORDER BY v DESC, id ASC LIMIT 2 OFFSET 1 BY cat')).map(r => r.id));
  });

  it('applies many keys, and a full clause stack in one SELECT', async () => {
    const stack = total.where(r => r.v.gt(1)).limitBy(r => [r.cat, r.v.gt(4)]).take(1).offset(1).limit(4, 1);
    const result = await both(stack, true);
    const filtered = byTotal.filter(r => r.v > 1);
    const expected = oracle(filtered, r => `${r.cat}/${r.v > 4}`, 1, 1).slice(1, 5);
    expect(ids(result)).toEqual(ids(expected));
  });

  it('LIMIT 0 and an offset past every group return nothing', async () => {
    expect(await both(q.limitBy(r => r.cat).take(0))).toEqual([]);
    expect(await both(q.limitBy(r => r.cat).take(5).offset(100))).toEqual([]);
  });

  it('NULL is one group, and NaN is one group', async () => {
    const nulls = await both(total.limitBy(r => r.ng).take(1), true);
    expect(ids(nulls)).toEqual(ids(oracle(byTotal, r => r.ng, 1)));
    expect((nulls as LbRow[]).filter(r => r.ng === null)).toHaveLength(1);
    const nans = await both(total.limitBy(r => r.f).take(1), true);
    expect((nans as LbRow[]).filter(r => Number.isNaN(r.f))).toHaveLength(1);
    expect(nans).toHaveLength(3);
  });

  it('array keys, and an unselected key', async () => {
    const arrays = await both(total.limitBy(r => r.tags).take(1), true);
    expect(ids(arrays)).toEqual(ids(oracle(byTotal, r => JSON.stringify(r.tags), 1)));
    const unselected = await both(total.limitBy(r => r.cat).take(1).map(r => ({ id: r.id })), true);
    expect(ids(unselected)).toEqual(ids(oracle(byTotal, r => r.cat, 1)));
  });

  it('computed keys and parameters in keys', async () => {
    const computed = await both(total.limitBy(r => r.v.plus(val(3, col.UInt32)).gt(7n)).take(1), true);
    expect(ids(computed)).toEqual(ids(oracle(byTotal, r => r.v + 3 > 7, 1)));
  });

  it('join keys, through folded and nested forms', async () => {
    const joined = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.v.desc()).thenBy(r => r.a.id);
    const plain = joined.limitBy(r => [r.a.cat, r.b.w]).take(1).map(r => ({ id: r.a.id }));
    const expected = oracle(byTotal.filter(r => r.id % 2 === 0), r => `${r.cat}/${r.id % 4 === 0 ? 'p' : 'q'}`, 1);
    expect(ids(await both(plain, true))).toEqual(ids(expected));
    expect(ids(await both(joined.limitBy(r => r.b.w).take(1).map(r => ({ id: r.a.id, w: r.b.w })), true))).toHaveLength(2);
    const outer = leftJoin({ a: q.orderBy(r => r.id).limitBy(r => r.cat).take(2) }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, w: r.b.w }));
    expect(ids(await both(outer)).sort((x, y) => x - y)).toEqual(ids(oracle([...rows], r => r.cat, 2)).sort((x, y) => x - y));
  });

  it('over an aggregate, folded and over a computed key', async () => {
    const agg = q.groupBy(r => ({ cat: r.cat, v: r.v })).aggregate(() => ({ c: count() }));
    const ordered = agg.orderBy(r => r.cat).thenBy(r => r.v);
    const folded = await both(ordered.limitBy(r => r.cat).take(1), true);
    expect(folded).toEqual(await native("SELECT cat, v, count() AS c FROM lb GROUP BY cat, v ORDER BY cat, v LIMIT 1 BY cat").then(rs => rs.map(r => ({ cat: r.cat, v: r.v, c: BigInt(r.c as string) }))));
    const computed = await both(ordered.limitBy(r => r.v.gt(4)).take(1), true);
    expect(computed).toHaveLength(2);
  });

  it('an aggregate alias under prefer_column_name_to_alias = 1 does not raise code 10', async () => {
    const shadow = q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ v: count() })).orderBy(r => r.cat).limitBy(r => r.v).take(1);
    expect(await differential(aliasBackends, shadow, true)).toEqual(await differential(backends, shadow, true));
    const cte = q.map(r => ({ cat: r.cat, n: r.v })).cte();
    const overCte = cte.groupBy(r => ({ cat: r.cat })).aggregate(r => ({ n: max(r.n) })).orderBy(r => r.cat).limitBy(r => r.n).take(1);
    expect(await differential(aliasBackends, overCte, true)).toEqual(await differential(backends, overCte, true));
    const joined = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ w: r.b.w })).aggregate(() => ({ v: count() })).orderBy(r => r.w).limitBy(r => r.v).take(1);
    expect(await differential(aliasBackends, joined, true)).toEqual(await differential(backends, joined, true));
  });

  it('every nesting order agrees with naive and with a JavaScript oracle where one is written', async () => {
    const orderedCat = q.orderBy(r => r.id);
    const limitThen = orderedCat.limit(5).limitBy(r => r.cat).take(1);
    expect(ids(await both(limitThen, true))).toEqual(ids(oracle(rows.slice(0, 5), r => r.cat, 1)));
    const thenOrder = orderedCat.limitBy(r => r.cat).take(1).orderBy(r => r.id.desc());
    expect(ids(await both(thenOrder, true))).toEqual(ids(oracle(rows, r => r.cat, 1)).reverse());
    const twice = orderedCat.limitBy(r => r.cat).take(2).limitBy(r => r.v.gt(4)).take(1);
    expect(ids(await both(twice)).length).toBeGreaterThan(0);
    const thenWhere = orderedCat.limitBy(r => r.cat).take(1).where(r => r.id.gt(1));
    expect(ids(await both(thenWhere)).sort((x, y) => x - y)).toEqual([2, 3]);
    const overMap = q.map(r => ({ cat: r.s, k: r.v.gt(4), id: r.id })).orderBy(r => r.id).limitBy(r => r.k).take(1);
    expect(ids(await both(overMap, true))).toEqual(ids(oracle(rows, r => r.v > 4, 1)));
    const shared = orderedCat.limitBy(r => r.cat).take(1);
    expect(ids(await both(unionAll(shared, shared))).length).toBe(6);
    const viaCte = orderedCat.limitBy(r => r.cat).take(1).cte().where(r => r.id.gt(1));
    expect(ids(await both(viaCte)).sort((x, y) => x - y)).toEqual([2, 3]);
    const expansion = q.orderBy(r => r.id).arrayJoin(r => r.tags, 'tag').limitBy(r => r.tag).take(1).map(r => ({ id: r.id, tag: r.tag }));
    expect((await both(expansion)).length).toBe(3);
    const folded = q.arrayJoin(r => r.tags, 'tag').limitBy(r => r.tag).take(1000).map(r => ({ id: r.id }));
    expect((await both(folded)).length).toBe(rows.reduce((n, r) => n + r.tags.length, 0));
  });

  it('DISTINCT runs before a folded LIMIT BY, and after a nested one', async () => {
    const distinct = from(d).map(r => ({ cat: r.cat, v: r.v })).distinct().orderBy(r => r.cat).thenBy(r => r.v);
    expect(await both(distinct.limitBy(r => r.cat).take(2), true)).toEqual([{ cat: 'x', v: 1 }, { cat: 'x', v: 2 }, { cat: 'y', v: 1 }]);
    const unsorted = from(d).map(r => ({ cat: r.cat, v: r.v })).distinct();
    const folded = (await both(unsorted.limitBy(r => r.cat).take(5))) as { cat: string; v: number }[];
    expect(folded.sort((a, b) => a.cat.localeCompare(b.cat) || a.v - b.v)).toEqual([{ cat: 'x', v: 1 }, { cat: 'x', v: 2 }, { cat: 'x', v: 3 }, { cat: 'y', v: 1 }]);
    const nested = from(d).orderBy(r => r.v).limitBy(r => r.cat).take(2).distinct();
    expect((await both(nested) as { cat: string; v: number }[]).sort((a, b) => a.cat.localeCompare(b.cat))).toEqual([{ cat: 'x', v: 1 }, { cat: 'y', v: 1 }]);
  });

  it('a fallible filter above sees only retained rows, on both paths', async () => {
    // id 24 has s = 'bad', and is the last of its group: LIMIT BY drops it before the cast runs.
    const kept = q.orderBy(r => r.id).limitBy(r => r.cat).take(2).where(r => cast(r.s, col.UInt32).ge(0));
    expect(ids(await both(kept)).sort((x, y) => x - y)).toEqual(ids(oracle(rows, r => r.cat, 2)).sort((x, y) => x - y));
  });

  it('a fallible key runs only on rows that a folded WHERE retains', async () => {
    const guarded = q.where(r => r.s.ne('bad')).orderBy(r => r.id).limitBy(r => cast(r.s, col.UInt32).gt(0)).take(1);
    expect(ids(await both(guarded, true))).toEqual([1, 2]);
  });

  it('run and stream return the same rows, through the public client', async () => {
    const client = createTypedClient(options);
    try {
      const query = total.limitBy(r => r.cat).take(2).offset(1);
      const streamed: unknown[] = [];
      for await (const row of client.stream(query)) streamed.push(row);
      const buffered = await client.run(query);
      expect(streamed).toEqual(buffered);
      expect(ids(buffered)).toEqual(ids(oracle(byTotal, r => r.cat, 2, 1)));
    } finally { await client.close(); }
  });

  it('every emitted form parses, including no-rows forms', async () => {
    for (const query of [q.limitBy(r => r.cat).take(1), q.limitBy(r => r.cat).take(1).offset(0), q.limitBy(r => [r.cat, r.id]).take(0)]) {
      for (const compiled of [compile(query.ir), emitNaive(query.ir)]) {
        const result = await driver.query({ query: compiled.sql, format: 'JSONEachRow', query_params: compiled.params });
        result.close();
      }
    }
  });

  it('a server failure in a key surfaces as QueryError', async () => {
    const plan = backends[1]!.compile(q.limitBy(r => cast(r.s, col.UInt32)).take(1).ir);
    await expect(collect(backends[1]!.run(plan))).rejects.toBeInstanceOf(QueryError);
  });
});
