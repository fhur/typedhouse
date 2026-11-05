import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, type Expr, from, join, leftJoin, max, scalar, sql, sum, table, unionAll, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient as createTypedClient, QueryError } from '../src/index.js';
import { collect, differential } from './backend-harness.js';
import { resultsContract, type QueryOutcome } from './results-contract.js';

/** Track C4 Tester probes on clickhouse/clickhouse-server:24.8. Each query runs naive and optimized under
 * prefer_column_name_to_alias 0 and 1, and is compared with a JavaScript oracle where the order is deterministic. */
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const t = table('lba', { id: col.UInt32, cat: col.String, ng: col.Nullable(col.String), v: col.UInt32, s: col.String, tags: col.Array(col.String), f: col.Float64, big: col.UInt64, at: col.Date }, meta);
const u = table('lba_u', { id: col.UInt32, w: col.String }, meta);
const r8 = table('lba_r', { id: col.UInt32, cat: col.String, ver: col.UInt32 }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] });
const smp = table('lba_s', { id: col.UInt32, cat: col.String }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const nan = table('lba_nan', { id: col.UInt32, f: col.Float64 }, meta);
const big = table('lba_big', { id: col.UInt32, cat: col.String, v: col.UInt32 }, meta);
const q = from(t);
const byId = q.orderBy(r => r.id);
const list = 'id, cat, ng, v, s, tags, f, big, at';

interface Row { id: number; cat: string; ng: string | null; v: number; s: string; tags: string[]; f: number; big: bigint; at: Date }
const cats = ['a', 'b', 'c'];
/** `s` is not a number only on the last row of each category, which every `take(2)` over `byId` drops. */
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  cat: cats[i % 3]!,
  ng: i % 4 === 0 ? null : ['x', 'y'][i % 2]!,
  v: (i * 7) % 10,
  s: i >= 27 ? 'bad' : String(i),
  tags: i % 5 === 0 ? [] : [`t${i % 2}`, `t${i % 3}`],
  f: i % 7 === 0 ? NaN : i % 2,
  big: 9007199254740993n + BigInt(i),
  at: new Date(Date.UTC(2024, 0, 1 + (i % 3))),
}));
const uRows = rows.filter(r => r.id % 2 === 0).map(r => ({ id: r.id, w: r.id % 4 === 0 ? 'p' : 'q' }));
const wOf = (id: number) => uRows.find(x => x.id === id)?.w;

let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
let options: Parameters<typeof createClient>[0];
const defaults: ReturnType<typeof createClickHouseBackend>[] = [];
const prefers: ReturnType<typeof createClickHouseBackend>[] = [];

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture', clickhouse_settings: { output_format_json_quote_denormals: 1, output_format_json_quote_64bit_integers: 1 } };
  driver = createClient(options);
  for (const mode of ['clickhouse-naive', 'clickhouse'] as const) {
    defaults.push(createClickHouseBackend(options, mode));
    prefers.push(createClickHouseBackend({ ...options, clickhouse_settings: { ...options!.clickhouse_settings, prefer_column_name_to_alias: 1 } }, mode));
  }
  await driver.command({ query: 'CREATE TABLE lba (id UInt32, cat String, ng Nullable(String), v UInt32, s String, tags Array(String), f Float64, big UInt64, at Date) ENGINE=MergeTree ORDER BY id' });
  await driver.command({ query: 'SYSTEM STOP MERGES lba' });
  for (let part = 0; part < 4; part++) {
    const values = rows.filter(r => r.id % 4 === part).map(r => `(${r.id}, '${r.cat}', ${r.ng === null ? 'NULL' : `'${r.ng}'`}, ${r.v}, '${r.s}', [${r.tags.map(x => `'${x}'`).join(',')}], ${Number.isNaN(r.f) ? 'nan' : r.f}, ${r.big}, '${r.at.toISOString().slice(0, 10)}')`);
    await driver.command({ query: `INSERT INTO lba VALUES ${values.join(',')}` });
  }
  await driver.command({ query: 'CREATE TABLE lba_u (id UInt32, w String) ENGINE=MergeTree ORDER BY id' });
  await driver.insert({ table: 'lba_u', values: uRows, format: 'JSONEachRow' });
  await driver.command({ query: 'CREATE TABLE lba_r (id UInt32, cat String, ver UInt32) ENGINE=ReplacingMergeTree(ver) ORDER BY id' });
  await driver.command({ query: 'SYSTEM STOP MERGES lba_r' });
  // id 1 moves from category a to b; id 2 from b to a. Without FINAL the stale versions are visible.
  await driver.command({ query: "INSERT INTO lba_r VALUES (1,'a',1),(2,'b',1),(3,'c',1)" });
  await driver.command({ query: "INSERT INTO lba_r VALUES (1,'b',2),(2,'a',2)" });
  await driver.command({ query: 'CREATE TABLE lba_s (id UInt32, cat String) ENGINE=MergeTree ORDER BY intHash32(id) SAMPLE BY intHash32(id)' });
  await driver.command({ query: "INSERT INTO lba_s SELECT number, ['a','b','c'][number % 3 + 1] FROM numbers(3000)" });
  await driver.command({ query: 'CREATE TABLE lba_nan (id UInt32, f Float64) ENGINE=MergeTree ORDER BY id' });
  await driver.command({ query: 'CREATE TABLE lba_big (id UInt32, cat String, v UInt32) ENGINE=MergeTree ORDER BY id' });
  await driver.command({ query: 'SYSTEM STOP MERGES lba_big' });
  for (let part = 0; part < 5; part++) await driver.command({ query: `INSERT INTO lba_big SELECT number * 5 + ${part}, toString(cityHash64(number) % 97), cityHash64(number, 1) % 1000 FROM numbers(40000)` });
}, 180000);

