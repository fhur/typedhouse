import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { col, from, table, val } from '@chql/core';
import { compile, emitNaive } from '@chql/compiler';
import { createClient, createClientFromBackend, createClickHouseBackend, QueryError, type Backend } from '../src/index.js';
import { collect } from './backend-harness.js';
const driver = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(async () => {}) }));
const createDriver = vi.hoisted(() => vi.fn());
vi.mock('@clickhouse/client', () => ({ createClient: createDriver }));
const q = from(table('rows', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).where(r => r.id.gt(0n)).limit(3);
beforeEach(() => { vi.clearAllMocks(); createDriver.mockImplementation(() => driver); });
function response(ids = ['1', '2']) {
  const parsed = ids.map(id => vi.fn(() => ({ id })));
  const stream = Readable.from([parsed.map(json => ({ json }))]);
  const result = { stream: vi.fn(() => stream), close: vi.fn(), json: vi.fn(async () => ids.map(id => ({ id }))) };
  driver.query.mockResolvedValueOnce(result);
  return { parsed, stream, result };
}
it('accepts arbitrary decoded-batch plugins with per-facade identity caching and no lifecycle dispatch', async () => {
  const close = vi.fn();
  const backend = {
    name: 'custom', close,
    compile: vi.fn((rel) => ({ compiled: compile(rel) })),
    run: vi.fn(async function* () { yield []; yield [{ id: 7n }, { id: 8n }]; }),
  } satisfies Backend & { close(): void };
  const client = createClientFromBackend(backend);
  expect('close' in client).toBe(false);
  await client.stream(q).return();
  expect(backend.compile).not.toHaveBeenCalled();
  expect(await client.run(q)).toEqual([{ id: 7n }, { id: 8n }]);
  expect(await collect(client.stream(q))).toEqual(await client.run(q));
  expect(backend.compile).toHaveBeenCalledTimes(1);
  await client.run(q.limit(3));
  await createClientFromBackend(backend).run(q);
  expect(backend.compile).toHaveBeenCalledTimes(3);
  expect(close).not.toHaveBeenCalled();
  const error = new Error('custom execution');
  backend.run.mockImplementationOnce(async function* () { throw error; });
  await expect(client.run(q)).rejects.toBe(error);
});
for (const mode of ['clickhouse', 'clickhouse-naive'] as const) {
  it(`${mode}: selects compiler, rejects foreign plans, retains Array transport and mandatory settings`, async () => {
    const backend = createClickHouseBackend({}, mode);
    const shared = val([1n, 2n], col.Array(col.UInt64));
    const query = q.map(r => ({ id: r.id, a: shared, b: shared, c: val([1n, 2n], col.Array(col.UInt64)) }));
    const plan = backend.compile(query.ir);
    expect(backend.name).toBe(mode);
    expect(plan.compiled).toEqual((mode === 'clickhouse' ? compile : emitNaive)(query.ir));
    expect(compile(q.ir).sql).not.toBe(emitNaive(q.ir).sql);
    expect(Object.values(plan.compiled.params).filter(v => v === '[1,2]')).toHaveLength(2);
    const foreign = createClickHouseBackend({}, mode);
    await expect(foreign.run(plan).next()).rejects.toThrow('backend_plan_owner');
    await expect(backend.run({ compiled: plan.compiled }).next()).rejects.not.toBeInstanceOf(QueryError);
    expect(driver.query).not.toHaveBeenCalled();
    response([]);
    expect(await collect(backend.run(plan))).toEqual([]);
    const request = driver.query.mock.calls[0]![0];
    expect(request).toMatchObject({ format: 'JSONEachRow', clickhouse_settings: { date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1 } });
    for (const [name, value] of Object.entries(plan.compiled.params)) {
      expect(value === '[1,2]' ? request.clickhouse_settings[`param_${name}`] : request.query_params[name]).toBe(value);
      if (value === '[1,2]') expect(request.query_params).not.toHaveProperty(name);
    }
    await backend.close(); await foreign.close();
    expect(driver.close).toHaveBeenCalledTimes(2);
  });
  it(`${mode}: lazy singleton decoding, partial failure, early exit and concurrent repeat cursors`, async () => {
    const backend = createClickHouseBackend({}, mode), client = createClientFromBackend(backend);
    const prepare = vi.spyOn(backend, 'compile');
    const abandoned = client.stream(q); await abandoned.return();
    expect(prepare).not.toHaveBeenCalled();
    const a = response(['1', 'bad', '3']), b = response(['8', '9']);
    const first = client.stream(q), second = client.stream(q);
    expect((await first.next()).value).toEqual({ id: 1n });
    expect(a.parsed[1]).not.toHaveBeenCalled();
    expect((await second.next()).value).toEqual({ id: 8n });
    await expect(first.next()).rejects.toMatchObject({ name: 'QueryError', params: { p0: '0' } });
    expect(a.parsed[2]).not.toHaveBeenCalled();
    expect(a.result.close).toHaveBeenCalledTimes(1);
    expect(a.stream.destroyed).toBe(true);
    expect(b.result.close).not.toHaveBeenCalled();
    await second.return();
    expect(b.parsed[1]).not.toHaveBeenCalled();
    expect(b.result.close).toHaveBeenCalledTimes(1);
    const c = response();
    expect(await client.run(q)).toEqual([{ id: 1n }, { id: 2n }]);
    expect(c.result.close).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(driver.close).not.toHaveBeenCalled();
    await backend.close();
  });
  it(`${mode}: preparation stays outside QueryError; execution/read/creation/JSON failures clean up`, async () => {
    const backend = createClickHouseBackend({}, mode), client = createClientFromBackend(backend);
    const unsupported = from(table('bad', { day: col.Date32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    await expect(client.run(unsupported)).rejects.not.toBeInstanceOf(QueryError);
    expect(driver.query).not.toHaveBeenCalled();
    const error = new Error('failure');
    driver.query.mockRejectedValueOnce(error);
    await expect(client.run(q)).rejects.toMatchObject({ cause: error, sql: backend.compile(q.ir).compiled.sql });
    for (const failure of ['creation', 'read', 'json']) {
      const f = response();
      if (failure === 'creation') f.result.stream.mockImplementation(() => { throw error; });
      if (failure === 'json') f.parsed[0]!.mockImplementation(() => { throw error; });
      if (failure === 'read') f.result.stream.mockReturnValue(Readable.from((async function* () { throw error; yield []; })()));
      await expect(client.run(q)).rejects.toMatchObject({ name: 'QueryError', cause: error });
      expect(f.result.close).toHaveBeenCalledTimes(1);
      f.stream.destroy();
    }
    const consumer = response();
    await expect((async () => { for await (const _ of client.stream(q)) throw error; })()).rejects.toBe(error);
    expect(consumer.result.close).toHaveBeenCalledTimes(1);
    await backend.close();
  });
}
it('isolates mode caches and closes only the explicitly owned driver', async () => {
  const own = { query: vi.fn(), close: vi.fn(async () => {}) };
  const injected = { query: vi.fn(), close: vi.fn(async () => {}) };
  createDriver.mockReturnValueOnce(own).mockReturnValueOnce(injected);
  const defaultClient = createClient();
  const naive = createClickHouseBackend({}, 'clickhouse-naive');
  const plugin = createClientFromBackend(naive);
  const naiveCompile = vi.spyOn(naive, 'compile');
  own.query.mockResolvedValue({ json: async () => [{ id: '4' }], close: vi.fn() });
  injected.query.mockImplementation(async () => ({ stream: () => Readable.from([[{ json: () => ({ id: '5' }) }]]), close: vi.fn() }));
  expect(await defaultClient.run(q)).toEqual([{ id: 4n }]);
  expect(await plugin.run(q)).toEqual([{ id: 5n }]);
  expect(own.query.mock.calls[0]![0].query).toBe(compile(q.ir).sql);
  expect(injected.query.mock.calls[0]![0].query).toBe(emitNaive(q.ir).sql);
  await defaultClient.close();
  expect(own.close).toHaveBeenCalledTimes(1);
  expect(injected.close).not.toHaveBeenCalled();
  expect(await plugin.run(q)).toEqual([{ id: 5n }]);
  expect(naiveCompile).toHaveBeenCalledTimes(1);
  await naive.close();
  expect(injected.close).toHaveBeenCalledTimes(1);
});
it('passes the exact official options object through without filtering or mutation', async () => {
  const options = {
    url: 'https://example.invalid:8443', username: 'tester', password: 'secret',
    database: 'analytics', request_timeout: 3210, max_open_connections: 3,
    compression: { request: true, response: true },
    tls: { ca_cert: Buffer.from('ca'), cert: Buffer.from('cert'), key: Buffer.from('key') },
    keep_alive: { enabled: true, idle_socket_ttl: 1234 },
    http_headers: { 'X-Probe': 'unchanged' },
    clickhouse_settings: { max_threads: 2 },
  };
  const snapshot = JSON.stringify(options);
  const backend = createClickHouseBackend(options, 'clickhouse-naive');
  const client = createClient(options);
  expect(createDriver.mock.calls.map(call => call[0])).toEqual([options, options]);
  expect(createDriver.mock.calls[0]![0]).toBe(options);
  expect(createDriver.mock.calls[1]![0]).toBe(options);
  expect(JSON.stringify(options)).toBe(snapshot);
  await backend.close(); await client.close();
});
it('returns a custom plugin cursor when a consumer throws into a partially consumed batch', async () => {
  const closed = vi.fn(), unread = vi.fn(() => ({ id: 8n }));
  const failure = new Error('consumer throw');
  const batch = [{ id: 7n }];
  Object.defineProperty(batch, '1', { get: unread, enumerable: true });
  const backend = {
    name: 'custom', compile: (rel) => ({ compiled: compile(rel) }),
    async *run() { try { yield batch; throw new Error('must not resume'); } finally { closed(); } },
  } satisfies Backend;
  const cursor = createClientFromBackend(backend).stream(q);
  expect((await cursor.next()).value).toEqual({ id: 7n });
  await expect(cursor.throw(failure)).rejects.toBe(failure);
  expect(unread).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(await cursor.next()).toEqual({ done: true, value: undefined });
});
it('buffered plans enforce ownership and retain JSON rejection context and cleanup', async () => {
  const a = createClickHouseBackend(), b = createClickHouseBackend({}, 'clickhouse-naive');
  const plan = a.compile(q.ir);
  await expect(b.runBuffered(plan)).rejects.toThrow('backend_plan_owner');
  expect(driver.query).not.toHaveBeenCalled();
  const f = response();
  const failure = new Error('buffered JSON failure');
  f.result.json.mockRejectedValueOnce(failure);
  await expect(a.runBuffered(plan)).rejects.toMatchObject({ cause: failure, sql: plan.compiled.sql, params: plan.compiled.params });
  expect(f.result.close).toHaveBeenCalledTimes(1);
  expect(f.result.stream).not.toHaveBeenCalled();
  f.stream.destroy();
  await a.close(); await b.close();
});
it('default client retains buffered JSON run and owns cleanup, including decode failure', async () => {
  const client = createClient();
  const f = response(['bad']);
  await expect(client.run(q)).rejects.toBeInstanceOf(QueryError);
  expect(f.result.json).toHaveBeenCalledTimes(1);
  expect(f.result.stream).not.toHaveBeenCalled();
  expect(f.result.close).toHaveBeenCalledTimes(1);
  f.stream.destroy();
  await client.close();
  expect(driver.close).toHaveBeenCalledTimes(1);
});
