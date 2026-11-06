import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, unionAll, type QuerySettings, type Rel } from '@typedhouse/core';
import { createClickHouseBackend, createClient, QueryError } from '../src/index.js';

/** D6 Tester. Regression tests. Once the server has started a response, it reports a limit under HTTP 200
 * at the end of the JSONEachRow body. By default, before 25.11, that is a final `{"exception": "Code: 396. ..."}`
 * line, which reads as a row. A limit must stay a QueryError with its code, and must never become a row. */
const big = table(
  'd6_big',
  { id: col.UInt64, s: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const exceptional = table(
  'd6_exception',
  { exception: col.String },
  { engine: 'MergeTree', sortingKey: ['exception'], partitionKey: [] },
);

let server: StartedTestContainer;

let optimized: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClickHouseBackend>;

type Query<R> = { readonly ir: Rel; readonly _rowType: R; readonly caps: { live: false } };

const paths = <R>(query: Query<R>): readonly [string, () => Promise<unknown[]>][] => [
  ['run', () => optimized.run(query)],
  [
    'stream',
    async () => {
      const rows: unknown[] = [];
      for await (const row of optimized.stream(query)) rows.push(row);
      return rows;
    },
  ],
  ['naive', () => naive.runBuffered(naive.compile(query.ir))],
];

const outcome = async (run: () => Promise<unknown[]>) => {
  try {
    return { rows: await run() };
  } catch (error) {
    return {
      isQueryError: error instanceof QueryError,
      code: ((error as QueryError).cause as { code?: unknown } | undefined)?.code,
      message: String((error as QueryError).cause),
    };
  }
};

beforeAll(async () => {
  server = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_SKIP_USER_SETUP: '1',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forResponsePredicate(body => body === 'Ok.\n'))
    .start();

  const url = `http://${server.getHost()}:${server.getMappedPort(8123)}`;
  const admin = createDriver({ url });

  for (const query of [
    'CREATE TABLE d6_big (id UInt64, s String) ENGINE = MergeTree ORDER BY id',
    `INSERT INTO d6_big SELECT number, repeat('x', 50) FROM numbers(3000000)`,
    'CREATE TABLE d6_exception (exception String) ENGINE = MergeTree ORDER BY exception',
    'INSERT INTO d6_exception SELECT toString(number) FROM numbers(3)',
  ])
    await admin.command({ query });

  await admin.close();
  optimized = createClient({ url, request_timeout: 120000 });
  naive = createClickHouseBackend({ url, request_timeout: 120000 }, 'clickhouse-naive');
}, 180000);

afterAll(async () => {
  await optimized?.close();
  await naive?.close();
  await server?.stop();
});

describe('a limit reached after output started is still a QueryError with its code', () => {
  it.each([
    ['max_result_rows', { max_result_rows: 2_000_000 }, '396'],
    ['max_result_bytes', { max_result_bytes: 50_000_000 }, '396'],
    ['max_execution_time', { max_execution_time: 0.3 }, '159'],
  ] satisfies readonly [string, QuerySettings, string][])('%s', async (_name, settings, code) => {
    for (const [path, run] of paths(from(big).settings(settings)))
      expect(await outcome(run), path).toMatchObject({ isQueryError: true, code });
  });

  it('a small union, where the limit lands after the first branch', async () => {
    const small = from(exceptional).map(r => ({ v: r.exception }));

    const query = unionAll(small, small).settings({ max_result_rows: 3, max_threads: 1 });

    for (const [path, run] of paths(query))
      expect(await outcome(run), path).toMatchObject({ isQueryError: true, code: '396' });
  });
});

describe('a limit never becomes a row', () => {
  it('a column named exception does not receive the server error text', async () => {
    const query = unionAll(from(exceptional), from(exceptional)).settings({
      max_result_rows: 3,
      max_threads: 1,
    });

    for (const [path, run] of paths(query)) {
      const result = await outcome(run);

      // Either the full result or the limit's error; a successful read must not be 4 rows.
      if ('rows' in result) {
        expect(JSON.stringify(result.rows), path).not.toContain('Limit for result exceeded');
        expect(result.rows, path).toHaveLength(6);
      } else expect(result, path).toMatchObject({ isQueryError: true, code: '396' });
    }
  });
});
