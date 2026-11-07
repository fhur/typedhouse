import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table } from '@typedhouse/core';
import { createClient, QueryError } from '../src/index.js';

let container: StartedTestContainer;
let client: ReturnType<typeof createClient>;
const quick = from(table('quick', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).orderBy(r => r.id);
// One row a second, in blocks of one: rows arrive well before the query is done.
const slow = from(table('slow', { id: col.UInt64 }, { engine: 'View', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  const driver = createDriver(options);
  try {
    await driver.command({ query: 'CREATE TABLE quick (id UInt64) ENGINE=Memory' });
    await driver.command({ query: 'INSERT INTO quick SELECT number FROM numbers(3)' });
    await driver.command({ query: 'CREATE VIEW slow AS SELECT number AS id FROM numbers(8) WHERE sleepEachRow(1) = 0 SETTINGS max_block_size = 1' });
  } finally { await driver.close(); }
  client = createClient(options);
}, 120_000);
afterAll(async () => { await client?.close(); await container?.stop(); });

const drain = async <T>(rows: AsyncIterable<T>) => { const out: T[] = []; for await (const row of rows) out.push(row); return out; };
const rows = [{ id: 0n }, { id: 1n }, { id: 2n }];

it('reads the same rows with no options, empty options and a signal that never fires', async () => {
  expect(await drain(client.stream(quick))).toEqual(rows);
  expect(await drain(client.stream(quick, {}))).toEqual(rows);
  expect(await drain(client.stream(quick, { signal: new AbortController().signal }))).toEqual(rows);
  expect(await client.run(quick)).toEqual(rows);
});

it('a signal aborted before the start reads nothing', async () => {
  await expect(drain(client.stream(quick, { signal: AbortSignal.abort() }))).rejects.toBeInstanceOf(QueryError);
});

it('an abort before the response starts ends the read at once', async () => {
  const started = performance.now();
  await expect(drain(client.stream(slow, { signal: AbortSignal.timeout(200) }))).rejects.toBeInstanceOf(QueryError);
  expect(performance.now() - started).toBeLessThan(2_500);
});

it('an abort after rows have arrived ends the read at once, keeping those rows', async () => {
  const controller = new AbortController();
  const seen: unknown[] = [];
  const started = performance.now();
  const reading = (async () => { for await (const row of client.stream(slow, { signal: controller.signal })) { seen.push(row); controller.abort(); } })();
  await expect(reading).rejects.toBeInstanceOf(QueryError);
  expect(seen).toEqual([{ id: 0n }]);
  expect(performance.now() - started).toBeLessThan(4_000);
});
