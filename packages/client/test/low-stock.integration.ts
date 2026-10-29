import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { rowDecoder } from '../src/decode.js';
import { collect, keys } from './backend-harness.js';
import { categoryRollup, expectedParams, expectedSql, lowStockCategories } from '../../compiler/test/fixtures/corpus/low-stock.js';
let container: StartedTestContainer;
let driver: ReturnType<typeof createClient>;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  const options = { url: `http://${container.getHost()}:${container.getMappedPort(8123)}`, username: 'fixture', password: 'fixture' };
  driver = createClient(options);
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend(options, mode));
  for (const file of ['schema.sql', 'seed.sql']) {
    const sql = readFileSync(new URL(`../../compiler/test/fixtures/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').filter(s => s.trim())) await driver.command({ query: statement });
  }
  // Twelve active NULL-category components and one inactive component. The two
  // effective dates tie at newest version; FINAL chooses the later duplicate.
  await driver.command({ query: "INSERT INTO entity_ots_component (tenantId,entityId,category,state) SELECT 'anchor',concat('cmp_',toString(number)),NULL,if(number=12,'inactive','active') FROM numbers(13)" });
  for (const [version, date, inserted, stock] of [[1, 1, 1, 100], [2, 1, 1, 2], [2, 1, 2, 3], [2, 2, 1, 1]]) {
    await driver.command({ query: `INSERT INTO metric_group_ots_component_indices (tenantId,entityId,version,effectiveAt,insertedAt,stock_index) SELECT 'anchor',concat('cmp_',toString(number)),${version},toDateTime64('2026-01-0${date} 00:00:00',3),toDateTime64('2026-01-01 00:00:0${inserted}',3),${stock} FROM numbers(13)` });
  }
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await driver?.close(); await container?.stop(); });
async function native(tenant: string) {
  // Literal spec SQL is the independent native oracle, never emitted SQL.
  const response = await driver.query({ query: expectedSql, query_params: { ...expectedParams, p0: tenant, p2: tenant }, format: 'JSONEachRow', clickhouse_settings: { output_format_json_quote_64bit_integers: 1, output_format_json_quote_denormals: 1 } });
  const decode = rowDecoder({ category: { kind: 'scalar', name: 'String' }, components: { kind: 'scalar', name: 'UInt64' }, stockIndex: { kind: 'scalar', name: 'Float64' }, leadTimeIndex: { kind: 'scalar', name: 'Float64' }, priceIndex: { kind: 'scalar', name: 'Float64' }, warned: { kind: 'scalar', name: 'UInt64' } });
  try { return (await response.json()).map(decode); } finally { response.close(); }
}
it('executes exact lowStock via both official Backends, run/stream and native spec SQL on the six-table seed', async () => {
  for (const tenant of ['acme', 'other', 'anchor', 'absent']) {
    const q = lowStockCategories(tenant), expected = await native(tenant);
    if (tenant === 'anchor') expect(expected).toEqual([{ category: 'uncategorised', components: 12n, stockIndex: 48, leadTimeIndex: NaN, priceIndex: NaN, warned: 0n }]);
    if (tenant === 'absent') expect(expected).toEqual([]);
    if (tenant === 'acme') expect(expected).toHaveLength(3);
    for (const backend of backends) {
      const plan = backend.compile(q.ir), client = createClientFromBackend(backend);
      expect(plan.compiled.columns).toEqual(backends[0]!.compile(q.ir).compiled.columns);
      expect(plan.compiled.columnPaths).toBeUndefined();
      for (const rows of [(await collect(backend.run(plan))).flat(), await client.run(q), await collect(client.stream(q))]) {
        // stockIndex is not a total key: compare bags, not arbitrary tie order.
        expect(keys(q, rows), backend.name + ':' + tenant).toEqual(keys(q, expected));
      }
    }
  }
}, 120000);
it('records focused actual EXPLAIN and retains latest aggregation and filtered/pruned join boundaries', async () => {
  const q = categoryRollup('acme');
  const plan = backends[0]!.compile(q.ir).compiled;
  const response = await driver.query({ query: 'EXPLAIN PLAN ' + plan.sql, query_params: plan.params, format: 'TabSeparatedRaw' });
  try {
    const text = await response.text();
    // Pinned 24.8 plan, including indentation/parent-child structure. The two
    // JOINs and latest's lower Aggregating boundary must survive optimization;
    // ClickHouse absorbs the SQL derived tables into Expression steps here.
    expect(text).toBe(`Expression ((Project names + Projection))
  Aggregating
    Expression ((Before GROUP BY + DROP unused columns after JOIN))
      Join (JOIN FillRightFirst)
        Expression ((JOIN actions + (Change column names to column identifiers + (Project names + Projection))))
          Expression
            ReadFromMergeTree (default.entity_ots_component)
        Expression ((JOIN actions + (Change column names to column identifiers + (Project names + (Projection + DROP unused columns after JOIN)))))
          Join (JOIN FillRightFirst)
            Expression ((JOIN actions + (Change column names to column identifiers + (Project names + Projection))))
              Filter ((WHERE + Change column names to column identifiers))
                ReadFromMergeTree (default.metric_group_ots_component_indices)
            Expression ((JOIN actions + (Change column names to column identifiers + (Project names + Projection))))
              Aggregating
                Expression ((Before GROUP BY + (Change column names to column identifiers + (Project names + Projection))))
                  Filter ((WHERE + Change column names to column identifiers))
                    ReadFromMergeTree (default.metric_group_ots_component_indices)
`);
    expect(plan.sql).toContain('INNER ALL JOIN (SELECT `m`.`entityId`');
    expect(plan.sql).toContain('INNER ALL JOIN (SELECT `tenantId`, `entityId`, max(`version`)');
    console.info('lowStock focused EXPLAIN', { sql: plan.sql, plan: text });
  } finally { response.close(); }
});
