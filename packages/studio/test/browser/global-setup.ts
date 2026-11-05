// One ClickHouse for the whole run, with a few rows. The spec files reach it through STUDIO_TEST_CLICKHOUSE.
import { readFile } from 'node:fs/promises';
import { GenericContainer, Wait } from 'testcontainers';
import { createClient } from '@clickhouse/client';

export async function startClickHouse() {
  const container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'test-secret', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  const admin = createClient({ url, username: 'fixture', password: 'test-secret' });
  await admin.command({ query: 'CREATE DATABASE fixture' });
  await admin.close();
  const db = createClient({ url, username: 'fixture', password: 'test-secret', database: 'fixture' });
  const schema = await readFile(new URL('../../../compiler/test/fixtures/schema.sql', import.meta.url), 'utf8');
  for (const statement of schema.split(';').filter(s => s.trim())) await db.command({ query: statement });
  await db.command({ query: "INSERT INTO entity_ots_component (tenantId, entityId, state, countOfParts, updatedAt) SELECT 'acme', concat('cmp_', toString(number)), 'active', number + 1, toDateTime64('2026-04-27 00:00:00', 3, 'UTC') FROM numbers(8)" });
  await db.close();
  return { url, stop: async () => { await container.stop(); } };
}

export default async function globalSetup() {
  const { url, stop } = await startClickHouse();
  process.env['STUDIO_TEST_CLICKHOUSE'] = url;
  return stop;
}
