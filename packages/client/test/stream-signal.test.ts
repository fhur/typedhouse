import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { createClickHouseBackend, createClientFromBackend, type Backend, type Plan } from '../src/index.js';

const driver = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@clickhouse/client', () => ({ createClient: () => driver }));
beforeEach(() => { vi.clearAllMocks(); });

const fake = () => {
  const run = vi.fn<Backend['run']>(async function* () { yield [{ id: 1 }]; });
  const backend: Backend = { name: 'fake', compile: () => ({ compiled: {} }) as Plan, run };
  return { run, client: createClientFromBackend(backend) };
};
const query = from(table('t', { id: col.UInt8 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const collect = async <T>(rows: AsyncIterable<T>) => { const out: T[] = []; for await (const row of rows) out.push(row); return out; };

it('hands a backend the signal given to stream', async () => {
  const { run, client } = fake();
  const { signal } = new AbortController();
  await collect(client.stream(query, { signal }));
  expect(run.mock.calls[0]![1]).toEqual({ signal });
});

it('a stream without options calls a backend as before', async () => {
  const { run, client } = fake();
  await collect(client.stream(query));
  expect(run.mock.calls[0]).toHaveLength(1);
});

it('the ClickHouse backend gives the driver the signal, and leaves it out without one', async () => {
  const respond = () => driver.query.mockResolvedValueOnce({ stream: () => Readable.from([[{ json: () => ({ id: 1 }) }]]), close: vi.fn() });
  const backend = createClickHouseBackend();
  const plan = backend.compile(query.ir);
  const { signal } = new AbortController();
  respond();
  await collect(backend.run(plan, { signal }));
  expect(driver.query.mock.calls[0]![0].abort_signal).toBe(signal);
  respond();
  await collect(backend.run(plan));
  expect('abort_signal' in driver.query.mock.calls[1]![0]).toBe(false);
});

it('the ClickHouse backend ends a stream already under way when aborted', async () => {
  const controller = new AbortController();
  const stream = new Readable({ objectMode: true, read() {} });
  stream.push([{ json: () => ({ id: 1 }) }]);
  const close = vi.fn();
  driver.query.mockResolvedValueOnce({ stream: () => stream, close });
  const backend = createClickHouseBackend();
  const rows = backend.run(backend.compile(query.ir), { signal: controller.signal });
  await rows[Symbol.asyncIterator]().next();
  const iterator = rows[Symbol.asyncIterator]();
  const pending = iterator.next();
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(close).toHaveBeenCalled();
});
