import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, countIf, from, table, val } from '@chql/core';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect } from './backend-harness.js';
import { stockHistory } from '../../compiler/test/fixtures/corpus/stock-history.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const q = from(table('range_values', { id: col.UInt32, n: col.Nullable(col.Int64), lo: col.Int64, hi: col.Int64, s: col.String, at: col.DateTime64(3, 'Europe/Amsterdam'), day: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  await driver.command({ query: "CREATE TABLE range_values (id UInt32,n Nullable(Int64),lo Int64,hi Int64,s String,at DateTime64(3,'Europe/Amsterdam'),day Date) ENGINE=Memory" });
  await driver.command({ query: "INSERT INTO range_values VALUES (0,NULL,1,3,'', '2026-03-29 01:59:59.122','2026-03-28'),(1,1,1,3,'a','2026-03-29 01:59:59.123','2026-03-29'),(2,2,1,3,'b','2026-03-29 03:00:00.456','2026-03-29'),(3,3,1,3,'c','2026-03-29 03:00:00.457','2026-03-30'),(4,4,1,3,'z','2026-03-29 03:00:00.458','2026-03-31')" });
  for (const file of ['schema.sql', 'seed.sql']) {
    for (const statement of readFileSync(new URL(`../../compiler/test/fixtures/${file}`, import.meta.url), 'utf8').split(';').filter(s => s.trim())) await driver.command({ query: statement });
  }
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
it('executes inclusive, reversed, NULL, empty-string and expression bounds through run/stream', async () => {
  const query = q.map(r => ({ id: r.id, inside: r.n.between(r.lo, r.hi), point: r.n.between(2n, 2n), reversed: r.n.between(3n, 1n), nullLower: r.n.between(null, 3n), nullUpper: r.n.between(1n, null), text: r.s.between('', 'b'), instant: r.at.between(new Date('2026-03-29T00:59:59.123Z'), new Date('2026-03-29T01:00:00.456Z')), day: r.day.between(new Date('2026-03-29T23:59:59Z'), new Date('2026-03-29T00:00:00Z')) })).orderBy(r => r.id.asc());
  const expected = [
    { id: 0, inside: null, point: null, reversed: null, nullLower: null, nullUpper: null, text: true, instant: false, day: false },
    { id: 1, inside: true, point: false, reversed: false, nullLower: null, nullUpper: null, text: true, instant: true, day: true },
    { id: 2, inside: true, point: true, reversed: false, nullLower: null, nullUpper: null, text: true, instant: true, day: true },
    { id: 3, inside: true, point: false, reversed: false, nullLower: null, nullUpper: null, text: false, instant: false, day: false },
    { id: 4, inside: false, point: false, reversed: false, nullLower: false, nullUpper: null, text: false, instant: false, day: false },
  ];
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    expect(await client.run(query)).toEqual(expected);
    expect(await collect(client.stream(query))).toEqual(expected);
    expect(await client.run(q.aggregate(g => ({ tally: countIf(g.n.between(val(1n), 3n)) })))).toEqual([{ tally: 3n }]);
    expect(await client.run(q.where(r => r.n.between(3n, 1n)))).toEqual([]);
  }
});
it('preserves arithmetic operands, mixed date descriptors and AND/OR precedence against native comparisons', async () => {
  const query = q.map(r => ({
    id: r.id,
    arithmetic: r.n.plus(1n).between(r.lo.minus(1n), r.hi.plus(1n)),
    mixedDate: r.at.between(r.day, new Date('2026-03-29T01:00:00.456Z')),
    hostile: r.s.between("a' OR 1=1 --", 'z'),
    combined: r.n.between(1n, 2n).or(r.n.between(3n, 4n)).and(r.n.between(2n, 3n)),
  })).orderBy(r => r.id.asc());
  const result = await driver.query({
    query: `SELECT id, ((n+1 >= lo-1) AND (n+1 <= hi+1)) AS arithmetic,
      ((at >= day) AND (at <= toDateTime64('2026-03-29 01:00:00.456',3,'UTC'))) AS mixedDate,
      ((s >= {hostile:String}) AND (s <= 'z')) AS hostile,
      ((((n>=1) AND (n<=2)) OR ((n>=3) AND (n<=4))) AND ((n>=2) AND (n<=3))) AS combined
      FROM range_values ORDER BY id`,
    query_params: { hostile: "a' OR 1=1 --" }, format: 'JSONEachRow',
  });
  const boolean = (value: number | null) => value === null ? null : value !== 0;
  let expected;
  try {
    expected = (await result.json<{ id: number; arithmetic: number | null; mixedDate: number; hostile: number; combined: number | null }>()).map(r => ({
      id: r.id, arithmetic: boolean(r.arithmetic), mixedDate: boolean(r.mixedDate), hostile: boolean(r.hostile), combined: boolean(r.combined),
    }));
  } finally { result.close(); }
  expect(expected.map(r => r.combined)).toEqual([null, false, true, true, false]);
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    expect(await client.run(query)).toEqual(expected);
    expect(await collect(client.stream(query))).toEqual(expected);
    const filtered = q.where(r => r.n.between(1n, 2n).or(r.n.between(3n, 4n)))
      .where(r => r.n.between(2n, 3n)).map(r => r.id).orderBy(r => r.id);
    expect(await client.run(filtered)).toEqual([{ id: 2 }, { id: 3 }]);
  }
});
it('preserves deterministic fallible receiver errors rather than treating ranges as total predicates', async () => {
  await expect(driver.query({ query: "SELECT CAST(s AS Int64) >= 1 AND CAST(s AS Int64) <= 3 FROM range_values", format: 'JSONEachRow' })).rejects.toThrow(/Cannot parse/);
  const query = q.map(r => ({ flag: cast(r.s, col.Int64).between(1n, 3n) }));
  for (const backend of backends) {
    const client = createClientFromBackend(backend);
    const failure = { name: 'QueryError', cause: expect.objectContaining({ code: '32', message: expect.stringContaining('Cannot parse Int64 from String') }) };
    await expect(client.run(query)).rejects.toMatchObject(failure);
    await expect(collect(client.stream(query))).rejects.toMatchObject(failure);
  }
});
it('executes the spec history window with FINAL through native SQL and both official backends', async () => {
  for (const [since, until] of [['2026-04-27', '2026-05-04'], ['2026-04-27', '2026-04-27'], ['2026-05-04', '2026-04-27']]) {
    const lower = new Date(since!), upper = new Date(until!);
    const query = stockHistory(lower, upper);
    const result = await driver.query({ query: "SELECT c.entityId AS entityId,a.effectiveAt AS at,a.version AS version,a.market_stock_total AS stock FROM (SELECT entityId FROM entity_ots_component WHERE tenantId='acme' AND startsWith(category,'Passives/Capacitors')) c INNER ALL JOIN (SELECT entityId,effectiveAt,version,market_stock_total FROM metric_group_ots_component_market_availability FINAL WHERE tenantId='acme' AND effectiveAt >= {lo:DateTime64(3,'UTC')} AND effectiveAt <= {hi:DateTime64(3,'UTC')}) a ON c.entityId=a.entityId ORDER BY entityId,at,version", query_params: { lo: since + ' 00:00:00.000', hi: until + ' 00:00:00.000' }, format: 'JSONEachRow', clickhouse_settings: { date_time_output_format: 'iso' } });
    let expected;
    try { expected = (await result.json<{ entityId: string; at: string; version: number; stock: number }>()).map(r => ({ ...r, at: new Date(r.at) })); } finally { result.close(); }
    if (since! <= until!) expect(expected.length).toBeGreaterThan(0); else expect(expected).toEqual([]);
    for (const backend of backends) {
      const client = createClientFromBackend(backend);
      expect(await client.run(query)).toEqual(expected);
      expect(await collect(client.stream(query))).toEqual(expected);
    }
  }
}, 120000);
