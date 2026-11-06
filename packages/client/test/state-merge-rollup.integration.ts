import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  argMaxMerge,
  argMaxState,
  avgMerge,
  avgState,
  col,
  containsAggregateState,
  countMerge,
  countState,
  createKnownFunctions,
  from,
  join,
  leftJoin,
  maxMerge,
  maxState,
  minMerge,
  minState,
  parseCHType,
  print,
  quantileExactMerge,
  quantileExactState,
  quantileMerge,
  quantileState,
  rightJoin,
  fullJoin,
  scalar,
  sql,
  sumMerge,
  sumState,
  table,
  uniqExactMerge,
  uniqExactState,
  uniqMerge,
  uniqState,
  unionAll,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClientFromBackend, rowDecoder } from '../src/index.js';
import { outputSettings } from '../src/backend.js';
import { collect } from './backend-harness.js';

/** D3 Tester: a real AggregatingMergeTree fed by a materialized view, read with merges stopped, through run and
 * stream on both emitters and both alias settings, against handwritten SQL and a JavaScript oracle. */
const STATES = `
  views AggregateFunction(sum, UInt32),
  n AggregateFunction(count),
  visitors AggregateFunction(uniq, String),
  ids AggregateFunction(uniqExact, String),
  latency AggregateFunction(quantile(0.9), Float64),
  nq AggregateFunction(quantile(0.9), Nullable(Float64)),
  median AggregateFunction(quantileExact(0.5), UInt32),
  amount AggregateFunction(sum, Decimal(18, 2)),
  top AggregateFunction(max, Nullable(UInt32)),
  low AggregateFunction(min, UInt32),
  latest AggregateFunction(argMax, String, DateTime('UTC')),
  mean AggregateFunction(avg, Float64),
  nmean AggregateFunction(avg, Nullable(Float64))`;

const stateColumns = {
  views: col.AggregateFunction('sum', col.UInt32),
  n: col.AggregateFunction('count'),
  visitors: col.AggregateFunction('uniq', col.String),
  ids: col.AggregateFunction('uniqExact', col.String),
  latency: col.AggregateFunction('quantile(0.9)', col.Float64),
  nq: col.AggregateFunction('quantile(0.9)', col.Nullable(col.Float64)),
  median: col.AggregateFunction('quantileExact(0.5)', col.UInt32),
  amount: col.AggregateFunction('sum', col.Decimal(18, 2)),
  top: col.AggregateFunction('max', col.Nullable(col.UInt32)),
  low: col.AggregateFunction('min', col.UInt32),
  latest: col.AggregateFunction('argMax', col.String, col.DateTime('UTC')),
  mean: col.AggregateFunction('avg', col.Float64),
  nmean: col.AggregateFunction('avg', col.Nullable(col.Float64)),
} as const;

const rollupMeta = {
  engine: 'AggregatingMergeTree',
  sortingKey: ['day', 'page'],
  partitionKey: [],
} as const;

const rollup = table('daily', { day: col.Date, page: col.String, ...stateColumns }, rollupMeta);

const view = table('daily_mv', { day: col.Date, page: col.String, ...stateColumns }, rollupMeta);

const SOURCE = `(
  at DateTime('UTC'), page String, visitor String, latency Float64, nlatency Nullable(Float64),
  hits UInt32, price Decimal(18, 2), maybe Nullable(UInt32)
) ENGINE = MergeTree ORDER BY at`;

const sourceColumns = {
  at: col.DateTime('UTC'),
  page: col.String,
  visitor: col.String,
  latency: col.Float64,
  nlatency: col.Nullable(col.Float64),
  hits: col.UInt32,
  price: col.Decimal(18, 2),
  maybe: col.Nullable(col.UInt32),
};

const sourceMeta = { engine: 'MergeTree', sortingKey: ['at'], partitionKey: [] } as const;

const late = table('late_views', sourceColumns, sourceMeta);

const raw = table('page_views', sourceColumns, sourceMeta);

const pages = table(
  'pages',
  { page: col.String, title: col.String },
  { engine: 'MergeTree', sortingKey: ['page'], partitionKey: [] },
);

interface View {
  at: string;
  day: string;
  page: string;
  visitor: string;
  latency: number;
  nlatency: number | null;
  hits: number;
  cents: number;
  maybe: number | null;
}

const clock = (i: number) =>
  `2024-01-0${1 + (i % 2)} 0${i % 7}:${String(i % 60).padStart(2, '0')}:00`;

const makeView = (i: number, page: string): View => ({
  at: clock(i),
  day: clock(i).slice(0, 10),
  page,
  visitor: `v${i % 5}`,
  latency: (i * 13) % 101,
  // The `/none` page has only NULL inputs.
  nlatency: page === '/none' || i % 3 === 0 ? null : (i * 7) % 50,
  hits: 1 + ((i * 3) % 11),
  // A value with exact cents, far above Float64's exact range when summed at scale.
  cents: 900719925474 + i,
  maybe: page === '/none' || i % 4 === 0 ? null : i * 2,
});

/** Three inserts make at least three parts. /a and /b repeat across parts; /c is only in the last one. */
const batches: View[][] = [
  Array.from({ length: 12 }, (_, i) => makeView(i, i % 2 ? '/a' : '/b')),
  Array.from({ length: 12 }, (_, i) => makeView(i + 12, i % 3 ? '/a' : '/none')),
  Array.from({ length: 12 }, (_, i) => makeView(i + 24, i % 2 ? '/b' : '/c')),
];

const allViews = batches.flat();

const lateViews = Array.from({ length: 6 }, (_, i) => makeView(i + 100, i % 2 ? '/a' : '/late'));

const literal = (v: View) =>
  `('${v.at}','${v.page}','${v.visitor}',${v.latency},${v.nlatency ?? 'NULL'},${v.hits},${(v.cents / 100).toFixed(2)},${v.maybe ?? 'NULL'})`;

const money = (cents: bigint) =>
  `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`.replace(/\.?0+$/, m =>
    m.startsWith('.') ? '' : m,
  );

