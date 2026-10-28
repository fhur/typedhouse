import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient } from '@chql/client';
import { quantile, quantileIf, avg, avgIf, argMax, argMaxIf, cast, count, countIf, sum, sumIf, max, maxIf, from, col, table, val, registerCompiler, join, crossJoin, unionAll, scalar, print, relNode, Query, type Column } from '@chql/core';
import { compile, emitNaive, quoteIdentifier } from '../src/index.js';
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
it('simple optimizer agrees with naive execution across clause boundaries', async () => {
  const source = from(db.entity_ots_component);
  const queries = [
    source.where(r => r.tenantId.eq('acme')).orderBy(r => r.entityId).limit(1, 1),
    source.orderBy(r => r.entityId).limit(2).where(r => r.tenantId.eq('acme')),
    source.orderBy(r => r.entityId).limit(2).orderBy(r => r.entityId.desc()),
    source.orderBy(r => r.entityId).limit(3, 1).limit(1, 1),
  ];
  for (const query of queries) {
    const execute = async (emitter: typeof compile) => {
      const plan = emitter(query.ir);
      const endpoint = new URL(url);
      for (const [key, value] of Object.entries(plan.params)) endpoint.searchParams.set(`param_${key}`, value);
      const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${plan.sql} FORMAT JSONEachRow` });
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      return text;
    };
    expect(await execute(compile)).toBe(await execute(emitNaive));
  }
});
it('adversarial quantile: fractional levels, mixed nullable predicates and hostile parameters compose across both emitters', async () => {
  await sql('CREATE TABLE adversarial_quantiles (x Nullable(Float64), selected Nullable(Bool)) ENGINE=Memory');
  await sql('INSERT INTO adversarial_quantiles VALUES (0,true),(8,true),(16,true),(32,false),(64,NULL),(NULL,true)');
  const source = from(table('adversarial_quantiles', { x: col.Nullable(col.Float64), selected: col.Nullable(col.Bool) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const hostile = "'\\\\\n\u0000日本語 {p0:Float64} --";
  for (const level of [-0, Number.MIN_VALUE, 0.25, 0.75, 1 - Number.EPSILON, 1]) {
    const summary = source.aggregate(g => {
      const selected = quantileIf(level)(g.x, g.selected);
      return { selected, shared: selected, equal: quantileIf(level)(g.x, g.selected) };
    });
    const direct = JSON.parse(await sql(`SELECT quantileIf(toFloat64('${level}'))(x,selected) AS q,toTypeName(q) AS type FROM adversarial_quantiles FORMAT JSONEachRow`));
    expect(direct.type).toBe('Nullable(Float64)');
    expect(direct.q).toBeCloseTo(16 * level, 12);
    const query = unionAll(summary, summary).map(r => ({ ...r, tag: val(hostile), global: scalar(source.aggregate(g => quantileIf(level)(g.x, g.selected))) }));
    const expected = Array.from({ length: 2 }, () => ({ selected: direct.q, shared: direct.q, equal: direct.q, tag: hostile, global: direct.q }));
    expect(await client.run(query)).toEqual(expected);
    const streamed = []; for await (const row of client.stream(query)) streamed.push(row); expect(streamed).toEqual(expected);
    for (const emitter of [compile, emitNaive]) {
      const plan = emitter(query.ir);
      expect(plan.sql).not.toContain(hostile);
      expect(plan.parameterTypes).toBeDefined();
      const levels = Object.entries(plan.parameterTypes!).filter(([, type]) => print(type) === 'Float64');
      expect(levels).toHaveLength(3); // scalar, shared aggregate, separately constructed equal aggregate
      expect(levels.map(([name]) => plan.params[name])).toEqual([String(level), String(level), String(level)]);
      const endpoint = new URL(url);
      // Raw HTTP needs ClickHouse escaped-text transport (the client driver does this itself).
      for (const [key, value] of Object.entries(plan.params)) endpoint.searchParams.set(`param_${key}`, value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\0', '\\0'));
      const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${plan.sql} FORMAT JSONEachRow` });
      const text = await response.text();
      expect(response.ok, text).toBe(true);
      expect(text.trim().split('\n').map(line => JSON.parse(line))).toEqual(expected);
    }
  }
});
it('runs weekly quantile history with FINAL isolation, Date windows, unions and scalar composition', async () => {
  await sql("CREATE TABLE quantile_history (tenant String, entity String, at DateTime64(3), version UInt32, value Nullable(Float64)) ENGINE=ReplacingMergeTree(version) ORDER BY (tenant,entity,at)");
  await sql("INSERT INTO quantile_history VALUES ('acme','cmp_7','2024-03-03',1,100),('acme','cmp_7','2024-03-03',2,2),('acme','cmp_7','2024-03-04',1,6),('acme','cmp_7','2024-03-10',1,NULL),('acme','cmp_7','2024-03-17',1,20),('other','cmp_7','2024-03-03',1,900),('acme','other','2024-03-03',1,800)");
  const source = from(table('quantile_history', { tenant: col.String, entity: col.String, at: col.DateTime64(3), version: col.UInt32, value: col.Nullable(col.Float64) }, { engine: 'ReplacingMergeTree', sortingKey: ['tenant', 'entity', 'at'], partitionKey: [] })).final().where(r => r.tenant.eq('acme')).where(r => r.entity.eq('cmp_7')).where(r => r.at.ge(new Date('2024-03-03')).and(r.at.lt(new Date('2024-03-17'))));
  const weekly = source.groupBy(r => ({ week: r.at.toStartOfWeek() })).aggregate(g => ({ stock: avg(g.value), leadDays: quantile(0.5)(g.value), selected: quantileIf(1)(g.value, g.value.gt(3)) }));
  const direct = (await sql("SELECT toStartOfWeek(at) AS week,avg(value) AS stock,quantile(0.5)(value) AS leadDays,quantileIf(1)(value,value>3) AS selected,toTypeName(leadDays) AS type FROM quantile_history FINAL WHERE tenant='acme' AND entity='cmp_7' AND at>=toDateTime64('2024-03-03',3) AND at<toDateTime64('2024-03-17',3) GROUP BY week ORDER BY week FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line));
  expect(direct.map(r => r.type)).toEqual(['Nullable(Float64)', 'Nullable(Float64)']);
  const expected = direct.map(({ week, stock, leadDays, selected }) => ({ week: new Date(week), stock, leadDays, selected }));
  expect(expected).toEqual([{ week: new Date('2024-03-03'), stock: 4, leadDays: 4, selected: 6 }, { week: new Date('2024-03-10'), stock: null, leadDays: null, selected: null }]);
  const query = unionAll(weekly, weekly).where(r => r.week.ge(new Date('2024-03-03'))).orderBy(r => r.week).limit(3);
  const rows = [expected[0], expected[0], expected[1]];
  expect(await client.run(query)).toEqual(rows);
  const streamed = []; for await (const row of client.stream(query)) streamed.push(row); expect(streamed).toEqual(rows);
  const scalarQuery = source.limit(1).map(() => ({ median: scalar(source.aggregate(g => quantile(0.5)(g.value))) }));
  expect(await client.run(scalarQuery)).toEqual([{ median: 4 }]);
  const scalarRows = []; for await (const row of client.stream(scalarQuery)) scalarRows.push(row); expect(scalarRows).toEqual([{ median: 4 }]);
});
it('proves quantile numeric widths, empty/null/If results and nonfinite values on 24.8', async () => {
  const seed = from(db.entity_ots_component).limit(1);
  for (const descriptor of [col.UInt8, col.UInt16, col.UInt32, col.UInt64, col.UInt128, col.UInt256, col.Int8, col.Int16, col.Int32, col.Int64, col.Int128, col.Int256, col.Float32, col.Float64]) {
    const type = print(descriptor.type), wide = /Int(64|128|256)$/.test(type);
    const column: Column<number | bigint> = descriptor;
    const values = seed.map(() => ({ values: val(wide ? [0n, 2n, 4n] : [0, 2, 4], col.Array(column)) })).arrayJoin(r => r.values, 'value');
    const query = values.aggregate(g => ({ low: quantile(0)(g.value), mid: quantile(0.5)(g.value), high: quantile(1)(g.value), missing: quantileIf(0.5)(g.value, val(null, col.Nullable(col.Bool))) }));
    const direct = JSON.parse(await sql(`SELECT quantile(0)(x) AS low,quantile(0.5)(x) AS mid,quantile(1)(x) AS high,toTypeName(mid) AS type FROM (SELECT CAST(number*2 AS ${type}) AS x FROM numbers(3)) FORMAT JSONEachRow`));
    expect(direct).toEqual({ low: 0, mid: 2, high: 4, type: 'Float64' });
    const expected = [{ low: 0, mid: 2, high: 4, missing: NaN }];
    expect(await client.run(query)).toEqual(expected);
    const rows = []; for await (const row of client.stream(query)) rows.push(row); expect(rows).toEqual(expected);
    expect(await client.run(values.limit(0).aggregate(g => quantile(0.5)(g.value)))).toEqual([{ value: NaN }]);
    const optional: Column<number | bigint | null> = col.Nullable(column);
    const nullableValues = seed.map(() => ({ xs: val(wide ? [null, 2n, 4n] : [null, 2, 4], col.Array(optional)) })).arrayJoin(r => r.xs, 'x');
    const nullableQuery = nullableValues.aggregate(g => ({ mid: quantile(0.5)(g.x), missing: quantileIf(0.5)(g.x, val(false)) }));
    const nullableDirect = JSON.parse(await sql(`SELECT quantile(0.5)(x) AS mid,quantileIf(0.5)(x,false) AS missing,toTypeName(mid) AS type FROM (SELECT arrayJoin([CAST(NULL AS Nullable(${type})),CAST(2 AS Nullable(${type})),CAST(4 AS Nullable(${type}))]) AS x) FORMAT JSONEachRow`));
    expect(nullableDirect).toEqual({ mid: 3, missing: null, type: 'Nullable(Float64)' });
    expect(await client.run(nullableQuery)).toEqual([{ mid: 3, missing: null }]);
    const nullableRows = []; for await (const row of client.stream(nullableQuery)) nullableRows.push(row); expect(nullableRows).toEqual([{ mid: 3, missing: null }]);
    expect(await client.run(nullableValues.limit(0).aggregate(g => quantile(0.5)(g.x)))).toEqual([{ x: null }]);
  }
  for (const [values, expected] of [[[NaN, 2, 4], 3], [[-Infinity, Infinity], NaN], [[Infinity], Infinity], [[-Infinity], -Infinity]] as const) {
    const query = seed.map(() => ({ xs: val([...values], col.Array(col.Float64)) })).arrayJoin(r => r.xs, 'x').aggregate(g => quantile(0.5)(g.x));
    expect(await client.run(query)).toEqual([{ x: expected }]);
    const rows = []; for await (const row of client.stream(query)) rows.push(row); expect(rows).toEqual([{ x: expected }]);
  }
  const nullableNan = seed.aggregate(() => quantile(0.5)(val(NaN, col.Nullable(col.Float64))));
  expect(await client.run(nullableNan)).toEqual([{ quantile: NaN }]);
  const nullableNanRows = []; for await (const row of client.stream(nullableNan)) nullableNanRows.push(row); expect(nullableNanRows).toEqual([{ quantile: NaN }]);
  const empty = seed.limit(0).aggregate(() => quantile(0.5)(val(null, col.Nullable(col.Float64))));
  expect(await client.run(empty)).toEqual([{ quantile: null }]);
  // Larger than the reservoir: only assert boundedness, not independent random sample equality.
  const approx = JSON.parse(await sql('SELECT quantile(0.5)(number) AS q FROM numbers(20000) FORMAT JSONEachRow'));
  expect(approx.q).toBeGreaterThanOrEqual(0); expect(approx.q).toBeLessThanOrEqual(19999);
}, 30000);
it('adversarial weekly Date: exhausts every supported day against independent calendar arithmetic and SQL', async () => {
  await sql('CREATE TABLE adversarial_calendar (day Date) ENGINE=Memory');
  await sql("INSERT INTO adversarial_calendar SELECT toDate(number) FROM numbers(65536)");
  const source = from(table('adversarial_calendar', { day: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const valid = source.where(r => r.day.ge(new Date('1970-01-04')));
  const q = valid.map(r => ({ day: r.day, week: r.day.toStartOfWeek(), twice: r.day.toStartOfWeek().toStartOfWeek() })).orderBy(r => r.day);
  const expected = Array.from({ length: 65533 }, (_, i) => {
    const day = new Date((i + 3) * 86400000);
    const week = new Date(day.getTime() - day.getUTCDay() * 86400000);
    return { day, week, twice: week };
  });
  const native = (await sql("SELECT day,toStartOfWeek(day,0) AS week FROM adversarial_calendar WHERE day >= toDate('1970-01-04') ORDER BY day FORMAT JSONEachRow")).trim().split('\n').map(line => {
    const row = JSON.parse(line); return { day: new Date(row.day), week: new Date(row.week), twice: new Date(row.week) };
  });
  expect(native).toEqual(expected);
  expect(await client.run(q)).toEqual(expected);
  const streamed = []; for await (const row of client.stream(q)) streamed.push(row); expect(streamed).toEqual(expected);
  for (const day of ['1970-01-01', '1970-01-02', '1970-01-03']) {
    const invalid = source.where(r => r.day.eq(new Date(day))).map(r => r.day.toStartOfWeek());
    await expect(client.run(invalid)).rejects.toMatchObject({ cause: { message: expect.stringContaining('chql_date_out_of_range') } });
    await expect((async () => { for await (const _row of client.stream(invalid)) { /* drain */ } })()).rejects.toMatchObject({ cause: { message: expect.stringContaining('chql_date_out_of_range') } });
  }
}, 30000);
it('adversarial weekly Date: nullable array transport, repeated union scopes and DST calendar boundaries', async () => {
  const seed = from(db.entity_ots_component).limit(1);
  const shared = val(new Date('2024-03-10T23:59:59-07:00'), col.Date);
  const dates = seed.map(() => ({ dates: val([null, new Date('2024-03-10T23:59:59-07:00'), new Date('2149-06-06T23:59:59Z')], col.Array(col.Nullable(col.Date))) }))
    .arrayJoin(r => r.dates, 'day').map(r => ({ day: r.day, week: r.day.toStartOfWeek(), shared, equal: val(new Date('2024-03-11'), col.Date) }));
  const q = unionAll(dates, dates).orderBy(r => r.day.asc().nullsFirst());
  const compiled = emitNaive(q.ir);
  expect(Object.values(compiled.params)).toEqual(['2024-03-11', '2024-03-11', "[NULL,'2024-03-11','2149-06-06']"]);
  expect(compiled.sql).not.toContain('2024-03-11');
  const expected = [null, null, '2024-03-11', '2024-03-11', '2149-06-06', '2149-06-06'].map(day => ({ day: day === null ? null : new Date(day), week: day === null ? null : new Date(day === '2149-06-06' ? '2149-06-01' : '2024-03-10'), shared: new Date('2024-03-11'), equal: new Date('2024-03-11') }));
  expect(await client.run(q)).toEqual(expected);
  const rows = []; for await (const row of client.stream(q)) rows.push(row); expect(rows).toEqual(expected);
  await sql("CREATE TABLE adversarial_dst (at Nullable(DateTime64(3,'America/New_York'))) ENGINE=Memory");
  await sql("INSERT INTO adversarial_dst SELECT toDateTime64(instant,3,'UTC') FROM values('instant String',('2024-03-10 04:59:59.999'),('2024-03-10 05:00:00'),('2024-03-10 07:00:00'),('2024-11-03 03:59:59.999'),('2024-11-03 04:00:00'),('2024-11-03 05:30:00'),('2024-11-03 06:30:00'))");
  await sql('INSERT INTO adversarial_dst VALUES (NULL)');
  const zoned = from(table('adversarial_dst', { at: col.Nullable(col.DateTime64(3, 'America/New_York')) }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).orderBy(r => r.at.asc().nullsFirst()).map(r => ({ week: r.at.toStartOfWeek() }));
  const weeks = [null, '2024-03-03', '2024-03-10', '2024-03-10', '2024-10-27', '2024-11-03', '2024-11-03', '2024-11-03'].map(day => ({ week: day === null ? null : new Date(day) }));
  const direct = (await sql('SELECT toStartOfWeek(at,0) AS week,toTypeName(week) AS type FROM adversarial_dst ORDER BY at NULLS FIRST FORMAT JSONEachRow')).trim().split('\n').map(line => JSON.parse(line));
  expect(direct.map(row => ({ week: row.week === null ? null : new Date(row.week) }))).toEqual(weeks);
  expect(direct.map(row => row.type)).toEqual(Array(8).fill('Nullable(Date)'));
  expect(await client.run(zoned)).toEqual(weeks);
  const streamed = []; for await (const row of client.stream(zoned)) streamed.push(row); expect(streamed).toEqual(weeks);
});
it('runs strict weekly Date means against independent SQL with FINAL, nullable groups and timezone settings', async () => {
  await sql("CREATE TABLE weekly_history (tenant String, entity String, at DateTime64(3,'America/New_York'), inserted UInt32, stock Nullable(Float64)) ENGINE=ReplacingMergeTree(inserted) ORDER BY (tenant,entity,at)");
  await sql("INSERT INTO weekly_history VALUES ('acme','cmp_7','2024-02-29 12:00:00',1,2),('acme','cmp_7','2024-03-02 23:30:00',1,99),('acme','cmp_7','2024-03-02 23:30:00',2,6),('acme','cmp_7','2024-03-03 00:00:00',1,NULL),('acme','cmp_7','2024-03-04 00:00:00',1,8),('acme','cmp_7','2024-03-10 00:00:00',1,NULL),('other','cmp_7','2024-03-03',1,900),('acme','other','2024-03-03',1,800)");
  const source = from(table('weekly_history', { tenant: col.String, entity: col.String, at: col.DateTime64(3, 'America/New_York'), inserted: col.UInt32, stock: col.Nullable(col.Float64) }, { engine: 'ReplacingMergeTree', sortingKey: ['tenant', 'entity', 'at'], partitionKey: [] })).final().where(r => r.tenant.eq('acme')).where(r => r.entity.eq('cmp_7'));
  const weekly = source.groupBy(r => ({ week: r.at.toStartOfWeek() })).aggregate(g => ({ stock: avg(g.stock) }));
  const baseline = "SELECT toStartOfWeek(at,0) AS week,avg(stock) AS stock FROM weekly_history FINAL WHERE tenant='acme' AND entity='cmp_7' GROUP BY week";
  const direct = JSON.parse(await sql(`SELECT groupArray(tuple(toString(week),stock)) AS rows FROM (${baseline} ORDER BY week) FORMAT JSONEachRow`)).rows.map(([day, stock]: [string, number | null]) => ({ week: new Date(`${day}T00:00:00Z`), stock }));
  expect(direct).toEqual([{ week: new Date('2024-02-25'), stock: 4 }, { week: new Date('2024-03-03'), stock: 8 }, { week: new Date('2024-03-10'), stock: null }]);
  const compare = async (query: { ir: import('@chql/core').Rel; caps: { live: boolean }; _rowType: { week: Date; stock: number | null } }, expected: typeof direct) => {
    expect(await client.run(query)).toEqual(expected);
    const rows = []; for await (const row of client.stream(query)) rows.push(row); expect(rows).toEqual(expected);
  };
  await compare(weekly.orderBy(r => r.week), direct);
  const windowed = source.where(r => r.at.ge(new Date('2024-03-03T05:00:00Z')).and(r.at.lt(new Date('2024-03-10T05:00:00Z'))))
    .groupBy(r => ({ week: r.at.toStartOfWeek() })).aggregate(g => ({ stock: avg(g.stock) }));
  const directWindow = JSON.parse(await sql("SELECT toString(toStartOfWeek(at,0)) AS week,avg(stock) AS stock FROM weekly_history FINAL WHERE tenant='acme' AND entity='cmp_7' AND at>=toDateTime64('2024-03-03 05:00:00',3,'UTC') AND at<toDateTime64('2024-03-10 05:00:00',3,'UTC') GROUP BY week FORMAT JSONEachRow"));
  await compare(windowed, [{ week: new Date(directWindow.week), stock: directWindow.stock }]);
  const latestWeek = source.aggregate(g => ({ week: max(g.at).toStartOfWeek() }));
  expect(await client.run(latestWeek)).toEqual([{ week: new Date('2024-03-10') }]);
  await compare(unionAll(weekly, weekly).where(r => r.week.ge(new Date('2024-03-03T20:00:00Z'))).orderBy(r => r.week).limit(2), [direct[1], direct[1]]);
  await compare(source.limit(0).groupBy(r => ({ week: r.at.toStartOfWeek() })).aggregate(g => ({ stock: avg(g.stock) })), []);
  expect(Object.values(emitNaive(weekly.ir).columns).map(print)).toEqual(['Date', 'Nullable(Float64)']);
  const seed = from(db.entity_ots_component).limit(1);
  await sql('CREATE TABLE calendar_days (day Date, optional Nullable(Date)) ENGINE=Memory');
  await sql("INSERT INTO calendar_days VALUES ('1970-01-01',NULL),('2024-02-29','2024-02-29'),('2149-06-06','2149-06-06')");
  const calendar = from(table('calendar_days', { day: col.Date, optional: col.Nullable(col.Date) }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).orderBy(r => r.day);
  const calendarExpected = [{ day: new Date('1970-01-01'), optional: null }, { day: new Date('2024-02-29'), optional: new Date('2024-02-29') }, { day: new Date('2149-06-06'), optional: new Date('2149-06-06') }];
  expect(await client.run(calendar)).toEqual(calendarExpected);
  const calendarRows = []; for await (const row of client.stream(calendar)) calendarRows.push(row); expect(calendarRows).toEqual(calendarExpected);
  const dateArray = seed.map(() => ({ days: val([new Date('1970-01-01'), null, new Date('2024-02-29')], col.Array(col.Nullable(col.Date))) }));
  expect(await client.run(dateArray)).toEqual([{ days: [new Date('1970-01-01'), null, new Date('2024-02-29')] }]);
  for (const setting of [0, 1]) {
    for (const day of ['1970-01-04', '2000-02-29', '2023-12-31', '2024-01-01', '2024-03-03', '2024-03-04', '2149-06-06']) {
      const input = seed.map(() => ({ day: val(new Date(day), col.Date) }));
      const q = input.map(r => ({ day: r.day, week: r.day.toStartOfWeek() }));
      const native = JSON.parse(await sql(`SELECT toStartOfWeek(toDate('${day}'),0) AS week,toTypeName(week) AS type SETTINGS enable_extended_results_for_datetime_functions=${setting} FORMAT JSONEachRow`));
      expect(native.type).toBe('Date');
      const expected = [{ day: new Date(day), week: new Date(native.week) }];
      expect(await client.run(q)).toEqual(expected);
      const rows = []; for await (const row of client.stream(q)) rows.push(row); expect(rows).toEqual(expected);
    }
  }
  for (const day of ['1970-01-01', '1969-12-31', '2150-01-01']) {
    const q = seed.map(() => ({ week: val(new Date(day), col.DateTime64(3)).toStartOfWeek() }));
    await expect(client.run(q)).rejects.toMatchObject({ cause: { message: expect.stringContaining('chql_date_out_of_range') } });
  }
  const nullWeek = seed.map(() => ({ week: val(null, col.Nullable(col.Date)).toStartOfWeek() }));
  expect(await client.run(nullWeek)).toEqual([{ week: null }]);
  for (const extended of [0, 1] as const) {
    const zoned = createClient({ url, username: 'fixture', password: 'fixture', clickhouse_settings: { session_timezone: 'Asia/Tokyo', enable_extended_results_for_datetime_functions: extended } });
    try {
      for (const precision of [0, 1, 2, 3] as const) {
        const instant = new Date('2024-03-03T01:00:00Z');
        // A column timezone differs from both the UTC parameter transport and session timezone.
        await sql(`CREATE TABLE week_zone_${extended}_${precision} (at DateTime64(${precision},'America/New_York')) ENGINE=Memory`);
        await sql(`INSERT INTO week_zone_${extended}_${precision} VALUES ('2024-03-02 20:00:00')`);
        const q = from(table(`week_zone_${extended}_${precision}`, { at: col.DateTime64(precision, 'America/New_York') }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).map(r => ({ week: r.at.toStartOfWeek(), constant: val(instant, col.DateTime64(precision)).toStartOfWeek() }));
        const expected = [{ week: new Date('2024-02-25'), constant: new Date('2024-03-03') }];
        expect(await zoned.run(q)).toEqual(expected);
        const rows = []; for await (const row of zoned.stream(q)) rows.push(row); expect(rows).toEqual(expected);
        const native = JSON.parse(await sql(`SELECT toStartOfWeek(at,0) AS week,toTypeName(week) AS type FROM week_zone_${extended}_${precision} SETTINGS enable_extended_results_for_datetime_functions=${extended} FORMAT JSONEachRow`));
        expect(native).toEqual({ week: '2024-02-25', type: extended ? 'Date32' : 'Date' });
        const descriptorQuery = from(table(`week_zone_${extended}_${precision}`, { at: col.DateTime64(precision, 'America/New_York') }, { engine: 'Memory', sortingKey: [], partitionKey: [] })).map(r => ({ week: r.at.toStartOfWeek() }));
        const descriptors = JSON.parse(await sql(`SELECT toTypeName(week) AS week FROM (${emitNaive(descriptorQuery.ir).sql}) FORMAT JSONEachRow`));
        expect(descriptors).toEqual({ week: 'Date' });
      }
    } finally { await zoned.close(); }
  }
});
it('summarizes bounded tenant history with FINAL and composes mean outputs through union/scalar', async () => {
  await sql('CREATE TABLE mean_history (tenantId String, entityId String, effectiveAt DateTime64(3), inserted UInt32, stock Float64, lead Nullable(Float64)) ENGINE=ReplacingMergeTree(inserted) ORDER BY (tenantId,entityId,effectiveAt)');
  await sql("INSERT INTO mean_history VALUES ('acme','a','2026-01-01',1,100,100),('acme','a','2026-01-02',1,99,99),('acme','a','2026-01-02',2,8,4),('acme','a','2026-01-03',1,16,NULL),('acme','a','2026-01-04',1,200,200),('acme','b','2026-01-02',1,4,NULL),('other','a','2026-01-02',1,900,900)");
  const source = from(table('mean_history', { tenantId: col.String, entityId: col.String, effectiveAt: col.DateTime64(3), inserted: col.UInt32, stock: col.Float64, lead: col.Nullable(col.Float64) }, { engine: 'ReplacingMergeTree', sortingKey: ['tenantId', 'entityId', 'effectiveAt'], partitionKey: [] })).final()
    .where(r => r.tenantId.eq('acme')).where(r => r.effectiveAt.ge(new Date('2026-01-02T00:00:00Z')).and(r.effectiveAt.lt(new Date('2026-01-04T00:00:00Z'))));
  const summary = source.groupBy(r => r.entityId).aggregate(g => ({ stock: avg(g.stock), leadDays: avg(g.lead), positive: avgIf(g.stock, g.stock.gt(4)), ratio: avg(g.stock).divide(avg(g.stock)) }));
  const base = "FROM mean_history FINAL WHERE tenantId='acme' AND effectiveAt>=toDateTime64('2026-01-02',3) AND effectiveAt<toDateTime64('2026-01-04',3)";
  const baseline = `SELECT entityId,avg(stock) AS stockMean,avg(lead) AS leadDays,avgIf(stock,stock>4) AS positive,avg(stock)/avg(stock) AS ratio ${base} GROUP BY entityId`;
  const decode = (text: string) => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line, (_k, v) => v === 'nan' ? NaN : v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v));
  const direct = (query: string) => sql(query + ' SETTINGS output_format_json_quote_denormals=1 FORMAT JSONEachRow').then(decode);
  const compare = async <R>(query: { ir: import('@chql/core').Rel; caps: { live: boolean }; _rowType: R }, expected: unknown) => {
    expect(await client.run(query)).toEqual(expected);
    const rows = []; for await (const row of client.stream(query)) rows.push(row);
    expect(rows).toEqual(expected);
  };
  const expected = await direct(`SELECT entityId,stockMean AS stock,leadDays,positive,ratio FROM (${baseline}) ORDER BY entityId`);
  expect(expected).toEqual([{ entityId: 'a', stock: 12, leadDays: 4, positive: 12, ratio: 1 }, { entityId: 'b', stock: 4, leadDays: null, positive: NaN, ratio: 1 }]);
  await compare(summary.orderBy(r => r.entityId), expected);
  expect(Object.values(emitNaive(summary.ir).columns).map(print)).toEqual(['String', 'Float64', 'Nullable(Float64)', 'Float64', 'Float64']);
  await compare(unionAll(summary, summary).where(r => r.stock.gt(4)).orderBy(r => r.entityId).limit(2), await direct(`SELECT entityId,stockMean AS stock,leadDays,positive,ratio FROM (${baseline} UNION ALL ${baseline}) WHERE stockMean>4 ORDER BY entityId LIMIT 2`));
  const global = source.aggregate(g => avg(g.stock));
  const composed = summary.map(r => ({ entityId: r.entityId, mean: scalar(global) })).orderBy(r => r.entityId);
  expect(print(composed.row.mean.ir.type)).toBe('Nullable(Float64)');
  await compare(composed, await direct(`SELECT entityId,(SELECT avg(stock) ${base}) AS mean FROM (${baseline}) ORDER BY entityId`));
  await compare(source.limit(0).aggregate(g => ({ stock: avg(g.stock), lead: avg(g.lead) })), [{ stock: NaN, lead: null }]);
  await compare(source.limit(0).groupBy(r => r.entityId).aggregate(g => avg(g.stock)), []);
});
it('matches mean descriptors, empty/NULL/If semantics and precision across all supported widths', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const descriptors: Column<number | bigint>[] = [col.UInt8, col.UInt16, col.UInt32, col.UInt64, col.UInt128, col.UInt256, col.Int8, col.Int16, col.Int32, col.Int64, col.Int128, col.Int256, col.Float32, col.Float64];
  const decode = (v: unknown) => v === 'nan' ? NaN : v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v;
  for (const descriptor of descriptors) {
    const type = print(descriptor.type);
    for (const empty of [false, true]) {
      const input = empty ? source.limit(0) : source;
      const value = /^(U?Int)(64|128|256)$/.test(type) ? 8n : 8;
      const nullable: Column<number | bigint | null> = col.Nullable(descriptor);
      const query = input.aggregate(() => ({ value: avg(val(value, descriptor)), nullable: avg(val(value, nullable)), excluded: avgIf(val(value, descriptor), val(false)), excludedNull: avgIf(val(value, nullable), val(false)), nullPredicate: avgIf(val(value, descriptor), val(null, col.Nullable(col.Bool))), allNull: avg(val(null, nullable)) }));
      const direct = JSON.parse(await sql(`SELECT avg(CAST(8 AS ${type})) AS value,avg(CAST(8 AS Nullable(${type}))) AS nullable,avgIf(CAST(8 AS ${type}),false) AS excluded,avgIf(CAST(8 AS Nullable(${type})),false) AS excludedNull,avgIf(CAST(8 AS ${type}),CAST(NULL AS Nullable(Bool))) AS nullPredicate,avg(CAST(NULL AS Nullable(${type}))) AS allNull,toTypeName(value) AS valueType,toTypeName(nullable) AS nullableType,toTypeName(excluded) AS excludedType,toTypeName(excludedNull) AS excludedNullType,toTypeName(nullPredicate) AS predicateType FROM numbers(${empty ? 0 : 1}) SETTINGS output_format_json_quote_denormals=1 FORMAT JSONEachRow`));
      expect([direct.valueType, direct.nullableType, direct.excludedType, direct.excludedNullType, direct.predicateType]).toEqual(['Float64', 'Nullable(Float64)', 'Float64', 'Nullable(Float64)', 'Float64']);
      expect(Object.values(emitNaive(query.ir).columns).map(print)).toEqual(['Float64', 'Nullable(Float64)', 'Float64', 'Nullable(Float64)', 'Float64', 'Nullable(Float64)']);
      const expected = [{ value: empty ? NaN : 8, nullable: empty ? null : 8, excluded: NaN, excludedNull: null, nullPredicate: NaN, allNull: null }];
      expect([{ value: decode(direct.value), nullable: direct.nullable, excluded: decode(direct.excluded), excludedNull: direct.excludedNull, nullPredicate: decode(direct.nullPredicate), allNull: direct.allNull }]).toEqual(expected);
      expect(await client.run(query)).toEqual(expected);
      const rows = []; for await (const row of client.stream(query)) rows.push(row); expect(rows).toEqual(expected);
    }
  }
  for (const values of [[Infinity], [-Infinity], [Infinity, -Infinity], [NaN], [0.5, 1.5]]) {
    const q = source.map(() => ({ values: val(values, col.Array(col.Float64)) })).arrayJoin(r => r.values, 'item').aggregate(g => avg(g.item));
    const direct = JSON.parse(await sql(`SELECT avg(x) AS value,toTypeName(value) AS type FROM (SELECT arrayJoin([${values.map(v => `toFloat64('${String(v)}')`).join(',')}]) AS x) SETTINGS output_format_json_quote_denormals=1 FORMAT JSONEachRow`));
    expect(direct.type).toBe('Float64'); const expected = [{ item: decode(direct.value) }];
    expect(await client.run(q)).toEqual(expected); const rows = []; for await (const row of client.stream(q)) rows.push(row); expect(rows).toEqual(expected);
  }
  const wide = source.aggregate(() => avg(val(9007199254740993n, col.UInt256)));
  const direct = JSON.parse(await sql("SELECT avg(toUInt256('9007199254740993')) AS value,toTypeName(value) AS type FROM numbers(1) FORMAT JSONEachRow"));
  expect(direct).toEqual({ value: 9007199254740992, type: 'Float64' }); // Float64 means are not exact bigint arithmetic.
  expect(await client.run(wide)).toEqual([{ avg: direct.value }]);
  const rows = []; for await (const row of client.stream(wide)) rows.push(row); expect(rows).toEqual([{ avg: direct.value }]);
});
it('adversarial means preserve nullable predicate selection and hostile shared parameters across scopes', async () => {
  const seed = from(db.entity_ots_component).limit(1);
  const hostile = "x'); SELECT 999 --\\\n\0雪";
  const shared = val(hostile);
  const branch = (value: number | null, flag: boolean | null) => seed.map(() => ({ value: val(value, col.Nullable(col.Float64)), flag: val(flag, col.Nullable(col.Bool)), tag: shared }));
  const input = unionAll(branch(2, true), branch(10, true), branch(100, false), branch(1000, null), branch(null, true));
  const means = input.where(r => r.tag.eq(shared)).aggregate(g => ({ selected: avgIf(g.value, g.flag), all: avg(g.value) }));
  const repeated = unionAll(means, means).map(r => ({ ...r, global: scalar(input.aggregate(g => avgIf(g.value, g.flag))), equalButDistinct: val(hostile) }));
  const compiled = emitNaive(repeated.ir);
  expect(compiled.sql).not.toContain(hostile);
  expect(Object.values(compiled.params).filter(v => v === hostile)).toHaveLength(2);
  const hex = Buffer.from(hostile).toString('hex');
  const directInput = "SELECT CAST(v AS Nullable(Float64)) AS value,CAST(f AS Nullable(Bool)) AS flag FROM values('v Nullable(Float64), f Nullable(Bool)', (2,true),(10,true),(100,false),(1000,NULL),(NULL,true))";
  const direct = JSON.parse(await sql(`SELECT avgIf(value,flag) AS selected,avg(value) AS all,(SELECT avgIf(value,flag) FROM (${directInput})) AS global,unhex('${hex}') AS equalButDistinct,toTypeName(selected) AS type FROM (${directInput}) FORMAT JSONEachRow`));
  expect(direct).toEqual({ selected: 6, all: 278, global: 6, equalButDistinct: hostile, type: 'Nullable(Float64)' });
  const { type: _type, ...row } = direct;
  const expected = [row, row];
  expect(Object.values(compiled.columns).map(print)).toEqual(['Nullable(Float64)', 'Nullable(Float64)', 'Nullable(Float64)', 'String']);
  expect(await client.run(repeated)).toEqual(expected);
  const streamed = []; for await (const row of client.stream(repeated)) streamed.push(row);
  expect(streamed).toEqual(expected);
});
it('adversarial means use server Float32 rounding and wide signed arithmetic rather than JS preaggregation', async () => {
  const seed = from(db.entity_ots_component).limit(1);
  for (const [descriptor, values, literal] of [
    [col.Float32, [16777217, 16777219], '[toFloat32(16777217),toFloat32(16777219)]'],
    [col.Int256, [-(1n << 200n), 1n << 200n], '[toInt256(\'-1606938044258990275541962092341162602522202993782792835301376\'),toInt256(\'1606938044258990275541962092341162602522202993782792835301376\')]'],
  ] as const) {
    const column: Column<number | bigint> = descriptor;
    const q = seed.map(() => ({ values: val([...values], col.Array(column)) })).arrayJoin(r => r.values, 'item').aggregate(g => avg(g.item));
    const direct = JSON.parse(await sql(`SELECT avg(x) AS item,toTypeName(item) AS type FROM (SELECT arrayJoin(${literal}) AS x) FORMAT JSONEachRow`));
    expect(direct).toEqual({ item: descriptor === col.Float32 ? 16777218 : 0, type: 'Float64' });
    expect(print(q.row.item.ir.type)).toBe(direct.type);
    expect(await client.run(q)).toEqual([{ item: direct.item }]);
    const rows = []; for await (const row of client.stream(q)) rows.push(row); expect(rows).toEqual([{ item: direct.item }]);
  }
});
it('selects latest tenant metrics with FINAL, NULL skipping, conditional exclusion, union and scalar composition', async () => {
  await sql('CREATE TABLE latest_metrics (tenantId String, entityId String, version UInt32, inserted UInt32, stock_index Float64, lead_time_max_days Nullable(Float64)) ENGINE=ReplacingMergeTree(inserted) ORDER BY (tenantId,entityId,version)');
  await sql("INSERT INTO latest_metrics VALUES ('acme','a',3,1,30,NULL),('acme','a',1,1,10,10),('acme','a',2,1,19,19),('acme','a',2,2,20,20),('acme','b',1,1,5,NULL),('acme','b',1,1,5,NULL),('other','a',9,1,900,900)");
  const cleanIndices = from(table('latest_metrics', { tenantId: col.String, entityId: col.String, version: col.UInt32, inserted: col.UInt32, stock_index: col.Float64, lead_time_max_days: col.Nullable(col.Float64) }, { engine: 'ReplacingMergeTree', sortingKey: ['tenantId', 'entityId', 'version'], partitionKey: [] })).final();
  const scoped = cleanIndices.where(i => i.tenantId.eq('acme'));
  const latest = scoped.groupBy(i => ({ entityId: i.entityId })).aggregate(g => ({ version: max(g.version), stockIndex: argMax(g.stock_index, g.version), leadDays: argMax(g.lead_time_max_days, g.version) }));
  const direct = async (query: string) => (await sql(query + ' FORMAT JSONEachRow')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  const baseline = "SELECT entityId,newest AS version,stockIndex,leadDays FROM (SELECT entityId,max(version) AS newest,argMax(stock_index,version) AS stockIndex,argMax(lead_time_max_days,version) AS leadDays FROM latest_metrics FINAL WHERE tenantId='acme' GROUP BY entityId)";
  const expected = await direct(baseline + ' ORDER BY entityId');
  expect(expected).toEqual([{ entityId: 'a', version: 3, stockIndex: 30, leadDays: 20 }, { entityId: 'b', version: 1, stockIndex: 5, leadDays: null }]);
  expect(await client.run(latest.orderBy(r => r.entityId))).toEqual(expected);
  const rows = []; for await (const row of client.stream(latest.orderBy(r => r.entityId))) rows.push(row);
  expect(rows).toEqual(expected);
  const composed = unionAll(latest, latest).where(r => r.stockIndex.gt(10)).orderBy(r => r.entityId).limit(2);
  const unionExpected = await direct(`SELECT * FROM (${baseline} UNION ALL ${baseline}) WHERE stockIndex>10 ORDER BY entityId LIMIT 2`);
  expect(await client.run(composed)).toEqual(unionExpected);
  const unionRows = []; for await (const row of client.stream(composed)) unionRows.push(row);
  expect(unionRows).toEqual(unionExpected);
  const global = scoped.aggregate(g => argMax(g.stock_index, g.version));
  const scalarQuery = latest.map(r => ({ entityId: r.entityId, latest: scalar(global) })).orderBy(r => r.entityId);
  expect(print(scalarQuery.row.latest.ir.type)).toBe('Nullable(Float64)');
  const scalarExpected = await direct(`SELECT entityId,(SELECT argMax(stock_index,version) FROM latest_metrics FINAL WHERE tenantId='acme') AS latest FROM (${baseline}) ORDER BY entityId`);
  expect(await client.run(scalarQuery)).toEqual(scalarExpected);
  const scalarRows = []; for await (const row of client.stream(scalarQuery)) scalarRows.push(row);
  expect(scalarRows).toEqual(scalarExpected);
  const conditional = scoped.aggregate(g => ({ stock: argMaxIf(g.stock_index, g.version, g.version.lt(3)), none: argMaxIf(g.stock_index, g.version, g.version.gt(99)), lead: argMaxIf(g.lead_time_max_days, g.version, g.version.gt(99)), ratio: argMax(g.stock_index, g.version).divide(max(g.version)) }));
  const conditionalExpected = await direct("SELECT argMaxIf(stock_index,version,version<3) AS stock,argMaxIf(stock_index,version,version>99) AS none,argMaxIf(lead_time_max_days,version,version>99) AS lead,argMax(stock_index,version)/max(version) AS ratio FROM latest_metrics FINAL WHERE tenantId='acme'");
  expect(conditionalExpected).toEqual([{ stock: 20, none: 0, lead: null, ratio: 10 }]);
  expect(await client.run(conditional)).toEqual(conditionalExpected);
  const conditionalRows = []; for await (const row of client.stream(conditional)) conditionalRows.push(row);
  expect(conditionalRows).toEqual(conditionalExpected);
  const nullPredicate = scoped.aggregate(g => ({ value: argMaxIf(g.stock_index, g.version, val(null, col.Nullable(col.Bool))) }));
  expect(await client.run(nullPredicate)).toEqual(await direct("SELECT argMaxIf(stock_index,version,CAST(NULL AS Nullable(Bool))) AS value FROM latest_metrics FINAL WHERE tenantId='acme'"));
  expect(await client.run(scoped.limit(0).aggregate(g => ({ stock: argMax(g.stock_index, g.version), lead: argMax(g.lead_time_max_days, g.version) })))).toEqual([{ stock: 0, lead: null }]);
  expect(await client.run(scoped.limit(0).groupBy(r => r.entityId).aggregate(g => argMax(g.stock_index, g.version)))).toEqual([]);
});
it('matches pinned argMax widths, nullable empty defaults and Bool/String descriptors through run and stream', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const descriptors: Column[] = [col.UInt8, col.UInt16, col.UInt32, col.UInt64, col.UInt128, col.UInt256, col.Int8, col.Int16, col.Int32, col.Int64, col.Int128, col.Int256, col.Float32, col.Float64, col.String, col.Bool];
  for (const descriptor of descriptors) {
    const type = print(descriptor.type), literal = type === 'Bool' ? 'true' : "'7'";
    // Cast descriptors are runtime-erased here; compiler validation is authoritative.
    const value = type === 'Bool' ? true : type === 'String' ? '7' : /^(U?Int)(64|128|256)$/.test(type) ? 7n : 7;
    const typed = descriptor as Column<number | bigint | string | boolean>;
    for (const empty of [false, true]) {
      const input = empty ? source.limit(0) : source;
      const nullableType: Column<number | bigint | string | boolean | null> = col.Nullable(typed);
      const query = input.aggregate(() => ({ value: argMax(val(value, typed), val(1, col.UInt32)), nullable: argMax(val(value, nullableType), val(1, col.UInt32)), excluded: argMaxIf(val(value, typed), val(1, col.UInt32), val(false)), allNull: argMax(val(null, nullableType), val(1, col.UInt32)) }));
      const direct = JSON.parse(await sql(`SELECT argMax(CAST(${literal} AS ${type}),toUInt32(1)) AS value,argMax(CAST(${literal} AS Nullable(${type})),toUInt32(1)) AS nullable,argMaxIf(CAST(${literal} AS ${type}),toUInt32(1),false) AS excluded,argMax(CAST(NULL AS Nullable(${type})),toUInt32(1)) AS allNull,toTypeName(value) AS valueType,toTypeName(nullable) AS nullableType,toTypeName(excluded) AS excludedType,toTypeName(allNull) AS nullType FROM numbers(${empty ? 0 : 1}) FORMAT JSONEachRow`));
      expect(direct.valueType).toBe(type); expect(direct.excludedType).toBe(type);
      expect(direct.nullableType).toBe(`Nullable(${type})`); expect(direct.nullType).toBe(`Nullable(${type})`);
      expect(Object.values(emitNaive(query.ir).columns).map(print)).toEqual([type, `Nullable(${type})`, type, `Nullable(${type})`]);
      const decode = (v: unknown) => v !== null && /^(U?Int)(64|128|256)$/.test(type) ? BigInt(v as string) : v;
      const expected = [{ value: decode(direct.value), nullable: decode(direct.nullable), excluded: decode(direct.excluded), allNull: null }];
      expect(await client.run(query)).toEqual(expected);
      const rows = []; for await (const row of client.stream(query)) rows.push(row);
      expect(rows).toEqual(expected);
    }
  }
  const probe = JSON.parse(await sql("SELECT argMax(toLowCardinality(toString(number)),number) AS value,toTypeName(value) AS type FROM numbers(3) FORMAT JSONEachRow"));
  expect(probe).toEqual({ value: '2', type: 'String' }); // LC is intentionally rejected, not mislabeled as retained.
  const tied = JSON.parse(await sql("SELECT argMax(if(number=0,'a','b'),toUInt32(1)) AS value FROM numbers(2) FORMAT JSONEachRow"));
  expect(['a', 'b']).toContain(tied.value); // No invented insertion-order tie breaker.
  const tieQuery = source.map(() => ({ values: val(['a', 'b'], col.Array(col.String)) })).arrayJoin(r => r.values, 'item').aggregate(g => argMax(g.item, val(1, col.UInt32)));
  const tiedRows = await client.run(tieQuery);
  expect(tiedRows).toHaveLength(1); expect(['a', 'b']).toContain(tiedRows[0]!.item);
  const tieStream = []; for await (const row of client.stream(tieQuery)) tieStream.push(row);
  expect(tieStream).toHaveLength(1); expect(['a', 'b']).toContain(tieStream[0]!.item);
});
it('adversarial argMax keeps hostile shared/equal parameters isolated across union and scalar scopes', async () => {
  const hostile = "x'); DROP TABLE entity_ots_component; --\\\n\u0000雪";
  const shared = val(hostile, col.String), equal = val(hostile, col.String);
  const source = from(db.entity_ots_component);
  const latest = source.aggregate(g => ({ a: argMax(shared, g.countOfParts), b: argMaxIf(shared, g.countOfParts, g.tenantId.eq('acme')), c: argMax(equal, g.countOfParts) }));
  const combined = unionAll(latest, latest).map(r => ({ ...r, scalar: scalar(source.aggregate(g => argMax(shared, g.countOfParts))) }));
  const compiled = emitNaive(combined.ir);
  expect(compiled.sql).not.toContain(hostile);
  expect(Object.values(compiled.params).filter(v => v === hostile)).toHaveLength(2);
  // Independent hex literal avoids ClickHouse's escaped-text HTTP parameter format.
  const direct = JSON.parse(await sql(`SELECT argMax(unhex('${Buffer.from(hostile).toString('hex')}'),countOfParts) AS value FROM entity_ots_component FORMAT JSONEachRow`)).value;
  expect(direct).toBe(hostile);
  const expected = Array.from({ length: 2 }, () => ({ a: direct, b: direct, c: direct, scalar: direct }));
  expect(await client.run(combined)).toEqual(expected);
  const rows = []; for await (const row of client.stream(combined)) rows.push(row);
  expect(rows).toEqual(expected);
});
it('adversarial argMax orders every supported version width without numeric precision loss', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const cases: [Column<number | bigint>, (number | bigint)[], string][] = [
    [col.UInt8, [0, 255, 1], '255'], [col.UInt16, [0, 65535, 1], '65535'], [col.UInt32, [0, 4294967295, 1], '4294967295'],
    [col.Int8, [-128, -1, -2], '-1'], [col.Int16, [-32768, -1, -2], '-1'], [col.Int32, [-2147483648, -1, -2], '-1'],
    [col.UInt64, [9007199254740992n, 9007199254740993n, 1n], '9007199254740993'],
    [col.UInt128, [1n, (1n << 128n) - 1n, 2n], ((1n << 128n) - 1n).toString()],
    [col.UInt256, [1n, (1n << 256n) - 1n, 2n], ((1n << 256n) - 1n).toString()],
    [col.Int64, [-9007199254740993n, -9007199254740992n, -9007199254740994n], '-9007199254740992'],
    [col.Int128, [-(1n << 127n), -1n, -2n], '-1'], [col.Int256, [-(1n << 255n), -1n, -2n], '-1'],
    [col.Float32, [-Infinity, Infinity, 0], 'inf'], [col.Float64, [-Infinity, Infinity, 0], 'inf'],
  ];
  for (const [descriptor, values, maximum] of cases) {
    const type = print(descriptor.type);
    const q = source.map(() => ({ versions: val(values, col.Array(descriptor)) })).arrayJoin(r => r.versions, 'version')
      .aggregate(g => ({ value: argMax(g.version, g.version), text: argMax(cast(g.version, col.String), g.version) }));
    const literals = values.map(v => `CAST('${String(v)}' AS ${type})`).join(',');
    const direct = JSON.parse(await sql(`SELECT argMax(v,v) AS value,argMax(toString(v),v) AS text,toTypeName(value) AS type FROM (SELECT arrayJoin([${literals}]) AS v) SETTINGS output_format_json_quote_denormals=1 FORMAT JSONEachRow`));
    expect(direct.type).toBe(type); expect(direct.text).toBe(maximum);
    const value = typeof values[0] === 'bigint' ? BigInt(direct.value) : direct.value === 'inf' ? Infinity : direct.value;
    const expected = [{ value, text: maximum }];
    expect(await client.run(q)).toEqual(expected);
    const rows = []; for await (const row of client.stream(q)) rows.push(row);
    expect(rows).toEqual(expected);
    expect(print(q.row.value.ir.type)).toBe(type);
  }
});
it('executes explicit union alignment, grouping and aggregate casts through run and stream', async () => {
  await sql('CREATE TABLE cast_values (`a.b` UInt32, f Float64, text String, n Nullable(UInt32)) ENGINE=Memory');
  await sql("INSERT INTO cast_values VALUES (0,0.5,'7',NULL),(2,2.5,'9',2),(2,2.5,'9',2)");
  const source = from(table('cast_values', { 'a.b': col.UInt32, f: col.Float64, text: col.String, n: col.Nullable(col.UInt32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const direct = async (query: string) => (await sql(query + ' FORMAT JSONEachRow')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  const small = source.map(r => ({ value: r['a.b'] }));
  const wide = source.map(r => ({ value: r.f }));
  expect(() => unionAll(small, wide)).toThrow('union_descriptor_mismatch');
  const aligned = unionAll(small.map(r => cast(r.value, col.Float64)), wide);
  const grouped = aligned.where(r => cast(r.value, col.Bool)).groupBy(r => cast(r.value, col.String)).aggregate(g => ({ total: cast(count(), col.Float64) }))
    .orderBy(r => r.value.desc()).orderBy(r => cast(r.value, col.Float64));
  const expected = await direct('SELECT key AS value,total FROM (SELECT CAST(value AS String) AS key,CAST(count() AS Float64) AS total FROM (SELECT CAST(`a.b` AS Float64) AS value FROM cast_values UNION ALL SELECT f AS value FROM cast_values) WHERE CAST(value AS Bool) GROUP BY CAST(value AS String)) ORDER BY CAST(key AS Float64)');
  expect(await client.run(grouped)).toEqual(expected);
  const streamed = []; for await (const row of client.stream(grouped)) streamed.push(row);
  expect(streamed).toEqual(expected);
  const aggregates = source.aggregate(g => ({ before: sum(cast(g['a.b'], col.Float64)), after: cast(sum(g['a.b']), col.Float64).plus(1) }));
  expect(await client.run(aggregates)).toEqual(await direct('SELECT sum(CAST(`a.b` AS Float64)) AS before,CAST(sum(`a.b`) AS Float64)+1 AS after FROM cast_values'));
  const set = source.map(r => cast(r.text, col.UInt64));
  const composed = source.map(r => ({ value: cast(r.text, col.UInt64), member: cast(r.text, col.UInt64).in(set), total: cast(scalar(source.aggregate(() => cast(count(), col.Float64))), col.Nullable(col.String)) })).orderBy(r => r.value);
  const baseline = await direct('SELECT CAST(text AS UInt64) AS value,CAST(text AS UInt64) IN (SELECT CAST(text AS UInt64) FROM cast_values) AS member,CAST((SELECT CAST(count() AS Float64) FROM cast_values) AS Nullable(String)) AS total FROM cast_values ORDER BY value');
  expect(await client.run(composed)).toEqual(baseline.map(r => ({ ...r, value: BigInt(r.value as string), member: Boolean(r.member) })));
  const converted = source.map(r => ({ text: cast(r['a.b'], col.String), n: cast(r.n, col.Nullable(col.Float64)) })).orderBy(r => r.text);
  const convertedDirect = await direct('SELECT CAST(`a.b` AS String) AS text,CAST(n AS Nullable(Float64)) AS n FROM cast_values ORDER BY text');
  expect(await client.run(converted)).toEqual(convertedDirect);
  const convertedStream = []; for await (const row of client.stream(converted)) convertedStream.push(row);
  expect(convertedStream).toEqual(convertedDirect);
  expect(await client.run(source.limit(0).map(r => cast(r.n, col.Nullable(col.Float64))))).toEqual([]);
});
it('matches cast descriptors and values under both cast_keep_nullable settings, including failures', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const descriptors: Column[] = [col.UInt8, col.UInt16, col.UInt32, col.UInt64, col.UInt128, col.UInt256, col.Int8, col.Int16, col.Int32, col.Int64, col.Int128, col.Int256, col.Float32, col.Float64, col.String, col.Bool];
  for (const setting of [0, 1] as const) {
    const configured = createClient({ url, username: 'fixture', password: 'fixture', clickhouse_settings: { cast_keep_nullable: setting } });
    try {
      for (const descriptor of descriptors) {
        const text = descriptor === col.Bool ? 'true' : '7';
        const query = source.map(() => ({ value: cast(val(text, col.String), descriptor), nullable: cast(val(null, col.Nullable(col.String)), col.Nullable(descriptor)) }));
        const type = print(descriptor.type);
        const direct = JSON.parse(await sql(`SELECT CAST('${text}' AS ${type}) AS value,CAST(NULL AS Nullable(${type})) AS nullable,toTypeName(CAST('${text}' AS ${type})) AS type,toTypeName(CAST(NULL AS Nullable(${type}))) AS nullableType SETTINGS cast_keep_nullable=${setting} FORMAT JSONEachRow`)) as { value: unknown; nullable: null; type: string; nullableType: string };
        expect(direct.type).toBe(type); expect(direct.nullableType).toBe(`Nullable(${type})`);
        const value = /^(U?Int)(64|128|256)$/.test(type) ? BigInt(direct.value as string) : direct.value;
        expect(await configured.run(query)).toEqual([{ value, nullable: null }]);
        const rows = []; for await (const row of configured.stream(query)) rows.push(row);
        expect(rows).toEqual([{ value, nullable: null }]);
      }
      const shared = val("hostile'\\\n{p77:String}", col.String);
      const hostile = source.map(() => ({ a: cast(shared, col.String), b: cast(shared, col.Nullable(col.String)), c: cast(val("hostile'\\\n{p77:String}", col.String), col.String), empty: cast(val('', col.String), col.String) }));
      expect(Object.keys(emitNaive(hostile.ir).params)).toHaveLength(3);
      expect(await configured.run(hostile)).toEqual([{ a: "hostile'\\\n{p77:String}", b: "hostile'\\\n{p77:String}", c: "hostile'\\\n{p77:String}", empty: '' }]);
      for (const bad of ['not-a-number', '']) {
        const invalid = source.map(() => ({ value: cast(val(bad, col.String), col.UInt64) }));
        await expect(configured.run(invalid)).rejects.toBeInstanceOf(QueryError);
        await expect((async () => { for await (const _row of configured.stream(invalid)) { /* must throw */ } })()).rejects.toBeInstanceOf(QueryError);
      }
      // Non-NULL Nullable operands must also stay Nullable, independent of server configuration.
      const nullable = source.map(() => ({ value: cast(val(7, col.Nullable(col.UInt32)), col.Nullable(col.Float64)) }));
      expect(await configured.run(nullable)).toEqual([{ value: 7 }]);
    } finally { await configured.close(); }
  }
});
it('adversarial casts preserve server rounding, overflow, non-finite and wide integer semantics', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const query = source.map(() => ({
    overflow: cast(val(257, col.UInt32), col.UInt8),
    negative: cast(val(-1, col.Int32), col.UInt8),
    fractional: cast(val(-2.75), col.Int32),
    rounded: cast(val(16777217), col.Float32),
    huge: cast(val('115792089237316195423570985008687907853269984665640564039457584007913129639935', col.String), col.UInt256),
    signed: cast(val('-170141183460469231731687303715884105728', col.String), col.Int128),
    nan: cast(val('nan', col.String), col.Float64),
    infinity: cast(val('-inf', col.String), col.Float32),
    bool: cast(val(-2), col.Bool),
    boolText: cast(val(false), col.String),
  }));
  const direct = JSON.parse(await sql(`SELECT CAST(toUInt32(257) AS UInt8) AS overflow,CAST(toInt32(-1) AS UInt8) AS negative,CAST(toFloat64(-2.75) AS Int32) AS fractional,CAST(toFloat64(16777217) AS Float32) AS rounded,CAST('115792089237316195423570985008687907853269984665640564039457584007913129639935' AS UInt256) AS huge,CAST('-170141183460469231731687303715884105728' AS Int128) AS signed,CAST('nan' AS Float64) AS nan,CAST('-inf' AS Float32) AS infinity,CAST(toFloat64(-2) AS Bool) AS bool,CAST(false AS String) AS boolText SETTINGS output_format_json_quote_denormals=1,output_format_json_quote_64bit_integers=1 FORMAT JSONEachRow`));
  expect(direct.nan).toBe('nan'); expect(direct.infinity).toBe('-inf');
  const expected = [{ ...direct, huge: BigInt(direct.huge), signed: BigInt(direct.signed), nan: NaN, infinity: -Infinity }];
  expect(await client.run(query)).toEqual(expected);
  const rows = []; for await (const row of client.stream(query)) rows.push(row);
  expect(rows).toEqual(expected);
});
it('adversarial cast composition preserves shared hostile Params through union, expansion, fences and scalar sets', async () => {
  const hostile = "7'\\\n{p99:String}\0";
  const shared = val(hostile, col.String);
  const source = from(db.entity_ots_component).orderBy(r => r.entityId).limit(1);
  const branch = source.map(() => ({ values: val([0, 2, 2], col.Array(col.UInt32)), text: cast(shared, col.String) })).arrayJoin(r => r.values, 'item')
    .map(r => ({ value: cast(r.item, col.Float64), text: r.text })).orderBy(r => r.value).materialize();
  const combined = unionAll(branch, branch.limit(1)).materialize();
  const set = combined.map(r => cast(r.value, col.UInt64));
  const query = combined.map(r => ({
    text: cast(r.text, col.Nullable(col.String)), equal: cast(val(hostile, col.String), col.String),
    value: cast(r.value, col.UInt64), member: cast(cast(r.value, col.UInt64).in(set), col.String),
    total: cast(scalar(combined.aggregate(g => sum(cast(g.value, col.UInt64)))), col.Nullable(col.String)),
  })).orderBy(r => r.value);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const plan = emitNaive(query.ir);
    expect(plan.sql).not.toContain(hostile);
    expect(Object.values(plan.params).filter(v => v === hostile)).toHaveLength(2);
    expect([...new Set([...plan.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))]).toEqual(Object.keys(plan.params));
    const literal = `unhex('${Buffer.from(hostile).toString('hex')}')`;
    const baseline = (await sql(`SELECT CAST(${literal} AS Nullable(String)) AS text,${literal} AS equal,CAST(n AS UInt64) AS value,CAST(n IN (0,2) AS String) AS member,CAST(4 AS Nullable(String)) AS total FROM (SELECT arrayJoin([0,2,2,0]) AS n) ORDER BY value FORMAT JSONEachRow`)).trim().split('\n').map(line => JSON.parse(line) as { value: string });
    const expected = baseline.map(row => ({ ...row, value: BigInt(row.value) }));
    expect(await client.run(query)).toEqual(expected);
    const rows = []; for await (const row of client.stream(query)) rows.push(row);
    expect(rows).toEqual(expected);
  } finally { warn.mockRestore(); }
});
it('adversarial fences preserve hostile Param transport, identity and client compile memoization', async () => {
  const hostile = "t0`'\\\n{p77:Array(String)} --";
  const shared = val(hostile, col.String);
  const source = from(db.entity_ots_component).orderBy(r => r.entityId).limit(1);
  const fenced = source.map(() => ({ ['t0']: shared, values: val([hostile, hostile, 'safe'], col.Array(col.String)) })).materialize();
  const expanded = unionAll(fenced, fenced).materialize().arrayJoin(r => r.values, 'item').materialize();
  const query = expanded.map(r => ({ value: r.item, shared, equal: val(hostile, col.String), matched: r.item.eq(r.t0) })).orderBy(r => r.value);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const plan = emitNaive(query.ir);
    expect(plan.sql).not.toContain(hostile);
    expect(Object.values(plan.params).filter(v => v === hostile)).toHaveLength(2);
    expect([...new Set([...plan.sql.matchAll(/\{(p\d+):/g)].map(m => m[1]))]).toEqual(Object.keys(plan.params));
    expect(warn).toHaveBeenCalledTimes(3);
    const literal = `unhex('${Buffer.from(hostile).toString('hex')}')`;
    const direct = (await sql(`SELECT item AS value,${literal} AS shared,${literal} AS equal,item=${literal} AS matched FROM (SELECT arrayJoin([${literal},${literal},'safe',${literal},${literal},'safe']) AS item) ORDER BY value FORMAT JSONEachRow`)).trim().split('\n').map(line => JSON.parse(line) as { value: string; shared: string; equal: string; matched: number });
    const expected = direct.map(r => ({ ...r, matched: Boolean(r.matched) }));
    expect(await client.run(query)).toEqual(expected);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(await client.run(query)).toEqual(expected);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(query.toSQL()).toEqual(plan);
    expect(warn).toHaveBeenCalledTimes(9);
  } finally { warn.mockRestore(); }
});
it('adversarial fences keep DISTINCT union boundaries and branch-local offset before inner joins', async () => {
  const source = from(db.entity_ots_component).map(r => ({ id: r.entityId, category: r.category }));
  const branch = source.orderBy(r => r.id.desc()).limit(2, 1).materialize();
  const all = unionAll(branch, branch);
  if (all.ir.kind !== 'Union') throw new Error('expected Union');
  const unique = new Query<{ id: string; category: string | null }>(relNode({ kind: 'Union', inputs: all.ir.inputs, output: all.ir.output, all: false }), all.caps).materialize();
  const joined = join({ t0: unique, t1: unique }).on(r => r.t0.id.eq(r.t1.id)).materialize()
    .map(r => ({ id: r.t0.id, category: r.t1.category })).orderBy(r => r.id);
  const direct = (await sql("WITH chosen AS (SELECT entityId AS id,category FROM entity_ots_component ORDER BY id DESC LIMIT 2 OFFSET 1), u AS (SELECT * FROM chosen UNION DISTINCT SELECT * FROM chosen) SELECT a.id AS id,b.category AS category FROM u a INNER ALL JOIN u b ON a.id=b.id ORDER BY id FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as { id: string; category: string | null });
  expect(await client.run(joined)).toEqual(direct);
  expect(await client.run(joined)).toEqual([{ id: 'a', category: null }, { id: 'b', category: 'hidden' }]);
});
it('executes composable materialize fences, nested arrays, sets and scalar totals against direct SQL', async () => {
  await sql('CREATE TABLE t0 (`__chql_input` String, `a.b` Nullable(String), `__proto__` Array(String)) ENGINE=Memory');
  await sql("INSERT INTO t0 VALUES ('a',NULL,['x','x']),('b','yes',[]),('c','yes',['y'])");
  const source = from(table('t0', { __chql_input: col.String, 'a.b': col.Nullable(col.String), ['__proto__']: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const direct = async (text: string) => (await sql(text + ' FORMAT JSONEachRow')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  const componentParts = source.leftArrayJoin(r => r.__proto__, 'partId');
  const fenced = componentParts.materialize();
  const projected = fenced.materialize().where(r => r.partId.notEmpty()).map(r => ({ id: r.__chql_input, partId: r.partId, value: r['a.b'] })).orderBy(r => r.id).thenBy(r => r.partId).limit(3);
  expect(await client.run(projected)).toEqual(await direct('SELECT __chql_input AS id,partId,`a.b` AS value FROM t0 LEFT ARRAY JOIN `__proto__` AS partId WHERE notEmpty(partId) ORDER BY id,partId LIMIT 3'));
  const grouped = fenced.groupBy(r => r.partId).aggregate(() => count()).orderBy(r => r.partId);
  expect(await client.run(grouped)).toEqual((await direct('SELECT partId,count() AS count FROM t0 LEFT ARRAY JOIN `__proto__` AS partId GROUP BY partId ORDER BY partId')).map(r => ({ ...r, count: BigInt(r.count as string) })));
  const limited = source.orderBy(r => r.__chql_input.desc()).limit(2).materialize().map(r => ({ id: r.__chql_input })).orderBy(r => r.id);
  expect(await client.run(limited)).toEqual(await direct('SELECT __chql_input AS id FROM (SELECT * FROM t0 ORDER BY __chql_input DESC LIMIT 2) ORDER BY id'));
  const ids = unionAll(source.map(r => r.__chql_input).materialize(), source.limit(0).map(r => r.__chql_input)).materialize();
  const query = source.materialize().where(r => r.__chql_input.in(ids)).map(r => ({ id: r.__chql_input, total: scalar(fenced.aggregate(() => count())) })).orderBy(r => r.id);
  expect(await client.run(query)).toEqual((await direct('SELECT __chql_input AS id,(SELECT count() FROM t0 LEFT ARRAY JOIN `__proto__`) AS total FROM t0 WHERE __chql_input IN (SELECT __chql_input FROM t0) ORDER BY id')).map(r => ({ ...r, total: BigInt(r.total as string) })));
  const nested = crossJoin({ t0: source.limit(1), __chql_input: source.where(r => r.__chql_input.eq('c')) }).materialize().leftArrayJoin(r => r.t0.__proto__, 'item').materialize();
  const nestedDirect = await direct("SELECT a.__chql_input AS aid,a.`a.b` AS av,a.`__proto__` AS aa,b.__chql_input AS bid,b.`a.b` AS bv,b.`__proto__` AS ba,item FROM (SELECT * FROM t0 LIMIT 1) a CROSS JOIN (SELECT * FROM t0 WHERE __chql_input='c') b LEFT ARRAY JOIN a.`__proto__` AS item");
  expect(await client.run(nested)).toEqual(nestedDirect.map(r => ({ t0: { __chql_input: r.aid, 'a.b': r.av, ['__proto__']: r.aa }, __chql_input: { __chql_input: r.bid, 'a.b': r.bv, ['__proto__']: r.ba }, item: r.item })));
  expect(await client.run(source.limit(0).materialize())).toEqual([]);
  expect(await client.run(fenced.map(r => r.partId).distinct().materialize().orderBy(r => r.partId))).toEqual(await direct('SELECT DISTINCT partId FROM t0 LEFT ARRAY JOIN `__proto__` AS partId ORDER BY partId'));
});
it('adversarial membership composes scalar receivers, grouped sets and post-expansion grouping', async () => {
  const source = from(db.entity_ots_component);
  const hostile = "EOL'\\\n{p77:Array(String)} --";
  const selected = unionAll(source.limit(1).map(() => ({ value: val(hostile, col.String) })), source.limit(1).map(() => ({ value: val(hostile, col.String) })));
  const expanded = source.limit(1).map(() => ({ values: val([hostile, hostile, 'safe'], col.Array(col.String)) })).leftArrayJoin(r => r.values, 'value');
  const grouped = expanded.groupBy(r => ({ member: r.value.in(selected) })).aggregate(g => ({ matches: countIf(g.value.in(selected)), misses: countIf(g.value.notIn(selected)) })).orderBy(r => r.member);
  const literal = `unhex('${Buffer.from(hostile).toString('hex')}')`;
  const baseline = (await sql(`SELECT value IN (SELECT ${literal}) AS member, countIf(value IN (SELECT ${literal})) AS matches, countIf(value NOT IN (SELECT ${literal})) AS misses FROM (SELECT arrayJoin([${literal},${literal},'safe']) AS value) GROUP BY member ORDER BY member FORMAT JSONEachRow`)).trim().split('\n').map(line => JSON.parse(line) as { member: number; matches: string; misses: string });
  expect(await client.run(grouped)).toEqual(baseline.map(r => ({ member: Boolean(r.member), matches: BigInt(r.matches), misses: BigInt(r.misses) })));
  expect(await client.run(grouped)).toEqual([{ member: false, matches: 0n, misses: 1n }, { member: true, matches: 2n, misses: 0n }]);
  expect(emitNaive(grouped.ir).sql).not.toContain(hostile);
  const totals = source.aggregate(() => count());
  const scalarMembership = source.limit(1).map(() => ({ yes: scalar(totals).in(totals), no: scalar(totals).notIn(totals) }));
  expect(await client.run(scalarMembership)).toEqual([{ yes: true, no: false }]);
  const aggregateMembership = source.aggregate(() => ({ yes: count().in(totals), no: count().notIn([]) }));
  expect(await client.run(aggregateMembership)).toEqual([{ yes: true, no: true }]);
});
it('adversarial numeric membership agrees with SQL across compatible descriptors and NULL-only sets', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const sets = unionAll(source.map(() => ({ n: val(-1.5, col.Float64) })), source.map(() => ({ n: val(255, col.Float64) })), source.map(() => ({ n: val(256, col.Float64) })));
  const query = source.map(() => ({ yes: val(255, col.UInt8).in(sets), no: val(0, col.UInt8).notIn(sets) }));
  const direct = JSON.parse((await sql('SELECT toUInt8(255) IN (SELECT arrayJoin([-1.5,255.,256.])) AS yes,toUInt8(0) NOT IN (SELECT arrayJoin([-1.5,255.,256.])) AS no FORMAT JSONEachRow')).trim()) as { yes: number; no: number };
  expect(await client.run(query)).toEqual([{ yes: Boolean(direct.yes), no: Boolean(direct.no) }]);
  const nulls = source.map(() => ({ n: val(null, col.Nullable(col.Int64)) }));
  expect(await client.run(source.map(() => ({ yes: val(0n, col.Int64).in(nulls), no: val(0n, col.Int64).notIn(nulls) })))).toEqual([{ yes: false, no: true }]);
});
it('matches IN and NOT IN truth values and filtered rows for NULL, empty and duplicate sets', async () => {
  await sql('CREATE TABLE membership_values (id String, lifecycleStatus Nullable(String), n Nullable(Int64), b Bool) ENGINE=Memory');
  await sql("INSERT INTO membership_values VALUES ('a',NULL,NULL,false),('b','EOL',7,true),('c','Active',9,false),('d','EOL',7,true)");
  const parts = from(table('membership_values', { id: col.String, lifecycleStatus: col.Nullable(col.String), n: col.Nullable(col.Int64), b: col.Bool }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const direct = async (query: string) => (await sql(query + ' FORMAT JSONEachRow')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  for (const [set, text] of [[parts.map(r => r.lifecycleStatus), 'SELECT lifecycleStatus FROM membership_values'], [parts.where(r => r.id.eq('absent')).map(r => r.lifecycleStatus), "SELECT lifecycleStatus FROM membership_values WHERE id='absent'"], [parts.where(r => r.lifecycleStatus.isNull()).map(r => r.lifecycleStatus), 'SELECT lifecycleStatus FROM membership_values WHERE isNull(lifecycleStatus)']] as const) {
    const result = parts.map(r => ({ id: r.id, yes: r.lifecycleStatus.in(set), no: r.lifecycleStatus.notIn(set) })).orderBy(r => r.id);
    const baseline = await direct(`SELECT id,lifecycleStatus IN (${text}) AS yes,lifecycleStatus NOT IN (${text}) AS no FROM membership_values ORDER BY id`);
    expect(await client.run(result)).toEqual(baseline.map(r => ({ id: r.id, yes: r.yes === null ? null : Boolean(r.yes), no: r.no === null ? null : Boolean(r.no) })));
    for (const negative of [false, true]) {
      const filtered = parts.where(r => negative ? r.lifecycleStatus.notIn(set) : r.lifecycleStatus.in(set)).map(r => r.id).orderBy(r => r.id);
      expect(await client.run(filtered)).toEqual(await direct(`SELECT id FROM membership_values WHERE lifecycleStatus ${negative ? 'NOT IN' : 'IN'} (${text}) ORDER BY id`));
    }
  }
  for (const values of [[], ['EOL', 'EOL']] as const) {
    const list = values.length ? "['EOL','EOL']" : '[]';
    const result = parts.map(r => ({ id: r.id, yes: r.lifecycleStatus.in(values), no: r.lifecycleStatus.notIn(values) })).orderBy(r => r.id);
    const baseline = await direct(`SELECT id,lifecycleStatus IN ${list} AS yes,lifecycleStatus NOT IN ${list} AS no FROM membership_values ORDER BY id`);
    expect(await client.run(result)).toEqual(baseline.map(r => ({ id: r.id, yes: r.yes === null ? null : Boolean(r.yes), no: r.no === null ? null : Boolean(r.no) })));
  }
  const typed = parts.map(r => ({ id: r.id, n: r.n.in([7n]), b: r.b.notIn([true]), empty: r.id.in([]) })).orderBy(r => r.id);
  const baseline = await direct('SELECT id,n IN [7] AS n,b NOT IN [true] AS b,id IN [] AS empty FROM membership_values ORDER BY id');
  expect(await client.run(typed)).toEqual(baseline.map(r => ({ id: r.id, n: r.n === null ? null : Boolean(r.n), b: Boolean(r.b), empty: Boolean(r.empty) })));
  expect(await client.run(parts.aggregate(g => ({ eol: countIf(g.lifecycleStatus.in(['EOL', 'Obsolete'])) })))).toEqual([{ eol: 2n }]);
  expect(await direct("SELECT toTypeName(lifecycleStatus IN ['EOL']) AS n,toTypeName(id IN (SELECT lifecycleStatus FROM membership_values)) AS s FROM membership_values LIMIT 1")).toEqual([{ n: 'Nullable(UInt8)', s: 'UInt8' }]);
});
it('preserves hostile set/list values and shared versus equal parameter identity', async () => {
  const source = from(db.entity_ots_component).limit(1);
  const hostile = "x'\\\\\n{p900:String}`); SELECT 999 --";
  const shared = val(hostile, col.String);
  const set = source.map(() => ({ ['a.b`__proto__']: shared }));
  const query = source.map(() => ({ yes: shared.in(set), no: shared.notIn([hostile, hostile]), equal: val(hostile, col.String).in(set) }));
  const plan = emitNaive(query.ir);
  expect(plan.sql).not.toContain(hostile);
  expect(Object.keys(plan.params)).toHaveLength(3);
  expect(plan.params.p0).toBe(hostile);
  expect(plan.params.p2).toBe(hostile);
  expect(plan.sql.match(/\{p0:String\}/g)).toHaveLength(4);
  expect(await client.run(query)).toEqual([{ yes: true, no: false, equal: true }]);
  const literal = `unhex('${Buffer.from(hostile).toString('hex')}')`;
  const direct = JSON.parse((await sql(`SELECT ${literal} IN (SELECT ${literal} AS \`a.b\`) AS yes, ${literal} NOT IN [${literal},${literal}] AS no FORMAT JSONEachRow`)).trim()) as unknown;
  expect(direct).toEqual({ yes: 1, no: 0 });
  const bigSet = from(db.entity_ots_component).map(r => r.countOfParts).distinct();
  // Object form is required for unnamed constants.
  const boolNamed = source.map(() => ({ b: val(true, col.Bool) }));
  expect(await client.run(source.map(r => ({ big: r.countOfParts.in(bigSet), bool: val(false, col.Bool).notIn(boolNamed) })))).toEqual([{ big: true, bool: true }]);
});
it('executes entityId set examples with UNION, nested dependencies and branch-local limits', async () => {
  const components = from(db.entity_ots_component);
  const cIndices = components.map(r => ({ entityId: r.entityId, stock_index: val(0.25, col.Float64) }));
  const object = components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => ({ id: i.entityId }))));
  const single = components.where(c => c.entityId.in(cIndices.where(i => i.stock_index.lt(0.5)).map(i => i.entityId)));
  expect(await client.run(object.map(r => r.entityId).orderBy(r => r.entityId))).toEqual(await client.run(single.map(r => r.entityId).orderBy(r => r.entityId)));
  expect(await client.run(single.map(r => r.entityId).orderBy(r => r.entityId))).toEqual([{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }]);
  const branch = components.map(r => r.entityId).distinct().orderBy(r => r.entityId).limit(1, 1);
  const set = unionAll(branch, branch, components.where(r => r.entityId.in(branch)).map(r => r.entityId));
  const query = components.where(r => r.entityId.in(set)).map(r => r.entityId);
  const baseline = (await sql('SELECT entityId FROM entity_ots_component WHERE entityId IN (SELECT entityId FROM (SELECT DISTINCT entityId FROM entity_ots_component ORDER BY entityId LIMIT 1 OFFSET 1) UNION ALL SELECT entityId FROM (SELECT DISTINCT entityId FROM entity_ots_component ORDER BY entityId LIMIT 1 OFFSET 1)) FORMAT JSONEachRow')).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(await client.run(query)).toEqual(baseline);
  expect(baseline).toEqual([{ entityId: 'b' }]);
});
it('keeps hostile scalar parameters isolated through UNION, grouping and replaced sorting', async () => {
  const source = from(db.entity_ots_component);
  const hostile = "x'\\\\\n{p900:String}`); SELECT 999 --";
  const shared = val(hostile, col.String);
  const inner = source.map(() => ({ ['__proto__']: shared })).aggregate(g => max(g.__proto__));
  const value = scalar(inner);
  const branch = source.limit(1).map(() => ({ value, shared, equal: val(hostile, col.String) }));
  const combined = unionAll(branch, branch);
  const result = combined.groupBy(r => ({ value: r.value, total: scalar(source.aggregate(() => count())) }))
    .aggregate(() => count()).orderBy(r => r.value).thenBy(r => r.total).orderBy(r => r.count);
  const plan = emitNaive(result.ir);
  expect(plan.sql).not.toContain(hostile);
  expect(plan.params).toEqual({ p0: hostile, p1: hostile });
  expect([...plan.sql.matchAll(/\{(p\d+):String\}/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i)).toEqual(['p0', 'p1']);
  expect(await client.run(branch)).toEqual([{ value: hostile, shared: hostile, equal: hostile }]);
  const direct = JSON.parse((await sql('SELECT (SELECT count() FROM entity_ots_component) AS total, count() AS count FROM (SELECT 1 UNION ALL SELECT 1) GROUP BY total FORMAT JSONEachRow')).trim()) as { total: string; count: string };
  expect(await client.run(result)).toEqual([{ value: hostile, total: BigInt(direct.total), count: BigInt(direct.count) }]);
  expect(direct).toEqual({ total: '3', count: '2' });
});
it('keeps scalar nullable max nulls and zero-denominator nonfinite arithmetic honest', async () => {
  const source = from(db.entity_ots_component);
  const empty = source.where(r => r.tenantId.eq('absent'));
  const total = scalar(empty.aggregate(() => count()));
  const result = source.limit(1).map(() => ({ n: scalar(empty.aggregate(g => max(g.category))), nan: total.divide(total), inf: val(1n).divide(total) }));
  const direct = JSON.parse((await sql("SELECT (SELECT max(category) FROM entity_ots_component WHERE tenantId='absent') AS n, 0/0 AS nan, 1/0 AS inf SETTINGS output_format_json_quote_denormals=1 FORMAT JSONEachRow")).trim()) as unknown;
  expect(direct).toEqual({ n: null, nan: 'nan', inf: 'inf' });
  expect(await client.run(result)).toEqual([{ n: null, nan: NaN, inf: Infinity }]);
  expect(print(emitNaive(result.ir).columns.n!)).toBe('Nullable(String)');
});
it('executes unchanged object and expression stock shares with inline global scalars', async () => {
  await sql('CREATE TABLE scalar_stock (entityId String, version UInt32, stock Float64) ENGINE=Memory');
  await sql("INSERT INTO scalar_stock VALUES ('a',1,10),('a',2,30),('c',1,70),('other',1,999)");
  const metrics = from(table('scalar_stock', { entityId: col.String, version: col.UInt32, stock: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const newest = metrics.groupBy(r => r.entityId).aggregate(g => max(g.version));
  const latest = join({ m: metrics, v: newest }).on(r => [r.m.entityId.eq(r.v.entityId), r.m.version.eq(r.v.version)]).map(r => ({ ...r.m }));
  const scopedLatest = join({ c: from(db.entity_ots_component).where(r => r.tenantId.eq('acme')), a: latest }).on(r => r.c.entityId.eq(r.a.entityId)).map(r => ({ entityId: r.c.entityId, category: r.c.category, stock: r.a.stock }));
  const total = scopedLatest.aggregate(g => ({ stock: sum(g.stock) }));
  const stockShare = scopedLatest.map(r => ({ entityId: r.entityId, stock: r.stock, share: r.stock.divide(scalar(total)).multiply(100) })).orderBy(r => r.entityId);
  const baseline = (await sql("SELECT entityId,stock,stock/(SELECT sum(stock) FROM scalar_stock WHERE (entityId,version) IN (('a',2),('c',1)))*100 AS share FROM scalar_stock WHERE (entityId,version) IN (('a',2),('c',1)) ORDER BY entityId FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(await client.run(stockShare)).toEqual(baseline);
  expect(baseline).toEqual([{ entityId: 'a', stock: 30, share: 30 }, { entityId: 'c', stock: 70, share: 70 }]);
  expect(await client.run(scopedLatest.orderBy(r => r.entityId).map(r => r.stock.divide(scalar(scopedLatest.aggregate(g => sum(g.stock)))).multiply(100)))).toEqual([{ stock: 30 }, { stock: 70 }]);
  expect(await client.run(scopedLatest.where(r => r.stock.lt(scalar(total))).aggregate(() => count()))).toEqual([{ count: 2n }]);
});
it('matches scalar server descriptors and decoding on nonempty, empty and all-null aggregates', async () => {
  await sql('CREATE TABLE scalar_values (n Nullable(Int64), f Float64) ENGINE=Memory');
  await sql('INSERT INTO scalar_values VALUES (7,1.5),(NULL,2.5),(-2,3)');
  const source = from(table('scalar_values', { n: col.Nullable(col.Int64), f: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  for (const [input, condition] of [[source, '1'], [source.where(r => r.f.lt(0)), 'f<0'], [source.where(r => r.n.isNull()), 'isNull(n)']] as const) {
    const values = source.limit(1).map(() => ({ ['__proto__']: scalar(input.aggregate(() => count())), ['s.dot`']: scalar(input.aggregate(g => sum(g.n))), f: scalar(input.aggregate(g => sum(g.f))) }));
    const direct = JSON.parse((await sql(`SELECT (SELECT count() FROM scalar_values WHERE ${condition}) AS c,(SELECT sum(n) FROM scalar_values WHERE ${condition}) AS n,(SELECT sum(f) FROM scalar_values WHERE ${condition}) AS f FORMAT JSONEachRow`)).trim()) as { c: string; n: string | null; f: number };
    expect(await client.run(values)).toEqual([{ ['__proto__']: BigInt(direct.c), ['s.dot`']: direct.n === null ? null : BigInt(direct.n), f: direct.f }]);
    const types = JSON.parse((await sql(`SELECT toTypeName((SELECT count() FROM scalar_values WHERE ${condition})) AS c,toTypeName((SELECT sum(n) FROM scalar_values WHERE ${condition})) AS n,toTypeName((SELECT sum(f) FROM scalar_values WHERE ${condition})) AS f FORMAT JSONEachRow`)).trim()) as Record<string, string>;
    const columns = emitNaive(values.ir).columns;
    expect([print(columns.__proto__!), print(columns['s.dot`']!), print(columns.f!)]).toEqual([types.c, types.n, types.f]);
    expect(types).toEqual({ c: 'Nullable(UInt64)', n: 'Nullable(Int64)', f: 'Nullable(Float64)' });
  }
});
it('preserves supported String and Bool scalar descriptors on empty and nonempty inputs', async () => {
  await sql('CREATE TABLE scalar_text (s String, b Bool) ENGINE=Memory');
  await sql("INSERT INTO scalar_text VALUES ('a',false),('z',true)");
  const source = from(table('scalar_text', { s: col.String, b: col.Bool }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  for (const [input, condition] of [[source, '1'], [source.where(r => r.s.eq('missing')), '0']] as const) {
    const result = source.limit(1).map(() => ({ s: scalar(input.aggregate(g => max(g.s))), b: scalar(input.aggregate(g => max(g.b))) }));
    const direct = JSON.parse((await sql(`SELECT (SELECT max(s) FROM scalar_text WHERE ${condition}) AS s,(SELECT max(b) FROM scalar_text WHERE ${condition}) AS b FORMAT JSONEachRow`)).trim()) as unknown;
    expect(await client.run(result)).toEqual([direct]);
    const types = JSON.parse((await sql(`SELECT toTypeName((SELECT max(s) FROM scalar_text WHERE ${condition})) AS s,toTypeName((SELECT max(b) FROM scalar_text WHERE ${condition})) AS b FORMAT JSONEachRow`)).trim()) as unknown;
    const columns = emitNaive(result.ir).columns;
    expect(types).toEqual({ s: print(columns.s!), b: print(columns.b!) });
    expect(types).toEqual({ s: 'Nullable(String)', b: 'Nullable(Bool)' });
  }
});
it('executes nested scalar dependencies with shared and equal parameter identities', async () => {
  const source = from(db.entity_ots_component);
  const shared = val('acme', col.String);
  const scoped = source.where(r => r.tenantId.eq(shared));
  const inner = scoped.aggregate(() => count());
  const intermediate = scoped.map(() => scalar(inner));
  const outer = intermediate.aggregate(g => sum(g.count));
  const result = scoped.limit(1).map(() => ({ total: scalar(outer), shared, equal: val('acme', col.String) }));
  const plan = emitNaive(result.ir);
  expect(plan.params).toEqual({ p0: 'acme', p1: 'acme' });
  const direct = JSON.parse((await sql("SELECT (SELECT sum(n) FROM (SELECT (SELECT count() FROM entity_ots_component WHERE tenantId='acme') AS n FROM entity_ots_component WHERE tenantId='acme')) AS total FORMAT JSONEachRow")).trim()) as { total: string };
  expect(await client.run(result)).toEqual([{ total: BigInt(direct.total), shared: 'acme', equal: 'acme' }]);
  expect(direct.total).toBe('4');
});
it('keeps nested ALL and DISTINCT boundaries, offsets and post-union expansion under joins', async () => {
  await sql('CREATE TABLE union_adversarial (id UInt32, xs Array(Nullable(Int32))) ENGINE=Memory');
  await sql('INSERT INTO union_adversarial VALUES (1,[NULL,7,7]),(1,[NULL,7,7]),(2,[]),(3,[9])');
  const q = from(table('union_adversarial', { id: col.UInt32, xs: col.Array(col.Nullable(col.Int32)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const branch = q.distinct().orderBy(r => r.id).limit(2, 1);
  const inner = unionAll(q, branch);
  const distinct = new Query<{ id: number; xs: (number | null)[] }>(relNode({ kind: 'Union', inputs: [inner.ir, q.ir], all: false, output: q.ir.output }), { live: false });
  const bag = unionAll(inner, distinct).leftArrayJoin(r => r.xs, 'item');
  const joined = join({ a: bag, b: q }).on(r => r.a.id.eq(r.b.id))
    .groupBy(r => ({ id: r.a.id, item: r.a.item })).aggregate(() => count())
    .orderBy(r => r.id).thenBy(r => r.item.asc().nullsFirst());
  const direct = (await sql(`SELECT a.id AS id,a.item AS item,count() AS count FROM
    (SELECT id,xs,item FROM (
      SELECT id,xs FROM (SELECT id,xs FROM union_adversarial UNION ALL SELECT id,xs FROM (SELECT DISTINCT id,xs FROM union_adversarial ORDER BY id LIMIT 2 OFFSET 1))
      UNION ALL SELECT id,xs FROM (SELECT id,xs FROM union_adversarial UNION DISTINCT SELECT id,xs FROM union_adversarial)
    ) LEFT ARRAY JOIN xs AS item) AS a
    INNER ALL JOIN union_adversarial AS b ON a.id=b.id
    GROUP BY a.id,a.item ORDER BY id,item NULLS FIRST FORMAT JSONEachRow`)).trim().split('\n').map(line => {
      const row = JSON.parse(line) as { id: number; item: number | null; count: string };
      return { ...row, count: BigInt(row.count) };
    });
  expect(await client.run(joined)).toEqual(direct);
  expect(direct).toEqual([{ id: 1, item: null, count: 6n }, { id: 1, item: 7, count: 12n }, { id: 2, item: null, count: 3n }, { id: 3, item: 9, count: 3n }]);
});
it('transports hostile shared and equal Params through nested union projection and filtering', async () => {
  const payload = "x'\\\\`); SELECT 999 --\n{p99:String}";
  const shared = val(payload, col.String);
  const source = from(db.entity_ots_component).limit(1);
  const a = source.map(() => ({ ['__proto__']: shared, ['a.b']: val([payload, ''], col.Array(col.String)) }));
  const b = source.map(() => ({ ['a.b']: val([payload, ''], col.Array(col.String)), ['__proto__']: val(payload, col.String) }));
  const united = unionAll(unionAll(a, b), a).where(r => r.__proto__.eq(shared));
  const plan = emitNaive(united.ir);
  expect(plan.sql).not.toContain(payload);
  expect(plan.params).toEqual({ p0: payload, p1: plan.params.p1, p2: plan.params.p1, p3: payload });
  expect(plan.sql.match(/\{p0:String\}/g)).toHaveLength(3);
  const rows = await client.run(united);
  expect(rows).toEqual(Array.from({ length: 3 }, () => ({ ['__proto__']: payload, ['a.b']: [payload, ''] })));
  expect(rows.every(row => Object.hasOwn(row, '__proto__'))).toBe(true);
});
it('runs the unchanged component/part union example with bag semantics and branch boundaries', async () => {
  await sql('CREATE TABLE entity_off_the_shelf_part (entityId String) ENGINE=Memory');
  await sql("INSERT INTO entity_off_the_shelf_part VALUES ('p1'),('p1'),('p2')");
  const components = from(db.entity_ots_component);
  // This independent fixture only needs entityId for the unchanged projection.
  const parts = from(table('entity_off_the_shelf_part', { entityId: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const example = unionAll(
    components.map(c => ({ entityId: c.entityId, kind: val('component', col.String) })),
    parts.map(p => ({ entityId: p.entityId, kind: val('part', col.String) })),
  );
  const partRows = parts;
  const baseline = (await sql("SELECT entityId,kind FROM (SELECT entityId,'component' AS kind FROM entity_ots_component UNION ALL SELECT entityId,'part' AS kind FROM entity_off_the_shelf_part) ORDER BY entityId,kind FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(await client.run(example.orderBy(r => r.entityId).thenBy(r => r.kind))).toEqual(baseline);
  expect(baseline).toHaveLength(6);
  const branch = partRows.orderBy(r => r.entityId.desc()).limit(1);
  const bag = unionAll(branch, partRows.limit(0), branch, partRows);
  expect(await client.run(bag.groupBy(r => r.entityId).aggregate(() => count()).orderBy(r => r.entityId))).toEqual([{ entityId: 'p1', count: 2n }, { entityId: 'p2', count: 3n }]);
  expect(await client.run(bag.where(r => r.entityId.eq('p2')).map(r => ({ id: r.entityId })).distinct().orderBy(r => r.id).limit(1))).toEqual([{ id: 'p2' }]);
  const distinctIR = relNode({ kind: 'Union', inputs: [partRows.ir, partRows.ir], all: false, output: partRows.ir.output });
  expect(await client.run(new Query<{ entityId: string }>(distinctIR, { live: false }).orderBy(r => r.entityId))).toEqual([{ entityId: 'p1' }, { entityId: 'p2' }]);
  expect(await client.run(unionAll(partRows.limit(0), partRows.limit(0)))).toEqual([]);
});
it('aligns reversed fields and decodes nullable bigint timestamps arrays and tuples across unions', async () => {
  await sql('CREATE TABLE union_values (id UInt32,n Nullable(Int64),at DateTime64(3),xs Array(Nullable(Int64)),pair Tuple(label String,n UInt64)) ENGINE=Memory');
  await sql("INSERT INTO union_values VALUES (1,NULL,'2026-10-27 12:00:00.123',[NULL,7],('x',18446744073709551615)),(2,-7,'1970-01-01 00:00:00',[],('',0))");
  const side = from(table('union_values', { id: col.UInt32, n: col.Nullable(col.Int64), at: col.DateTime64(3), xs: col.Array(col.Nullable(col.Int64)), pair: col.Tuple({ label: col.String, n: col.UInt64 }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const a = side.map(r => ({ id: r.id, n: r.n, at: r.at, xs: r.xs, pair: r.pair }));
  const b = side.map(r => ({ pair: r.pair, xs: r.xs, at: r.at, n: r.n, id: r.id }));
  const rows = await client.run(unionAll(a, b).orderBy(r => r.id));
  const direct = (await sql("SELECT id,n,at,xs,pair FROM (SELECT id,n,at,xs,pair FROM union_values UNION ALL SELECT id,n,at,xs,pair FROM union_values) ORDER BY id SETTINGS date_time_output_format='iso',output_format_json_quote_64bit_integers=1 FORMAT JSONEachRow")).trim().split('\n').map(line => {
    const r = JSON.parse(line) as { id: number; n: string | null; at: string; xs: (string | null)[]; pair: { label: string; n: string } };
    return { ...r, n: r.n === null ? null : BigInt(r.n), at: new Date(r.at), xs: r.xs.map(n => n === null ? null : BigInt(n)), pair: { ...r.pair, n: BigInt(r.pair.n) } };
  });
  expect(rows).toEqual(direct);
  expect(rows).toHaveLength(4);
  expect(rows[0]?.pair.n).toBe(18446744073709551615n);
  const nestedA = crossJoin({ ['__proto__']: side, 'b.dot': side }).leftArrayJoin(r => r.__proto__.xs, '__chql_leaf_0');
  const nestedB = crossJoin({ 'b.dot': side, ['__proto__']: side }).leftArrayJoin(r => r.__proto__.xs, '__chql_leaf_0');
  const nested = unionAll(nestedA, nestedB).where(r => r.__proto__.id.eq(1).and(r['b.dot'].id.eq(2))).orderBy(r => r.__chql_leaf_0.asc().nullsFirst());
  const decoded = await client.run(nested);
  const expected = (await client.run(nestedA.where(r => r.__proto__.id.eq(1).and(r['b.dot'].id.eq(2))).orderBy(r => r.__chql_leaf_0.asc().nullsFirst())));
  expect(decoded).toEqual(expected.flatMap(row => [row, row]));
  expect(decoded).toHaveLength(4);
  expect(Object.hasOwn(decoded[0]!, '__proto__')).toBe(true);
  expect(await client.run(unionAll(nestedA, nestedB).aggregate(() => count()))).toEqual([{ count: 12n }]);
});
it('executes ordered Cartesian products, nested joins and empty sides without null extension', async () => {
  const source = from(db.entity_ots_component).where(r => r.tenantId.eq('acme'));
  const product = crossJoin({ a: source, b: source, c: source });
  expect(await client.run(product.aggregate(() => count()))).toEqual([{ count: 8n }]);
  const flat = product.map(r => ({ a: r.a.entityId, b: r.b.entityId, c: r.c.entityId })).orderBy(r => r.a).thenBy(r => r.b).thenBy(r => r.c);
  const baseline = (await sql("SELECT a.entityId AS a,b.entityId AS b,c.entityId AS c FROM entity_ots_component a CROSS JOIN entity_ots_component b CROSS JOIN entity_ots_component c WHERE a.tenantId='acme' AND b.tenantId='acme' AND c.tenantId='acme' ORDER BY a,b,c FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(await client.run(flat)).toEqual(baseline);
  const direct = await client.run(crossJoin({ a: source, b: source }).orderBy(r => r.a.entityId).thenBy(r => r.b.entityId));
  const originals = await client.run(source.orderBy(r => r.entityId));
  expect(direct).toEqual(originals.flatMap(a => originals.map(b => ({ a, b }))));
  expect(await client.run(crossJoin({ a: source.limit(0), b: source }))).toEqual([]);
  expect(await client.run(crossJoin({ a: source, b: source.limit(0) }))).toEqual([]);
  const duplicate = source.map(() => ({ n: val(1, col.UInt32), nullable: val(null, col.Nullable(col.String)) }));
  expect(await client.run(crossJoin({ a: duplicate, b: duplicate }).aggregate(() => count()))).toEqual([{ count: 4n }]);
  expect(await client.run(crossJoin({ a: duplicate, b: duplicate }).distinct().map(r => ({ ...r.a })))).toEqual([{ n: 1, nullable: null }]);
  const nested = crossJoin({ ab: join({ a: source, b: source }).on(r => r.a.entityId.eq(r.b.entityId)), c: source });
  expect(await client.run(nested.where(r => r.ab.a.entityId.eq('a')).groupBy(r => r.c.category).aggregate(() => count()).orderBy(r => r.category.asc().nullsFirst()))).toEqual([{ category: null, count: 1n }, { category: 'visible', count: 1n }]);
  expect(await client.run(join({ ab: crossJoin({ a: source, b: source }), c: source }).on(r => r.ab.a.entityId.eq(r.c.entityId)).limit(1).map(r => ({ ...r.c })))).toHaveLength(1);
});
it('composes Cartesian products with repeated nullable LEFT expansion and hostile nested paths', async () => {
  await sql('CREATE TABLE cross_expansion_probe (id UInt32, xs Array(Nullable(Int32))) ENGINE=Memory');
  await sql('INSERT INTO cross_expansion_probe VALUES (1,[NULL,7,7]),(2,[])');
  const side = from(table('cross_expansion_probe', { id: col.UInt32, xs: col.Array(col.Nullable(col.Int32)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const expanded = crossJoin({ ['__proto__']: side, '__chql_leaf_0': side })
    .leftArrayJoin(r => r.__proto__.xs, 'x')
    .leftArrayJoin(r => r.__chql_leaf_0.xs, 'y');
  const ordered = expanded.map(r => ({ a: r.__proto__.id, b: r.__chql_leaf_0.id, x: r.x, y: r.y }))
    .orderBy(r => r.a).thenBy(r => r.b).thenBy(r => r.x.asc().nullsFirst()).thenBy(r => r.y.asc().nullsFirst());
  const baseline = (await sql('SELECT a.id AS a,b.id AS b,a.x AS x,b.y AS y FROM (SELECT id,arrayJoin(emptyArrayToSingle(xs)) AS x FROM cross_expansion_probe) a CROSS JOIN (SELECT id,arrayJoin(emptyArrayToSingle(xs)) AS y FROM cross_expansion_probe) b ORDER BY a,b,x NULLS FIRST,y NULLS FIRST FORMAT JSONEachRow')).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(baseline).toHaveLength(16);
  expect(await client.run(ordered)).toEqual(baseline);
  expect(await client.run(expanded.aggregate(() => count()))).toEqual([{ count: 16n }]);
  const empty = await client.run(expanded.where(r => r.__proto__.id.eq(2).and(r.__chql_leaf_0.id.eq(2))));
  expect(empty).toEqual([{ ['__proto__']: { id: 2, xs: [] }, __chql_leaf_0: { id: 2, xs: [] }, x: null, y: null }]);
  expect(Object.hasOwn(empty[0]!, '__proto__')).toBe(true);
  const nested = crossJoin({ nested: expanded, other: side.limit(0) });
  expect(await client.run(nested)).toEqual([]);
});
it.each(['RIGHT', 'FULL'])('independently checks %s ALL structured defaults under join_use_nulls', async kind => {
  const rows = (await sql(`SELECT l.id AS l,r.id AS r,l.arr AS la,r.arr AS ra FROM (SELECT 1 AS id,[7] AS arr) l ${kind} ALL JOIN (SELECT 2 AS id,[8] AS arr) r ON l.id=r.id ORDER BY r NULLS FIRST SETTINGS join_use_nulls=1 FORMAT JSONEachRow`)).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(rows).toEqual(kind === 'RIGHT' ? [{ l: null, r: 2, la: [], ra: [8] }] : [{ l: 1, r: null, la: [7], ra: [] }, { l: null, r: 2, la: [], ra: [8] }]);
});
it('records actual outer-join structured defaults instead of promising Nullable containers', async () => {
  const query = "SELECT r.arr AS arr,r.tup AS tup,r.mp AS mp,toTypeName(r.arr) AS arrType,toTypeName(r.tup) AS tupType,toTypeName(r.mp) AS mapType,r.id AS id FROM (SELECT 1 AS id) l LEFT ALL JOIN (SELECT 2 AS id,[7] AS arr,tuple('x',7) AS tup,map('x',7) AS mp) r ON l.id=r.id SETTINGS join_use_nulls=1 FORMAT JSONEachRow";
  expect(JSON.parse(await sql(query))).toEqual({ arr: [], tup: ['', 0], mp: {}, arrType: 'Array(UInt8)', tupType: 'Tuple(String, UInt8)', mapType: 'Map(String, UInt8)', id: null });
  for (const type of ['Array(UInt8)', 'Tuple(String, UInt8)', 'Map(String, UInt8)']) {
    await expect(sql(`SELECT CAST(NULL AS Nullable(${type}))`)).rejects.toThrow('cannot be inside Nullable type');
  }
});
it('executes inner ALL self/three-way/nested joins with residuals, nullable keys and empty inputs', async () => {
  await sql('CREATE TABLE inner_probe (tenantId String, id UInt32, key Nullable(UInt32), labels Array(String)) ENGINE=Memory');
  await sql("INSERT INTO inner_probe VALUES ('acme',1,7,['a']),('acme',2,7,['b']),('acme',3,NULL,[]),('other',4,7,['secret'])");
  const source = from(table('inner_probe', { tenantId: col.String, id: col.UInt32, key: col.Nullable(col.UInt32), labels: col.Array(col.String) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const q = source.where(r => r.tenantId.eq('acme'));
  const both = join({ a: q, b: q }).on(r => r.a.key.eq(r.b.key));
  const rows = await client.run(both.orderBy(r => r.a.id).thenBy(r => r.b.id));
  expect(rows).toEqual([1, 2].flatMap(a => [1, 2].map(b => ({ a: { tenantId: 'acme', id: a, key: 7, labels: [a === 1 ? 'a' : 'b'] }, b: { tenantId: 'acme', id: b, key: 7, labels: [b === 1 ? 'a' : 'b'] } }))));
  const flat = both.map(r => ({ a: r.a.id, b: r.b.id })).orderBy(r => r.a).thenBy(r => r.b);
  const baseline = (await sql("SELECT a.id AS a,b.id AS b FROM inner_probe a INNER ALL JOIN inner_probe b ON a.key=b.key WHERE a.tenantId='acme' AND b.tenantId='acme' ORDER BY a,b FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(await client.run(flat)).toEqual(baseline);
  const residual = join({ a: q, b: q }).on(r => [r.a.key.eq(r.b.key), r.a.id.lt(r.b.id)]);
  expect(await client.run(residual.map(r => ({ a: r.a.id, b: r.b.id })))).toEqual([{ a: 1, b: 2 }]);
  expect(await client.run(residual.groupBy(r => r.a.key).aggregate(g => ({ sum: sum(g.b.id) })))).toEqual([{ key: 7, sum: 2n }]);
  expect(await client.run(join({ a: q, b: q, c: q }).on(r => [r.a.key.eq(r.b.key), r.b.id.eq(r.c.id)]).aggregate(() => count()))).toEqual([{ count: 4n }]);
  const nested = join({ ab: residual, c: q }).on(r => r.ab.b.id.eq(r.c.id));
  expect(await client.run(nested.map(r => ({ a: r.ab.a.id, c: r.c.id })))).toEqual([{ a: 1, c: 2 }]);
  expect((await client.run(nested))[0]?.ab.a.id).toBe(1);
  expect(await client.run(both.where(r => r.a.id.eq(1)).distinct().limit(1).map(r => r.a.labels.arrayElement(1)))).toEqual([{ labels: 'a' }]);
  expect(await client.run(join({ a: q.limit(0), b: q }).on(r => r.a.id.eq(r.b.id)))).toEqual([]);
  expect(await client.run(join({ a: q, b: q.limit(0) }).on(r => r.a.id.eq(r.b.id)))).toEqual([]);
  for (const alias of ['__proto__', 'constructor', 'a.b', '42', '__chql_leaf_0', 'x`\\\\ hostile']) {
    const hostile = join({ [alias]: q, other: q }).on(r => r[alias]!.id.eq(r.other!.id)).map(r => ({ id: r[alias]!.id }));
    expect(await client.run(hostile.orderBy(r => r.id))).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  }
});
it('preserves reversed multi-input keys and an indivisible OR residual inside nested conjunctions', async () => {
  const q = from(db.entity_ots_component);
  const query = join({ a: q, b: q, c: q }).on(r =>
    r.c.entityId.eq(r.b.entityId).and(r.b.tenantId.eq(r.a.tenantId).and(
      r.a.entityId.lt(r.b.entityId).or(r.c.entityId.eq('b')),
    )),
  ).map(r => ({ a: r.a.entityId, b: r.b.entityId, c: r.c.entityId })).orderBy(r => r.a);
  const baseline = (await sql("SELECT a.entityId AS a,b.entityId AS b,c.entityId AS c FROM entity_ots_component a INNER ALL JOIN entity_ots_component b ON b.tenantId=a.tenantId INNER ALL JOIN entity_ots_component c ON c.entityId=b.entityId WHERE a.entityId<b.entityId OR c.entityId='b' ORDER BY a FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(baseline).toEqual([{ a: 'a', b: 'c', c: 'c' }, { a: 'b', b: 'b', c: 'b' }]);
  expect(await client.run(query)).toEqual(baseline);
});
it('retains nested nullable arrays and Cartesian multiplicity through repeated LEFT expansion', async () => {
  const source = from(db.entity_ots_component).where(r => r.entityId.eq('a')).map(r => ({ id: r.entityId, values: val([null, 7, 7], col.Array(col.Nullable(col.Int32))) }));
  const empty = source.map(r => ({ id: r.id, values: val([], col.Array(col.Nullable(col.Int32))) }));
  const joined = join({ a: source, b: empty }).on(r => r.a.id.eq(r.b.id));
  const expanded = joined.leftArrayJoin(r => r.b.values, 'empty').arrayJoin(r => r.a.values, 'one').leftArrayJoin(r => r.a.values, 'two');
  const rows = await client.run(expanded);
  expect(rows).toHaveLength(9);
  expect(rows).toEqual([null, 7, 7].flatMap(one => [null, 7, 7].map(two => ({ a: { id: 'a', values: [null, 7, 7] }, b: { id: 'a', values: [] }, empty: null, one, two }))));
  expect(await client.run(expanded.distinct().aggregate(() => count()))).toEqual([{ count: 4n }]);
  expect(await client.run(expanded.groupBy(r => r.empty).aggregate(g => ({ n: count(), total: sum(g.one) })))).toEqual([{ empty: null, n: 9n, total: 42n }]);
  expect(await client.run(joined.arrayJoin(r => r.b.values, 'missing'))).toEqual([]);
});
it('treats a single conjunction as the same inner join keys and residuals as an array', async () => {
  const q = from(db.entity_ots_component);
  const baseline = (await sql("SELECT a.entityId AS a,b.entityId AS b FROM entity_ots_component a INNER ALL JOIN entity_ots_component b ON a.tenantId=b.tenantId WHERE a.entityId<b.entityId ORDER BY a,b FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(baseline).toEqual([{ a: 'a', b: 'c' }]);
  const array = join({ a: q, b: q }).on(r => [r.a.tenantId.eq(r.b.tenantId), r.a.entityId.lt(r.b.entityId)]).map(r => ({ a: r.a.entityId, b: r.b.entityId }));
  expect(await client.run(array)).toEqual(baseline);
  const conjunction = join({ a: q, b: q }).on(r => r.a.tenantId.eq(r.b.tenantId).and(r.a.entityId.lt(r.b.entityId))).map(r => ({ a: r.a.entityId, b: r.b.entityId }));
  expect(await client.run(conjunction)).toEqual(baseline);
});
it.each(['arrayJoin', 'leftArrayJoin'] as const)('composes nested join rows with %s', async method => {
  const q = from(db.entity_ots_component).where(r => r.entityId.eq('a')).map(r => ({ id: r.entityId, labels: val(['x', 'x'], col.Array(col.String)) }));
  const joined = join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id));
  const baseline = JSON.parse(await sql("SELECT 'a' AS id, arrayJoin(['x','x']) AS item FORMAT JSON")).data as unknown;
  expect(baseline).toEqual([{ id: 'a', item: 'x' }, { id: 'a', item: 'x' }]);
  const expanded = joined[method](r => r.a.labels, 'item');
  expect(await client.run(expanded.map(r => ({ id: r.a.id, item: r.item })))).toEqual(baseline);
  expect(await client.run(expanded)).toEqual(['x', 'x'].map(item => ({ a: { id: 'a', labels: ['x', 'x'] }, b: { id: 'a', labels: ['x', 'x'] }, item })));
  const empty = q.map(r => ({ id: r.id, labels: val([], col.Array(col.String)) }));
  const left = join({ a: empty, b: q }).on(r => r.a.id.eq(r.b.id)).leftArrayJoin(r => r.a.labels, 'item');
  expect(await client.run(left.map(r => ({ id: r.a.id, item: r.item })))).toEqual([{ id: 'a', item: '' }]);
});
it('retains nested expansion descriptors, remaps transport aliases, and composes grouping and another join', async () => {
  const pair = col.Tuple({ n: col.UInt64, labels: col.Array(col.String) });
  await sql('CREATE TABLE nested_expansion_probe (id String, pairs Array(Tuple(n UInt64, labels Array(String)))) ENGINE=Memory');
  await sql("INSERT INTO nested_expansion_probe VALUES ('a',[(7,['x','x'])])");
  const q = from(table('nested_expansion_probe', { id: col.String, pairs: col.Array(pair) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const joined = join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id));
  const expanded = joined.arrayJoin(r => r.a.pairs, '__chql_leaf_0').leftArrayJoin(r => r.__chql_leaf_0.element('labels'), '__proto__');
  const row = { a: { id: 'a', pairs: [{ n: 7n, labels: ['x', 'x'] }] }, b: { id: 'a', pairs: [{ n: 7n, labels: ['x', 'x'] }] }, __chql_leaf_0: { n: 7n, labels: ['x', 'x'] }, ['__proto__']: 'x' };
  expect(await client.run(expanded.where(r => r.a.id.eq('a')).orderBy(r => r.__proto__).limit(2))).toEqual([row, row]);
  expect(await client.run(expanded.distinct())).toEqual([row]);
  expect(await client.run(expanded.groupBy(r => r.a.id).aggregate(g => ({ n: max(g.__chql_leaf_0.element('n')), count: count() }))))
    .toEqual([{ id: 'a', n: 7n, count: 2n }]);
  const again = join({ expanded, q }).on(r => r.expanded.a.id.eq(r.q.id));
  expect(await client.run(again.map(r => ({ n: r.expanded.__chql_leaf_0.element('n'), label: r.expanded.__proto__ })))).toEqual([{ n: 7n, label: 'x' }, { n: 7n, label: 'x' }]);
});
it('normalizes nullable keys and preserves nested transport collisions through residual and sort scopes', async () => {
  const q = from(db.entity_ots_component).where(r => r.tenantId.eq('acme')).map(r => ({ id: r.entityId, key: r.category, ['__chql_leaf_0']: r.countOfParts }));
  const inner = join({ ['__chql_leaf_0']: q, b: q }).on(r => [
    r.__chql_leaf_0.key.ifNull('missing').eq(r.b.key.ifNull('missing')),
    r.__chql_leaf_0.id.le(r.b.id), r.b.id.ge('a'),
  ]);
  const nested = join({ ['__chql_leaf__0']: inner, c: q }).on(r => r.__chql_leaf__0.b.id.eq(r.c.id));
  const ordered = nested.orderBy(r => r.c.id.desc()).thenBy(r => r.__chql_leaf__0.b.id).orderBy(r => r.c.id).distinct().limit(2);
  const rows = await client.run(ordered);
  expect(rows).toEqual([
    { __chql_leaf__0: { __chql_leaf_0: { id: 'a', key: null, __chql_leaf_0: 18446744073709551615n }, b: { id: 'a', key: null, __chql_leaf_0: 18446744073709551615n } }, c: { id: 'a', key: null, __chql_leaf_0: 18446744073709551615n } },
    { __chql_leaf__0: { __chql_leaf_0: { id: 'c', key: 'visible', __chql_leaf_0: 0n }, b: { id: 'c', key: 'visible', __chql_leaf_0: 0n } }, c: { id: 'c', key: 'visible', __chql_leaf_0: 0n } },
  ]);
  expect(await client.run(ordered.groupBy(r => r.c.key).aggregate(g => ({ n: count(), total: sum(g.__chql_leaf__0.b.__chql_leaf_0) })).orderBy(r => r.key.asc().nullsFirst()))).toEqual([{ key: null, n: 1n, total: 18446744073709551615n }, { key: 'visible', n: 1n, total: 0n }]);
});
it('runs the unchanged generic latest helper on FINAL and joins expanded component parts', async () => {
  type Versioned = { tenantId: string; entityId: string; version: number };
  const latest = <R extends Versioned>(q: Query<R>) => {
    const newest = q.groupBy(m => ({ tenantId: m.tenantId, entityId: m.entityId })).aggregate(g => ({ version: max(g.version) }));
    return join({ m: q, v: newest }).on(r => [r.m.tenantId.eq(r.v.tenantId), r.m.entityId.eq(r.v.entityId), r.m.version.eq(r.v.version)]).map(r => ({ ...r.m }));
  };
  await sql('CREATE TABLE latest_probe (tenantId String, entityId String, version UInt32, inserted UInt32, stock Float64) ENGINE=ReplacingMergeTree(inserted) ORDER BY (tenantId,entityId,version)');
  await sql('SYSTEM STOP MERGES latest_probe');
  await sql("INSERT INTO latest_probe VALUES ('acme','p1',1,1,10),('acme','p1',2,1,20),('other','p1',9,1,999)");
  await sql("INSERT INTO latest_probe VALUES ('acme','p1',2,2,25)");
  const q = from(table('latest_probe', { tenantId: col.String, entityId: col.String, version: col.UInt32, inserted: col.UInt32, stock: col.Float64 }, { engine: 'ReplacingMergeTree', sortingKey: ['tenantId','entityId','version'], partitionKey: [] }));
  expect(await client.run(latest(q.final().where(r => r.tenantId.eq('acme'))))).toEqual([{ tenantId: 'acme', entityId: 'p1', version: 2, inserted: 2, stock: 25 }]);
  const componentParts = from(db.entity_ots_component).where(r => r.entityId.eq('a')).map(r => ({ tenantId: r.tenantId, entityId: r.entityId, matched_part_ids: val(['p1','p1'], col.Array(col.String)) })).arrayJoin(r => r.matched_part_ids, 'partId');
  const joined = join({ c: componentParts, p: latest(q.final()) }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId)]).map(r => ({ component: r.c.entityId, stock: r.p.stock }));
  expect(await client.run(joined)).toEqual([{ component: 'a', stock: 25 }, { component: 'a', stock: 25 }]);
  await sql('CREATE TABLE parts_probe (tenantId String, entityId String, mpn String, manufacturerName String) ENGINE=Memory');
  await sql("INSERT INTO parts_probe VALUES ('acme','p1','GRM','Maker'),('other','p1','hidden','Secret')");
  const parts = from(table('parts_probe', { tenantId: col.String, entityId: col.String, mpn: col.String, manufacturerName: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const withParts = join({ c: componentParts, p: parts }).on(r => [r.c.tenantId.eq(r.p.tenantId), r.c.partId.eq(r.p.entityId)]).map(r => ({ component: r.c.entityId, mpn: r.p.mpn, manufacturer: r.p.manufacturerName }));
  expect(await client.run(withParts)).toEqual([{ component: 'a', mpn: 'GRM', manufacturer: 'Maker' }, { component: 'a', mpn: 'GRM', manufacturer: 'Maker' }]);
  const direct = (await sql("SELECT 'a' AS component, p.mpn AS mpn, p.manufacturerName AS manufacturer FROM (SELECT 'acme' AS tenantId, arrayJoin(['p1','p1']) AS partId) c INNER ALL JOIN parts_probe p ON c.tenantId=p.tenantId AND c.partId=p.entityId FORMAT JSONEachRow")).trim().split('\n').map(line => JSON.parse(line) as unknown);
  expect(await client.run(withParts)).toEqual(direct);
});
it('executes supported SAMPLE fractions on a sampling-key fixture', async () => {
  await sql('CREATE TABLE sampling_probe (id UInt32, hash UInt64) ENGINE=MergeTree ORDER BY hash SAMPLE BY hash');
  await sql('INSERT INTO sampling_probe SELECT number, cityHash64(number) FROM numbers(32)');
  const q = from(table('sampling_probe', { id: col.UInt32, hash: col.UInt64 }, { engine: 'MergeTree', sortingKey: ['hash'], partitionKey: [] }));
  for (const fraction of [1, 0.5, 1e-7]) {
    const expected = JSON.parse(await sql(`SELECT groupArray(id) FROM (SELECT id FROM sampling_probe SAMPLE ${fraction} ORDER BY id) FORMAT JSONEachRow`)) as Record<string, number[]>;
    expect(await client.run(q.sample(fraction).map(r => r.id).orderBy(r => r.id))).toEqual(expected['groupArray(id)']!.map(id => ({ id })));
  }
});
it('composes patterned aliases with nested LEFT defaults and grouped multiplicity', async () => {
  const q = from(db.entity_ots_component).where(r => r.entityId.eq('a')).map(() => ({
    item_count: val(7, col.UInt32), nested: val([[], ['x', 'x']], col.Array(col.Array(col.String))),
  }));
  const alias: `item_${number}` = `item_${Number('42')}`;
  const expanded = q.leftArrayJoin(r => r.nested, alias);
  expect(await client.run(expanded)).toEqual([
    { item_count: 7, nested: [[], ['x', 'x']], item_42: [] },
    { item_count: 7, nested: [[], ['x', 'x']], item_42: ['x', 'x'] },
  ]);
  // Check punctuation aliases independently of optional pattern indexes.
  const twice = q.leftArrayJoin(r => r.nested, 'a.b').leftArrayJoin(r => r['a.b'], '42');
  expect(await client.run(twice.groupBy(r => r['42']).aggregate(() => count()).orderBy(r => r['42']))).toEqual([{ '42': '', count: 1n }, { '42': 'x', count: 2n }]);
});
it('executes FINAL deterministically with explicit replacement versions and composes hints', async () => {
  await sql('CREATE TABLE final_probe (id UInt32, version UInt32, n UInt32) ENGINE=ReplacingMergeTree(version) ORDER BY id');
  await sql('SYSTEM STOP MERGES final_probe');
  await sql('INSERT INTO final_probe VALUES (1,1,10),(2,1,20)');
  await sql('INSERT INTO final_probe VALUES (1,2,30)');
  const q = from(table('final_probe', { id: col.UInt32, version: col.UInt32, n: col.UInt32 }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] }));
  expect(await client.run(q.final().orderBy(r => r.id))).toEqual([{ id: 1, version: 2, n: 30 }, { id: 2, version: 1, n: 20 }]);
  expect(await client.run(q.final().groupBy(r => r.version).aggregate(g => ({ n: sum(g.n) })).orderBy(r => r.version))).toEqual([{ version: 1, n: 20n }, { version: 2, n: 30n }]);
  expect(q.sample(0.1).final().toSQL().sql).toBe('SELECT `id`, `version`, `n` FROM `final_probe` FINAL SAMPLE 0.1');
  expect(q.final().sample(0.1).toSQL().params).toEqual({});
});
it('expands arrays without replacing originals and uses exact LEFT child defaults', async () => {
  await sql('CREATE TABLE array_join_probe (id UInt32, a Array(String), b Array(Nullable(Int32)), big Array(UInt64), pairs Array(Tuple(label String, n Nullable(Int32))), nested Array(Array(String))) ENGINE=Memory');
  await sql("INSERT INTO array_join_probe VALUES (1,['x','x','y'],[NULL,7],[18446744073709551615],[('z',8)],[['a','b']]),(2,[],[],[],[],[])");
  const q = from(table('array_join_probe', { id: col.UInt32, a: col.Array(col.String), b: col.Array(col.Nullable(col.Int32)), big: col.Array(col.UInt64), pairs: col.Array(col.Tuple({ label: col.String, n: col.Nullable(col.Int32) })), nested: col.Array(col.Array(col.String)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  expect(await client.run(q.arrayJoin(r => r.a, 'item').orderBy(r => r.item).map(r => ({ id: r.id, a: r.a, item: r.item })))).toEqual(['x','x','y'].map(item => ({ id: 1, a: ['x','x','y'], item })));
  expect(await client.run(q.leftArrayJoin(r => r.a, '__proto__').where(r => r.id.eq(2)).map(r => ({ a: r.a, ['__proto__']: r.__proto__ })))).toEqual([{ a: [], ['__proto__']: '' }]);
  expect(await client.run(q.leftArrayJoin(r => r.b, 'v').orderBy(r => r.id).thenBy(r => r.v.asc().nullsFirst()).map(r => ({ id: r.id, v: r.v })))).toEqual([{ id: 1, v: null }, { id: 1, v: 7 }, { id: 2, v: null }]);
  expect(await client.run(q.leftArrayJoin(r => r.big, 'v').orderBy(r => r.id).map(r => ({ v: r.v })))).toEqual([{ v: 18446744073709551615n }, { v: 0n }]);
  expect(await client.run(q.leftArrayJoin(r => r.pairs, 'pair').where(r => r.id.eq(2)).orderBy(r => r.id).limit(1).map(r => ({ pair: r.pair, label: r.pair.element('label'), n: r.pair.element('n') })))).toEqual([{ pair: { label: '', n: null }, label: '', n: null }]);
  expect(await client.run(q.leftArrayJoin(r => r.nested, 'arr').arrayJoin(r => r.arr, 'v').map(r => ({ v: r.v })).orderBy(r => r.v))).toEqual([{ v: 'a' }, { v: 'b' }]);
  expect(await client.run(q.leftArrayJoin(r => r.nested, 'arr').where(r => r.id.eq(2)).map(r => r.arr))).toEqual([{ arr: [] }]);
  expect(await client.run(q.arrayJoin(r => r.pairs.element('label'), 'label').map(r => r.label))).toEqual([{ label: 'z' }]);
  expect(await client.run(q.aggregate(g => ({ pairs: max(g.pairs) })).arrayJoin(r => r.pairs, 'pair').map(r => r.pair.element('label')))).toEqual([{ pair: 'z' }]);
  expect(await client.run(q.orderBy(r => r.id.desc()).limit(1).arrayJoin(r => r.a, 'v'))).toEqual([]);
  expect(await client.run(q.arrayJoin(r => r.a, 'v').orderBy(r => r.v).limit(1).map(r => r.v))).toEqual([{ v: 'x' }]);
  expect(await client.run(q.arrayJoin(r => r.a, 'v').groupBy(r => r.v).aggregate(() => count()).orderBy(r => r.v))).toEqual([{ v: 'x', count: 2n }, { v: 'y', count: 1n }]);
  for (const alias of ['__chql_input', '__chql_element', 'constructor', 'x`\\\\ hostile']) {
    const joined = q.where(r => r.id.eq(1)).arrayJoin(r => r.a, alias).map(r => ({ item: r[alias]! }));
    expect(await client.run(joined)).toEqual([{ item: 'x' }, { item: 'x' }, { item: 'y' }]);
  }
  const shared = val(['p','p'], col.Array(col.String));
  const computed = q.where(r => r.a.hasAny(shared)).arrayJoin(() => shared, 'item');
  expect(computed.toSQL().params).toEqual({ p0: "['p','p']" });
  expect(computed.toSQL().sql.match(/\{p0:Array\(String\)\}/g)).toHaveLength(2);
  expect(await client.run(q.limit(1).arrayJoin(() => shared, 'item').map(r => r.item))).toEqual([{ item: 'p' }, { item: 'p' }]);
});
it('retains numeric source columns at runtime with a widened string expansion alias', async () => {
  const alias: string = ['expandedName'].join('');
  const q = from(db.entity_ots_component).where(r => r.entityId.eq('a'))
    .map(() => ({ n: val(7, col.UInt32), names: val(['x'], col.Array(col.String)) }));
  for (const expanded of [q.arrayJoin(r => r.names, alias), q.leftArrayJoin(r => r.names, alias)]) {
    expect(expanded.toSQL().columns.n).toEqual(col.UInt32.type);
    expect(await client.run(expanded)).toEqual([{ n: 7, names: ['x'], expandedName: 'x' }]);
  }
});
it('creates only the selected pattern or union alias, including after FINAL and composition', async () => {
  await sql('CREATE TABLE alias_final_probe (id UInt32, version UInt32, names Array(String)) ENGINE=ReplacingMergeTree(version) ORDER BY id');
  await sql('SYSTEM STOP MERGES alias_final_probe');
  await sql("INSERT INTO alias_final_probe VALUES (1,1,['old'])");
  await sql("INSERT INTO alias_final_probe VALUES (1,2,['new','new']),(2,1,[])");
  const q = from(table('alias_final_probe', { id: col.UInt32, version: col.UInt32, names: col.Array(col.String) }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] })).final();
  const patternedAlias: `item_${string}` = `item_${['actual'].join('')}`;
  for (const expanded of [q.arrayJoin(r => r.names, patternedAlias), q.leftArrayJoin(r => r.names, patternedAlias)]) {
    expect(Object.hasOwn(expanded.row, 'item_missing')).toBe(false);
    expect(Object.hasOwn(expanded.toSQL().columns, 'item_missing')).toBe(false);
    const rows = await client.run(expanded.where(r => r.id.eq(1)).orderBy(r => r.id).limit(2));
    expect(rows).toEqual([{ id: 1, version: 2, names: ['new','new'], item_actual: 'new' }, { id: 1, version: 2, names: ['new','new'], item_actual: 'new' }]);
    expect(rows.every(row => !Object.hasOwn(row, 'item_missing'))).toBe(true);
  }
  for (const alias of ['first', 'second'] as const) {
    const expanded = q.leftArrayJoin(r => r.names, alias).where(r => r.id.eq(2));
    expect(await client.run(expanded)).toEqual([{ id: 2, version: 1, names: [], [alias]: '' }]);
  }
});
it('keeps repeated expansions Cartesian across distinct, aliases and empty Bool defaults', async () => {
  const q = from(db.entity_ots_component).where(r => r.entityId.eq('a'))
    .map(r => ({ id: r.entityId, a: val([true, false, true], col.Array(col.Bool)) }));
  const twice = q.arrayJoin(r => r.a, '__chql_input').arrayJoin(r => r.a, '__chql_element');
  expect(await client.run(twice.aggregate(() => count()))).toEqual([{ count: 9n }]);
  expect(await client.run(twice.distinct().aggregate(() => count()))).toEqual([{ count: 4n }]);
  expect(await client.run(twice.where(r => r.__chql_input.eq(false)).where(r => r.__chql_element.eq(false))
    .map(r => ({ a: r.a, first: r.__chql_input, second: r.__chql_element })))).toEqual([{ a: [true, false, true], first: false, second: false }]);
  const empty = q.map(r => ({ id: r.id, a: val([], col.Array(col.Bool)) }));
  expect(await client.run(empty.leftArrayJoin(r => r.a, 'v').map(r => ({ a: r.a, v: r.v })))).toEqual([{ a: [], v: false }]);
  expect(await client.run(empty.arrayJoin(r => r.a, 'v').aggregate(() => count()))).toEqual([{ count: 0n }]);
  const shared = val(['same'], col.Array(col.String));
  const equal = val(['same'], col.Array(col.String));
  const parameters = q.map(r => ({ id: r.id, shared })).arrayJoin(() => shared, 'first').arrayJoin(() => equal, 'second');
  expect(parameters.toSQL().params).toEqual({ p0: "['same']", p1: '[true,false,true]', p2: 'a', p3: "['same']" });
  expect(await client.run(parameters.map(r => ({ first: r.first, second: r.second })))).toEqual([{ first: 'same', second: 'same' }]);
});
it('executes grouped/global aggregates with nullable and empty inputs', async () => {
  await sql('CREATE TABLE aggregation_probe (k Nullable(String), n UInt32, f Float64, v Nullable(Int32)) ENGINE=Memory');
  await sql("INSERT INTO aggregation_probe VALUES ('a',2,1.5,4),('a',3,2.5,NULL),(NULL,7,3,NULL)");
  const t = table('aggregation_probe', { k: col.Nullable(col.String), n: col.UInt32, f: col.Float64, v: col.Nullable(col.Int32) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(t);
  expect(await client.run(q.groupBy(r => r.k).aggregate(g => ({ count: count(), n: sum(g.n), f: sum(g.f), v: max(g.v), s: sum(g.v), c: countIf(g.n.gt(2)), si: sumIf(g.n, g.n.gt(2)), mi: maxIf(g.n, g.n.gt(2)) })).orderBy(r => r.k.asc().nullsFirst()))).toEqual([
    { k: null, count: 1n, n: 7n, f: 3, v: null, s: null, c: 1n, si: 7n, mi: 7 },
    { k: 'a', count: 2n, n: 5n, f: 4, v: 4, s: 4n, c: 1n, si: 3n, mi: 3 },
  ]);
  expect(await client.run(q.where(r => r.n.eq(999)).aggregate(g => ({ count: count(), n: sum(g.n), v: max(g.v), s: sum(g.v), m: max(g.n) })))).toEqual([{ count: 0n, n: 0n, v: null, s: null, m: 0 }]);
  expect(await client.run(q.aggregate(g => sum(g.n)))).toEqual([{ n: 12n }]);
  expect(await client.run(q.aggregate(g => ({ c: countIf(g.n.lt(0)), s: sumIf(g.v, g.n.lt(0)), m: maxIf(g.v, g.n.lt(0)), n: sumIf(g.n, g.n.lt(0)) })))).toEqual([{ c: 0n, s: null, m: null, n: 0n }]);
  const fallback = val('missing');
  const grouped = q.groupBy(r => ({ ['__proto__']: r.k.ifNull(fallback) })).aggregate(g => ({ ratio: sum(g.n).divide(count()), total: count() }));
  expect(grouped.toSQL().params).toEqual({ p0: 'missing' });
  expect(grouped.toSQL().sql.match(/\{p0:String\}/g)).toHaveLength(2);
  expect(await client.run(grouped.where(r => r.total.gt(1n)).orderBy(r => r.ratio).limit(1).map(r => ({ key: r.__proto__, ratio: r.ratio })))).toEqual([{ key: 'a', ratio: 2.5 }]);
  expect((await sql('SELECT toTypeName(sum(v)), toTypeName(max(v)), toTypeName(sum(n)) FROM aggregation_probe')).trim()).toBe('Nullable(Int64)\tNullable(Int32)\tUInt64');
});
it('keeps nullable If predicates consistent with actual server result descriptors', async () => {
  await sql('CREATE TABLE agg_nullable_predicate (n UInt32, p Nullable(Bool)) ENGINE=Memory');
  await sql('INSERT INTO agg_nullable_predicate VALUES (2,true),(3,false),(7,NULL)');
  const q = from(table('agg_nullable_predicate', { n: col.UInt32, p: col.Nullable(col.Bool) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  expect((await sql('SELECT toTypeName(sumIf(n,p)), toTypeName(maxIf(n,p)), toTypeName(countIf(p)) FROM agg_nullable_predicate')).trim()).toBe('UInt64\tUInt32\tUInt64');
  expect(await client.run(q.aggregate(g => ({ s: sumIf(g.n, g.p), m: maxIf(g.n, g.p), c: countIf(g.p) })))).toEqual([{ s: 2n, m: 2, c: 1n }]);
  expect(await client.run(q.where(r => r.p.isNull()).aggregate(g => ({ s: sumIf(g.n, g.p), m: maxIf(g.n, g.p), c: countIf(g.p) })))).toEqual([{ s: 0n, m: 0, c: 0n }]);
});
it('composes repeated aggregates with renamed keys, structural maxima and constant keys', async () => {
  await sql('CREATE TABLE agg_composition (k String, n UInt32, pair Tuple(label String, value UInt32)) ENGINE=Memory');
  await sql("INSERT INTO agg_composition VALUES ('a',2,('x',2)),('a',3,('y',3)),('b',7,('z',7))");
  const q = from(table('agg_composition', { k: col.String, n: col.UInt32, pair: col.Tuple({ label: col.String, value: col.UInt32 }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const shared = val('a');
  const grouped = q.where(r => r.k.eq(val('a'))).groupBy(r => ({ n: r.k.eq(shared) }))
    .aggregate(g => ({ k: sum(g.n), pair: max(g.pair), c: count() }));
  expect(grouped.toSQL().params).toEqual({ p0: 'a', p1: 'a' });
  expect(grouped.toSQL().sql.match(/\{p0:String\}/g)).toHaveLength(2);
  expect(await client.run(grouped.orderBy(r => r.k).thenBy(r => r.c).limit(1).map(r => ({ key: r.n, n: r.k, label: r.pair.element('label') })))).toEqual([{ key: true, n: 5n, label: 'y' }]);
  expect(await client.run(grouped.where(r => r.c.gt(1n)).aggregate(g => ({ total: sum(g.k), high: max(g.c), rows: count() })))).toEqual([{ total: 5n, high: 2n, rows: 1n }]);
  expect(await client.run(q.groupBy(() => ({ fixed: val(1, col.UInt8) })).aggregate(() => count()))).toEqual([{ fixed: 1, count: 3n }]);
  expect(await client.run(q.where(r => r.n.eq(99)).groupBy(() => ({ fixed: val(1, col.UInt8) })).aggregate(() => count()))).toEqual([]);
});
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
  await sql('CREATE TABLE metric_group_ots_component_indices (tenantId String,entityId String,version UInt32,effectiveAt DateTime64(3),insertedAt DateTime64(3),price_change_log_sum Float64,price_change_count Float64,stock_index Float64,stock_index_warnings Array(String),lead_time_index_part_days Float64,lead_time_index_part_count Float64,lead_time_max_days Nullable(Float64)) ENGINE=ReplacingMergeTree(insertedAt) ORDER BY (tenantId,entityId,version,effectiveAt)');
  await sql("INSERT INTO metric_group_ots_component_indices (tenantId,entityId,version,effectiveAt,stock_index,lead_time_max_days) VALUES ('acme','a',2,'2026-10-27',30,NULL),('acme','a',1,'2026-10-26',20,7),('other','a',3,'2026-10-27',99,99)");
  const { stdout } = await promisify(execFile)('pnpm', ['example:first-query'], { env: { ...process.env, CLICKHOUSE_URL: url, CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' }, timeout: 120000 });
  expect(stdout).toContain('18446744073709551615n');
  expect(stdout).toContain('2026-10-27T12:00:00.123Z');
  expect(stdout).toContain("streamed latest metric { entityId: 'a', version: 2, stockIndex: 30, leadDays: 7 }");
  expect(stdout).toContain('latest positive stock [ { stock: 30 } ]');
  expect(stdout).toContain('streamed weekly mean { week: 2026-10-25T00:00:00.000Z, stock: 25 }');
  expect(stdout).toContain('streamed weekly quantile { week: 2026-10-25T00:00:00.000Z, stock: 25, leadDays: 7 }');
});
it('hostile values cannot escape parameters and genuine server errors retain SQL/params/cause', async () => {
  const q = from(db.entity_ots_component).where(c => c.tenantId.eq("acme' OR 1=1 --")).map(c => ({ id: c.entityId }));
  expect(await client.run(q)).toEqual([]);
  const missing = from(table('missing_table', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  try { await client.run(missing); throw new Error('expected server error'); }
  catch (error) { expect(error).toBeInstanceOf(QueryError); if (!(error instanceof QueryError)) throw error; expect(error.sql).toContain('`missing_table`'); expect(error.params).toEqual({}); expect(error.cause).toBeInstanceOf(Error); expect(error.node).toBe(missing.ir); }
});