afterAll(async () => {
  for (const b of [...defaults, ...prefers]) await b.close();
  await driver?.close();
  await container?.stop();
});

/** Every backend agrees, and returns `expected` when one is given. `expected` is an id list unless `by` projects otherwise. */
async function agree(query: { ir: Rel }, ordered: boolean, check?: (result: unknown[]) => void) {
  const first = await differential(defaults, query, ordered);
  const second = await differential(prefers, query, ordered);
  await differential([defaults[0]!, prefers[1]!], query, ordered);
  if (ordered) expect(second).toEqual(first);
  check?.(first);
  return first;
}
const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
const ids = (result: readonly unknown[]) => (result as { id: number }[]).map(r => r.id);
function keep<T>(input: readonly T[], key: (r: T) => unknown, n: number, m = 0): T[] {
  const seen = new Map<unknown, number>();
  return input.filter(r => {
    const k = key(r), at = seen.get(k) ?? 0;
    seen.set(k, at + 1);
    return at >= m && at < m + n;
  });
}
async function native(query: string, settings: Record<string, string | number> = {}) {
  const result = await driver.query({ query, format: 'JSONEachRow', clickhouse_settings: settings as never });
  try { return await result.json<Record<string, unknown>>(); } finally { result.close(); }
}
const firstTwo = keep(rows, r => r.cat, 2);

