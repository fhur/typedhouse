import { beforeAll, afterAll, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient } from '@chql/client';
import { count, countIf, sum, sumIf, max, maxIf, from, col, table, val, registerCompiler, join, crossJoin, unionAll, relNode, Query } from '@chql/core';
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
