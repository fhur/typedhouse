import { beforeAll, afterAll, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient } from '@chql/client';
import { from, col, table, val, registerCompiler } from '@chql/core';
import { emitNaive, quoteIdentifier } from '../src/index.js';
import { QueryError } from '@chql/client';
import { db } from '../../codegen/test/snapshots/schema.js';
let container: StartedTestContainer;
let client: ReturnType<typeof createClient>;
let url: string;
async function sql(query: string) {
  const response = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: query });
  const text = await response.text(); if (!response.ok) throw new Error(text); return text;
}
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  console.log('Runnable query real server:', await sql('SELECT version()'));
  client = createClient({ url, username: 'fixture', password: 'fixture' });
  registerCompiler(emitNaive);
  await sql('CREATE TABLE entity_ots_component (tenantId String, entityId String, category Nullable(String), state String, part_specifications Array(Tuple(id String, mpn Nullable(String), manufacturer Nullable(String), description Nullable(String), package Nullable(String), part_type Nullable(String))), matched_part_ids Array(String), countOfParts UInt64, updatedAt DateTime64(3)) ENGINE=Memory');
  await sql("INSERT INTO entity_ots_component (tenantId,entityId,category,countOfParts,updatedAt) VALUES ('acme','a',NULL,18446744073709551615,'2026-10-27 12:00:00.123'),('other','b','hidden',2,'2026-10-27 00:00:00'),('acme','c','visible',0,'1970-01-01 00:00:00')");
}, 120000);
afterAll(async () => { await client?.close(); await container?.stop(); });
it('executes the generated-schema query and matches a direct SQL baseline', async () => {
  const q = from(db.entity_ots_component).where(c => c.tenantId.eq('acme')).map(c => ({ id: c.entityId, count: c.countOfParts, updatedAt: c.updatedAt, category: c.category })).limit(10);
  expect(q.toSQL().params).toEqual({ p0: 'acme' });
  const actual = await client.run(q);
  const baseline = JSON.parse(await sql("SELECT entityId id,countOfParts count,updatedAt,category FROM entity_ots_component WHERE tenantId='acme' LIMIT 10 SETTINGS date_time_output_format='iso', output_format_json_quote_64bit_integers=1 FORMAT JSON")) as { data: { id: string; count: string; updatedAt: string; category: string | null }[] };
  expect(actual).toEqual(baseline.data.map(r => ({ ...r, count: BigInt(r.count), updatedAt: new Date(r.updatedAt) })));
  expect(actual).toEqual([{ id: 'a', count: 18446744073709551615n, updatedAt: new Date('2026-10-27T12:00:00.123Z'), category: null }, { id: 'c', count: 0n, updatedAt: new Date(0), category: 'visible' }]);
  expect(await client.run(q)).toEqual(actual);
});
it('executes hostile quoted table/column names without changing their identity', async () => {
  const name = 'odd`\\\\; --\nname';
  const key = 'column`\\\\; --';
  await sql(`CREATE TABLE ${quoteIdentifier(name)} (${quoteIdentifier(key)} String) ENGINE=Memory`);
  await sql(`INSERT INTO ${quoteIdentifier(name)} VALUES ('safe')`);
  const t = table(name, { [key]: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(t).where(r => r[key]!.eq('safe')).map(r => ({ ['__proto__']: r[key]! }));
  expect(await client.run(q)).toEqual([{ ['__proto__']: 'safe' }]);
});
it('preserves simultaneous projection semantics when aliases swap source names', async () => {
  const q = from(db.entity_ots_component).where(c => c.entityId.eq('a'))
    .map(c => ({ entityId: c.tenantId, tenantId: c.entityId }))
    .where(r => r.entityId.eq('acme')).limit(1)
    .map(r => ({ tenant: r.entityId, id: r.tenantId }));
  expect(await client.run(q)).toEqual([{ tenant: 'acme', id: 'a' }]);
});
it('does not let a projected alias capture another source column', async () => {
  const q = from(db.entity_ots_component).where(c => c.entityId.eq('a'))
    .map(c => ({ entityId: c.tenantId, originalId: c.entityId }));
  expect(await client.run(q)).toEqual([{ entityId: 'acme', originalId: 'a' }]);
});
it('compares Date parameters as instants for timezone-bearing DateTime64 columns', async () => {
  await sql("CREATE TABLE timezone_probe (id String, at DateTime64(3, 'Asia/Tokyo')) ENGINE=Memory");
  await sql("INSERT INTO timezone_probe VALUES ('tokyo', '2026-10-27 21:00:00.123')");
  const t = table('timezone_probe', { id: col.String, at: col.DateTime64(3, 'Asia/Tokyo') }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const instant = new Date('2026-10-27T12:00:00.123Z');
  expect(await client.run(from(t))).toEqual([{ id: 'tokyo', at: instant }]);
  expect(await client.run(from(t).where(r => r.at.eq(instant)))).toEqual([{ id: 'tokyo', at: instant }]);
});
it('keeps UTC instants across default/session timezones, precision and nullable parameters', async () => {
  const zonedClient = createClient({ url, username: 'fixture', password: 'fixture', clickhouse_settings: { session_timezone: 'America/New_York' } });
  try {
    for (const precision of [0, 1, 2, 3] as const) {
      const name = `date_precision_${precision}`;
      await sql(`CREATE TABLE ${name} (plain DateTime64(${precision}), zoned Nullable(DateTime64(${precision}, 'Asia/Tokyo'))) ENGINE=Memory`);
      await sql(`INSERT INTO ${name} SELECT toDateTime64('2026-10-27 12:00:00.123', ${precision}, 'UTC'), toDateTime64('2026-10-27 12:00:00.123', ${precision}, 'UTC')`);
      const t = table(name, { plain: col.DateTime64(precision), zoned: col.Nullable(col.DateTime64(precision, 'Asia/Tokyo')) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
      const instant = new Date('2026-10-27T12:00:00.123Z');
      const truncated = new Date(Math.floor(instant.getTime() / 10 ** (3 - precision)) * 10 ** (3 - precision));
      const expected = [{ plain: truncated, zoned: truncated }];
      expect(await zonedClient.run(from(t).where(r => r.plain.eq(instant)))).toEqual(expected);
      expect(await zonedClient.run(from(t).where(r => r.zoned.eq(instant)))).toEqual(expected);
      expect(await zonedClient.run(from(t).where(r => r.zoned.eq(null)))).toEqual([]);
      const shared = val(instant, col.DateTime64(precision, 'Asia/Tokyo'));
      const q = from(t).map(() => ({ a: shared, b: shared, absent: val(null, col.Nullable(col.DateTime64(precision, 'Asia/Tokyo'))) }));
      expect(q.toSQL().sql).toContain(`{p0:DateTime64(${precision}, 'UTC')}`);
      expect(Object.keys(q.toSQL().params)).toEqual(['p0']);
      expect(await zonedClient.run(q)).toEqual([{ a: truncated, b: truncated, absent: null }]);
    }
  } finally { await zonedClient.close(); }
});
it('composes LowCardinality nullable equality and projections without changing values', async () => {
  await sql('CREATE TABLE dictionary_probe (id String, label LowCardinality(String), optional LowCardinality(Nullable(String))) ENGINE=Memory');
  await sql("INSERT INTO dictionary_probe VALUES ('a', 'safe', 'value'), ('b', 'other', NULL)");
  const t = table('dictionary_probe', { id: col.String, label: col.LowCardinality(col.String), optional: col.LowCardinality(col.Nullable(col.String)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  expect(await client.run(from(t))).toEqual([{ id: 'a', label: 'safe', optional: 'value' }, { id: 'b', label: 'other', optional: null }]);
  const q = from(t).where(r => r.label.eq('safe')).map(r => ({ id: r.id, renamed: r.optional }))
    .where(r => r.renamed.eq('value')).limit(1).map(r => ({ result: r.renamed }));
  expect(await client.run(q)).toEqual([{ result: 'value' }]);
  expect(await client.run(from(t).where(r => r.optional.eq(null)))).toEqual([]);
});
it('keeps internal-alias-shaped and dotted column names scoped through composition', async () => {
  const t = table('scope_probe', { __chql_input: col.String, 'a.b': col.String, p0: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  await sql('CREATE TABLE scope_probe (`__chql_input` String, `a.b` String, p0 String) ENGINE=Memory');
  await sql("INSERT INTO scope_probe VALUES ('one', 'two', 'three')");
  const q = from(t).map(r => ({ __chql_input: r['a.b'], 'a.b': r.p0, p0: r.__chql_input }))
    .where(r => r.__chql_input.eq('two')).limit(1, 0)
    .map(r => ({ original: r.p0, dotted: r['a.b'], alias: r.__chql_input }));
  expect(await client.run(q)).toEqual([{ original: 'one', dotted: 'three', alias: 'two' }]);
});
it('runs the documented executable generated-schema example', async () => {
  const { stdout } = await promisify(execFile)('pnpm', ['example:first-query'], { env: { ...process.env, CLICKHOUSE_URL: url, CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' }, timeout: 120000 });
  expect(stdout).toContain('18446744073709551615n');
  expect(stdout).toContain('2026-10-27T12:00:00.123Z');
});
it('hostile values cannot escape parameters and genuine server errors retain SQL/params/cause', async () => {
  const q = from(db.entity_ots_component).where(c => c.tenantId.eq("acme' OR 1=1 --")).map(c => ({ id: c.entityId }));
  expect(await client.run(q)).toEqual([]);
  const missing = from(table('missing_table', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  try { await client.run(missing); throw new Error('expected server error'); }
  catch (error) { expect(error).toBeInstanceOf(QueryError); if (!(error instanceof QueryError)) throw error; expect(error.sql).toContain('`missing_table`'); expect(error.params).toEqual({}); expect(error.cause).toBeInstanceOf(Error); expect(error.node).toBe(missing.ir); }
});