describe('clause ordering and folding, with a JavaScript oracle', () => {
  const oracleCases: readonly (readonly [string, () => { ir: Rel }, () => readonly number[], boolean])[] = [
    ['where, orderBy, limitBy', () => q.where(r => r.v.gt(2)).orderBy(r => r.id).limitBy(r => r.cat).take(2), () => keep(rows.filter(r => r.v > 2), r => r.cat, 2).map(r => r.id), true],
    ['orderBy, where, limitBy: the filter nests over the sort', () => byId.where(r => r.v.gt(2)).limitBy(r => r.cat).take(2), () => keep(rows.filter(r => r.v > 2), r => r.cat, 2).map(r => r.id), true],
    ['limitBy, where: the filter sees retained rows only', () => byId.limitBy(r => r.cat).take(2).where(r => r.v.gt(2)), () => firstTwo.filter(r => r.v > 2).map(r => r.id), false],
    ['limitBy, where on the key', () => byId.limitBy(r => r.cat).take(2).where(r => r.cat.eq('a')), () => firstTwo.filter(r => r.cat === 'a').map(r => r.id), false],
    ['limitBy, limit', () => byId.limitBy(r => r.cat).take(2).limit(4, 1), () => firstTwo.slice(1, 5).map(r => r.id), true],
    ['limit, limitBy', () => byId.limit(4, 1).limitBy(r => r.cat).take(1), () => keep(rows.slice(1, 5), r => r.cat, 1).map(r => r.id), true],
    ['take and offset, limit and offset', () => byId.limitBy(r => r.cat).take(2).offset(1).limit(3, 1), () => keep(rows, r => r.cat, 2, 1).slice(1, 4).map(r => r.id), true],
    ['limitBy, limitBy', () => byId.limitBy(r => r.cat).take(2).limitBy(r => r.v.gt(4)).take(1), () => keep(firstTwo, r => r.v > 4, 1).map(r => r.id), false],
    ['limitBy twice on one key with offsets', () => byId.limitBy(r => r.cat).take(4).offset(1).limitBy(r => r.cat).take(1).offset(1), () => keep(keep(rows, r => r.cat, 4, 1), r => r.cat, 1, 1).map(r => r.id), false],
    ['limitBy, orderBy', () => byId.limitBy(r => r.cat).take(2).orderBy(r => r.id.desc()), () => [...firstTwo].reverse().map(r => r.id), true],
    ['limitBy, identity map, where', () => byId.limitBy(r => r.cat).take(2).map(r => ({ id: r.id, v: r.v })).where(r => r.v.gt(2)), () => firstTwo.filter(r => r.v > 2).map(r => r.id), false],
    ['limitBy, computed map, where', () => byId.limitBy(r => r.cat).take(2).map(r => ({ id: r.id, k: r.v.plus(1) })).where(r => r.k.gt(3n)), () => firstTwo.filter(r => r.v + 1 > 3).map(r => r.id), false],
    ['orderBy, computed map, limitBy', () => byId.map(r => ({ id: r.id, k: r.v.gt(4) })).limitBy(r => r.k).take(2), () => keep(rows, r => r.v > 4, 2).map(r => r.id), true],
    ['a renaming map: the key is the renamed column', () => byId.map(r => ({ id: r.id, cat: r.s, s: r.cat })).limitBy(r => r.cat).take(1), () => keep(rows, r => r.s, 1).map(r => r.id), true],
    ['a computed alias named as the column it reads', () => byId.map(r => ({ id: r.id, v: r.v.gt(4) })).limitBy(r => r.v).take(1), () => keep(rows, r => r.v > 4, 1).map(r => r.id), true],
    ['an unselected column named as another alias', () => byId.map(r => ({ id: r.id, cat: r.v.gt(4) })).limitBy(r => r.cat).take(1).map(r => ({ id: r.id })), () => keep(rows, r => r.v > 4, 1).map(r => r.id), false],
    ['many keys', () => byId.limitBy(r => [r.cat, r.ng, r.v.gt(4)]).take(1).offset(1), () => keep(rows, r => `${r.cat}/${r.ng}/${r.v > 4}`, 1, 1).map(r => r.id), true],
    ['a repeated key', () => byId.limitBy(r => [r.cat, r.cat]).take(1), () => keep(rows, r => r.cat, 1).map(r => r.id), true],
    ['a key that the server can fold (isNull of a non-null column)', () => byId.limitBy(r => r.id.isNull()).take(2), () => rows.slice(0, 2).map(r => r.id), true],
    ['a constant-valued column from a map, read by name', () => byId.map(r => ({ id: r.id, k: val(2, col.UInt32) })).limitBy(r => r.k).take(2), () => rows.slice(0, 2).map(r => r.id), true],
    ['a date key', () => byId.limitBy(r => r.at).take(1), () => keep(rows, r => r.at.getTime(), 1).map(r => r.id), true],
    ['a UInt64 key above 2^53', () => byId.limitBy(r => r.big).take(1).limit(3), () => rows.slice(0, 3).map(r => r.id), true],
    ['a membership key with a subquery', () => byId.limitBy(r => r.id.in(from(u).map(x => x.id))).take(1), () => keep(rows, r => wOf(r.id) !== undefined, 1).map(r => r.id), true],
    ['a sql key that reads the row', () => byId.limitBy(r => sql`${r.v} % 2`.as(col.UInt32)).take(1), () => keep(rows, r => r.v % 2, 1).map(r => r.id), true],
    ['take 0', () => byId.limitBy(r => r.cat).take(0), () => [], true],
    ['take 0 with offset', () => byId.limitBy(r => r.cat).take(0).offset(1), () => [], true],
    ['offset 0', () => byId.limitBy(r => r.cat).take(1).offset(0), () => keep(rows, r => r.cat, 1).map(r => r.id), true],
    ['the largest safe take', () => byId.limitBy(r => r.cat).take(Number.MAX_SAFE_INTEGER), () => rows.map(r => r.id), true],
    ['the largest safe offset', () => byId.limitBy(r => r.cat).take(1).offset(Number.MAX_SAFE_INTEGER), () => [], true],
    ['both largest safe', () => byId.limitBy(r => r.cat).take(Number.MAX_SAFE_INTEGER).offset(Number.MAX_SAFE_INTEGER), () => [], true],
    ['union input', () => unionAll(q.where(r => r.id.le(10)), q.where(r => r.id.gt(10))).orderBy(r => r.id).limitBy(r => r.cat).take(2), () => firstTwo.map(r => r.id), true],
    ['union of two, filter above', () => unionAll(byId.limitBy(r => r.cat).take(1), byId.limitBy(r => r.cat).take(1).offset(1)).where(r => r.v.gt(2)), () => firstTwo.filter(r => r.v > 2).map(r => r.id), false],
    ['union, limitBy, union', () => unionAll(unionAll(q, q).orderBy(r => r.id).limitBy(r => r.cat).take(2), byId.where(r => r.id.eq(1))), () => [1, 1, 2, 2, 3, 3, 1], false],
    ['one branch shared', () => { const s = byId.limitBy(r => r.cat).take(1); return unionAll(s, s).where(r => r.v.ge(0)); }, () => [...keep(rows, r => r.cat, 1), ...keep(rows, r => r.cat, 1)].map(r => r.id), false],
    ['shared LimitBy with a filter on one use', () => { const s = byId.limitBy(r => r.cat).take(2); return unionAll(s, s.where(r => r.cat.eq('a'))); }, () => [...firstTwo, ...firstTwo.filter(r => r.cat === 'a')].map(r => r.id), false],
    ['shared input with different LimitBy', () => { const s = byId.where(r => r.v.gt(2)); return unionAll(s.limitBy(r => r.cat).take(1), s.limitBy(r => r.ng).take(1)); }, () => { const f = rows.filter(r => r.v > 2); return [...keep(f, r => r.cat, 1), ...keep(f, r => r.ng, 1)].map(r => r.id); }, false],
    ['CTE input', () => byId.cte().limitBy(r => r.cat).take(2), () => firstTwo.map(r => r.id), true],
    ['CTE over it', () => byId.limitBy(r => r.cat).take(2).cte().where(r => r.v.gt(2)), () => firstTwo.filter(r => r.v > 2).map(r => r.id), false],
    ['CTE, offset, CTE, second LimitBy', () => byId.cte().limitBy(r => r.cat).take(3).offset(1).cte().limitBy(r => r.cat).take(1), () => keep(keep(rows, r => r.cat, 3, 1), r => r.cat, 1).map(r => r.id), false],
    ['distinct, sort, limitBy', () => q.distinct().orderBy(r => r.id).limitBy(r => r.cat).take(2), () => firstTwo.map(r => r.id), false],
    ['limitBy, distinct', () => byId.limitBy(r => r.cat).take(2).distinct(), () => firstTwo.map(r => r.id), false],
    ['expansion, limitBy on a source column', () => byId.where(r => r.id.le(10)).arrayJoin(r => r.tags, 'tag').limitBy(r => r.id).take(1).map(r => ({ id: r.id })), () => rows.filter(r => r.id <= 10 && r.tags.length).map(r => r.id), false],
    ['limitBy, expansion, filter on a source column', () => byId.limitBy(r => r.cat).take(2).arrayJoin(r => r.tags, 'tag').where(r => r.cat.eq('b')).map(r => ({ id: r.id })), () => firstTwo.filter(r => r.cat === 'b').flatMap(r => r.tags.map(() => r.id)), false],
    ['left expansion, limitBy on the alias', () => from(t).where(r => r.id.eq(1)).leftArrayJoin(r => r.tags, 'tag').limitBy(r => r.tag).take(1).map(r => ({ id: r.id })), () => [1], false],
  ];
  it.each(oracleCases)('%s', async (_name, build, expected, ordered) => {
    await agree(build(), ordered, result => {
      const actual = ids(result);
      if (ordered) expect(actual).toEqual(expected());
      else expect(sorted(actual)).toEqual(sorted(expected()));
    });
  });

  it('LIMIT BY over a sort survives filters, maps and CTEs on every thread count, with redundant-sort removal on and off', async () => {
    const big0 = from(big).orderBy(r => r.v.desc()).thenBy(r => r.id);
    const queries = [
      big0.limitBy(r => r.cat).take(2).offset(1),
      big0.where(r => r.v.lt(900)).limitBy(r => r.cat).take(2),
      big0.map(r => ({ id: r.id, c2: r.cat, v2: r.v.plus(1) })).limitBy(r => r.c2).take(2),
      big0.cte().limitBy(r => r.cat).take(2),
    ];
    const handwritten = [
      'SELECT id FROM lba_big ORDER BY v DESC, id ASC LIMIT 2 OFFSET 1 BY cat',
      'SELECT id FROM lba_big WHERE v < 900 ORDER BY v DESC, id ASC LIMIT 2 BY cat',
      'SELECT id FROM lba_big ORDER BY v DESC, id ASC LIMIT 2 BY cat',
      'SELECT id FROM lba_big ORDER BY v DESC, id ASC LIMIT 2 BY cat',
    ];
    for (const settings of [{}, { max_threads: 1 }, { query_plan_remove_redundant_sorting: 0 }, { max_threads: 16 }]) {
      for (const [i, query] of queries.entries()) {
        const expected = (await native(handwritten[i]!, settings)).map(r => r.id);
        expect(expected.length).toBeGreaterThan(100);
        for (const compiled of [compile(query.ir), emitNaive(query.ir)]) {
          const result = await driver.query({ query: compiled.sql, query_params: compiled.params, format: 'JSONEachRow', clickhouse_settings: settings as never });
          try { expect((await result.json<{ id: unknown }>()).map(r => r.id), compiled.sql).toEqual(expected); } finally { result.close(); }
        }
      }
    }
  }, 120000);
});

