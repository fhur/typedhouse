import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, from, table, val } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';

// A session timezone far from UTC: the parameter path must not depend on it.
const hostile = { session_timezone: 'America/New_York' } as const;

const zones = [undefined, 'UTC', 'Europe/Amsterdam'] as const;

const instants = [
  '1970-01-01T00:00:00.000Z',
  '2026-01-02T03:04:05.678Z',
  '2026-03-29T00:59:59.999Z',
  '2026-03-29T01:00:00.001Z', // Amsterdam spring-forward
  '2026-10-25T00:59:59.999Z',
  '2026-10-25T01:00:00.001Z', // Amsterdam fall-back
  '2106-02-07T06:28:15.000Z', // DateTime maximum
];

const metadata = { engine: 'Memory', sortingKey: [], partitionKey: [] };

const one = from(table('one', { n: col.UInt8 }, metadata));

const events = table(
  'dt_events',
  { id: col.UInt32, at: col.DateTime('Europe/Amsterdam') },
  metadata,
);

const stored = [
  { id: 1, at: '2026-03-29T00:30:00Z' },
  { id: 2, at: '2026-03-29T01:30:00Z' },
  { id: 3, at: '2026-10-25T00:30:00Z' },
  { id: 4, at: '2026-10-25T01:30:00Z' },
];

let container: StartedTestContainer;

let driver: ReturnType<typeof createClient>;

const backends: ReturnType<typeof createClickHouseBackend>[] = [];

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_USER: 'fixture',
      CLICKHOUSE_PASSWORD: 'fixture',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123))
    .start();

  const options = {
    url: `http://${container.getHost()}:${container.getMappedPort(8123)}`,
    username: 'fixture',
    password: 'fixture',
  };

  driver = createClient(options);

  for (const mode of ['clickhouse', 'clickhouse-naive'] as const)
    backends.push(createClickHouseBackend(options, mode));

  await driver.command({ query: 'CREATE TABLE one (n UInt8) ENGINE=Memory' });
  await driver.command({ query: 'INSERT INTO one VALUES (1)' });

  await driver.command({
    query: "CREATE TABLE dt_events (id UInt32, at DateTime('Europe/Amsterdam')) ENGINE=Memory",
  });

  // Insert by epoch seconds so the fixture itself cannot be shifted by any timezone.
  await driver.command({
    query: `INSERT INTO dt_events VALUES ${stored.map(r => `(${r.id}, ${new Date(r.at).getTime() / 1000})`).join(',')}`,
  });
}, 120000);

afterAll(async () => {
  for (const backend of backends) await backend.close();
  await driver?.close();
  await container?.stop();
});

it('sends Date as UTC seconds and restores the declared DateTime type without moving the instant', async () => {
  for (const zone of zones)
    for (const iso of instants) {
      const value = val(new Date(iso), col.DateTime(zone));
      const query = one.map(() => ({ at: value, again: value }));
      const expectedSeconds = Math.floor(new Date(iso).getTime() / 1000);
      // A server-built literal of the declared type is the type oracle (session timezone included).
      const literal = `toDateTime('2026-01-01 00:00:00'${zone === undefined ? '' : `,'${zone}'`})`;

      for (const emit of [compile, emitNaive]) {
        const plan = emit(query.ir);
        expect(Object.keys(plan.params)).toEqual(['p0']);

        const result = await driver.query({
          query: `SELECT toTypeName(at) AS actual,toTypeName(${literal}) AS expected,toUnixTimestamp(at) AS seconds FROM (${plan.sql})`,
          query_params: plan.params,
          format: 'JSONEachRow',
          clickhouse_settings: hostile,
        });

        try {
          const [row] = await result.json<{ actual: string; expected: string; seconds: number }>();
          expect(row!.actual).toBe(row!.expected);
          expect(Number(row!.seconds)).toBe(expectedSeconds);
        } finally {
          result.close();
        }
      }

      for (const backend of backends)
        expect(await createClientFromBackend(backend).run(query)).toEqual([
          { at: new Date(expectedSeconds * 1000), again: new Date(expectedSeconds * 1000) },
        ]);
    }
}, 120000);

it('filters a DateTime column by a Date parameter exactly at DST boundaries', async () => {
  for (const cutoff of [
    '2026-03-29T01:00:00Z',
    '2026-03-29T01:30:00Z',
    '2026-10-25T01:00:00Z',
    '2026-10-25T01:30:00.999Z',
  ]) {
    const since = new Date(cutoff);
    // Independent oracle: compare instants in JS (DateTime floors the parameter to the second).
    const sinceSeconds = Math.floor(since.getTime() / 1000);

    const expected = stored
      .filter(r => new Date(r.at).getTime() / 1000 >= sinceSeconds)
      .map(r => ({ id: r.id }));

    const query = from(events)
      .where(e => e.at.ge(since))
      .map(e => ({ id: e.id }))
      .orderBy(e => e.id);

    for (const emit of [compile, emitNaive]) {
      const plan = emit(query.ir);

      const result = await driver.query({
        query: plan.sql,
        query_params: plan.params,
        format: 'JSONEachRow',
        clickhouse_settings: hostile,
      });

      try {
        expect(await result.json()).toEqual(expected);
      } finally {
        result.close();
      }
    }

    for (const backend of backends)
      expect(await createClientFromBackend(backend).run(query)).toEqual(expected);
  }
}, 120000);

it('rejects instants a DateTime cannot hold before anything reaches the server', () => {
  for (const instant of [new Date(-1000), new Date((0xffff_ffff + 1) * 1000)]) {
    const query = from(events).where(e => e.at.ge(instant));

    for (const emit of [compile, emitNaive])
      expect(() => emit(query.ir)).toThrow(/param_incompatible/);
  }
});
