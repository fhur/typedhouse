import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { col, from, table } from '@chql/core';
import { createClient, QueryError } from '../src/index.js';
const driver = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn() }));
vi.mock('@clickhouse/client', () => ({ createClient: () => driver }));
const q = from(table('rows', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeEach(() => vi.clearAllMocks());
function response(values: unknown[], fail?: Error) {
  const parsed = vi.fn((value: unknown) => value);
  let pulled = 0;
  const stream = Readable.from((async function* () {
    for (const value of values) { pulled++; yield [{ json: () => parsed(value) }]; }
    if (fail) throw fail;
  })(), { highWaterMark: 1 });
  const result = { stream: vi.fn(() => stream), close: vi.fn(), json: vi.fn(async () => values) };
  driver.query.mockResolvedValue(result);
  return { result, stream, parsed, pulled: () => pulled };
}
it('is lazy, decodes only requested rows, bounds pulling and closes on break without closing the client', async () => {
  const fixture = response(Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })));
  const client = createClient();
  const iterator = client.stream(q);
  expect(driver.query).not.toHaveBeenCalled();
  expect(await iterator.next()).toEqual({ done: false, value: { id: 0n } });
  await new Promise(resolve => setImmediate(resolve));
  expect(fixture.parsed).toHaveBeenCalledTimes(1);
  expect(fixture.pulled()).toBeLessThanOrEqual(2);
  await iterator.return();
  expect(fixture.stream.destroyed).toBe(true);
  expect(fixture.result.close).toHaveBeenCalledTimes(1);
  expect(fixture.result.json).not.toHaveBeenCalled();
  expect(driver.close).not.toHaveBeenCalled();
});
it('cleans up on exhaustion, consumer throw and empty responses', async () => {
  const client = createClient();
  for (const values of [[], [{ id: '1' }]]) {
    const fixture = response(values);
    const actual = [];
    for await (const row of client.stream(q)) actual.push(row);
    expect(actual).toEqual(values.length ? [{ id: 1n }] : []);
    expect(fixture.result.close).toHaveBeenCalledTimes(1);
    expect(fixture.stream.destroyed).toBe(true);
  }
  const fixture = response([{ id: '1' }, { id: '2' }]);
  const error = new Error('consumer');
  await expect((async () => { for await (const _row of client.stream(q)) throw error; })()).rejects.toBe(error);
  expect(fixture.result.close).toHaveBeenCalledTimes(1);
});
it('wraps execution, stream creation, read, JSON and decode failures with context', async () => {
  const client = createClient();
  const error = new Error('transport');
  driver.query.mockRejectedValueOnce(error);
  await expect(client.stream(q).next()).rejects.toMatchObject({ name: 'QueryError', cause: error, sql: expect.stringContaining('rows'), params: {} });
  for (const mode of ['creation', 'read', 'json', 'decode']) {
    const fixture = response(mode === 'read' ? [] : [{ id: 'bad' }], mode === 'read' ? error : undefined);
    if (mode === 'creation') fixture.result.stream.mockImplementation(() => { throw error; });
    if (mode === 'json') fixture.parsed.mockImplementation(() => { throw error; });
    await expect(client.stream(q).next()).rejects.toBeInstanceOf(QueryError);
    expect(fixture.result.close).toHaveBeenCalledTimes(1);
    fixture.stream.destroy();
  }
});
it('does not compile abandoned iterators and preserves lazy preparation errors', async () => {
  const client = createClient();
  const unsupported = from(table('unsupported', { date: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const abandoned = client.stream(unsupported);
  await abandoned.return();
  expect(driver.query).not.toHaveBeenCalled();
  await expect(client.stream(unsupported).next()).rejects.toThrow('decode_unsupported: Date');
  await expect(client.stream(unsupported).next()).rejects.not.toBeInstanceOf(QueryError);
  expect(driver.query).not.toHaveBeenCalled();
});
it('does not eagerly decode a multi-row driver batch and cleans up after a late decode failure', async () => {
  const client = createClient();
  const parsed = ['1', 'bad', '3'].map(id => vi.fn(() => ({ id })));
  const stream = Readable.from([parsed.map(json => ({ json }))]);
  const result = { stream: () => stream, close: vi.fn(), json: vi.fn() };
  driver.query.mockResolvedValueOnce(result);
  const iterator = client.stream(q.where(r => r.id.gt(0n)));
  expect(await iterator.next()).toEqual({ done: false, value: { id: 1n } });
  expect(parsed[1]).not.toHaveBeenCalled();
  await expect(iterator.next()).rejects.toMatchObject({ name: 'QueryError', params: { p0: '0' }, cause: expect.any(Error) });
  expect(parsed[2]).not.toHaveBeenCalled();
  expect(result.close).toHaveBeenCalledTimes(1);
  expect(stream.destroyed).toBe(true);
  expect(result.json).not.toHaveBeenCalled();
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
});
it('closing one paused cursor neither decodes its remaining batch nor closes another cursor', async () => {
  const client = createClient();
  const remaining = vi.fn(() => ({ id: '2' }));
  const a = Readable.from([[{ json: () => ({ id: '1' }) }, { json: remaining }]]);
  const b = Readable.from([[{ json: () => ({ id: '8' }) }, { json: () => ({ id: '9' }) }]]);
  const closeA = vi.fn(), closeB = vi.fn();
  driver.query.mockResolvedValueOnce({ stream: () => a, close: closeA }).mockResolvedValueOnce({ stream: () => b, close: closeB });
  const first = client.stream(q), second = client.stream(q);
  expect((await first.next()).value).toEqual({ id: 1n });
  expect((await second.next()).value).toEqual({ id: 8n });
  await first.return();
  expect(remaining).not.toHaveBeenCalled();
  expect(closeA).toHaveBeenCalledTimes(1);
  expect(closeB).not.toHaveBeenCalled();
  expect((await second.next()).value).toEqual({ id: 9n });
  expect(await second.next()).toEqual({ done: true, value: undefined });
  expect(closeB).toHaveBeenCalledTimes(1);
  expect(driver.close).not.toHaveBeenCalled();
});
it('shares compilation/decoders with run and uses identical transport settings', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const client = createClient();
  const query = q.where(r => r.id.in([1n, 2n])).materialize();
  try {
    response([{ id: '1' }]);
    for await (const _row of client.stream(query)) { /* exhaust */ }
    expect(warn).toHaveBeenCalledTimes(1);
    await client.run(query);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(driver.query.mock.calls[0]).toEqual(driver.query.mock.calls[1]);
    expect(driver.query.mock.calls[0]![0]).toMatchObject({ format: 'JSONEachRow', query_params: {}, clickhouse_settings: { param_p0: '[1,2]', date_time_output_format: 'iso', output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1 } });
  } finally { warn.mockRestore(); }
});