describe('joins', () => {
  it('a key on either side of an inner join, through folded and nested forms', async () => {
    const joined = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.id);
    const matched = rows.filter(r => wOf(r.id));
    await agree(joined.limitBy(r => r.b.w).take(1).map(r => ({ id: r.a.id })), false, result => expect(sorted(ids(result))).toEqual(sorted(keep(matched, r => wOf(r.id), 1).map(r => r.id))));
    await agree(joined.limitBy(r => [r.a.cat, r.b.w]).take(1).offset(1).map(r => ({ id: r.a.id })), false, result => expect(sorted(ids(result))).toEqual(sorted(keep(matched, r => `${r.cat}/${wOf(r.id)}`, 1, 1).map(r => r.id))));
  });
  it('NULL extension: unmatched rows are one group, under both settings', async () => {
    const joined = leftJoin({ a: q }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.id);
    await agree(joined.limitBy(r => r.b.w).take(1).map(r => ({ id: r.a.id, w: r.b.w })), false, result => {
      expect(sorted(ids(result))).toEqual(sorted(keep(rows, r => wOf(r.id) ?? null, 1).map(r => r.id)));
      expect((result as { w: string | null }[]).filter(r => r.w === null)).toHaveLength(1);
    });
  });
  it('a null-rejecting filter under the key: LeftToInner keeps the key descriptor', async () => {
    const joined = leftJoin({ a: q }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('p')).orderBy(r => r.a.id);
    await agree(joined.limitBy(r => r.b.w).take(2).map(r => ({ id: r.a.id, w: r.b.w })), false, result => expect(sorted(ids(result))).toEqual(rows.filter(r => wOf(r.id) === 'p').slice(0, 2).map(r => r.id)));
  });
  it('a filter on a side above a LimitBy input does not change which rows that side retains', async () => {
    const side = byId.limitBy(r => r.cat).take(2);
    const joined = join({ a: side, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.v.gt(2)).map(r => ({ id: r.a.id }));
    await agree(joined, false, result => expect(sorted(ids(result))).toEqual(sorted(firstTwo.filter(r => r.v > 2 && wOf(r.id)).map(r => r.id))));
    const outer = leftJoin({ a: side }, { b: byId.limitBy(r => r.cat).take(1).map(r => ({ id: r.id, w: r.cat })) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('a')).map(r => ({ id: r.a.id }));
    await agree(outer, false, result => expect(ids(result)).toEqual([1]));
  });
  it('one LimitBy on both sides of a self join is a CTE', async () => {
    const side = byId.limitBy(r => r.cat).take(2);
    const self = join({ a: side, b: side }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id }));
    expect(compile(self.ir).sql).toMatch(/^WITH `t0` AS/);
    await agree(self, false, result => expect(sorted(ids(result))).toEqual(sorted(firstTwo.map(r => r.id))));
  });
  it('a direct selection that swaps side columns: the key is the selected name', async () => {
    const swap = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, w: r.a.cat, cat: r.b.w })).orderBy(r => r.id).limitBy(r => r.cat).take(1);
    await agree(swap, true, result => expect(ids(result)).toEqual(keep(rows.filter(r => wOf(r.id)), r => wOf(r.id), 1).map(r => r.id)));
  });
  it('nested join keys, and a LimitBy over a nested join as a join input', async () => {
    const inner = join({ x: q, y: from(u) }).on(r => r.x.id.eq(r.y.id));
    const matched = rows.filter(r => wOf(r.id));
    const deep = join({ a: inner, b: from(u) }).on(r => r.a.x.id.eq(r.b.id)).orderBy(r => r.a.x.id).limitBy(r => [r.a.x.cat, r.b.w]).take(1).map(r => ({ id: r.a.x.id }));
    await agree(deep, false, result => expect(sorted(ids(result))).toEqual(sorted(keep(matched, r => `${r.cat}/${wOf(r.id)}`, 1).map(r => r.id))));
    const side = inner.orderBy(r => r.x.id).limitBy(r => r.y.w).take(1);
    const outer = join({ a: side, b: from(u) }).on(r => r.a.x.id.eq(r.b.id)).map(r => ({ id: r.a.x.id, w: r.a.y.w }));
    await agree(outer, false, result => expect(sorted(ids(result))).toEqual(sorted(keep(matched, r => wOf(r.id), 1).map(r => r.id))));
  });
  it('nested rows decode through run and stream, with the original shape', async () => {
    const joined = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.id).limitBy(r => r.b.w).take(1);
    const client = createTypedClient(options);
    try {
      const buffered = await client.run(joined);
      const streamed: unknown[] = [];
      for await (const row of client.stream(joined)) streamed.push(row);
      expect(streamed).toEqual(buffered);
      expect(buffered).toHaveLength(2);
      expect(buffered[0]).toEqual({ a: rows[1], b: { id: 2, w: 'q' } });
      expect(buffered[0]!.a.big).toBe(9007199254740994n);
      expect(buffered[0]!.a.at).toBeInstanceOf(Date);
      // The harness canonicalizer reads flat rows, so compare the nested rows of the naive path directly.
      const naive = createClickHouseBackend(options, 'clickhouse-naive');
      try { expect((await collect(naive.run(naive.compile(joined.ir)))).flat()).toEqual(buffered); } finally { await naive.close(); }
    } finally { await client.close(); }
  });
});

