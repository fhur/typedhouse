import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickHouseLogLevel, createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait } from 'testcontainers';
import {
  asofLeftJoin,
  col,
  count,
  from,
  fullJoin,
  leftJoin,
  print,
  rightJoin,
  sql,
  table,
  uniq,
  unionAll,
  type CHType,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient } from '../src/index.js';

/** D21 Tester. Every result is compared with 24.8, whose server already returns the default, and every
 * `meta` with the descriptor, on both emitters and through run, stream and the naive path. */
const versions = ['24.8', '24.3', '25.3', '25.8', '25.10', '26.3', '26.10'] as const;

type Version = (typeof versions)[number];

async function start(version: Version) {
  const reuse = process.env[`D21_URL_${version.replace('.', '_')}`];
  if (reuse) return { url: reuse, stop: async () => undefined };

  const server = await new GenericContainer(`clickhouse/clickhouse-server:${version}`)
    .withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forResponsePredicate(body => body === 'Ok.\n'))
    .start();

  return {
    url: `http://${server.getHost()}:${server.getMappedPort(8123)}`,
    stop: async () => void (await server.stop()),
  };
}

/** Settings each version knows: 24.3 has none of the JSON ones. */
const experimental = (version: Version): Record<string, number> =>
  version === '24.3'
    ? { allow_experimental_variant_type: 1 }
    : {
        allow_experimental_json_type: 1,
        allow_experimental_variant_type: 1,
        allow_experimental_dynamic_type: 1,
      };

const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

// Hostile text in names and Enum labels: quotes, backslashes, `')`, newlines and parameter-shaped text.
const hostileEnum = col.Enum8({
  "it's": 1,
  'a\\b': 2,
  "')": 3,
  'x\ny': 4,
  '{p0:String}': 5,
  '`q`': 6,
});

const hostile = col.Tuple({
  "it's": col.UInt8,
  'a`b': col.String,
  'x\\y': col.Nullable(col.UInt32),
  'n\nl': hostileEnum,
  '{p1:UInt8}': col.DateTime('Asia/Tokyo'),
  "')": col.Tuple({ "'": col.Int64 }),
});

const l = table('d21x_l', { k: col.UInt8, ts: col.UInt32 }, opts);

const right = {
  k: col.UInt8,
  ts: col.UInt32,
  h: hostile,
  plain: col.Tuple({ a: col.UInt8, b: col.String }),
  at: col.Array(col.Tuple({ a: col.UInt8 })),
  mt: col.Map(col.String, col.Tuple({ a: col.UInt8 })),
  pt: col.Unknown('Point'),
  ring: col.Unknown('Ring'),
  poly: col.Unknown('Polygon'),
  mpoly: col.Unknown('MultiPolygon'),
};

const r = table('d21x_r', right as any, opts) as any;

const ddl = (columns: Record<string, { type: CHType }>) =>
  Object.entries(columns)
    .map(([name, c]) => `\`${name}\` ${print(c.type)}`)
    .join(', ');

/** The null-extended side is always `q`; rightJoin puts it first. */
const kinds: Record<string, (rel: any, left?: any) => any> = {
  leftJoin: (q, t = from(l)) => (leftJoin as any)({ t }, { q }).on((x: any) => x.t.k.eq(x.q.k)),
  rightJoin: (q, t = from(l)) => (rightJoin as any)({ q }, { t }).on((x: any) => x.t.k.eq(x.q.k)),
  fullJoin: (q, t = from(l)) => (fullJoin as any)({ t }, { q }).on((x: any) => x.t.k.eq(x.q.k)),
  asofLeftJoin: (q, t = from(l)) =>
    (asofLeftJoin as any)({ t }, { q })
      .on((x: any) => x.t.k.eq(x.q.k))
      .asof((x: any) => x.t.ts.ge(x.q.ts)),
};

