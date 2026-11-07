import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickHouseLogLevel, createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait } from 'testcontainers';
import { col, from, join, leftJoin, print, table } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClient } from '../src/index.js';

/** D21 second form, Tester. The wrapper strips one outer `Nullable(` from `toTypeName(c)` with a regex,
 * then CASTs back. These types put `Nullable(` inside a non-Nullable outer type, in member names, under
 * LowCardinality and deep nesting; `JSON(max_dynamic_paths=2)` behind `col.JSON` and a
 * SimpleAggregateFunction over a Tuple with a Nullable member check that the CAST to the same type
 * changes no data. Each matched row must equal the same column read through an inner join, each unmatched
 * row must equal 24.8's, and `meta` must equal the descriptor. */
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

const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('d21p_l', { k: col.UInt8 }, opts);

const tuples = {
  tn: [col.Tuple({ a: col.Nullable(col.UInt8) }), { a: 4 }],
  tnm: [col.Tuple({ Nullable: col.UInt8, b: col.String }), { Nullable: 5, b: 'x' }],
  tnp: [col.Tuple({ 'Nullable(': col.UInt8, ')': col.String }), { 'Nullable(': 6, ')': 'y' }],
  tlc: [
    col.Tuple({
      a: col.LowCardinality(col.Nullable(col.String)),
      b: col.LowCardinality(col.String),
    }),
    { a: 'p', b: 'q' },
  ],
  deep: [
    col.Tuple({
      x: col.Tuple({
        y: col.Tuple({ z: col.Nullable(col.UInt8), w: col.Array(col.Nullable(col.String)) }),
      }),
    }),
    { x: { y: { z: 7, w: ['a', null] } } },
  ],
  tm: [col.Tuple({ m: col.Map(col.String, col.Nullable(col.UInt8)) }), { m: { a: 1, b: null } }],
  saf: [
    col.SimpleAggregateFunction(
      'anyLast',
      col.Tuple({ a: col.UInt8, s: col.Nullable(col.String) }),
    ),
    { a: 8, s: 'z' },
  ],
} as const;

const r = table(
  'd21p_r',
  { k: col.UInt8, ...Object.fromEntries(Object.entries(tuples).map(([n, [c]]) => [n, c])) } as any,
  opts,
) as any;

// A JSON whose physical type has a parameter, described as plain `col.JSON`, with more paths than it keeps
// as dynamic subcolumns: the CAST must not move or lose any.
const j = table('d21p_j', { k: col.UInt8, js: col.JSON }, opts);

const settings = (v: Version): Record<string, number> =>
  v === '24.3' ? {} : { allow_experimental_json_type: 1 };

const sorted = (rows: unknown) =>
  (rows as unknown[])
    .map(row => JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)))
    .sort();

const baseline = new Map<string, unknown>();

describe.each(versions)('on %s', version => {
  let stop: () => Promise<void>;

  let admin: ReturnType<typeof createDriver>;

  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const server = await start(version);
    stop = server.stop;

    const options = {
      url: server.url,
      clickhouse_settings: settings(version) as never,
      log: { level: ClickHouseLogLevel.OFF },
    };

    admin = createDriver(options);
    client = createClient(options);

    for (const query of [
      'CREATE OR REPLACE TABLE d21p_l (k UInt8) ENGINE = MergeTree ORDER BY k',
      `CREATE OR REPLACE TABLE d21p_r (k UInt8, ${Object.entries(tuples)
        .map(([n, [c]]) => `${n} ${print(c.type)}`)
        .join(', ')}) ENGINE = MergeTree ORDER BY k`,
      'INSERT INTO d21p_l VALUES (1), (2)',
      ...(version === '24.3'
        ? []
        : [
            'CREATE OR REPLACE TABLE d21p_j (k UInt8, js JSON(max_dynamic_paths = 2)) ENGINE = MergeTree ORDER BY k',
            `INSERT INTO d21p_j VALUES (1, '{"a": 1, "b": {"c": "x"}, "d": [1, 2], "e": 2.5}')`,
          ]),
    ])
      await admin.command({ query });

    await admin.insert({
      table: 'd21p_r',
      format: 'JSONEachRow',
      values: [{ k: 1, ...Object.fromEntries(Object.entries(tuples).map(([n, [, v]]) => [n, v])) }],
    });
  });

  afterAll(async () => {
    await admin?.close();
    await client?.close();
    await stop();
  });

  const meta = async (compiled: { sql: string; params: Record<string, unknown> }) =>
    (
      (await (
        await admin.query({ query: compiled.sql, query_params: compiled.params, format: 'JSON' })
      ).json()) as { meta: { type: string }[] }
    ).meta.map(m => m.type);

  it.each(Object.keys(tuples))('%s', async name => {
    const outer = leftJoin({ t: from(l) }, { q: from(r) })
      .on((x: any) => x.t.k.eq(x.q.k))
      .map((x: any) => ({ k: x.t.k, v: x.q[name] }));

    const inner = join({ t: from(l), q: from(r) })
      .on((x: any) => x.t.k.eq(x.q.k))
      .map((x: any) => ({ k: x.t.k, v: x.q[name] }));

    for (const compiled of [compile(outer.ir), emitNaive(outer.ir)]) {
      expect(compiled.sql).toContain('CAST(ifNull(');
      expect(await meta(compiled)).toEqual(Object.values(compiled.columns).map(t => print(t)));
    }

    const rows = (await client.run(outer as never)) as { k: number; v: unknown }[];
    const matched = (await client.run(inner as never)) as { k: number; v: unknown }[];
    expect(sorted(rows.filter(row => row.k === 1))).toEqual(sorted(matched));
    expect(rows.find(row => row.k === 1)!.v).toEqual(tuples[name as keyof typeof tuples][1]);

    const unmatched = rows.find(row => row.k === 2);
    if (version === '24.8') baseline.set(name, unmatched);
    expect(unmatched).toEqual(baseline.get(name));
  });

  it.skipIf(version === '24.3')(
    'JSON(max_dynamic_paths = 2) behind col.JSON keeps every path',
    async () => {
      const outer = leftJoin({ t: from(l) }, { q: from(j) })
        .on(x => x.t.k.eq(x.q.k))
        .map(x => ({ k: x.t.k, js: x.q.js }));

      const inner = join({ t: from(l), q: from(j) })
        .on(x => x.t.k.eq(x.q.k))
        .map(x => ({ k: x.t.k, js: x.q.js }));

      const rows = (await client.run(outer)) as { k: number; js: unknown }[];
      expect(sorted(rows.filter(row => row.k === 1))).toEqual(sorted(await client.run(inner)));
      expect(rows.find(row => row.k === 2)!.js).toEqual({});

      // The paths kept outside the dynamic subcolumns are still there, compared through the server.
      const compiled = compile(outer.ir);

      const result = await admin.query({
        query: `SELECT toString(js) AS s FROM (${compiled.sql.replace(/ SETTINGS .*$/s, '')}) WHERE k = 1 SETTINGS join_use_nulls = 1`,
        format: 'JSON',
      });

      const [row] = ((await result.json()) as { data: { s: string }[] }).data;

      expect(JSON.parse(row!.s)).toEqual(
        JSON.parse(
          (
            (await (
              await admin.query({ query: 'SELECT toString(js) AS s FROM d21p_j', format: 'JSON' })
            ).json()) as { data: { s: string }[] }
          ).data[0]!.s,
        ),
      );
    },
  );
});
