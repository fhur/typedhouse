import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  col,
  count,
  max,
  sum,
  from,
  join,
  leftJoin,
  table,
  unionAll,
  scalar,
  parseCHType,
  print,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

// Slice 4f Tester probes: hidden names (`hiddenColumns`) on paths the Worker's guards may not see.
// Contract: where naive succeeds, optimized must succeed with identical rows and meta in every cell.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const hidden = { ...meta, hiddenColumns: ['hidden', 'mat'] } as const;

const XH = from(table('xh', { id: col.UInt32, v: col.String, arr: col.Array(col.UInt32) }, hidden));

const XJ = from(table('xj', { id: col.UInt32, w: col.String }, meta));

let container: StartedTestContainer | undefined;

let url: string;

type Settings = Readonly<Record<string, string | number>>;

interface Result {
  meta?: string[];
  data?: unknown[][];
  error?: string;
}

async function execute(
  sql: string,
  params: Readonly<Record<string, string>> = {},
  settings: Settings = {},
): Promise<Result> {
  const endpoint = new URL(url);

  for (const [key, value] of Object.entries(params))
    endpoint.searchParams.set(`param_${key}`, value);

  for (const [key, value] of Object.entries(settings))
    endpoint.searchParams.set(key, String(value));

  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('wait_end_of_query', '1');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: `${sql} FORMAT JSONCompact`,
  });

  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 200) };
  const json = JSON.parse(text) as { meta: { type: string }[]; data: unknown[][] };

  return {
    meta: json.meta.map(m => print(parseCHType(m.type))),
    data: [...json.data].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  };
}

const raw = async (sql: string) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: sql,
  });

  if (!res.ok) throw new Error(await res.text());
  return res.text();
};

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_USER: 'fixture',
      CLICKHOUSE_PASSWORD: 'fixture',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123))
    .start();

  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;

  await raw(
    'CREATE TABLE xh (id UInt32, v String, arr Array(UInt32), hidden Int64 ALIAS toInt64(id) * 10, mat Int64 MATERIALIZED toInt64(id) * 100) ENGINE=MergeTree ORDER BY id',
  );

  await raw(
    "INSERT INTO xh (id, v, arr) VALUES (1, 'a', [1, 2]), (2, 'b', [3]), (2, 'c', []), (3, 'd', [4, 5])",
  );

  await raw('CREATE TABLE xj (id UInt32, w String) ENGINE=MergeTree ORDER BY id');
  await raw("INSERT INTO xj VALUES (1, 'x'), (2, 'y'), (4, 'z')");
}, 120000);

afterAll(async () => {
  await container?.stop();
});

const cells: Settings[] = [];

for (const alias of [0, 1])
  for (const prewhere of [0, 1])
    cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });

const brief = (r: Result) => (r.error ? `E${r.error}` : JSON.stringify([r.meta, r.data]));

/** Per cell: 'agree', or the disagreement. Naive must succeed in every cell for the probe to be in contract. */
async function cellMap(root: Rel): Promise<string[]> {
  const optimized = compile(root),
    naive = emitNaive(root),
    out: string[] = [];

  for (const s of cells) {
    const n = await execute(naive.sql, naive.params, s);
    expect(n.error, `naive ${JSON.stringify(s)}\n${naive.sql}`).toBeUndefined();
    const o = brief(await execute(optimized.sql, optimized.params, s));

    out.push(
      o === brief(n) ? 'agree' : `optimized ${o.startsWith('E') ? o : 'rows'} vs naive rows`,
    );
  }

  return out;
}

const agree = ['agree', 'agree', 'agree', 'agree'];

const g = (q: any) =>
  q
    .groupBy((r: any) => ({ id: r.id }))
    .aggregate((x: any) => ({ hidden: count(), top: max(x.v) }))
    .where((r: any) => r.hidden.gt(1n));