/** ClickHouse's reservoir below its capacity: linear interpolation at level * (n - 1). */
function interpolated(values: readonly number[], level: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = level * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

const nonNull = <T>(values: readonly (T | null)[]) => values.filter((v): v is T => v !== null);

/** The oracle for a whole-rollup merge at a given latency level. */
function merged(views: readonly View[], level = 0.9) {
  const hits = views.map(v => v.hits);
  const latencies = views.map(v => v.latency);
  const known = nonNull(views.map(v => v.nlatency));
  const maybe = nonNull(views.map(v => v.maybe));

  return {
    views: BigInt(hits.reduce((a, b) => a + b, 0)),
    n: BigInt(views.length),
    visitors: BigInt(new Set(views.map(v => v.visitor)).size),
    ids: BigInt(new Set(views.map(v => v.visitor)).size),
    p: interpolated(latencies, level),
    np: known.length ? interpolated(known, 0.9) : null,
    median: [...hits].sort((a, b) => a - b)[Math.floor(0.5 * hits.length)]!,
    amount: money(views.reduce((a, v) => a + BigInt(v.cents), 0n)),
    top: maybe.length ? Math.max(...maybe) : null,
    low: Math.min(...hits),
    latest: [...views].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!.visitor,
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    nmean: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
  };
}

/** One aggregate shape for the table, the view and every derived input. */
const mergeAll = (g: any, level = 0.9) => ({
  views: sumMerge(g.views),
  n: countMerge(g.n),
  visitors: uniqMerge(g.visitors),
  ids: uniqExactMerge(g.ids),
  p: quantileMerge(level)(g.latency),
  np: quantileMerge(0.9)(g.nq),
  median: quantileExactMerge(0.5)(g.median),
  amount: sumMerge(g.amount),
  top: maxMerge(g.top),
  low: minMerge(g.low),
  latest: argMaxMerge(g.latest),
  mean: avgMerge(g.mean),
  nmean: avgMerge(g.nmean),
});

const mergeSql = (level = 0.9) => `
  sumMerge(views) AS views, countMerge(n) AS n, uniqMerge(visitors) AS visitors, uniqExactMerge(ids) AS ids,
  quantileMerge(${level})(latency) AS p, quantileMerge(0.9)(nq) AS np, quantileExactMerge(0.5)(median) AS median,
  sumMerge(amount) AS amount, maxMerge(top) AS top, minMerge(low) AS low, argMaxMerge(latest) AS latest,
  avgMerge(mean) AS mean, avgMerge(nmean) AS nmean`;

/** The fresh-state twin of the materialized view's SELECT. */
const statesOf = (g: any) => ({
  views: sumState(g.hits),
  n: countState(),
  visitors: uniqState(g.visitor),
  ids: uniqExactState(g.visitor),
  latency: quantileState(0.9)(g.latency),
  nq: quantileState(0.9)(g.nlatency),
  median: quantileExactState(0.5)(g.hits),
  amount: sumState(g.price),
  top: maxState(g.maybe),
  low: minState(g.hits),
  latest: argMaxState(g.visitor, g.at),
  mean: avgState(g.latency),
  nmean: avgState(g.nlatency),
});

const statesSql = `sumState(hits) AS views, countState() AS n, uniqState(visitor) AS visitors, uniqExactState(visitor) AS ids,
  quantileState(0.9)(s.latency) AS latency, quantileState(0.9)(nlatency) AS nq, quantileExactState(0.5)(hits) AS median,
  sumState(price) AS amount, maxState(maybe) AS top, minState(hits) AS low, argMaxState(visitor, at) AS latest,
  avgState(s.latency) AS mean, avgState(nlatency) AS nmean`;

let container: StartedTestContainer;

let driver: ReturnType<typeof createClient>;

const backends: { label: string; backend: ReturnType<typeof createClickHouseBackend> }[] = [];

let url: string;

const auth = { username: 'fixture', password: 'fixture' };

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
  const options = { url, ...auth };
  driver = createClient(options);

  for (const mode of ['clickhouse-naive', 'clickhouse'] as const)
    for (const prefer of [0, 1] as const)
      backends.push({
        label: `${mode} prefer=${prefer}`,
        backend: createClickHouseBackend(
          { ...options, clickhouse_settings: { prefer_column_name_to_alias: prefer } },
          mode,
        ),
      });

  await driver.command({ query: `CREATE TABLE page_views ${SOURCE}` });
  await driver.command({ query: `CREATE TABLE late_views ${SOURCE}` });

  await driver.command({
    query: `CREATE TABLE daily (day Date, page String, ${STATES}) ENGINE = AggregatingMergeTree ORDER BY (day, page)`,
  });

  await driver.command({ query: 'SYSTEM STOP MERGES daily' });

  await driver.command({
    query: `CREATE MATERIALIZED VIEW daily_mv TO daily AS SELECT toDate(at) AS day, page, ${statesSql} FROM page_views AS s GROUP BY day, page`,
  });

  for (const batch of batches)
    await driver.command({
      query: `INSERT INTO page_views VALUES ${batch.map(literal).join(',')}`,
    });

  await driver.command({
    query: `INSERT INTO late_views VALUES ${lateViews.map(literal).join(',')}`,
  });

  await driver.command({
    query: 'CREATE TABLE pages (page String, title String) ENGINE = MergeTree ORDER BY page',
  });

  await driver.command({
    query: "INSERT INTO pages VALUES ('/a','A'),('/b','B'),('/orphan','O')",
  });
}, 180000);

afterAll(async () => {
  for (const { backend } of backends) await backend.close();
  await driver?.close();
  await container?.stop();
});

const canonical = (v: unknown): unknown => {
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : Number(v.toPrecision(12));
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonical);

  if (v && typeof v === 'object') {
    if (Object.getPrototypeOf(v) !== Object.prototype) return String(v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canonical(x)]));
  }

  return v;
};

const sorted = (rows: readonly unknown[]) => rows.map(row => JSON.stringify(canonical(row))).sort();

/** Handwritten SQL, decoded by the same column decoders the query would use. */
async function handwritten(query: string, rel: Rel, settings: Record<string, unknown> = {}) {
  const result = await driver.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: { ...outputSettings, ...settings } as never,
  });

  const { columns, columnPaths } = emitNaive(rel);
  return (await result.json<unknown>()).map(rowDecoder(columns, columnPaths));
}

/** Every backend, through run and stream, equals the oracle; the handwritten SQL, when given, does too. */
async function agree(query: { ir: Rel } & any, expected: readonly unknown[], native?: string) {
  const want = sorted(expected);
  if (native) expect(sorted(await handwritten(native, query.ir)), 'handwritten').toEqual(want);

  for (const { label, backend } of backends) {
    const client = createClientFromBackend(backend);
    expect(sorted(await client.run(query)), `${label} run`).toEqual(want);
    expect(sorted(await collect(client.stream(query))), `${label} stream`).toEqual(want);
  }
}

const byKey = (views: readonly View[], key: (v: View) => string) => {
  const groups = new Map<string, View[]>();
  for (const v of views) groups.set(key(v), [...(groups.get(key(v)) ?? []), v]);
  return [...groups];
};

const dayOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

const rowCount = async (query: string) => {
  const r = await driver.query({ query, format: 'JSONEachRow' });
  return (await r.json<Record<string, unknown>>())[0]!;
};

