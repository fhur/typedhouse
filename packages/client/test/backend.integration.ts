import { afterAll, beforeAll, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, table, from, join, count, uniqExact, avg, max, scalar, unionAll, val } from '@typedhouse/core';
import { createClickHouseBackend, createClientFromBackend, QueryError } from '../src/index.js';
import { collect, verify } from './backend-harness.js';
let container: StartedTestContainer;
let url: string;
const backends: ReturnType<typeof createClickHouseBackend>[] = [];
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] };
const components = from(table('backend_components', { tenant: col.String, id: col.String, category: col.Nullable(col.String), ids: col.Array(col.String), at: col.DateTime64(3), stock: col.Float64 }, meta));
const parts = from(table('backend_parts', { tenant: col.String, id: col.String }, meta));
async function sql(query: string) {
  const response = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: query });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text;
}
async function native(query: string): Promise<Record<string, unknown>[]> {
  const text = await sql(`${query} SETTINGS date_time_output_format='iso',output_format_json_quote_64bit_integers=1 FORMAT JSONEachRow`);
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>) : [];
}
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) backends.push(createClickHouseBackend({ url, username: 'fixture', password: 'fixture', max_open_connections: 2 }, mode));
  await sql('CREATE TABLE backend_components (tenant String,id String,category Nullable(String),ids Array(String),at DateTime64(3),stock Float64) ENGINE=Memory');
  await sql("INSERT INTO backend_components VALUES ('acme','a','visible',['p','p','q'],'2024-03-11 12:00:00',2),('acme','b','visible',['p'],'2024-03-12 12:00:00',4),('acme','c',NULL,[],'2024-03-18 12:00:00',8),('other','a','hidden',['p'],'2024-03-11 12:00:00',100)");
  await sql('CREATE TABLE backend_parts (tenant String,id String) ENGINE=Memory');
  await sql("INSERT INTO backend_parts VALUES ('acme','p'),('acme','p'),('acme','q'),('other','p')");
}, 120000);
afterAll(async () => { for (const backend of backends) await backend.close(); await container?.stop(); });
it('runs tenant expansion/join distinct rollup through plugin batches and typed facades', async () => {
  const expanded = components.where(r => r.tenant.eq('acme')).arrayJoin(r => r.ids, 'part');
  const matched = join({ c: expanded, p: parts }).on(r => [r.c.tenant.eq(r.p.tenant), r.c.part.eq(r.p.id)]);
  const rollup = matched.groupBy(r => ({ category: r.c.category.ifNull('uncategorised') })).aggregate(g => ({ rows: count(), entities: uniqExact(g.c.id) })).where(r => r.rows.gt(0n)).orderBy(r => r.category).limit(5);
  await verify(backends, rollup, [{ category: 'visible', rows: 7n, entities: 2n }], async () => (await native("SELECT ifNull(c.category,'uncategorised') AS category,count() AS rows,uniqExact(c.id) AS entities FROM (SELECT *,part FROM backend_components ARRAY JOIN ids AS part WHERE tenant='acme') c INNER ALL JOIN backend_parts p ON c.tenant=p.tenant AND c.part=p.id GROUP BY category HAVING rows>0 ORDER BY category LIMIT 5")).map(r => ({ category: String(r.category), rows: BigInt(String(r.rows)), entities: BigInt(String(r.entities)) })), true);
  const nested = matched.map(r => ({ id: r.c.id, part: r.p.id }));
  const nestedJoin = join({ ['__proto__']: nested, 'a.b': parts.where(r => r.tenant.eq('acme')) }).on(r => r.__proto__.part.eq(r['a.b'].id)).limit(0);
  await verify(backends, nestedJoin, [], async () => { expect(await native('SELECT id FROM backend_parts LIMIT 0')).toEqual([]); return []; });
});
it('preserves weekly Date UNION duplicates and nullable scalar results with ordered native expectations', async () => {
  const weekly = components.where(r => r.tenant.eq('acme')).groupBy(r => ({ week: r.at.toStartOfWeek() })).aggregate(g => ({ mean: avg(g.stock) }));
  const duplicated = unionAll(weekly, weekly);
  const newest = scalar(weekly.aggregate(g => max(g.week)));
  const query = duplicated.where(r => r.week.in([new Date('2024-03-10'), new Date('2024-03-17')])).map(r => ({ week: r.week, mean: r.mean, newest })).orderBy(r => r.week);
  const expected = [3, 3, 8, 8].map((mean, i) => ({ week: new Date(i < 2 ? '2024-03-10' : '2024-03-17'), mean, newest: new Date('2024-03-17') }));
  await verify(backends, query, expected, async () => (await native("WITH w AS (SELECT toStartOfWeek(at) AS week,avg(stock) AS mean FROM backend_components WHERE tenant='acme' GROUP BY week) SELECT week,mean,(SELECT max(week) FROM w) AS newest FROM (SELECT * FROM w UNION ALL SELECT * FROM w) WHERE week IN ('2024-03-10','2024-03-17') ORDER BY week")).map(r => ({ week: new Date(String(r.week)), mean: Number(r.mean), newest: new Date(String(r.newest)) })), true);
});
it('decodes nested paths, hostile/numeric output names, nulls, bigint and Array params without changing value models', async () => {
  const hostile = "x'\\\n{p9:Array(String)} --";
  const shared = val([hostile, ''], col.Array(col.String));
  const left = components.where(r => r.tenant.eq('acme').and(r.id.eq('a'))).map(r => ({ '0': val(9n, col.UInt64), 'a.b': r.category, ['__proto__']: shared, at: r.at }));
  const right = components.where(r => r.tenant.eq('acme').and(r.id.eq('c'))).map(r => ({ category: r.category, id: val(9n, col.UInt64) }));
  const query = join({ ['__proto__']: left, 'a.b': right }).on(r => r.__proto__['0'].eq(r['a.b'].id));
  const expected = [{ ['__proto__']: { '0': 9n, 'a.b': 'visible', ['__proto__']: [hostile, ''], at: new Date('2024-03-11T12:00:00Z') }, 'a.b': { category: null, id: 9n } }];
  await verify(backends, query, expected, async () => (await native(`SELECT toUInt64(9) AS id,c.category AS category,c.at AS at,[unhex('${Buffer.from(hostile).toString('hex')}'),''] AS list,d.category AS missing FROM backend_components c CROSS JOIN backend_components d WHERE c.tenant='acme' AND c.id='a' AND d.tenant='acme' AND d.id='c'`)).map(r => ({ ['__proto__']: { '0': BigInt(String(r.id)), 'a.b': String(r.category), ['__proto__']: r.list as string[], at: new Date(String(r.at)) }, 'a.b': { category: r.missing as null, id: BigInt(String(r.id)) } })));
});
it('requires the narrow serialized-Array workaround while delegating parsing and compression to the driver', async () => {
  const options = { url, username: 'fixture', password: 'fixture', compression: { response: true } };
  const driver = createDriver(options);
  const backend = createClickHouseBackend(options, 'clickhouse');
  const text = "a'\\\\\n";
  const query = components.limit(1).map(() => ({ values: val([text], col.Array(col.String)) }));
  const plan = backend.compile(query.ir);
  try {
    // This is a preformatted literal, not the JS Array the official formatter expects.
    await expect(driver.query({ query: plan.compiled.sql, query_params: plan.compiled.params, format: 'JSONEachRow' })).rejects.toThrow();
    const direct = await driver.query({ query: 'SELECT {list:Array(String)} AS values', query_params: { list: [text] }, format: 'JSONEachRow' });
    try { expect(await direct.json()).toEqual([{ values: [text] }]); }
    finally { direct.close(); }
    expect(await createClientFromBackend(backend).run(query)).toEqual([{ values: [text] }]);
  } finally { await backend.close(); await driver.close(); }
});
it('round-trips nested Array literals and nullable elements through both official execution paths', async () => {
  const text = "quote'\\\\\n\u0000雪";
  const matrix = [[text, '', null], []];
  const query = components.limit(1).map(() => ({
    matrix: val(matrix, col.Array(col.Array(col.Nullable(col.String)))),
    wide: val([[0n, 18446744073709551615n], []], col.Array(col.Array(col.UInt64))),
  }));
  const expected = [{ matrix, wide: [[0n, 18446744073709551615n], []] }];
  await verify(backends, query, expected, async () => (await native(`SELECT [[unhex('${Buffer.from(text).toString('hex')}'),'',NULL],[]] AS matrix,[[toUInt64(0),toUInt64('18446744073709551615')],[]] AS wide`)).map(r => ({
    matrix: r.matrix as (string | null)[][],
    wide: (r.wide as string[][]).map(items => items.map(BigInt)),
  })));
  for (const backend of backends) expect(await backend.runBuffered(backend.compile(query.ir))).toEqual(expected);
});
it('supports early exit, concurrent repeat execution, server failures and caller-owned reuse', async () => {
  for (const backend of backends) {
    // Runnable usage: facade is non-owning; close backend only after all cursors.
    const client = createClientFromBackend(backend);
    const q = components.where(r => r.tenant.eq('acme')).map(r => r.id).orderBy(r => r.id);
    for await (const row of client.stream(q)) { expect(row.id).toBe('a'); break; }
    const expected = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(await Promise.all([client.run(q), collect(client.stream(q))])).toEqual([expected, expected]);
    const missing = from(table('backend_missing', { id: col.UInt64 }, meta));
    await expect(client.run(missing)).rejects.toBeInstanceOf(QueryError);
    expect(await createClientFromBackend(backend).run(q)).toEqual(expected);
  }
});