it('D1 + D2, flipped in 4f fix round 1: identity selections between the scan and the Aggregate keep every name the table resolves in N', async () => {
  // 4f fix round 1: was ['agree', 'agree', 'optimized E215 vs naive rows' x2] for the four D1 shapes and E43 for D2.
  const identity = g(XH.map(r => ({ id: r.id, v: r.v })));
  expect(await cellMap(identity.ir)).toEqual(agree);
  const filtered = g(XH.where(r => r.v.ne('z')).map(r => ({ id: r.id, v: r.v })));
  expect(await cellMap(filtered.ir)).toEqual(agree);
  const filteredAfter = g(XH.map(r => ({ id: r.id, v: r.v })).where(r => r.v.ne('z')));
  expect(await cellMap(filteredAfter.ir)).toEqual(agree);

  const orderBy = XH.map(r => ({ id: r.id, v: r.v }))
    .groupBy(r => ({ id: r.id }))
    .aggregate(x => ({ mat: max(x.v) }))
    .orderBy(r => r.mat);

  expect(await cellMap(orderBy.ir)).toEqual(agree);

  const expanded = XH.map(r => ({ id: r.id, arr: r.arr }))
    .arrayJoin(r => r.arr, 'e')
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ hidden: count() }))
    .where(r => r.hidden.gt(1n));

  expect(await cellMap(expanded.ir)).toEqual(agree);

  // D2 cells (declared columns dropped by the narrowing selection): HAVING, ORDER BY and an expanded block.
  const declared = XH.map(r => ({ id: r.id, v: r.v }))
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ arr: count() }))
    .where(r => r.arr.gt(1n));

  expect(await cellMap(declared.ir)).toEqual(agree);

  const declaredOrder = XH.map(r => ({ id: r.id }))
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ v: count() }))
    .orderBy(r => r.v);

  expect(await cellMap(declaredOrder.ir)).toEqual(agree);

  const declaredExpanded = XH.map(r => ({ id: r.id, arr: r.arr }))
    .arrayJoin(r => r.arr, 'e')
    .groupBy(r => ({ id: r.id }))
    .aggregate(() => ({ v: count() }))
    .where(r => r.v.gt(1n));

  expect(await cellMap(declaredExpanded.ir)).toEqual(agree);
});

it('hazards with no finding', async () => {
  const shapes: Record<string, Rel> = {
    distinct: g(XH.map(r => ({ id: r.id, v: r.v })).distinct()).ir,
    limit: g(XH.limit(10)).ir,
    sorted: g(XH.orderBy(r => r.id).limit(10)).ir,
    union: unionAll(g(XH), g(XH.where(r => r.v.ne('y')))).ir,
    scalarSub: XH.where(r => r.v.ne('z')).map(r => ({
      id: r.id,
      s: scalar(g(XH).aggregate((x: any) => ({ s: sum(x.hidden) }))),
    })).ir,
    inSub: XJ.where(r => r.id.in(g(XH).map((r: any) => ({ id: r.id })))).ir,
    nested: join({
      a: XJ,
      n: join({ b: XH, c: XJ })
        .on(r => r.b.id.eq(r.c.id))
        .map(r => ({ id: r.b.id, v: r.b.v })),
    })
      .on(r => r.a.id.eq(r.n.id))
      .groupBy(r => ({ id: r.a.id }))
      .aggregate(x => ({ hidden: count(), top: max(x.n.v) }))
      .where(r => r.hidden.gt(1n)).ir,
    leftToInner: leftJoin({ a: XJ }, { m: XH })
      .on(r => r.a.id.eq(r.m.id))
      .where(r => r.m.v.ne('q'))
      .groupBy(r => ({ id: r.m.id }))
      .aggregate(x => ({ hidden: count(), top: max(x.m.v) }))
      .where(r => r.hidden.gt(1n)).ir,
    leftToInnerKey: leftJoin({ a: XJ }, { m: XH })
      .on(r => r.a.id.eq(r.m.id))
      .where(r => r.m.v.ne('q'))
      .groupBy(r => ({ mat: r.m.v }))
      .aggregate(() => ({ n: count() }))
      .orderBy(r => r.mat).ir,
    cteSide: (() => {
      const s = XH.where(r => r.v.ne('z')).cte();

      return join({ a: XJ, m: s })
        .on(r => r.a.id.eq(r.m.id))
        .groupBy(r => ({ id: r.a.id }))
        .aggregate(x => ({ hidden: count(), top: max(x.m.v) }))
        .where(r => r.hidden.gt(1n)).ir;
    })(),
    caseOnly: XH.groupBy(r => ({ id: r.id }))
      .aggregate(() => ({ Hidden: count() }))
      .where(r => r.Hidden.gt(1n)).ir,
    selectionAlias: XH.where(r => r.v.ne('z')).map(r => ({
      hidden: r.id.plus(1),
      mat: r.id.plus(2),
    })).ir,
    arrayJoinAliasAgg: XH.arrayJoin(r => r.arr, 'hidden')
      .groupBy(r => ({ hidden: r.hidden }))
      .aggregate(() => ({ n: count() }))
      .where(r => r.hidden.gt(1)).ir,
    arrayJoinAliasHaving: XH.arrayJoin(r => r.arr, 'mat')
      .where(r => r.mat.gt(1))
      .groupBy(r => ({ id: r.id }))
      .aggregate(x => ({ s: sum(x.mat) }))
      .orderBy(r => r.s).ir,
  };

  const out: Record<string, string[]> = {};
  for (const [k, root] of Object.entries(shapes)) out[k] = await cellMap(root);
  for (const [k, v] of Object.entries(out)) expect(v, k).toEqual(agree);
});

