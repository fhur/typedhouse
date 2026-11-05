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
    await admin.command({ query: 'CREATE TABLE agent_events (id UInt64, category Nullable(String)) ENGINE=Memory' });
    await admin.command({ query: "INSERT INTO agent_events SELECT number, if(number % 3 = 0, NULL, 'sample') FROM numbers(600)" });
  } finally { await admin.close(); }
  connection = connect(config);
  await connection.refresh();
}, 180_000);
afterAll(async () => { await connection?.close(); await container?.stop(); });
it('typechecks before execution, decodes bigints, retains only bounded rows', async () => {
  const api = createAgentCapabilities(connection!);
  await expect(api.queryRun('export default from(agent_events).where(c => c.missing.eq(1))', 'owner')).rejects.toThrow();
  const result = await api.queryRun('export default from(agent_events).orderBy(c => c.id)', 'owner');
  expect(result.truncated).toBe(true);
  expect(result.sql).toMatch(/LIMIT 501\s*$/);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(result.retainedRows).toBe(500);
  expect(result.rows[0]).toEqual({ id: '0', category: null });
});
it('executes real sampled null, distinct and range statistics', async () => {
  const result = await createAgentCapabilities(connection!).columnsDescribe('agent_events', ['category', 'id']);
  expect(result.columns[0]?.statistics).toMatchObject({ sampledRows: '600', nulls: '200', approximateDistinct: '1', commonValues: ['sample'] });
  expect(result.columns[1]?.statistics).toMatchObject({ min: '0', max: '599' });
});
it('fails closed when result-byte budget is exceeded', async () => {
  await expect(connection!.runAgentQuery("export default from(agent_events).map(() => ({ payload: val('x'.repeat(8_000)) }))"))
    .rejects.toThrow(/result|limit|bytes/i);
});
it('reuses safe Array query parameter transport', async () => {
  const result = await createAgentCapabilities(connection!).queryRun("export default from(agent_events).where(c => c.id.in([1n, 2n])).orderBy(c => c.id)", 'owner');
  expect(result.rows).toEqual([{ id: '1', category: 'sample' }, { id: '2', category: 'sample' }]);
});
