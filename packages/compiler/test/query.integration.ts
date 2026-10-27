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
it('orders mixed keys, null placement and replacement ordering after filter/projection', async () => {
  await sql('CREATE TABLE ordering_probe (id String, n UInt32, label Nullable(String), specs Array(Tuple(name Nullable(String)))) ENGINE=Memory');
  await sql("INSERT INTO ordering_probe VALUES ('a',2,NULL,[('x')]),('b',1,'z',[(NULL)]),('c',2,'a',[('x')]),('d',1,NULL,[(NULL)]),('e',2,'a',[('x')])");
  const t = table('ordering_probe', { id: col.String, n: col.UInt32, label: col.Nullable(col.String), specs: col.Array(col.Tuple({ name: col.Nullable(col.String) })) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(t).where(r => r.n.gt(0)).map(r => ({ renamed: r.id, n: r.n, label: r.label, specs: r.specs }));
  const ids = async (query: { ir: import('@chql/core').Rel } & import('@chql/core').Query<import('@chql/core').Infer<typeof q>>) => (await client.run(query)).map(r => r.renamed);
  expect(await ids(q.orderBy(r => r.n.desc()).thenBy(r => r.renamed))).toEqual(['a','c','e','b','d']);
  expect(await ids(q.orderBy(r => r.label.asc().nullsFirst()).thenBy(r => r.renamed.desc()))).toEqual(['d','a','e','c','b']);
  expect(await ids(q.orderBy(r => r.label.asc().nullsLast()).thenBy(r => r.renamed))).toEqual(['c','e','b','a','d']);
  expect(await ids(q.orderBy(r => r.n).thenBy(r => r.renamed).orderBy(r => r.renamed.desc()))).toEqual(['e','d','c','b','a']);
  expect(await ids(q.orderBy(r => r.renamed.desc()).limit(2))).toEqual(['e','d']);
  expect(await ids(q.orderBy(r => r.renamed).limit(2).orderBy(r => r.renamed.desc()))).toEqual(['b','a']);
  expect(await client.run(q.map(r => r.label).distinct().orderBy(r => r.label.asc().nullsFirst()))).toEqual([{ label: null }, { label: 'a' }, { label: 'z' }]);
  expect(await client.run(q.map(r => ({ label: r.label, specs: r.specs })).distinct().where(r => r.label.isNotNull()).map(r => r.specs.arrayElement(1).element('name')).distinct().orderBy(r => r.specs.asc().nullsLast()).limit(2))).toEqual([{ specs: 'x' }, { specs: null }]);
});
it('preserves swapped aliases, shared computed sort keys and offset boundaries', async () => {
  await sql('CREATE TABLE adversarial_order (id UInt32, rank UInt32, label Nullable(String)) ENGINE=Memory');
  await sql("INSERT INTO adversarial_order VALUES (1,30,NULL),(2,20,'b'),(3,10,'a'),(4,40,'b'),(5,50,NULL)");
  const t = table('adversarial_order', { id: col.UInt32, rank: col.UInt32, label: col.Nullable(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const shared = val(2, col.UInt32);
  const q = from(t).map(r => ({ rank: r.id, id: r.rank, label: r.label }));
  const ordered = q.orderBy(r => r.rank.plus(shared).desc()).thenBy(r => r.id.plus(shared));
  expect(ordered.toSQL().params).toEqual({ p0: '2' });
  expect(await client.run(ordered.limit(2, 1).map(r => r.rank))).toEqual([{ rank: 4 }, { rank: 3 }]);
  expect(await client.run(ordered.orderBy(r => r.label.desc().nullsFirst()).thenBy(r => r.rank).limit(3, 1).map(r => r.rank))).toEqual([{ rank: 5 }, { rank: 2 }, { rank: 4 }]);
  expect(await client.run(q.orderBy(() => val(1)).thenBy(r => r.rank.desc()).limit(2).map(r => r.rank))).toEqual([{ rank: 5 }, { rank: 4 }]);
  expect(await client.run(q.map(r => r.label).distinct().orderBy(r => r.label.desc().nullsLast()).limit(2, 1))).toEqual([{ label: 'a' }, { label: null }]);
  expect(await client.run(q.orderBy(r => r.rank).limit(2).map(r => r.label).distinct().orderBy(r => r.label.desc().nullsLast()))).toEqual([{ label: 'b' }, { label: null }]);
});
it('keeps prototype-like single-expression names through distinct and ordering', async () => {
  const q = from(db.entity_ots_component).map(r => ({ ['__proto__']: r.category })).map(r => r.__proto__).distinct()
    .orderBy(r => r.__proto__.desc().nullsLast()).thenBy(r => r.__proto__).limit(3);
  expect(await client.run(q)).toEqual([{ ['__proto__']: 'visible' }, { ['__proto__']: 'hidden' }, { ['__proto__']: null }]);
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
it('executes structural filters and composed projections through the catalog', async () => {
  await sql('CREATE TABLE structural_probe (id String, category Nullable(String), ids Array(String), path Array(Int64), specs Array(Tuple(mpn Nullable(String), description Nullable(String))), n UInt32) ENGINE=Memory');
  await sql("INSERT INTO structural_probe VALUES ('a','Passives/Capacitors',['CN','TW'],[1042], [('M1','first'),(NULL,NULL)],4), ('b',NULL,[],[],[],0)");
  const t = table('structural_probe', { id: col.String, category: col.Nullable(col.String), ids: col.Array(col.String), path: col.Array(col.Int64), specs: col.Array(col.Tuple({ mpn: col.Nullable(col.String), description: col.Nullable(col.String) })), n: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(t).where(r => r.category.startsWith('Passives').and(r.ids.notEmpty()).and(r.ids.has('CN')).and(r.ids.hasAny(['TW'])).and(r.path.has(1042n)).and(r.n.gt(2)))
    .map(r => ({ id: r.id, mpns: r.specs.element('mpn'), first: r.specs.arrayElement(1).element('description'), last: r.specs.arrayElement(-1).element('description'), outside: r.specs.arrayElement(99).element('mpn'), count: r.ids.length(), category: r.category.ifNull('none'), total: r.n.plus(2), ratio: r.n.divide(2), flag: r.n.ge(4).or(r.n.lt(0)).not().not() }))
    .where(r => r.count.eq(2n)).limit(1).map(r => ({ ...r, total: r.total.multiply(2n).minus(1n), present: r.first.isNotNull(), absent: r.last.isNull() }));
  expect(await client.run(q)).toEqual([{ id: 'a', mpns: ['M1', null], first: 'first', last: null, outside: null, count: 2n, category: 'Passives/Capacitors', total: 11n, ratio: 2, flag: true, present: true, absent: true }]);
  expect(await client.run(from(t).where(r => r.ids.empty()).map(r => ({ name: r.category.ifNull('none'), first: r.specs.arrayElement(1).element('description'), any: r.ids.hasAny([]), unequal: r.n.ne(1), below: r.n.le(0) })))).toEqual([{ name: 'none', first: null, any: false, unequal: true, below: true }]);
});
it('encodes hostile recursive array parameters and named tuple fields without interpolation', async () => {
  const hostile = "a'\\\n\0";
  const tuple = col.Tuple({ ['__proto__']: col.UInt64, 'a.b': col.Nullable(col.String), '0': col.Int32 });
  const q = from(db.entity_ots_component).limit(1).map(() => ({ strings: val([hostile, ''], col.Array(col.String)), nested: val([[1n, null], []], col.Array(col.Array(col.Nullable(col.Int64)))), dates: val([new Date('2026-10-27T12:00:00.123Z')], col.Array(col.DateTime64(3, 'Asia/Tokyo'))), mixed: val(2, col.UInt8).lt(val(3, col.UInt32)), denormal: val(0).divide(0) }));
  expect(await client.run(q)).toEqual([{ strings: [hostile, ''], nested: [[1n, null], []], dates: [new Date('2026-10-27T12:00:00.123Z')], mixed: true, denormal: NaN }]);
  await sql('CREATE TABLE tuple_probe (t Tuple(`__proto__` UInt64, `a.b` Nullable(String), `0` Int32)) ENGINE=Memory');
  await sql("INSERT INTO tuple_probe VALUES ((7, 'safe', -3))");
  const t = table('tuple_probe', { t: tuple }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  expect(await client.run(from(t).map(r => ({ whole: r.t, proto: r.t.element('__proto__'), dotted: r.t.element('a.b'), numeric: r.t.element('0') })))).toEqual([{ whole: { ['__proto__']: 7n, 'a.b': 'safe', '0': -3 }, proto: 7n, dotted: 'safe', numeric: -3 }]);
});
it('adversarial: preserves nested structural composition and nullable membership', async () => {
  await sql('CREATE TABLE adversarial_nested (groups Array(Array(Tuple(label Nullable(String)))), nullable_ids Array(Nullable(Int64))) ENGINE=Memory');
  await sql("INSERT INTO adversarial_nested VALUES ([[('x'),(NULL)],[]],[NULL,7])");
  const t = table('adversarial_nested', { groups: col.Array(col.Array(col.Tuple({ label: col.Nullable(col.String) }))), nullable_ids: col.Array(col.Nullable(col.Int64)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(t).map(r => ({ labels: r.groups.element('label'), hit: r.nullable_ids.has(null), any: r.nullable_ids.hasAny([null]), absent: r.nullable_ids.has(8n) }))
    .where(r => r.hit.and(r.any).and(r.absent.not())).limit(1).map(r => ({ labels: r.labels }));
  expect(await client.run(q)).toEqual([{ labels: [['x', null], []] }]);
});
it('adversarial: array wire literals preserve all controls, Unicode, booleans and denormals', async () => {
  const strings = Array.from({ length: 32 }, (_, i) => `before${String.fromCharCode(i)}after`).concat(['\\\\N', "'); SELECT 1 --", 'é😀', '\\uFEFF']);
  const q = from(db.entity_ots_component).limit(1).map(() => ({ strings: val(strings, col.Array(col.String)), floats: val([NaN, Infinity, -Infinity, 1.25], col.Array(col.Float64)) }));
  expect(await client.run(q)).toEqual([{ strings, floats: [NaN, Infinity, -Infinity, 1.25] }]);
});
it('adversarial: nullable Bool array parameters use server-readable literals', async () => {
  const q = from(db.entity_ots_component).limit(1).map(() => ({ flags: val([true, false, null], col.Array(col.Nullable(col.Bool))) }));
  expect(await client.run(q)).toEqual([{ flags: [true, false, null] }]);
  const nested = from(db.entity_ots_component).limit(1).map(() => ({ flags: val([[true, false, null], []], col.Array(col.Array(col.Nullable(col.Bool)))), yes: val(true), no: val(false) }));
  expect(await client.run(nested)).toEqual([{ flags: [[true, false, null], []], yes: true, no: false }]);
});
it('adversarial: mixed-width arithmetic agrees with native decoding after reprojection', async () => {
  const q = from(db.entity_ots_component).limit(1).map(() => ({ product: val(2, col.Float32).multiply(val(3, col.Float32)), difference: val(0, col.UInt32).minus(val(1, col.UInt32)), fallback: val(null, col.Nullable(col.Int32)).ifNull(val(4294967295, col.UInt32)) }))
    .map(r => ({ ...r, compared: r.fallback.gt(0n) }));
  expect((await sql("SELECT toTypeName(ifNull(CAST(NULL AS Nullable(Int32)), toUInt32(4294967295)))")).trim()).toBe('Int64');
  expect((await sql("SELECT toTypeName(ifNull(NULL, toUInt32(4294967295)))")).trim()).toBe('UInt32');
  expect(await client.run(q)).toEqual([{ product: 6, difference: -1n, fallback: 4294967295n, compared: true }]);
});
it('adversarial repair: composes nullable Bool arrays with membership, indexing and fallback', async () => {
  const flags = val([null, false, true], col.Array(col.Nullable(col.Bool)));
  const q = from(db.entity_ots_component).limit(1)
    .map(() => ({ flags, absent: val(null, col.Nullable(col.Bool)), missing: flags.arrayElement(9) }))
    .where(r => r.flags.has(null).and(r.flags.hasAny([false])).and(r.missing.isNull()))
    .map(r => ({ flags: r.flags, first: r.flags.arrayElement(1), last: r.flags.arrayElement(-1), fallback: r.absent.ifNull(true), missing: r.missing.ifNull(false) }));
  expect(await client.run(q)).toEqual([{ flags: [null, false, true], first: null, last: true, fallback: true, missing: false }]);
});
it('adversarial repair: typed NULL preserves nested common-type arithmetic and shared identity', async () => {
  const absent = val(null, col.Nullable(col.Int32));
  const replacement = val(4294967295, col.UInt32);
  const q = from(db.entity_ots_component).limit(1)
    .map(() => ({ a: absent.ifNull(replacement), b: absent.ifNull(replacement), missing: absent }))
    .where(r => r.missing.isNull().and(r.a.eq(r.b)))
    .map(r => ({ result: r.a.plus(r.b), nullComparison: r.missing.eq(0), fallback: r.missing.ifNull(-1) }));
  expect(await client.run(q)).toEqual([{ result: 8589934590n, nullComparison: null, fallback: -1 }]);
  expect(Object.values(q.toSQL().params).filter(v => v === '4294967295')).toHaveLength(1);
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