it('item 0: reportSlowestQuery is best effort (fresh server, no grants, closed driver, undefined driver)', async () => {
  const { createClient } = await import('@clickhouse/client');
  const { reportSlowestQuery } = await import('./prefetch-check.js');
  const logs: unknown[][] = [];

  const spy = (await import('vitest')).vi
    .spyOn(console, 'info')
    .mockImplementation((...a: unknown[]) => {
      logs.push(a);
    });

  const fresh = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_USER: 'fixture',
      CLICKHOUSE_PASSWORD: 'fixture',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123))
    .start();

  try {
    const freshUrl = `http://${fresh.getHost()}:${fresh.getMappedPort(8123)}`;
    const first = createClient({ url: freshUrl, username: 'fixture', password: 'fixture' });
    await reportSlowestQuery(first, 'fresh'); // query_log not yet created / empty before the first flush
    await raw("CREATE USER nolog IDENTIFIED WITH plaintext_password BY 'x'");
    const nolog = createClient({ url, username: 'nolog', password: 'x' });
    await reportSlowestQuery(nolog, 'nolog', 30);
    await nolog.close();
    await reportSlowestQuery(nolog, 'closed');
    await reportSlowestQuery(undefined, 'undefined');
    await first.close();
  } finally {
    spy.mockRestore();
    await fresh.stop();
  }

  expect(logs.map(l => (l[1] as { file: string }).file)).toEqual(['fresh', 'nolog', 'closed']);
  expect(logs[1]![1]).toHaveProperty('unavailable');
  expect(logs[2]![1]).toHaveProperty('unavailable');
}, 120000);

it('item 0: the real suite arbitraries yield the identical asserted stream at concurrency 1/2/4/8 (and 8 = default locally)', async () => {
  const fc = (await import('fast-check')).default;
  const { prefetchedCheck, prefetchConcurrency } = await import('./prefetch-check.js');
  expect(process.env.CI === 'true' || prefetchConcurrency() === 8).toBe(true);

  const suites: [string, any, number, number][] = [
    [
      'aggregate-union',
      (await import('./aggregate-union-arbitrary.js')).recipeArbitrary,
      (await import('./aggregate-union-arbitrary.js')).seed,
      500,
    ],
    [
      'cte',
      (await import('./cte-arbitrary.js')).recipeArbitrary,
      (await import('./cte-arbitrary.js')).seed,
      500,
    ],
    [
      'join-block',
      (await import('./join-block-arbitrary.js')).colliding,
      (await import('./join-block-arbitrary.js')).seed,
      500,
    ],
    [
      'pruning',
      (await import('./pruning-arbitrary.js')).recipeArbitrary,
      (await import('./pruning-arbitrary.js')).seed,
      500,
    ],
    [
      'pushdown',
      (await import('./pushdown-arbitrary.js')).recipeArbitrary,
      (await import('./pushdown-arbitrary.js')).seed,
      700,
    ],
    [
      'outer-join',
      (await import('./outer-join-arbitrary.js')).recipes,
      (await import('./outer-join-arbitrary.js')).seed,
      500,
    ],
  ];

  for (const [name, arbitrary, seed, numRuns] of suites) {
    const expected = JSON.stringify(fc.sample(arbitrary, { seed, numRuns }), (_, x) =>
      typeof x === 'bigint' ? `${x}n` : x,
    );

    const counts: number[] = [];

    for (const concurrency of [1, 2, 4, 8]) {
      const seen: unknown[] = [];
      let evaluated = 0;

      const { result, prefetched } = await prefetchedCheck(
        arbitrary,
        { seed, numRuns },
        async (v: unknown) => {
          evaluated++;
          return v;
        },
        (v: unknown, e: unknown) => {
          if (e !== v && fc.stringify(e) !== fc.stringify(v))
            throw new Error('evaluation mismatch');

          seen.push(v);
        },
        concurrency,
      );

      expect(result.failed, `${name} ${String(result.errorInstance)}`).toBe(false);
      expect(result.numRuns, name).toBe(numRuns);
      counts.push(prefetched); // duplicates in the stream evaluate live (pre-existing cache design), so <= numRuns
      expect(evaluated, `${name} ${concurrency}`).toBeGreaterThan(0);

      expect(
        JSON.stringify(seen, (_, x) => (typeof x === 'bigint' ? `${x}n` : x)),
        `${name} ${concurrency}`,
      ).toBe(expected);
    }

    console.info('stream', name, numRuns, counts);
    expect(new Set(counts).size, name).toBe(1);
  }
}, 120000);