describe('aggregates', () => {
  const perCat = q.groupBy(r => ({ cat: r.cat, v: r.v })).aggregate(g => ({ c: count(), m: max(g.id) }));
  const groups = [...new Map(rows.map(r => [`${r.cat}/${r.v}`, r])).values()].map(r => ({ cat: r.cat, v: r.v, c: BigInt(rows.filter(x => x.cat === r.cat && x.v === r.v).length), m: Math.max(...rows.filter(x => x.cat === r.cat && x.v === r.v).map(x => x.id)) }));
  const ordered = [...groups].sort((a, b) => a.cat.localeCompare(b.cat) || a.v - b.v);
  it('over HAVING, ORDER BY and LIMIT on one block', async () => {
    const query = perCat.where(r => r.c.gt(0n)).orderBy(r => r.cat).thenBy(r => r.v).limitBy(r => r.cat).take(2).offset(1).limit(3);
    expect(compile(query.ir).sql.match(/SELECT/g)).toHaveLength(1);
    await agree(query, true, result => expect(result).toEqual(keep(ordered, r => r.cat, 2, 1).slice(0, 3)));
  });
  it('a key that is the aggregate value', async () => {
    const query = perCat.orderBy(r => r.cat).thenBy(r => r.v).limitBy(r => r.c).take(1);
    await agree(query, true, result => expect(result).toEqual(keep(ordered, r => r.c, 1)));
  });
  it('a computed key nests', async () => {
    const query = perCat.orderBy(r => r.cat).thenBy(r => r.v).limitBy(r => r.m.gt(10)).take(1);
    await agree(query, false, result => expect(result).toHaveLength(2));
  });
  it('aliases that shadow columns of the source, under both settings', async () => {
    const renamed = q.groupBy(r => ({ cat: r.ng.ifNull('n') })).aggregate(g => ({ v: max(g.id) })).orderBy(r => r.cat).limitBy(r => r.cat).take(1);
    await agree(renamed, true);
    const countV = q.groupBy(r => ({ s: r.cat })).aggregate(() => ({ v: count() })).orderBy(r => r.s).limitBy(r => r.v).take(1);
    await agree(countV, true, result => expect(result).toEqual([{ s: 'a', v: 10n }]));
    const keyV = q.groupBy(r => ({ v: r.cat })).aggregate(() => ({ c: count() })).orderBy(r => r.v).limitBy(r => r.v).take(1);
    await agree(keyV, true, result => expect(result).toEqual([{ v: 'a', c: 10n }, { v: 'b', c: 10n }, { v: 'c', c: 10n }]));
    const swap = q.groupBy(r => ({ cat: r.ng.ifNull('n'), ng: r.cat })).aggregate(() => ({ c: count() })).orderBy(r => r.ng).thenBy(r => r.cat).limitBy(r => r.ng).take(1);
    await agree(swap, true, result => expect(result).toHaveLength(3));
  });
  it('a join aggregate whose alias equals a side column, under both settings', async () => {
    const joined = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id));
    const alias = joined.groupBy(r => ({ w: r.b.w })).aggregate(() => ({ cat: count() })).orderBy(r => r.w).limitBy(r => r.cat).take(1);
    await agree(alias, false, result => expect((result as unknown[]).length).toBeGreaterThan(0));
    const both = joined.groupBy(r => ({ id: r.a.id })).aggregate(() => ({ c: count() })).orderBy(r => r.id).limitBy(r => r.id).take(1);
    await agree(both, true, result => expect((result as unknown[]).length).toBe(15));
  });
  it('an expansion alias as the aggregate key', async () => {
    const query = q.arrayJoin(r => r.tags, 'tag').groupBy(r => ({ tag: r.tag })).aggregate(() => ({ c: count() })).orderBy(r => r.tag).limitBy(r => r.c).take(1);
    await agree(query, false);
  });
  it('a keyless aggregate and a constant group key', async () => {
    await agree(q.aggregate(() => ({ c: count() })).limitBy(r => r.c).take(1), false, result => expect(result).toEqual([{ c: 30n }]));
    await agree(q.aggregate(() => ({ c: count() })).limitBy(r => r.c).take(0), false, result => expect(result).toEqual([]));
    const two = q.groupBy(() => ({ k: val(2, col.UInt32) })).aggregate(() => ({ c: count() })).limitBy(r => r.k).take(1);
    await agree(two, false, result => expect(result).toEqual([{ k: 2, c: 30n }]));
  });
  it('above LimitBy: the aggregate reads retained rows, keyed and keyless, with a key filter pushed', async () => {
    const top = byId.limitBy(r => r.cat).take(2);
    await agree(top.aggregate(g => ({ c: count(), s: sum(g.v) })), false, result => expect(result).toEqual([{ c: 6n, s: BigInt(firstTwo.reduce((n, r) => n + r.v, 0)) }]));
    const keyed = top.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).where(r => r.cat.eq('a'));
    await agree(keyed, false, result => expect(result).toEqual([{ cat: 'a', c: 2n }]));
    const distinct = q.map(r => ({ cat: r.cat, v: r.v })).distinct();
    await agree(distinct.orderBy(r => r.cat).thenBy(r => r.v).limitBy(r => r.cat).take(1), true);
    const aggDistinct = perCat.distinct().orderBy(r => r.cat).thenBy(r => r.v).limitBy(r => r.c).take(1);
    await agree(aggDistinct, true);
  });
});