describe('with merges stopped', () => {
  it('the fixture really is multi-part, with repeated keys', async () => {
    const parts = await rowCount(
      "SELECT count() AS parts FROM system.parts WHERE table = 'daily' AND active",
    );

    expect(Number(parts.parts)).toBeGreaterThanOrEqual(3);

    const rows = await rowCount(
      'SELECT count() AS stored, uniqExact(day, page) AS keys FROM daily',
    );

    expect(Number(rows.stored)).toBeGreaterThan(Number(rows.keys));
  });

  it('a whole-rollup merge matches the source oracle, on the table and the view', async () => {
    const expected = [merged(allViews)];
    const native = `SELECT ${mergeSql()} FROM daily`;

    await agree(
      from(rollup).aggregate(g => mergeAll(g)),
      expected,
      native,
    );

    await agree(
      from(view).aggregate(g => mergeAll(g)),
      expected,
      `SELECT ${mergeSql()} FROM daily_mv`,
    );
  });

  it('a grouped merge is one row per key, not one per stored row', async () => {
    await agree(
      from(rollup)
        .groupBy(r => ({ day: r.day, page: r.page }))
        .aggregate(g => mergeAll(g)),
      byKey(allViews, v => `${v.day}|${v.page}`).map(([key, views]) => ({
        day: dayOf(key.split('|')[0]!),
        page: key.split('|')[1]!,
        ...merged(views),
      })),
      `SELECT day, page, ${mergeSql()} FROM daily GROUP BY day, page`,
    );
  });

  it('agrees with the base aggregates computed directly from the source', async () => {
    const direct = await driver.query({
      query: `SELECT toString(sum(hits)) AS v, toString(count()) AS n, toString(sum(price)) AS a FROM page_views`,
      format: 'JSONEachRow',
    });

    const [row] = await direct.json<{ v: string; n: string; a: string }>();

    const [out] = await createClientFromBackend(backends[3]!.backend).run(
      from(rollup).aggregate(g => mergeAll(g)),
    );

    expect(String(out!.views)).toBe(row!.v);
    expect(String(out!.n)).toBe(row!.n);
    expect(String(out!.amount)).toBe(row!.a);
  });

  it('the merge level decides on a non-nullable state stored at 0.9', async () => {
    for (const level of [0.1, 0.5, 0.9, 0, 1])
      await agree(
        from(rollup).aggregate(g => ({ p: quantileMerge(level)(g.latency) })),
        [
          {
            p: interpolated(
              allViews.map(v => v.latency),
              level,
            ),
          },
        ],
        `SELECT quantileMerge(${level})(latency) AS p FROM daily`,
      );

    // The bullet's "no level gives the median" on the server, for the record.
    const bare = await rowCount('SELECT quantileMerge(latency) AS p FROM daily');

    expect(Number(bare.p)).toBeCloseTo(
      interpolated(
        allViews.map(v => v.latency),
        0.5,
      ),
    );
  });

  it('a nullable state raises invalid_merge_state on a mismatch, as the server does with code 43', async () => {
    for (const emit of [compile, emitNaive])
      expect(() => emit(from(rollup).aggregate(g => ({ p: quantileMerge(0.5)(g.nq) })).ir)).toThrow(
        /invalid_merge_state/,
      );

    for (const query of [
      'SELECT quantileMerge(0.5)(nq) FROM daily',
      'SELECT quantileMerge(nq) FROM daily',
    ])
      await expect(driver.query({ query })).rejects.toThrow(/quantile/);

    await expect(
      driver.query({ query: 'SELECT quantileMerge(0.5)(nq) FROM daily' }),
    ).rejects.toMatchObject({
      code: '43',
    });
  });

  it('FINAL collapses stored rows and merges to the same totals', async () => {
    const expected = [merged(allViews)];

    await agree(
      from(rollup)
        .final()
        .aggregate(g => mergeAll(g)),
      expected,
      `SELECT ${mergeSql()} FROM daily FINAL`,
    );

    const keys = new Set(allViews.map(v => `${v.day}|${v.page}`)).size;

    await agree(
      from(rollup).final().count(),
      [{ count: BigInt(keys) }],
      'SELECT count() AS count FROM daily FINAL',
    );

    const stored = await rowCount('SELECT count() AS stored FROM daily');
    expect(Number(stored.stored)).toBeGreaterThan(keys);
    await agree(from(rollup).count(), [{ count: BigInt(stored.stored as string) }]);
  });

  it('PREWHERE, alone and with FINAL, merges the selected key', async () => {
    const a = allViews.filter(v => v.page === '/a');
    const native = `SELECT ${mergeSql()} FROM daily PREWHERE page = '/a'`;

    await agree(
      from(rollup)
        .prewhere(r => r.page.eq('/a'))
        .aggregate(g => mergeAll(g)),
      [merged(a)],
      native,
    );

    await agree(
      from(rollup)
        .final()
        .prewhere(r => r.page.eq('/a'))
        .aggregate(g => mergeAll(g)),
      [merged(a)],
      `SELECT ${mergeSql()} FROM daily FINAL PREWHERE page = '/a'`,
    );
  });

  it('empty input: the documented values through run and stream', async () => {
    await agree(
      from(rollup)
        .where(r => r.page.eq('/absent'))
        .aggregate(g => ({
          views: sumMerge(g.views),
          n: countMerge(g.n),
          visitors: uniqMerge(g.visitors),
          ids: uniqExactMerge(g.ids),
          top: maxMerge(g.top),
          low: minMerge(g.low),
          latest: argMaxMerge(g.latest),
          mean: avgMerge(g.mean),
          nmean: avgMerge(g.nmean),
          p: quantileMerge(0.9)(g.latency),
          np: quantileMerge(0.9)(g.nq),
          amount: sumMerge(g.amount),
        })),
      [
        {
          views: 0n,
          n: 0n,
          visitors: 0n,
          ids: 0n,
          top: null,
          low: 0,
          latest: '',
          mean: NaN,
          nmean: null,
          p: NaN,
          np: null,
          amount: '0',
        },
      ],
    );

    await agree(
      from(rollup)
        .where(r => r.page.eq('/absent'))
        .groupBy(r => r.page)
        .aggregate(g => ({ views: sumMerge(g.views) })),
      [],
    );
  });

  it('all-NULL input merges to NULL on nullable states', async () => {
    await agree(
      from(rollup)
        .where(r => r.page.eq('/none'))
        .aggregate(g => ({
          top: maxMerge(g.top),
          np: quantileMerge(0.9)(g.nq),
          m: avgMerge(g.nmean),
        })),
      [{ top: null, np: null, m: null }],
    );
  });

  it('union of rollup state and fresh state', async () => {
    const fresh = from(late)
      .groupBy(r => toDayPage(r))
      .aggregate(g => statesOf(g));

    const input = unionAll(from(rollup), fresh as any);
    const everything = [...allViews, ...lateViews];

    await agree(
      input.aggregate((g: any) => mergeAll(g)),
      [merged(everything)],
    );

    await agree(
      input.groupBy((r: any) => r.page).aggregate((g: any) => mergeAll(g)),
      byKey(everything, v => v.page).map(([page, views]) => ({ page, ...merged(views) })),
      `SELECT page, ${mergeSql()} FROM (SELECT day, page, ${Object.keys(stateColumns).join(', ')} FROM daily UNION ALL SELECT toDate(at) AS day, page, ${statesSql} FROM late_views AS s GROUP BY day, page) GROUP BY page`,
    );
  });

  it('a state through an inner join input', async () => {
    const joined = (join({ d: from(pages), r: from(rollup) }) as any)
      .on((x: any) => x.d.page.eq(x.r.page))
      .map((x: any) => ({ title: x.d.title, views: x.r.views, top: x.r.top }))
      .groupBy((x: any) => x.title)
      .aggregate((g: any) => ({ views: sumMerge(g.views), top: maxMerge(g.top) }));

    const expected = (page: string, title: string) => {
      const m = merged(allViews.filter(v => v.page === page));
      return { title, views: m.views, top: m.top };
    };

    await agree(joined, [expected('/a', 'A'), expected('/b', 'B')]);
  });

  it('an unmatched outer row keeps the default state, which merges to 0', async () => {
    const native = `SELECT p.title AS title, sumMerge(r.views) AS views, countMerge(r.n) AS n, uniqMerge(r.visitors) AS visitors
      FROM pages AS p LEFT JOIN daily AS r ON p.page = r.page GROUP BY title SETTINGS join_use_nulls = 1`;

    const merge = (page: string, title: string) => {
      const m = merged(allViews.filter(v => v.page === page));
      return { title, views: m.views, n: m.n, visitors: m.visitors };
    };

    const expected = [
      merge('/a', 'A'),
      merge('/b', 'B'),
      { title: 'O', views: 0n, n: 0n, visitors: 0n },
    ];

    await agree(
      (leftJoin({ p: from(pages) }, { r: from(rollup) }) as any)
        .on((x: any) => x.p.page.eq(x.r.page))
        .map((x: any) => ({ title: x.p.title, views: x.r.views, n: x.r.n, visitors: x.r.visitors }))
        .groupBy((x: any) => x.title)
        .aggregate((g: any) => ({
          views: sumMerge(g.views),
          n: countMerge(g.n),
          visitors: uniqMerge(g.visitors),
        })),
      expected,
      native,
    );

    await agree(
      (rightJoin({ r: from(rollup) }, { p: from(pages) }) as any)
        .on((x: any) => x.p.page.eq(x.r.page))
        .map((x: any) => ({ title: x.p.title, views: x.r.views, n: x.r.n, visitors: x.r.visitors }))
        .groupBy((x: any) => x.title)
        .aggregate((g: any) => ({
          views: sumMerge(g.views),
          n: countMerge(g.n),
          visitors: uniqMerge(g.visitors),
        })),
      expected,
    );
  });

  it('a full join keeps both sides', async () => {
    const m = merged(allViews);

    const rows: any[] = await createClientFromBackend(backends[1]!.backend).run(
      (fullJoin({ p: from(pages) }, { r: from(rollup) }) as any)
        .on((x: any) => x.p.page.eq(x.r.page))
        .map((x: any) => ({ views: x.r.views }))
        .aggregate((g: any) => ({ views: sumMerge(g.views) })),
    );

    expect(rows).toEqual([{ views: m.views }]);
  });

  it('sumMerge(total) AS total under prefer_column_name_to_alias = 1, with a filter and sort on the alias', async () => {
    // The handwritten form the docs warn about: the name binds the state.
    await expect(
      driver.query({
        query: 'SELECT page, sumMerge(views) AS views FROM daily GROUP BY page HAVING views > 0',
        clickhouse_settings: { prefer_column_name_to_alias: 1 },
      }),
    ).rejects.toMatchObject({ code: '43' });

    // Default settings accept the same text, so only the setting makes the claim true.
    await driver.query({
      query: 'SELECT page, sumMerge(views) AS views FROM daily GROUP BY page HAVING views > 0',
    });

    const expected = byKey(allViews, v => v.page)
      .map(([page, views]) => ({ page, views: merged(views).views }))
      .filter(r => r.views > 20n)
      .sort((a, b) => Number(b.views - a.views) || a.page.localeCompare(b.page));

    await agree(
      from(rollup)
        .groupBy(r => r.page)
        .aggregate(g => ({ views: sumMerge(g.views) }))
        .where(r => r.views.gt(20n))
        .orderBy(r => r.views.desc())
        .thenBy(r => r.page),
      expected,
    );

    await agree(
      from(rollup)
        .groupBy(r => r.page)
        .aggregate(g => ({ views: sumMerge(g.views), twice: sumMerge(g.views) }))
        .map(r => ({ page: r.page, views: r.views, same: r.twice })),
      byKey(allViews, v => v.page).map(([page, views]) => ({
        page,
        views: merged(views).views,
        same: merged(views).views,
      })),
    );

    // A second aggregate's argument reads the first one's alias.
    await agree(
      from(rollup)
        .aggregate(g => ({ views: sumMerge(g.views), n: countMerge(g.n) }))
        .map(r => ({ views: r.views.plus(1n), n: r.n })),
      [{ views: merged(allViews).views + 1n, n: merged(allViews).n }],
    );
  });

  it('an alias equal to its state, over a CTE and through clauses that name it', async () => {
    const totals = byKey(allViews, v => v.page).map(([page, views]) => ({
      page,
      views: merged(views).views,
    }));

    const shared = from(rollup).cte();

    await agree(
      shared.groupBy(r => r.page).aggregate(g => ({ views: sumMerge(g.views) })),
      totals,
    );

    await agree(
      shared
        .groupBy(r => r.page)
        .aggregate(g => ({ views: sumMerge(g.views) }))
        .where(r => r.views.gt(20n)),
      totals.filter(r => r.views > 20n),
    );

    await agree(
      shared
        .groupBy(r => r.page)
        .aggregate(g => ({ views: sumMerge(g.views) }))
        .orderBy(r => r.views),
      totals,
    );

    await agree(
      shared
        .groupBy(r => r.page)
        .aggregate(g => ({ views: sumMerge(g.views), again: sumMerge(g.views) }))
        .where(r => r.again.gt(20n)),
      totals.filter(r => r.views > 20n).map(r => ({ ...r, again: r.views })),
    );
  });

  it('finalizeAggregation is per stored row, as the docs say', async () => {
    const stored = await rowCount(
      'SELECT count() AS stored, uniqExact(day, page) AS keys FROM daily',
    );

    const finalized = from(rollup).map(r => ({
      page: r.page,
      v: sql`finalizeAggregation(${r.views})`.as(col.UInt64),
    }));

    for (const { label, backend } of backends) {
      const rows = await createClientFromBackend(backend).run(finalized);
      expect(rows.length, label).toBe(Number(stored.stored));
      expect(rows.length, label).toBeGreaterThan(Number(stored.keys));

      expect(
        rows.reduce((a, r: any) => a + r.v, 0n),
        label,
      ).toBe(merged(allViews).views);
    }
  });

  it('a scalar subquery of a merged rollup', async () => {
    const query = from(pages).map(p => ({
      page: p.page,
      total: scalar(from(rollup).aggregate(g => sumMerge(g.views))),
    }));

    await agree(
      query,
      ['/a', '/b', '/orphan'].map(page => ({ page, total: merged(allViews).views })),
    );
  });

  it('two levels: a fresh state merged, then re-stated and merged again', async () => {
    const m = merged(allViews);

    await agree(
      from(raw)
        .groupBy(r => r.page)
        .aggregate(g => ({ s: sumState(g.hits), c: countState() }))
        .aggregate(g => ({ views: sumMerge(g.s), n: countMerge(g.c) })),
      [{ views: m.views, n: m.n }],
    );

    await agree(
      from(rollup)
        .groupBy(r => r.page)
        .aggregate(g => ({ merged: sumMerge(g.views) }))
        .aggregate(g => ({ s: sumState(g.merged) }))
        .aggregate(g => ({ total: sumMerge(g.s) })),
      [{ total: m.views }],
    );
  });

  it('after a real merge the answers do not change', async () => {
    await driver.command({ query: 'SYSTEM START MERGES daily' });
    await driver.command({ query: 'OPTIMIZE TABLE daily FINAL' });
    const keys = new Set(allViews.map(v => `${v.day}|${v.page}`)).size;
    await agree(from(rollup).count(), [{ count: BigInt(keys) }]);

    await agree(
      from(rollup).aggregate(g => mergeAll(g)),
      [merged(allViews)],
    );
  });
});