const shapes: Record<string, (k: (rel: any) => any) => any> = {
  'hostile whole': k => k(from(r)).map((x: any) => ({ k: x.t.k, h: x.q.h })),
  'hostile elements': k =>
    k(from(r)).map((x: any) => ({
      k: x.t.k,
      a: x.q.h.element("it's"),
      b: x.q.h.element('a`b'),
      c: x.q.h.element('x\\y'),
      e: x.q.h.element('n\nl'),
      d: x.q.h.element('{p1:UInt8}'),
      z: x.q.h.element("')").element("'"),
    })),
  'Array and Map of Tuple keep defaults, unwrapped': k =>
    k(from(r)).map((x: any) => ({ k: x.t.k, at: x.q.at, mt: x.q.mt })),
  'groupBy the whole tuple, having on count': k =>
    k(from(r))
      .groupBy((x: any) => ({ p: x.q.plain }))
      .aggregate(() => ({ n: count() }))
      .where((x: any) => x.n.gt(0n)),
  'groupBy an element, uniq over an element': k =>
    k(from(r))
      .groupBy((x: any) => ({ a: x.q.plain.element('a') }))
      .aggregate((x: any) => ({ u: uniq(x.q.plain.element('b')), n: count() })),
  'distinct over the tuple': k =>
    k(from(r))
      .map((x: any) => ({ p: x.q.plain }))
      .distinct(),
  'limitBy an element': k =>
    k(from(r))
      .orderBy((x: any) => x.t.k)
      .limitBy((x: any) => x.q.plain.element('b'))
      .take(5)
      .map((x: any) => ({ k: x.t.k, p: x.q.plain })),
  'where and orderBy on an element': k =>
    k(from(r))
      .where((x: any) => x.q.plain.element('a').eq(0))
      .orderBy((x: any) => x.q.plain.element('b'))
      .thenBy((x: any) => x.t.k)
      .map((x: any) => ({ k: x.t.k })),
  'settings()': k =>
    k(from(r))
      .map((x: any) => ({ k: x.t.k, p: x.q.plain }))
      .settings({ max_threads: 1 }),
  'union of two joins': k =>
    unionAll(
      k(from(r)).map((x: any) => ({ k: x.t.k, p: x.q.plain })),
      k(from(r).where((x: any) => x.k.eq(1))).map((x: any) => ({ k: x.t.k, p: x.q.plain })),
    ),
  'an IN subquery over an element': k =>
    from(l)
      .where((x: any) =>
        x.k.in(
          k(from(r))
            .where((y: any) => y.q.plain.element('a').eq(0))
            .map((y: any) => y.t.k),
        ),
      )
      .map((x: any) => ({ k: x.k })),
  'a CTE read twice': k => {
    const shared = k(from(r)).map((x: any) => ({ k: x.t.k, p: x.q.plain }));

    return (leftJoin as any)({ a: shared }, { b: shared })
      .on((x: any) => x.a.k.eq(x.b.k))
      .map((x: any) => ({ k: x.a.k, p: x.b.p }));
  },
  'a join over a join, extended on both levels': k => {
    const inner = k(from(r)).map((x: any) => ({ k: x.t.k, p: x.q.plain }));

    return (leftJoin as any)({ t: from(l) }, { q: inner.where((x: any) => x.k.eq(1)) })
      .on((x: any) => x.t.k.eq(x.q.k))
      .map((x: any) => ({ k: x.t.k, p: x.q.p, a: x.q.p.element('a') }));
  },
  'raw sql over an element and over the column': k =>
    k(from(r)).map((x: any) => ({
      k: x.t.k,
      a: sql`tupleElement(${x.q.plain}, 'a') + 1`.as(col.UInt16),
      s: sql`length(${x.q.plain}.2)`.as(col.UInt64),
    })),
  'parser Unknown kinds (Point, Ring, Polygon, MultiPolygon), read as they come': k =>
    k(from(r)).map((x: any) => ({ k: x.t.k, ring: x.q.ring, poly: x.q.poly, mpoly: x.q.mpoly })),
};

const paths = async (c: ReturnType<typeof connect>, q: any) => {
  const streamed: unknown[] = [];
  for await (const row of c.optimized.stream(q)) streamed.push(row);
  const plan = c.naive.compile(q.ir);

  return {
    run: await c.optimized.run(q),
    stream: streamed,
    naive: await c.naive.runBuffered(plan),
  };
};

const sorted = (rows: unknown) =>
  (rows as unknown[])
    .map(row => JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)))
    .sort();