it('fix round 1 re-verification: identity-map shapes around the Aggregate (stacked, computed, renamed, CTE, join, LeftToInner; hidden and mat)', async () => {
  const idv = (q: any) => q.map((r: any) => ({ id: r.id, v: r.v }));

  const gm = (q: any) =>
    q
      .groupBy((r: any) => ({ id: r.id }))
      .aggregate((x: any) => ({ mat: max(x.v) }))
      .orderBy((r: any) => r.mat);

  const s = XH.where(r => r.v.ne('z')).cte();

  const shapes: Record<string, Rel> = {
    stacked: g(idv(XH.map(r => ({ id: r.id, v: r.v, arr: r.arr })))).ir,
    stackedMat: gm(idv(idv(XH))).ir,
    stackedFiltered: g(idv(idv(XH).where((r: any) => r.v.ne('z')))).ir,
    computedAfterIdentity: idv(XH)
      .map((r: any) => ({ id: r.id, v: r.v, w: r.id.plus(1) }))
      .groupBy((r: any) => ({ id: r.id }))
      .aggregate((x: any) => ({ mat: max(x.w) }))
      .orderBy((r: any) => r.mat).ir,
    computedHiddenAlias: idv(XH)
      .map((r: any) => ({ id: r.id, hidden: r.id.plus(1) }))
      .groupBy((r: any) => ({ id: r.id }))
      .aggregate((x: any) => ({ mat: max(x.hidden) }))
      .where((r: any) => r.mat.gt(1n)).ir,
    rename: XH.map(r => ({ x: r.id, v: r.v }))
      .groupBy(r => ({ x: r.x }))
      .aggregate(x => ({ hidden: count(), top: max(x.v) }))
      .where(r => r.hidden.gt(1n)).ir,
    renameToMat: XH.map(r => ({ mat: r.id, v: r.v }))
      .groupBy(r => ({ mat: r.mat }))
      .aggregate(x => ({ hidden: count(), top: max(x.v) }))
      .orderBy(r => r.mat).ir,
    renameToMatFiltered: XH.map(r => ({ mat: r.id, v: r.v }))
      .where(r => r.mat.gt(1))
      .groupBy(r => ({ id: r.mat }))
      .aggregate(() => ({ n: count() })).ir,
    cteIdentity: unionAll(g(idv(s)), g(s)).ir,
    cteIdentityMat: unionAll(gm(idv(s)), gm(s)).ir,
    joinSideIdentity: join({ a: XJ, m: idv(XH) })
      .on((r: any) => r.a.id.eq(r.m.id))
      .groupBy((r: any) => ({ id: r.a.id }))
      .aggregate((x: any) => ({ hidden: count(), top: max(x.m.v) }))
      .where((r: any) => r.hidden.gt(1n)).ir,
    joinSideMat: join({ a: XJ, m: idv(idv(XH)) })
      .on((r: any) => r.a.id.eq(r.m.id))
      .groupBy((r: any) => ({ id: r.m.id }))
      .aggregate((x: any) => ({ mat: max(x.m.v) }))
      .orderBy((r: any) => r.mat).ir,
    leftToInnerIdentity: leftJoin({ a: XJ }, { m: idv(XH) })
      .on((r: any) => r.a.id.eq(r.m.id))
      .where((r: any) => r.m.v.ne('q'))
      .groupBy((r: any) => ({ id: r.m.id }))
      .aggregate((x: any) => ({ hidden: count(), top: max(x.m.v) }))
      .where((r: any) => r.hidden.gt(1n)).ir,
    leftToInnerMatKey: leftJoin({ a: XJ }, { m: idv(XH) })
      .on((r: any) => r.a.id.eq(r.m.id))
      .where((r: any) => r.m.v.ne('q'))
      .groupBy((r: any) => ({ mat: r.m.v }))
      .aggregate(() => ({ n: count() }))
      .orderBy((r: any) => r.mat).ir,
    expandedMat: XH.map(r => ({ id: r.id, arr: r.arr }))
      .arrayJoin(r => r.arr, 'e')
      .groupBy(r => ({ id: r.id }))
      .aggregate(x => ({ mat: sum(x.e) }))
      .orderBy(r => r.mat).ir,
  };

  const out: Record<string, string> = {};
  for (const [k, root] of Object.entries(shapes)) out[k] = (await cellMap(root)).join(',');

  console.info(
    'fix-round-1 cells',
    out,
    Object.fromEntries(
      Object.entries(shapes).map(([k, root]) => [
        k,
        (compile(root).sql.match(/SELECT /g) ?? []).length,
      ]),
    ),
  );

  for (const [k, v] of Object.entries(out)) expect(v, k).toBe(agree.join(','));
});
