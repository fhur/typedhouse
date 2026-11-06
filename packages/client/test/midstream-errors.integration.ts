import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, sql, table, unionAll, type Caps, type Query } from '@typedhouse/core';
import { createClickHouseBackend, createClient, QueryError } from '../src/index.js';

/** A server error after output started, on any query: HTTP 200, rows, then the error text. */
const big = table(
  'mid_big',
  { id: col.UInt64, s: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const exceptional = table(
  'mid_exception',
  { exception: col.String },
  { engine: 'MergeTree', sortingKey: ['exception'], partitionKey: [] },
);

const lookalike = 'Code: 396. DB::Exception: Limit for result exceeded (TOO_MANY_ROWS_OR_BYTES)';

let server: StartedTestContainer;

let url: string;

let client: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClickHouseBackend>;

type Runnable<R> = Pick<Query<R, Caps>, 'ir' | '_rowType' | 'caps'>;

const streamed = async <R>(target: Pick<typeof client, 'stream'>, query: Runnable<R>) => {
  const rows: R[] = [];
  let error: unknown;

  try {
    for await (const row of target.stream(query)) rows.push(row);
  } catch (caught) {
    error = caught;
  }

  return { rows, error };
};

const code = (error: unknown) =>
  error instanceof QueryError ? (error.cause as { code?: unknown } | undefined)?.code : error;

const failure = (run: Promise<unknown>) =>
  run.then(
    rows => ({ rows }),
    (error: unknown) => code(error),
  );

const throwing = from(big).map(r => ({
  id: r.id,
  v: sql`throwIf(${r.id} = 1500000, 'boom')`.as(col.UInt8),
}));

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

  for (const query of [
    'CREATE TABLE mid_big (id UInt64, s String) ENGINE = MergeTree ORDER BY id',
    `INSERT INTO mid_big SELECT number, repeat('x', 50) FROM numbers(3000000)`,
    'CREATE TABLE mid_exception (exception String) ENGINE = MergeTree ORDER BY exception',
    `INSERT INTO mid_exception VALUES ('a'), ('b\nCode: 396. DB::Exception: x'), ('${lookalike}')`,
    'CREATE USER mid_ro2 IDENTIFIED WITH no_password SETTINGS readonly = 2',
    'GRANT SELECT ON default.* TO mid_ro2',
  ])
    await admin.command({ query });

  await admin.close();
  client = createClient({ url, request_timeout: 120000 });
  naive = createClickHouseBackend({ url, request_timeout: 120000 }, 'clickhouse-naive');
}, 180000);

afterAll(async () => {
  await client?.close();
  await naive?.close();
  await server?.stop();
});

describe('a server error raised after output started', () => {
  it('throwIf late in a scan, with no settings, keeps its code on run and stream', async () => {
    expect(await failure(client.run(throwing))).toBe('395');
    const { rows, error } = await streamed(client, throwing);
    expect(code(error)).toBe('395');
    // stream may yield rows first; they are real rows of the query.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(3000000);
    expect(rows.every(row => typeof row.id === 'bigint' && row.v === 0)).toBe(true);
  }, 120000);

  it('a multi-line message keeps its code', async () => {
    const query = from(big).map(r => ({
      v: sql`throwIf(${r.id} = 1500000, 'line\n{"v":1}')`.as(col.UInt8),
    }));

    expect(await failure(client.run(query))).toBe('395');
    const { rows, error } = await streamed(client, query);
    expect(code(error)).toBe('395');
    expect(rows.every(row => row.v === 0)).toBe(true);
  }, 120000);

  it('a client-level http_write_exception_in_output_format does not reopen the ambiguity', async () => {
    const own = createClient({
      url,
      clickhouse_settings: { http_write_exception_in_output_format: 1 },
    });

    try {
      const query = unionAll(from(exceptional), from(exceptional)).settings({
        max_result_rows: 3,
        max_threads: 1,
      });

      expect(await failure(own.run(query))).toBe('396');
      expect(code((await streamed(own, query)).error)).toBe('396');
    } finally {
      await own.close();
    }
  });

  it('readonly = 2 accepts the setting and keeps the code', async () => {
    const own = createClient({ url, username: 'mid_ro2', password: '' });

    try {
      expect(await failure(own.run(throwing))).toBe('395');
    } finally {
      await own.close();
    }
  }, 120000);

  it('a limit on a real exception column never adds a row', async () => {
    const query = unionAll(from(exceptional), from(exceptional)).settings({
      max_result_rows: 3,
      max_threads: 1,
    });

    expect(await failure(client.run(query))).toBe('396');
    expect(await failure(naive.runBuffered(naive.compile(query.ir)))).toBe('396');
    const { rows, error } = await streamed(client, query);
    expect(code(error)).toBe('396');
    expect(JSON.stringify(rows)).not.toContain('Limit for result exceeded, max rows');

    for (const row of rows)
      expect(['a', 'b\nCode: 396. DB::Exception: x', lookalike]).toContain(row.exception);
  });
});

describe('data that looks like an error stays data', () => {
  const expected = [
    { exception: lookalike },
    { exception: 'a' },
    { exception: 'b\nCode: 396. DB::Exception: x' },
  ];

  it('in a column named exception and in any other column, on run and stream', async () => {
    const q = from(exceptional).orderBy(r => r.exception);
    expect(await client.run(q)).toEqual(expected);
    expect((await streamed(client, q)).rows).toEqual(expected);
    expect((await streamed(client, q)).error).toBeUndefined();

    const renamed = from(exceptional)
      .map(r => ({ other: r.exception }))
      .orderBy(r => r.other);

    expect((await client.run(renamed)).map(r => r.other)).toEqual(expected.map(r => r.exception));
  });
});

describe('a body cut off by something other than the server', () => {
  let fake: Server;

  let fakeUrl: string;

  beforeAll(async () => {
    fake = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"id":"1"}\n{"id":"2"}\n{"id":');
      setTimeout(() => response.destroy(), 20);
    });

    await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
    fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => fake.close(resolve));
  });

  it('a dropped connection never ends normally', async () => {
    const own = createClient({ url: fakeUrl });

    try {
      const q = from(
        table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
      );

      await expect(own.run(q)).rejects.toBeInstanceOf(QueryError);
      const { rows, error } = await streamed(own, q);
      expect(error).toBeInstanceOf(QueryError);
      expect(rows).toEqual([{ id: 1n }, { id: 2n }]);
    } finally {
      await own.close();
    }
  });
});
