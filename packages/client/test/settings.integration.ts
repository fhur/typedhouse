import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  col,
  count,
  from,
  join,
  leftJoin,
  sql,
  table,
  unionAll,
  type QuerySettings,
  type SettingsQuery,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient, QueryError } from '../src/index.js';

const t = table(
  'settings_t',
  { id: col.UInt32, cat: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const u = table(
  'settings_u',
  { id: col.UInt32, name: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const q = from(t);

const reading = (key: keyof QuerySettings) => sql`toString(getSetting(${key}))`.as(col.String);

let server: StartedTestContainer;

let url: string;

let optimized: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClickHouseBackend>;

async function runNaive<R>(query: SettingsQuery<R>): Promise<R[]> {
  const plan = naive.compile(query.ir);
  return (await naive.runBuffered(plan)) as R[];
}

const both = async <R>(query: SettingsQuery<R>) => [
  await optimized.run(query),
  await runNaive(query),
];

beforeAll(async () => {
  server = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_SKIP_USER_SETUP: '1',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forResponsePredicate(body => body === 'Ok.\n'))
    .start();

  url = `http://${server.getHost()}:${server.getMappedPort(8123)}`;
  const admin = createDriver({ url });

  await admin.command({
    query: 'CREATE TABLE settings_t (id UInt32, cat String) ENGINE = MergeTree ORDER BY id',
  });

  await admin.command({
    query: 'CREATE TABLE settings_u (id UInt32, name String) ENGINE = MergeTree ORDER BY id',
  });

  await admin.command({
    query: 'INSERT INTO settings_t SELECT number, toString(number % 3) FROM numbers(1000)',
  });

  await admin.command({
    query: 'INSERT INTO settings_u SELECT number, toString(number) FROM numbers(10)',
  });

  await admin.command({
    query: 'CREATE USER ro_user IDENTIFIED WITH no_password SETTINGS readonly = 1',
  });

  await admin.command({
    query: 'CREATE USER ro2_user IDENTIFIED WITH no_password SETTINGS readonly = 2',
  });

  await admin.command({ query: 'GRANT SELECT ON default.* TO ro_user, ro2_user' });
  await admin.close();
  optimized = createClient({ url });
  naive = createClickHouseBackend({ url }, 'clickhouse-naive');
}, 120000);

afterAll(async () => {
  await optimized?.close();
  await naive?.close();
  await server?.stop();
});

describe('values reach the server', () => {
  const cases: readonly [keyof QuerySettings, QuerySettings[keyof QuerySettings], string][] = [
    ['max_threads', 2, '2'],
    ['max_threads', 2n, '2'],
    ['max_execution_time', 1.5, '1.5'],
    ['max_execution_time', 0, '0'],
    ['max_execution_time', 9223372036854, '9223372036854'],
    ['max_memory_usage', 1_000_000_000, '1000000000'],
    ['max_memory_usage', 2n ** 64n - 1n, '18446744073709551615'],
    ['max_rows_to_read', 100000, '100000'],
    ['max_bytes_to_read', 100000000n, '100000000'],
    ['max_result_rows', 1000, '1000'],
    ['max_result_bytes', 100000000, '100000000'],
    ['max_block_size', 1024, '1024'],
    ['max_bytes_before_external_group_by', 100000000, '100000000'],
    ['max_bytes_before_external_sort', 100000000n, '100000000'],
    ['priority', 3, '3'],
    ['log_comment', 'report', 'report'],
    ['log_comment', '', ''],
  ];

  it.each(cases)('%s = %s', async (key, value, read) => {
    const query = q
      .limit(1)
      .map(() => ({ v: reading(key) }))
      .settings({ [key]: value });

    expect(await both(query)).toEqual([[{ v: read }], [{ v: read }]]);
  });

  it.each([
    ["it's"],
    ['back\\slash \\n'],
    ['a\nb\tc\rd\0e\bf\fg'],
    ['\u0001\u007f'],
    ["'; DROP TABLE settings_t; --"],
    ['*/ -- /* #'],
    ['{p0:UInt8} {x:String}'],
    ['é 🙂 ñ'],
    ['FORMAT JSON'],
    ['SETTINGS limit = 1'],
  ])('log_comment %j reads back', async comment => {
    const query = q
      .limit(1)
      .map(() => ({ v: reading('log_comment') }))
      .settings({ log_comment: comment });

    expect(await both(query)).toEqual([[{ v: comment }], [{ v: comment }]]);
  });

  it('a comment sits before the trailing join_use_nulls comment, and both settings hold', async () => {
    const query = leftJoin({ a: q }, { b: from(u) })
      .on(r => r.a.id.eq(r.b.id))
      .map(r => ({
        id: r.a.id,
        name: r.b.name,
        comment: reading('log_comment'),
      }))
      .orderBy(r => r.id)
      .limit(20)
      .settings({ log_comment: "*/ -- it's", max_threads: 1 });

    for (const rows of await both(query)) {
      expect(rows).toHaveLength(20);
      expect(rows[0]).toEqual({ id: 0, name: '0', comment: "*/ -- it's" });
      expect(rows[19]).toEqual({ id: 19, name: null, comment: "*/ -- it's" });
    }

    expect(compile(query.ir).sql.endsWith('type defaults */')).toBe(true);
    expect(emitNaive(query.ir).sql.endsWith('type defaults */')).toBe(true);
  });

  it('reaches subqueries, CTEs and union branches', async () => {
    const seen = q.limit(1).map(() => ({ v: reading('max_threads') }));
    const shared = seen.cte();
    const settings = { max_threads: 3 };
    const expected = [{ v: '3' }];

    const shapes = [
      seen.distinct().settings(settings),
      unionAll(seen, seen).distinct().settings(settings),
      shared.distinct().settings(settings),
      join({ a: seen, b: seen })
        .on(r => r.a.v.eq(r.b.v))
        .map(r => ({ v: r.b.v }))
        .settings(settings),
    ];

    for (const shape of shapes) expect(await both(shape)).toEqual([expected, expected]);
    const branches = await both(unionAll(seen, seen).settings(settings));

    expect(branches).toEqual([
      [...expected, ...expected],
      [...expected, ...expected],
    ]);
  });
});

describe('results', () => {
  it('rows do not change under performance settings', async () => {
    const shape = q
      .groupBy(r => ({ cat: r.cat }))
      .aggregate(() => ({ c: count() }))
      .orderBy(r => r.cat);

    const plain = await optimized.run(shape);

    const settled = shape.settings({
      max_threads: 1,
      max_block_size: 7,
      max_bytes_before_external_group_by: 100000000,
      max_bytes_before_external_sort: 100000000,
      priority: 1,
    });

    expect(plain).toHaveLength(3);
    expect(await both(settled)).toEqual([plain, plain]);
  });

  it('zero is accepted where the server substitutes its own value', async () => {
    const shape = q.orderBy(r => r.id).limit(2);
    const expected = await optimized.run(shape);

    expect(await both(shape.settings({ max_threads: 0, max_block_size: 0 }))).toEqual([
      expected,
      expected,
    ]);

    const unlimited = shape.settings({
      max_memory_usage: 0,
      max_execution_time: 0,
      max_result_rows: 0,
    });

    expect(await both(unlimited)).toEqual([expected, expected]);
  });

  it('stream takes the same path', async () => {
    const rows: unknown[] = [];

    for await (const row of optimized.stream(
      q
        .orderBy(r => r.id)
        .limit(2)
        .settings({ max_threads: 1 }),
    ))
      rows.push(row);

    expect(rows).toEqual([
      { id: 0, cat: '0' },
      { id: 1, cat: '1' },
    ]);
  });
});

describe('limits raise QueryError with their code', () => {
  const failure = async (run: () => Promise<unknown>) => {
    const error = await run().then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(QueryError);
    return String(((error as QueryError).cause as { code?: unknown }).code);
  };

  it.each([
    ['max_rows_to_read', { max_rows_to_read: 1 }, '158'],
    ['max_bytes_to_read', { max_bytes_to_read: 1 }, '307'],
    ['max_result_rows', { max_result_rows: 1 }, '396'],
    ['max_result_bytes', { max_result_bytes: 1 }, '396'],
    ['max_execution_time', { max_execution_time: 0.000001 }, '159'],
  ] satisfies readonly [string, QuerySettings, string][])('%s', async (_name, settings, code) => {
    const shape = q.map(r => ({ id: r.id, cat: r.cat })).settings(settings);
    expect(await failure(() => optimized.run(shape))).toBe(code);
    expect(await failure(() => runNaive(shape))).toBe(code);

    expect(
      await failure(async () => {
        for await (const row of optimized.stream(shape)) void row;
      }),
    ).toBe(code);
  });
});

describe('read-only users', () => {
  const asUser = (username: string) => createClient({ url, username, password: '' });

  it('readonly = 1 raises code 164 with or without settings, for the client output settings', async () => {
    const client = asUser('ro_user');

    try {
      for (const query of [q.limit(1), q.limit(1).settings({ max_threads: 1 })]) {
        const error = await client.run(query).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(QueryError);
        expect(((error as QueryError).cause as { code?: unknown }).code).toBe('164');
      }
    } finally {
      await client.close();
    }
  });

  it('readonly = 2 accepts settings', async () => {
    const client = asUser('ro2_user');

    try {
      const rows = await client.run(
        q
          .orderBy(r => r.id)
          .limit(1)
          .settings({ max_threads: 1 }),
      );

      expect(rows).toEqual([{ id: 0, cat: '0' }]);
    } finally {
      await client.close();
    }
  });
});