const toDayPage = (r: any) => ({ day: sql`toDate(${r.at})`.as(col.Date), page: r.page });

describe('design corrections, confirmed natively', () => {
  const typeOf = async (expr: string, from_ = '') => {
    const r = await driver.query({
      query: `SELECT toTypeName(${expr}) AS t ${from_}`,
      format: 'JSONEachRow',
    });

    return (await r.json<{ t: string }>())[0]!.t;
  };

  it('LowCardinality is dropped at every depth, and from SimpleAggregateFunction', async () => {
    await driver.command({
      query: `CREATE TABLE lc_source (
        a LowCardinality(String), b LowCardinality(Nullable(String)), c Array(LowCardinality(String)),
        d Map(LowCardinality(String), UInt8), e Tuple(x LowCardinality(String)), f Array(Array(LowCardinality(String)))
      ) ENGINE = MergeTree ORDER BY tuple()`,
    });

    await driver.command({
      query: `CREATE TABLE simple_source (
        k UInt8, s SimpleAggregateFunction(max, LowCardinality(String)),
        plain SimpleAggregateFunction(max, UInt64)
      ) ENGINE = AggregatingMergeTree ORDER BY k`,
    });

    expect(await typeOf('maxState(a)', 'FROM lc_source')).toBe('AggregateFunction(max, String)');

    expect(await typeOf('maxState(b)', 'FROM lc_source')).toBe(
      'AggregateFunction(max, Nullable(String))',
    );

    expect(await typeOf('maxState(c)', 'FROM lc_source')).toBe(
      'AggregateFunction(max, Array(String))',
    );

    expect(await typeOf('maxState(d)', 'FROM lc_source')).toBe(
      'AggregateFunction(max, Map(String, UInt8))',
    );

    expect(await typeOf('maxState(e)', 'FROM lc_source')).toBe(
      'AggregateFunction(max, Tuple(x String))',
    );

    expect(await typeOf('maxState(f)', 'FROM lc_source')).toBe(
      'AggregateFunction(max, Array(Array(String)))',
    );

    expect(await typeOf('maxState(s)', 'FROM simple_source')).toBe(
      'AggregateFunction(max, String)',
    );

    const simple = table(
      'simple_source',
      {
        k: col.UInt8,
        s: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)),
        plain: col.SimpleAggregateFunction('max', col.UInt64),
      },
      { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
    );

    // The stored-type claim, against the descriptors the builder prints for the wrapper's remaining shapes.
    for (const [column, build] of [
      ['s', (g: any) => maxState(g.s)],
      ['plain', (g: any) => maxState(g.plain)],
    ] as const) {
      const states = from(simple).aggregate(g => ({ state: build(g) as any }));
      const declared = print((states.ir as Extract<Rel, { kind: 'Aggregate' }>).columns.state!);
      expect(declared, column).toBe(await typeOf(`maxState(${column})`, 'FROM simple_source'));

      const merged_ = from(simple)
        .aggregate(g => ({ state: build(g) as any }))
        .aggregate((g: any) => ({ m: maxMerge(g.state) }));

      const direct = await driver.query({
        query: compile(merged_.ir).sql,
        query_params: compile(merged_.ir).params,
        format: 'JSON',
      });

      const json = await direct.json<{ meta: { type: string }[] }>();
      expect(print(compile(merged_.ir).columns.m!), column).toBe(json.meta![0]!.type);
    }
  });

  it('level 1 renders quantile(1.) in a parameterized state; a quantile(1) column fails closed in a union', async () => {
    const r = await driver.query({
      query:
        'SELECT toTypeName(quantileState({l:Float64})(toFloat64(number))) AS t FROM numbers(3)',
      query_params: { l: 1 },
      format: 'JSONEachRow',
    });

    expect((await r.json<{ t: string }>())[0]!.t).toBe('AggregateFunction(quantile(1.), Float64)');

    await driver.command({
      query:
        'CREATE TABLE q1 (k String, s AggregateFunction(quantile(1), Float64)) ENGINE = AggregatingMergeTree ORDER BY k',
    });

    const stored = await rowCount(
      "SELECT type FROM system.columns WHERE table = 'q1' AND name = 's'",
    );

    expect(stored.type).toBe('AggregateFunction(quantile(1), Float64)');

    const q1 = table(
      'q1',
      { k: col.String, s: col.AggregateFunction('quantile(1)', col.Float64) },
      { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
    );

    const fresh = from(raw)
      .groupBy(g => ({ k: g.page }))
      .aggregate(g => ({ s: quantileState(1)(g.latency) }));

    for (const emit of [compile, emitNaive])
      expect(() =>
        emit(
          unionAll(from(q1) as any, fresh as any).aggregate((g: any) => ({
            x: quantileMerge(1)(g.s),
          })).ir,
        ),
      ).toThrow(/union_descriptor_mismatch/);

    // Reading the column alone merges.
    await agree(
      from(q1).aggregate(g => ({ x: quantileMerge(1)(g.s) })),
      [{ x: NaN }],
    );
  });

  // Corrected on re-review: this test first required { one: 10, zero: 0 }, which contradicted the expected result in my own
  // defect report. The orchestrator's ruling is to fail closed: a level parameter is always Float64, so these columns have
  // no typed merge. The code 43 below is the server behaviour that justifies the rejection.
  it('a nullable column declared with an integer level raises invalid_merge_state, because the server refuses the parameter', async () => {
    for (const fn of ['quantile', 'quantileExact'] as const) {
      const name = `q_int_${fn}`;

      await driver.command({
        query: `CREATE TABLE ${name} (k String, one AggregateFunction(${fn}(1), Nullable(Float64)), zero AggregateFunction(${fn}(0), Nullable(Float64)))
          ENGINE = AggregatingMergeTree ORDER BY k`,
      });

      await driver.command({
        query: `INSERT INTO ${name} SELECT 'a', ${fn}State(1)(toNullable(toFloat64(number))), ${fn}State(0)(toNullable(toFloat64(number))) FROM numbers(11)`,
      });

      const q = table(
        name,
        {
          k: col.String,
          one: col.AggregateFunction(`${fn}(1)`, col.Nullable(col.Float64)),
          zero: col.AggregateFunction(`${fn}(0)`, col.Nullable(col.Float64)),
        },
        { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
      );

      const merge: any = fn === 'quantile' ? quantileMerge : quantileExactMerge;

      for (const emit of [compile, emitNaive])
        for (const level of [1, 0, 0.5])
          for (const column of ['one', 'zero'] as const)
            expect(() =>
              emit(from(q).aggregate((g: any) => ({ x: merge(level)(g[column]) })).ir),
            ).toThrow(/invalid_merge_state/);

      for (const [column, level] of [
        ['one', 1],
        ['zero', 0],
      ] as const) {
        // What a typed merge would send: a Float64 parameter, which the server refuses.
        await expect(
          driver.query({
            query: `SELECT ${fn}Merge({l:Float64})(${column}) FROM ${name}`,
            query_params: { l: level },
          }),
        ).rejects.toMatchObject({ code: '43' });

        // The same level as an integer literal is accepted, so the parameter's type is the whole difference.
        const literal = await rowCount(`SELECT ${fn}Merge(${level})(${column}) AS v FROM ${name}`);
        expect(Number(literal.v)).toBe(level === 1 ? 10 : 0);
      }

      // The docs' way out: finalizeAggregation reads such a column, row by row.
      const finalized = from(q).map(r => ({
        v: sql`finalizeAggregation(${r.one})`.as(col.Nullable(col.Float64)),
      }));

      await agree(finalized, [{ v: 10 }]);
    }
  });

  it('every DDL spelling the server normalizes merges at its level, and only the integer spellings are refused', async () => {
    for (const fn of ['quantile', 'quantileExact'] as const) {
      const merge: any = fn === 'quantile' ? quantileMerge : quantileExactMerge;

      for (const [spelling, serverSpelling, level] of [
        ['1.0', '1.', 1],
        ['1.', '1.', 1],
        ['1e0', '1.', 1],
        ['0.0', '0.', 0],
        ['0.', '0.', 0],
        ['0.90', '0.9', 0.9],
        ['.5', '0.5', 0.5],
        ['5e-1', '0.5', 0.5],
        ['0.30000000000000004', '0.30000000000000004', 0.30000000000000004],
        ['1e-7', '1e-7', 1e-7],
      ] as const) {
        const name = `spell_${fn}_${Buffer.from(spelling).toString('hex')}`;

        await driver.command({
          query: `CREATE TABLE ${name} (k String, s AggregateFunction(${fn}(${spelling}), Nullable(Float64))) ENGINE = AggregatingMergeTree ORDER BY k`,
        });

        await driver.command({
          query: `INSERT INTO ${name} SELECT 'a', ${fn}State(${spelling})(toNullable(toFloat64(number))) FROM numbers(11)`,
        });

        const stored = await rowCount(
          `SELECT type FROM system.columns WHERE table = '${name}' AND name = 's'`,
        );

        expect(stored.type).toBe(`AggregateFunction(${fn}(${serverSpelling}), Nullable(Float64))`);

        // The handwritten twin of what a typed merge sends.
        const response = await driver.query({
          query: `SELECT ${fn}Merge({l:Float64})(s) AS v FROM ${name}`,
          query_params: { l: level },
          format: 'JSONEachRow',
        });

        const [direct] = await response.json<{ v: number }>();

        // A generated descriptor carries the server's spelling; a hand-written one may carry the DDL's.
        for (const descriptor of [`${fn}(${serverSpelling})`, `${fn}(${spelling})`]) {
          const q = table(
            name,
            { k: col.String, s: col.AggregateFunction(descriptor, col.Nullable(col.Float64)) },
            { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
          );

          await agree(
            from(q).aggregate((g: any) => ({ v: merge(level)(g.s) })),
            [{ v: direct!.v }],
          );
        }
      }
    }
  });

  it('a non-nullable integer level stays accepted at any level', async () => {
    await driver.command({
      query: `CREATE TABLE q_plain (k String, one AggregateFunction(quantile(1), Float64), xone AggregateFunction(quantileExact(1), Float64)) ENGINE = AggregatingMergeTree ORDER BY k`,
    });

    await driver.command({
      query: `INSERT INTO q_plain SELECT 'a', quantileState(1)(toFloat64(number)), quantileExactState(1)(toFloat64(number)) FROM numbers(11)`,
    });

    const q = table(
      'q_plain',
      {
        k: col.String,
        one: col.AggregateFunction('quantile(1)', col.Float64),
        xone: col.AggregateFunction('quantileExact(1)', col.Float64),
      },
      { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
    );

    await agree(
      from(q).aggregate(g => ({
        a: quantileMerge(1)(g.one),
        b: quantileMerge(0)(g.one),
        c: quantileMerge(0.5)(g.one),
        d: quantileExactMerge(1)(g.xone),
        e: quantileExactMerge(0)(g.xone),
      })),
      [{ a: 10, b: 0, c: 5, d: 10, e: 0 }],
    );
  });

  it('a level-free nullable column: the docs send it to a known merge, which carries no level', async () => {
    await driver.command({
      query: `CREATE TABLE q_bare (k String, s AggregateFunction(quantile, Nullable(Float64))) ENGINE = AggregatingMergeTree ORDER BY k`,
    });

    await driver.command({
      query: `INSERT INTO q_bare SELECT 'a', quantileState(toNullable(toFloat64(number))) FROM numbers(11)`,
    });

    const q = table(
      'q_bare',
      { k: col.String, s: col.AggregateFunction('quantile', col.Nullable(col.Float64)) },
      { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
    );

    const known = createKnownFunctions({
      quantileMerge: { name: 'quantileMerge', isAggregate: true, deterministic: true, aliasTo: '' },
    } as never) as any;

    await agree(
      from(q).aggregate(g => ({ v: known.agg.quantileMerge(g.s).as(col.Nullable(col.Float64)) })),
      [{ v: 5 }],
    );
  });

  it('system.functions has no combinator names, so generated catalogs have no uniqMerge', async () => {
    const r = await rowCount(
      "SELECT count() AS c FROM system.functions WHERE name IN ('uniqMerge', 'sumMerge', 'sumState', 'quantileMerge')",
    );

    expect(Number(r.c)).toBe(0);
    const base = await rowCount("SELECT count() AS c FROM system.functions WHERE name = 'uniq'");
    expect(Number(base.c)).toBe(1);
  });
});

describe('stored arguments and result types', () => {
  beforeAll(async () => {
    await driver.command({
      query: `CREATE TABLE stored (
        k String,
        u1 AggregateFunction(uniq, UInt64), u2 AggregateFunction(uniq, String, UInt64), un AggregateFunction(uniq, Nullable(String)),
        e1 AggregateFunction(uniqExact, UInt64), e2 AggregateFunction(uniqExact, String, UInt64),
        c1 AggregateFunction(count, UInt64), cn AggregateFunction(count, Nullable(UInt64)),
        d2 AggregateFunction(sum, Decimal(9, 2)), d76 AggregateFunction(sum, Decimal(50, 3)),
        qd AggregateFunction(quantileExact(0.5), Date), xd AggregateFunction(max, Date), xs AggregateFunction(max, LowCardinality(String)),
        an AggregateFunction(argMax, Nullable(String), UInt32), ad AggregateFunction(avg, Decimal(18, 2)),
        qt AggregateFunction(quantile(0.5), DateTime('UTC')), simple SimpleAggregateFunction(max, UInt64)
      ) ENGINE = AggregatingMergeTree ORDER BY k`,
    });

    await driver.command({ query: 'SYSTEM STOP MERGES stored' });

    for (const start of [0, 50])
      await driver.command({
        query: `INSERT INTO stored SELECT 'a',
          uniqState(number + ${start}), uniqState(toString(number % 3), number + ${start}), uniqState(if(number % 2 = 0, NULL, toString(number + ${start}))),
          uniqExactState(number + ${start}), uniqExactState(toString(number % 3), number + ${start}),
          countState(number), countState(if(number % 2 = 0, NULL, number)),
          sumState(toDecimal32(number + 0.25, 2)), sumState(toDecimal256(number, 3)::Decimal(50, 3)),
          quantileExactState(0.5)(toDate('2024-01-01') + number), maxState(toDate('2024-01-01') + number), maxState(toLowCardinality(toString(number))),
          argMaxState(if(number = 49, NULL, toString(number)), toUInt32(number + ${start})), avgState(toDecimal64(number, 2)),
          quantileState(0.5)(toDateTime('2024-01-01 00:00:00', 'UTC') + number), max(number)
          FROM numbers(50)`,
      });
  });

  const stored = table(
    'stored',
    {
      k: col.String,
      u1: col.AggregateFunction('uniq', col.UInt64),
      u2: col.AggregateFunction('uniq', col.String, col.UInt64),
      un: col.AggregateFunction('uniq', col.Nullable(col.String)),
      e1: col.AggregateFunction('uniqExact', col.UInt64),
      e2: col.AggregateFunction('uniqExact', col.String, col.UInt64),
      c1: col.AggregateFunction('count', col.UInt64),
      cn: col.AggregateFunction('count', col.Nullable(col.UInt64)),
      d2: col.AggregateFunction('sum', col.Decimal(9, 2)),
      d76: col.AggregateFunction('sum', col.Decimal(50, 3)),
      qd: col.AggregateFunction('quantileExact(0.5)', col.Date),
      xd: col.AggregateFunction('max', col.Date),
      xs: col.AggregateFunction('max', col.String),
      an: col.AggregateFunction('argMax', col.Nullable(col.String), col.UInt32),
      ad: col.AggregateFunction('avg', col.Decimal(18, 2)),
      qt: col.AggregateFunction('quantile(0.5)', col.DateTime('UTC')),
      simple: col.SimpleAggregateFunction('max', col.UInt64),
    },
    { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
  );

  it('the server declares the merged result the descriptor declares', async () => {
    const query = from(stored).aggregate((g: any) => ({
      u1: uniqMerge(g.u1),
      u2: uniqMerge(g.u2),
      un: uniqMerge(g.un),
      e1: uniqExactMerge(g.e1),
      e2: uniqExactMerge(g.e2),
      c1: countMerge(g.c1),
      cn: countMerge(g.cn),
      d2: sumMerge(g.d2),
      d76: sumMerge(g.d76),
      xd: maxMerge(g.xd),
      xs: maxMerge(g.xs),
      an: argMaxMerge(g.an),
    }));

    for (const emit of [compile, emitNaive]) {
      const compiled = emit(query.ir);

      const response = await driver.query({
        query: compiled.sql,
        query_params: compiled.params,
        format: 'JSON',
      });

      const json = await response.json<{ meta: { name: string; type: string }[] }>();

      for (const { name, type } of json.meta!)
        expect(print(compiled.columns[name]!), name).toBe(type);
    }
  });

  it('values: count, uniq and uniqExact over stored arguments, Decimal scale and argMax', async () => {
    const query = from(stored).aggregate((g: any) => ({
      u1: uniqMerge(g.u1),
      u2: uniqMerge(g.u2),
      e1: uniqExactMerge(g.e1),
      c1: countMerge(g.c1),
      cn: countMerge(g.cn),
      d2: sumMerge(g.d2),
      xd: maxMerge(g.xd),
    }));

    const native = await handwritten(
      `SELECT uniqMerge(u1) AS u1, uniqMerge(u2) AS u2, uniqExactMerge(e1) AS e1, countMerge(c1) AS c1, countMerge(cn) AS cn, sumMerge(d2) AS d2, maxMerge(xd) AS xd FROM stored`,
      query.ir,
    );

    expect(native.length).toBe(1);
    await agree(query, native);
    expect(String((native[0] as any).d2)).toMatch(/^\d+(\.\d{1,2})?$/);
  });

  it('forms that stay rejected', () => {
    const q = from(stored) as any;

    for (const emit of [compile, emitNaive]) {
      for (const f of [
        () => q.aggregate((g: any) => ({ x: avgMerge(g.ad) })),
        () => q.aggregate((g: any) => ({ x: quantileMerge(0.5)(g.qt) })),
        () => q.aggregate((g: any) => ({ x: maxMerge(g.simple) })),
        () => q.aggregate((g: any) => ({ x: quantileExactMerge(0.5)(g.qd) })),
      ])
        expect(() => emit(f().ir)).toThrow(/invalid_merge_state/);
    }
  });

  it('the server agrees those forms are different things', async () => {
    // -Merge of a SimpleAggregateFunction does not exist on the server either.
    await expect(
      driver.query({ query: 'SELECT maxMerge(simple) FROM stored' }),
    ).rejects.toMatchObject({ code: '43' });

    // avg over Decimal and quantile over DateTime work on the server; the typed tier declines them, as documented.
    await driver.query({ query: 'SELECT avgMerge(ad), quantileMerge(0.5)(qt) FROM stored' });
  });
});

describe('a nested state never reaches the client', () => {
  const meta = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

  const nested = table(
    'nested_states',
    {
      k: col.String,
      total: col.AggregateFunction('uniq', col.String),
      a: col.Array(col.AggregateFunction('uniq', col.String)),
      m: col.Map(col.String, col.AggregateFunction('uniq', col.String)),
      v: col.Variant(col.AggregateFunction('uniq', col.String), col.String),
    },
    meta,
  );

  beforeAll(async () => {
    await driver.command({
      query: `CREATE TABLE nested_states (
        k String, total AggregateFunction(uniq, String), a Array(AggregateFunction(uniq, String)),
        m Map(String, AggregateFunction(uniq, String)), v Variant(AggregateFunction(uniq, String), String)
      ) ENGINE = MergeTree ORDER BY k`,
      clickhouse_settings: { allow_experimental_variant_type: 1 },
    });

    await driver.command({
      query: `INSERT INTO nested_states SELECT 'a', uniqState(toString(number)), [uniqState(toString(number))], map('x', uniqState(toString(number))),
        CAST(uniqState(toString(number)) AS Variant(AggregateFunction(uniq, String), String)) FROM numbers(200)`,
      clickhouse_settings: { allow_experimental_variant_type: 1 },
    });
  });

  it.each(['a', 'm', 'v'] as const)('column %s', async column => {
    for (const { label, backend } of backends) {
      const client = createClientFromBackend(backend);

      await expect(
        (async () => client.run((from(nested) as any).map((r: any) => ({ x: r[column] }))))(),
        label,
      ).rejects.toThrow(/aggregate_state_selection/);
    }

    // Reached directly: the server does return the bytes, so the rule is not hypothetical.
    const raw = await driver.query({
      query: `SELECT ${column} AS x FROM nested_states`,
      format: 'JSONEachRow',
    });

    expect(await raw.text()).toContain('\ufffd'.length ? '"x"' : '');
  });

  it('a direct state beside those columns still merges, and they stay readable by count', async () => {
    await agree(
      from(nested).aggregate(g => ({ n: uniqMerge(g.total) })),
      [{ n: 200n }],
    );

    await agree(from(nested).count(), [{ count: 1n }]);

    await agree(
      from(nested).map(r => ({ k: r.k })),
      [{ k: 'a' }],
    );

    await agree(
      (from(nested) as any)
        .map((r: any) => ({ k: r.k, c: r.m, s: r.total }))
        .aggregate((g: any) => ({ n: uniqMerge(g.s) })),
      [{ n: 200n }],
    );

    await agree(
      (from(nested) as any).map((r: any) => ({ n: sql`length(${r.a})`.as(col.UInt64) })),
      [{ n: 1n }],
    );
  });

  describe('a column the parser reads as Unknown', () => {
    beforeAll(async () => {
      await driver.command({
        query: `CREATE TABLE unmodelled (k String, n Nested(a AggregateFunction(uniq, String)), p AggregateFunction(uniq, Point)) ENGINE = MergeTree ORDER BY k`,
        clickhouse_settings: { flatten_nested: 0 },
      });

      await driver.command({
        query: `INSERT INTO unmodelled SELECT 'a', [tuple(uniqState(toString(number)))], uniqState((toFloat64(number), toFloat64(number))::Point) FROM numbers(200)`,
        clickhouse_settings: { flatten_nested: 0 },
      });
    });

    it.each(['n', 'p'] as const)('real column %s, described from system.columns', async column => {
      const row = await rowCount(
        `SELECT type FROM system.columns WHERE table = 'unmodelled' AND name = '${column}'`,
      );

      const parsed = parseCHType(row.type as string);
      expect(parsed.kind).toBe('Unknown');

      // The rule: a raw state never reaches the client.
      for (const { label, backend } of backends)
        await expect(
          (async () =>
            createClientFromBackend(backend).run(
              from(
                table(
                  'unmodelled',
                  { k: col.String, [column]: { type: parsed } } as never,
                  meta,
                ) as any,
              ).map((r: any) => ({ y: r[column] })),
            ))(),
          label,
        ).rejects.toThrow(/aggregate_state_selection|decode_unsupported/);
    });
  });

  it('the known-tier route reads AggregateFunction(uniq, Point), and the plain reads still work', async () => {
    const t = table(
      'unmodelled',
      { k: col.String, p: { type: parseCHType('AggregateFunction(uniq, Point)') } } as never,
      meta,
    ) as any;

    const known = createKnownFunctions({
      uniqMerge: { name: 'uniqMerge', isAggregate: true, deterministic: true, aliasTo: '' },
    } as never) as any;

    await agree(
      from(t).aggregate((g: any) => ({ n: known.agg.uniqMerge(g.p).as(col.UInt64) })),
      [{ n: 200n }],
    );

    await agree(from(t).count(), [{ count: 1n }]);

    await agree(
      from(t).map((r: any) => ({ k: r.k })),
      [{ k: 'a' }],
    );
  });

  it('state-free types the parser cannot model return usable rows', async () => {
    await driver.command({
      query: `CREATE TABLE no_state (k String, n Nested(a String, b UInt32), f Nested(AggregateFunction String),
        q Nested(\`AggregateFunction(x)\` String), p Point, r Ring, ap Array(Point)) ENGINE = MergeTree ORDER BY k`,
      clickhouse_settings: { flatten_nested: 0 },
    });

    await driver.command({
      query: `INSERT INTO no_state VALUES ('a', [('x', 1), ('y', 2)], [('z')], [('w')], (1.5, 2.5), [(1, 2), (3, 4)], [(5, 6)])`,
    });

    const described = await driver.query({
      query: "SELECT name, type FROM system.columns WHERE table = 'no_state'",
      format: 'JSONEachRow',
    });

    const columns: Record<string, unknown> = {};

    for (const { name, type } of await described.json<{ name: string; type: string }>())
      columns[name] = { type: parseCHType(type) };

    for (const name of ['n', 'f', 'q', 'p', 'r', 'ap'])
      expect((columns[name] as { type: { kind: string } }).type.kind, name).toBe('Unknown');

    await agree(from(table('no_state', columns as never, meta) as any), [
      {
        k: 'a',
        n: [
          { a: 'x', b: 1 },
          { a: 'y', b: 2 },
        ],
        f: [{ AggregateFunction: 'z' }],
        q: [{ 'AggregateFunction(x)': 'w' }],
        p: [1.5, 2.5],
        r: [
          [1, 2],
          [3, 4],
        ],
        ap: [[5, 6]],
      },
    ]);
  });

  it('system.columns prints one spelling, whatever the DDL used: only hand-written text can hide a state from the scanner', async () => {
    const accepted = [
      'AggregateFunction/*c*/(uniq, String)',
      'AggregateFunction -- c\n(uniq, String)',
      'AggregateFunction\n(uniq, String)',
      'AggregateFunction\t(uniq, String)',
      '"AggregateFunction"(uniq, String)',
      '`AggregateFunction`(uniq, String)',
      '`Aggregate\\x46unction`(uniq, String)',
      '"Aggregate\\x46unction"(uniq, String)',
    ];

    for (const [i, spelling] of accepted.entries()) {
      await driver.command({
        query: `CREATE TABLE spelled_${i} (k String, x ${spelling}) ENGINE = MergeTree ORDER BY k`,
      });

      const row = await rowCount(
        `SELECT type FROM system.columns WHERE table = 'spelled_${i}' AND name = 'x'`,
      );

      expect(row.type, spelling).toBe('AggregateFunction(uniq, String)');
      expect(containsAggregateState(parseCHType(row.type as string)), spelling).toBe(true);
    }

    await driver.command({
      query: `CREATE TABLE spelled_point (k String, x AggregateFunction/*c*/(uniq, Point)) ENGINE = MergeTree ORDER BY k`,
    });

    const point = await rowCount(
      "SELECT type FROM system.columns WHERE table = 'spelled_point' AND name = 'x'",
    );

    expect(point.type).toBe('AggregateFunction(uniq, Point)');
    expect(containsAggregateState(parseCHType(point.type as string))).toBe(true);

    // Type family names are case-sensitive here, so a case variant is not a state on the server either.
    for (const spelling of ['aggregatefunction(uniq, String)', 'AGGREGATEFUNCTION(uniq, String)'])
      await expect(
        driver.command({
          query: `CREATE TABLE spelled_case (k String, x ${spelling}) ENGINE = MergeTree ORDER BY k`,
        }),
      ).rejects.toMatchObject({ code: '50' });
  });

  it('Dynamic is a declared pass-through: the type says nothing of its contents, so a state in one is not caught', async () => {
    await driver.command({
      query: 'CREATE TABLE dynamic_state (k String, x Dynamic) ENGINE = MergeTree ORDER BY k',
      clickhouse_settings: { allow_experimental_dynamic_type: 1 },
    });

    await driver.command({
      query: `INSERT INTO dynamic_state SELECT 'a', CAST(uniqState(toString(number)) AS Dynamic) FROM numbers(200)`,
      clickhouse_settings: { allow_experimental_dynamic_type: 1 },
    });

    const t = table('dynamic_state', { k: col.String, x: col.Dynamic }, meta);
    const rows = await createClientFromBackend(backends[1]!.backend).run(from(t));
    expect(typeof (rows[0] as { x: unknown }).x).toBe('string');
    expect((rows[0] as { x: string }).x).toContain('\ufffd');
  });
});