describe('alias capture on the keys of a scan block', () => {
  it('an ARRAY JOIN alias named as the array it expands', async () => {
    const same = q.where(r => r.id.le(9)).arrayJoin(r => r.tags, 'tag').orderBy(r => r.id).thenBy(r => r.tag).limitBy(r => r.tag).take(1).map(r => ({ id: r.id, tag: r.tag }));
    await agree(same, false);
  });
  it('a physical column named like a number is not positional', async () => {
    await driver.command({ query: 'CREATE TABLE lba_num (`1` UInt32, `2` String) ENGINE=MergeTree ORDER BY `1`' });
    await driver.command({ query: "INSERT INTO lba_num VALUES (1,'a'),(2,'a'),(3,'b')" });
    const numbered = from(table('lba_num', { 1: col.UInt32, 2: col.String }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] }));
    const query = numbered.orderBy(r => r[1]).limitBy(r => r[2]).take(1);
    await agree(query, true, result => expect(result).toEqual([{ 1: 1, 2: 'a' }, { 1: 3, 2: 'b' }]));
  });
});

describe('results-only contract', () => {
  /** s is 'bad' on ids 28, 29, 30, the last of each category. */
  const kept = byId.limitBy(r => r.cat).take(2);
  const n = (r: { readonly s: Expr<string, string, 'row'> }) => cast(r.s, col.UInt32) as unknown as Expr<number, string, 'row'> & { gt(x: number): Expr<boolean, string, 'row'>; ge(x: number): Expr<boolean, string, 'row'> };
  const passing: readonly (readonly [string, () => { ir: Rel }, number])[] = [
    ['a fallible filter', () => kept.where(r => n(r).ge(0)), 6],
    ['a fallible select item', () => kept.map(r => ({ id: r.id, x: n(r) })), 6],
    ['a fallible select item, then a filter', () => kept.map(r => ({ id: r.id, x: n(r) })).where(r => r.x.ge(0)), 6],
    ['a fallible sort', () => kept.orderBy(r => n(r)), 6],
    ['a fallible second LimitBy', () => kept.limitBy(r => n(r)).take(1), 6],
    ['a fallible group key', () => kept.groupBy(r => ({ id: r.id, k: n(r) })).aggregate(() => ({ c: count() })), 6],
    ['a fallible aggregate', () => kept.aggregate(r => ({ id: sum(cast(r.s, col.UInt32)) })), 1],
    ['a fallible select item under distinct', () => kept.map(r => ({ id: r.id, x: n(r) })).distinct(), 6],
    ['a limit between it and a fallible map', () => byId.limitBy(r => r.cat).take(28).limit(3).map(r => ({ id: r.id, x: n(r) })), 3],
    ['a total map, then limit, over it', () => kept.map(r => ({ id: r.id, x: r.v.plus(1) })).limit(3), 3],
    ['a join on a side above it', () => join({ a: kept, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => n(r.a).ge(0)).map(r => ({ id: r.a.id })), firstTwo.filter(r => wOf(r.id)).length],
    ['a left join on a side above it', () => leftJoin({ a: kept }, { b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => n(r.a).ge(0)).map(r => ({ id: r.a.id })), 6],
    ['a union, each branch filtered', () => unionAll(kept, kept).where(r => n(r).ge(0)), 12],
    ['a CTE', () => kept.cte().where(r => n(r).ge(0)), 6],
    ['a subquery in a filter', () => q.where(r => r.id.in(kept.where(x => n(x).ge(0)).map(x => x.id))), 6],
    ['a subquery in a key', () => byId.limitBy(r => r.id.in(kept.where(x => n(x).ge(0)).map(x => x.id))).take(1), 2],
    ['a fallible key guarded by a folded filter', () => byId.where(r => r.s.ne('bad')).limitBy(r => n(r).gt(10)).take(1), 2],
    ['a fallible key and a fallible sort, guarded', () => q.where(r => r.s.ne('bad')).orderBy(r => n(r)).limitBy(r => n(r).gt(10)).take(1).limit(5), 2],
    ['a fallible key over a guard, a total filter above', () => q.where(r => r.s.ne('bad')).limitBy(r => n(r).gt(10)).take(1000).where(r => r.id.gt(0)), 27],
    ['a fallible key over a filtered CTE', () => q.where(r => r.s.ne('bad')).cte().limitBy(r => n(r).gt(10)).take(1000), 27],
    ['a fallible key over a filtered join', () => join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.ne('bad')).limitBy(r => n(r.a).gt(10)).take(1000).map(r => ({ id: r.a.id })), rows.filter(r => r.s !== 'bad' && wOf(r.id)).length],
    ['a fallible key after an expansion, guarded', () => q.where(r => r.s.ne('bad')).arrayJoin(r => r.tags, 'tag').limitBy(r => n(r).gt(10)).take(100000).map(r => ({ tag: r.tag })), rows.filter(r => r.s !== 'bad').reduce((m, r) => m + r.tags.length, 0)],
    ['a guard in a HAVING, a fallible key above it', () => q.groupBy(r => ({ s: r.s })).aggregate(() => ({ c: count() })).where(r => r.s.ne('bad')).limitBy(r => n(r).gt(10)).take(1000), 27],
  ];
  it.each(passing)('%s over retained or guarded rows passes naive and optimized', async (_name, build, length) => {
    await agree(build(), false, result => expect(result).toHaveLength(length));
  });
  it('a fallible key over every row fails on both paths as a QueryError', async () => {
    const query = q.limitBy(r => n(r)).take(1);
    for (const backend of defaults) await expect(collect(backend.run(backend.compile(query.ir)))).rejects.toBeInstanceOf(QueryError);
  });
  it('a total filter above never hides a key failure on one path only', async () => {
    const query = q.limitBy(r => n(r)).take(1).where(r => r.id.eq(1));
    const outcome = async (compiled: { sql: string; params: Record<string, string> }): Promise<QueryOutcome> => {
      try {
        const result = await driver.query({ query: compiled.sql, query_params: compiled.params, format: 'JSON' });
        try { return { data: (await result.json()).data as unknown[] }; } finally { result.close(); }
      } catch (error) { return { error: String(error) }; }
    };
    const verdict = resultsContract(await outcome(compile(query.ir)), await outcome(emitNaive(query.ir)));
    expect(verdict).toMatchObject({ ok: true });
  });
});

describe('scan modifiers', () => {
  it('final applies before LIMIT BY, on both paths', async () => {
    const fresh = from(r8).final().orderBy(r => r.id).limitBy(r => r.cat).take(1);
    expect(compile(fresh.ir).sql).toContain('FINAL');
    await agree(fresh, true, result => expect(result).toEqual([{ id: 1, cat: 'b', ver: 2 }, { id: 2, cat: 'a', ver: 2 }, { id: 3, cat: 'c', ver: 1 }]));
    const stale = from(r8).orderBy(r => r.id).thenBy(r => r.ver).limitBy(r => r.cat).take(1);
    await agree(stale, true, result => expect(result).toEqual([{ id: 1, cat: 'a', ver: 1 }, { id: 1, cat: 'b', ver: 2 }, { id: 3, cat: 'c', ver: 1 }]));
    const shared = from(r8).final().orderBy(r => r.id).limitBy(r => r.cat).take(1).where(r => r.ver.eq(2));
    await agree(shared, false, result => expect(ids(result)).toEqual([1, 2]));
  });
  it('sample applies before LIMIT BY, on both paths', async () => {
    const query = from(smp).sample(0.5).orderBy(r => r.id).limitBy(r => r.cat).take(5);
    expect(compile(query.ir).sql).toContain('SAMPLE 0.5');
    const result = await agree(query, true);
    expect(result).toHaveLength(15);
    const handwritten = await native('SELECT id FROM lba_s SAMPLE 0.5 ORDER BY id LIMIT 5 BY cat');
    expect(ids(result)).toEqual(handwritten.map(r => r.id));
  });
});

describe('grouping of float keys', () => {
  // Decision on record: float keys group by bit pattern, with nothing normalised.
  it('NaNs of one bit pattern are one group, NaNs of different patterns are two, and signed zeros are separate', async () => {
    await driver.command({ query: 'INSERT INTO lba_nan VALUES (1, nan), (2, nan), (3, 0/0), (4, 0/0), (5, -nan), (6, 0.0), (7, 0.0), (8, -0.0), (9, -0.0), (10, 1)' });
    const bits = await native('SELECT id, reinterpretAsUInt64(f) AS bits FROM lba_nan ORDER BY id');
    expect(bits.map(r => r.bits)).toEqual([
      '9221120237041090560', '9221120237041090560', // nan
      '18444492273895866368', '18444492273895866368', '18444492273895866368', // 0/0 and -nan
      '0', '0', '9223372036854775808', '9223372036854775808', '4607182418800017408',
    ]);
    const query = from(nan).orderBy(r => r.id).limitBy(r => r.f).take(1);
    const result = await agree(query, true, rows => expect(ids(rows)).toEqual([1, 3, 6, 8, 10]));
    expect((result as { f: number }[]).filter(r => Number.isNaN(r.f))).toHaveLength(2);
    expect((result as { f: number }[]).map(r => Object.is(r.f, -0))).toEqual([false, false, false, true, false]);
    expect(result).toHaveLength((await native('SELECT id FROM lba_nan ORDER BY id LIMIT 1 BY f')).length);
  });
});

describe('scalar keys and subqueries', () => {
  it('a scalar subquery combined with a column is a key, and a shared one is a CTE', async () => {
    const total = q.aggregate(() => ({ c: count() }));
    const query = byId.limitBy(r => r.big.gt(scalar(total).ifNull(0n))).take(1);
    await agree(query, true, result => expect(ids(result)).toEqual([1]));
    const shared = from(u).where(r => r.id.gt(1)).map(r => r.id);
    const twice = byId.limitBy(r => [r.id.in(shared), r.v.in(shared)]).take(1);
    expect(compile(twice.ir).sql).toMatch(/^WITH/);
    await agree(twice, true);
  });
});

describe('bad keys never reach the server', () => {
  it('a positional literal would change meaning: hand-built IR cannot produce it', async () => {
    // The hazard the rule exists for: on the server the literal is a position in the select list.
    const positional = await native('SELECT id, cat FROM lba ORDER BY id LIMIT 1 BY 2');
    expect(positional.map(r => r.id)).toEqual([1, 2, 3]);
    expect(() => q.limitBy(() => val(2, col.UInt32))).toThrow(/invalid_limit_by_key/);
  });
  it('compiled counts really cap on the server, not only in the text', async () => {
    const query = byId.limitBy(r => r.cat).take(3).offset(2);
    await agree(query, true, result => expect(ids(result)).toEqual(keep(rows, r => r.cat, 3, 2).map(r => r.id)));
    const handwritten = await native(`SELECT ${list} FROM lba ORDER BY id LIMIT 3 OFFSET 2 BY cat`);
    expect(handwritten.map(r => r.id)).toEqual(keep(rows, r => r.cat, 3, 2).map(r => r.id));
  });
});