function connect(url: string, settings: Record<string, number>) {
  const options = {
    url,
    clickhouse_settings: settings as never,
    log: { level: ClickHouseLogLevel.OFF },
  };

  const admin = createDriver(options);
  const optimized = createClient(options);
  const naive = createClickHouseBackend(options, 'clickhouse-naive');

  return {
    admin,
    optimized,
    naive,
    meta: async (compiled: { sql: string; params: Record<string, unknown> }) =>
      (
        (await (
          await admin.query({ query: compiled.sql, query_params: compiled.params, format: 'JSON' })
        ).json()) as { meta: { name: string; type: string }[] }
      ).meta,
    close: async () => {
      await admin.close();
      await optimized.close();
      await naive.close();
    },
  };
}

const baseline = new Map<string, string[]>();

describe.each(versions)('on %s', version => {
  let stop: () => Promise<void>;

  let c: ReturnType<typeof connect>;

  beforeAll(async () => {
    const server = await start(version);
    stop = server.stop;
    c = connect(server.url, experimental(version));

    for (const query of [
      'CREATE OR REPLACE TABLE d21x_l (k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY k',
      `CREATE OR REPLACE TABLE d21x_r (${ddl(right as never)}) ENGINE = MergeTree ORDER BY k`,
      'INSERT INTO d21x_l VALUES (1, 10), (2, 10), (3, 10)',
    ])
      await c.admin.command({ query });

    await c.admin.insert({
      table: 'd21x_r',
      format: 'JSONEachRow',
      values: [
        {
          k: 1,
          ts: 5,
          h: {
            "it's": 7,
            'a`b': 'x',
            'x\\y': null,
            'n\nl': "')",
            '{p1:UInt8}': '2024-01-01 00:00:00',
            "')": { "'": 5 },
          },
          plain: { a: 7, b: 'x' },
          at: [{ a: 1 }],
          mt: { m: { a: 1 } },
          pt: [1, 2],
          ring: [[1, 2]],
          poly: [[[1, 2]]],
          mpoly: [[[[1, 2]]]],
        },
      ],
    });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  describe.each(Object.keys(kinds))('%s', kind => {
    it.each(Object.keys(shapes))('%s', async shape => {
      const q = shapes[shape]!(kinds[kind]!);

      for (const compiled of [compile(q.ir), emitNaive(q.ir)]) {
        const meta = await c.meta(compiled);

        expect(Object.fromEntries(meta.map(m => [m.name, m.type])), `${compiled.sql}`).toEqual(
          Object.fromEntries(Object.entries(compiled.columns).map(([n, t]) => [n, print(t)])),
        );
      }

      const got = await paths(c, q);
      const key = `${kind}|${shape}`;
      // Parser Unknown kinds differ by version on purpose; their own test pins that.
      const versionFree = !shape.startsWith('parser Unknown');

      for (const [path, rows] of Object.entries(got)) {
        if (version === '24.8') {
          if (path === 'run') baseline.set(key, sorted(rows));
          expect(sorted(rows), path).toEqual(baseline.get(key));
        } else if (versionFree)
          expect(sorted(rows), `${path} against 24.8`).toEqual(baseline.get(key));
      }
    });
  });

  it('the typed default of each hostile element, as the descriptor says', async () => {
    const q = shapes['hostile elements']!(kinds.leftJoin!).where((x: any) => x.k.eq(2));
    const [row] = (await c.optimized.run(q)) as Record<string, unknown>[];

    expect(row).toEqual({
      k: 2,
      a: 0,
      b: '',
      c: null,
      e: "it's",
      d: new Date(0),
      z: 0n,
    });
  });

  it('a Point, unwrapped, reads [0, 0] up to 25.10 and NULL from 26.3', async () => {
    const q = kinds.leftJoin!(from(r))
      .map((x: any) => ({ k: x.t.k, pt: x.q.pt }))
      .where((x: any) => x.k.eq(2));

    expect(compile(q.ir).sql).not.toMatch(/defaultValueOfTypeName/);
    const [row] = (await c.optimized.run(q)) as { pt: unknown }[];
    expect(row!.pt).toEqual(['26.3', '26.10'].includes(version) ? null : [0, 0]);
  });

  it('a Ring, Polygon and MultiPolygon are arrays and keep [] on every version', async () => {
    const q = shapes[
      'parser Unknown kinds (Point, Ring, Polygon, MultiPolygon), read as they come'
    ]!(kinds.leftJoin!).where((x: any) => x.k.eq(2));

    expect(await c.optimized.run(q)).toEqual([{ k: 2, ring: [], poly: [], mpoly: [] }]);
  });
});
