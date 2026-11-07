// Against real ClickHouse 24.8: column names that are also statistic names (#1), and aborting a slow agent query (#2).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import { connect, type Connection } from '../server/clickhouse.js';
import { createAgentCapabilities } from '../server/agent-results.js';

let container: StartedTestContainer | undefined;
let connection: Connection | undefined;
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const config = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'test-secret', database: 'default' };
  const admin = createClient(config);
  try {
    await admin.command({ query: `CREATE TABLE named (
      id UInt64, min UInt64, max UInt64, nulls Nullable(UInt64), sampledRows UInt64, approximateDistinct String, commonValues String,
      \`max__stat\` UInt64, \`we ird\` Float64, Min Int32, unsupported Array(UInt8)
    ) ENGINE=Memory` });
    await admin.command({ query: "INSERT INTO named SELECT number, number + 10, number + 20, if(number = 0, NULL, number), number, toString(number % 2), toString(number % 2), number + 30, number / 2, -number, [1] FROM numbers(5)" });
    // Slow per row, in blocks of one: the query takes far longer than any assertion below allows.
    await admin.command({ query: 'CREATE VIEW slow AS SELECT number AS id, sleepEachRow(1) AS waited FROM numbers(8) SETTINGS max_block_size = 1' });
  } finally { await admin.close(); }
  connection = connect(config);
  await connection.refresh();
}, 180_000);
afterAll(async () => { await connection?.close(); await container?.stop(); });

const statistics = async (column: string) => {
  const result = await createAgentCapabilities(connection!).columnsDescribe('named', [column]);
  return result.columns[0]!.statistics as Record<string, unknown>;
};

it.each([
  ['min', { min: '10', max: '14', sampledRows: '5', nulls: '0' }],
  ['max', { min: '20', max: '24', sampledRows: '5', nulls: '0' }],
  ['nulls', { nulls: '1', sampledRows: '5', approximateDistinct: '4', min: '1', max: '4' }],
  ['sampledRows', { sampledRows: '5', nulls: '0', min: '0', max: '4' }],
  ['approximateDistinct', { approximateDistinct: '2', sampledRows: '5' }],
  ['commonValues', { sampledRows: '5' }],
  ['max__stat', { min: '30', max: '34' }],
  ['we ird', { min: '0', max: '2' }],
  ['Min', { min: '-4', max: '0' }],
  ['unsupported', { sampledRows: '5', nulls: '0' }],
])('describes a column named %s', async (column, expected) => {
  const values = await statistics(column);
  expect(values).toMatchObject(expected);
  expect(Object.keys(values).some(key => key.endsWith('__stat'))).toBe(false);
});

it('describes statistic-named columns in one call', async () => {
  const result = await createAgentCapabilities(connection!).columnsDescribe('named', ['id', 'min', 'max', 'nulls']);
  expect(result.columns.map(c => (c.statistics as { min: string }).min)).toEqual(['0', '10', '20', '1']);
});

it('an abort ends a slow query_run at once, with the query gone from the server', async () => {
  const controller = new AbortController();
  const started = performance.now();
  setTimeout(() => controller.abort(), 300);
  await expect(createAgentCapabilities(connection!).queryRun('export default from(slow)', 'owner', controller.signal)).rejects.toThrow();
  // Well short of the query's 8 s. The type check before it isn't abortable and takes seconds on a loaded machine; through the chat, a stop doesn't wait for it.
  expect(performance.now() - started).toBeLessThan(6_000);
  await expect.poll(async () => {
    const running = await connection!.driver.query({ query: "SELECT count() AS n FROM system.processes WHERE query LIKE '%slow%' AND query NOT LIKE '%system.processes%'", format: 'JSONEachRow' });
    return (await running.json<{ n: string }>())[0]!.n;
  }, { timeout: 5_000 }).toBe('0');
});

it('an abort mid-stream ends a query_run that has already sent rows', async () => {
  const controller = new AbortController();
  const started = performance.now();
  setTimeout(() => controller.abort(), 2_200);
  await expect(connection!.runAgentQuery('export default from(slow)', controller.signal)).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(6_500);
});

it('an abort ends a slow columns_describe and skips the columns after it', async () => {
  const controller = new AbortController();
  const started = performance.now();
  setTimeout(() => controller.abort(), 300);
  await expect(createAgentCapabilities(connection!).columnsDescribe('slow', ['id', 'waited'], controller.signal)).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(2_500);
});

it('an already aborted signal runs nothing', async () => {
  await expect(createAgentCapabilities(connection!).columnsDescribe('named', ['id'], AbortSignal.abort())).rejects.toThrow();
  await expect(connection!.runAgentQuery('export default from(named)', AbortSignal.abort())).rejects.toThrow();
});
