import { beforeAll, afterAll, it, expect } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import { generateSeed, seedProvenance, metricFixtures, tenants } from '../../../scripts/generate-fixture-seed.js';
let container: StartedTestContainer;
let url: string;
async function sql(query: string): Promise<string> {
  const response = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: query });
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  return body;
}
async function rows(query: string): Promise<Record<string, number | string>[]> {
  return JSON.parse(await sql(query + ' FORMAT JSON')).data as Record<string, number | string>[];
}
async function one(query: string) { const result = await rows(query); expect(result).toHaveLength(1); return result[0]!; }
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  console.log('Seed real server:', await sql('SELECT version()'));
  const ddl = await readFile('packages/compiler/test/fixtures/schema.sql', 'utf8');
  for (const statement of ddl.split(';').filter(s => s.trim())) await sql(statement);
  // Raw multiplicities must not depend on merge scheduling.
  await sql('SYSTEM STOP MERGES');
  const seed = await readFile('packages/compiler/test/fixtures/seed.sql', 'utf8');
  expect(seed).toBe(generateSeed());
  expect(await readFile('packages/compiler/test/fixtures/seed.provenance.json', 'utf8')).toBe(seedProvenance(seed));
  for (const statement of seed.split(';').filter(s => s.trim())) await sql(statement);
}, 120000);
afterAll(async () => { await container?.stop(); });
it('asserts precise entity populations, overlaps, shared groups and orphan ids in both tenants', async () => {
  for (const tenant of tenants) {
    const acme = tenant.name === 'acme';
    expect(await one(`SELECT toUInt32(count()) n, toUInt32(countIf(isNull(category))) nulls, toUInt32(countIf(state != 'active')) inactive, toUInt32(countIf(empty(matched_part_ids))) empties, toUInt32(countIf(isNull(category) AND empty(matched_part_ids))) overlap FROM entity_ots_component WHERE tenantId='${tenant.name}'`)).toEqual({ n: tenant.components, nulls: acme ? 300 : 6, inactive: acme ? 120 : 4, empties: acme ? 400 : 8, overlap: acme ? 300 : 6 });
    expect(await one(`SELECT toUInt32(count()) n, toUInt32(uniqExact(manufacturerId)) manufacturers, toUInt32(countIf(isNull(lifecycleStatus))) nulls FROM entity_off_the_shelf_part WHERE tenantId='${tenant.name}'`)).toEqual({ n: tenant.parts, manufacturers: 40, nulls: acme ? 200 : 4 });
  }
  expect(await one("SELECT toUInt32(count()) groups, toUInt32(sum(n)) participants, toUInt32(min(n)) smallest, toUInt32(max(n)) largest FROM (SELECT arrayJoin(matched_part_ids) part, count() n FROM entity_ots_component WHERE tenantId='acme' GROUP BY part HAVING n>1)")).toEqual({ groups: 25, participants: 50, smallest: 2, largest: 2 });
  expect(await one("SELECT toUInt32(count()) n FROM (SELECT arrayJoin(matched_part_ids) part FROM entity_ots_component WHERE tenantId='acme') WHERE part NOT IN (SELECT entityId FROM entity_off_the_shelf_part WHERE tenantId='acme')")).toEqual({ n: 1 });
  expect(await one("SELECT toUInt32(count()) n FROM entity_ots_component")).toEqual({ n: 2040 });
  expect(await one("SELECT toUInt32(count()) n FROM entity_off_the_shelf_part")).toEqual({ n: 3040 });
  // Identical ids deliberately exist in both tenants; tenant equality prevents cross matches.
  expect(await one("SELECT toUInt32(count()) n FROM entity_ots_component c INNER JOIN entity_off_the_shelf_part p ON c.tenantId=p.tenantId AND concat('part_', substring(c.entityId,5))=p.entityId")).toEqual({ n: 2040 });
});
it('exercises real array expansion, left defaults, shared pairs and tenant-scoped orphan joins', async () => {
  expect(await one("SELECT toUInt32(count()) n FROM entity_ots_component ARRAY JOIN matched_part_ids AS partId WHERE tenantId='acme'" )).toEqual({ n: 1600 });
  expect(await one("SELECT toUInt32(count()) n, toUInt32(countIf(partId='')) defaults FROM entity_ots_component LEFT ARRAY JOIN matched_part_ids AS partId WHERE tenantId='acme'" )).toEqual({ n: 2000, defaults: 400 });
  expect(await rows(`SELECT c.tenantId tenant, toUInt32(count()) n, toUInt32(countIf(isNull(p.entityId))) orphans
    FROM (SELECT tenantId, entityId, arrayJoin(matched_part_ids) partId FROM entity_ots_component) c
    LEFT ALL JOIN entity_off_the_shelf_part p ON c.tenantId=p.tenantId AND c.partId=p.entityId
    GROUP BY c.tenantId ORDER BY c.tenantId SETTINGS join_use_nulls=1`)).toEqual([
    { tenant: 'acme', n: 1600, orphans: 1 }, { tenant: 'other', n: 32, orphans: 1 },
  ]);
  expect(await one(`SELECT toUInt32(count()) n FROM
    (SELECT entityId, arrayJoin(matched_part_ids) partId FROM entity_ots_component WHERE tenantId='acme') a
    INNER ALL JOIN
    (SELECT entityId, arrayJoin(matched_part_ids) partId FROM entity_ots_component WHERE tenantId='acme') b
    ON a.partId=b.partId WHERE a.entityId<b.entityId`)).toEqual({ n: 25 });
  expect(await one(`SELECT toUInt32(countIf(countOfParts != length(matched_part_ids))) wrong,
    toUInt32(countIf(length(part_specifications) != 1)) wrongTuples,
    toUInt32(countIf(isNull(tupleElement(part_specifications[1], 'mpn')))) nullMpns
    FROM entity_ots_component WHERE tenantId='acme'`)).toEqual({ wrong: 0, wrongTuples: 0, nullMpns: 667 });
});
for (const metric of metricFixtures) it(`${metric.table}: raw rates, 26-week window, versions, and actual FINAL winners`, async () => {
  for (const tenant of tenants) {
    const entities = metric.entities === 'component' ? tenant.components : tenant.parts;
    const base = entities * 2.5 * 26;
    const where = `WHERE tenantId='${tenant.name}'`;
    expect(await one(`SELECT toUInt32(count()) n, toUInt32(uniqExact(entityId)) entities, toUInt32(uniqExact(effectiveAt)) weeks, toUInt32(dateDiff('week', min(effectiveAt), max(effectiveAt))) span, toString(min(effectiveAt)) first, toString(max(effectiveAt)) last FROM ${metric.table} ${where}`)).toEqual({ n: base + base / 10, entities, weeks: 26, span: 25, first: '2026-04-27 00:00:00.000', last: '2026-10-19 00:00:00.000' });
    expect(await one(`SELECT toUInt32(min(n)) low, toUInt32(max(n)) high, toUInt32(countIf(n != expected)) wrong FROM (SELECT entityId, effectiveAt, uniqExact(version) n, toUInt32(substring(entityId, ${metric.entities === 'component' ? 5 : 6})) % 4 + 1 expected FROM ${metric.table} ${where} GROUP BY entityId,effectiveAt)`)).toEqual({ low: 1, high: 4, wrong: 0 });
    expect(await one(`SELECT toUInt32(countIf(n=2)) duplicates, toUInt32(max(n)) maxCopies, toUInt32(countIf(n=2 AND delta!=1000)) wrongTime FROM (SELECT count() n, dateDiff('millisecond',min(insertedAt),max(insertedAt)) delta FROM ${metric.table} ${where} GROUP BY entityId,version,effectiveAt)`)).toEqual({ duplicates: base / 10, maxCopies: 2, wrongTime: 0 });
    for (const warning of metric.warnings) expect(await one(`SELECT toUInt32(countIf(notEmpty(${warning}))) n FROM ${metric.table} ${where}`)).toEqual({ n: (base + base / 10) / 20 });
    if (metric.table === 'metric_group_ots_component_indices') expect(await one(`SELECT toUInt32(countIf(isNull(lead_time_max_days))) n FROM ${metric.table} ${where}`)).toEqual({ n: base / 5 });
    const value = metric.values[0];
    expect(await one(`SELECT toUInt32(count()) n FROM ${metric.table} FINAL ${where}`)).toEqual({ n: base });
    expect(await one(`SELECT toUInt32(count()) wrong FROM (SELECT entityId,version,effectiveAt,insertedAt,${value} value FROM ${metric.table} FINAL ${where}) f INNER JOIN (SELECT entityId,version,effectiveAt,max(insertedAt) latest,argMax(${value},insertedAt) value FROM ${metric.table} ${where} GROUP BY entityId,version,effectiveAt) r USING(entityId,version,effectiveAt) WHERE f.insertedAt!=r.latest OR f.value!=r.value`)).toEqual({ wrong: 0 });
    expect(await one(`SELECT toUInt32(count()) wrong FROM (SELECT max(${value})-min(${value}) delta FROM ${metric.table} ${where} GROUP BY entityId,version,effectiveAt HAVING count()=2) WHERE abs(delta-1000)>0.000001`)).toEqual({ wrong: 0 });
  }
});
