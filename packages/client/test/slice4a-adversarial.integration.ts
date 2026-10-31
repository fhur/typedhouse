import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { cast, col, count, countIf, sum, avg, uniq, max, from, join, leftJoin, rightJoin, fullJoin, scalar, table, unionAll, parseCHType, print, outerColumnType, type Rel, type CHType } from '@typedhouse/core';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient as createTypedClient } from '../src/index.js';
import { collect } from './backend-harness.js';

// Tester native probes for slice 4a (outer joins) on clickhouse/clickhouse-server:24.8. Both emissions agree with each
// other in rows, meta and error code in every contract cell (prefer_column_name_to_alias 0/1 × optimize_move_to_prewhere 0/1,
// plus a cell with join_use_nulls = 0 sent as a request setting, which the query's own SETTINGS must override), meta equals
// print(compiled.columns), and the first cell equals a hand-written oracle that sets join_use_nulls = 1 itself.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const cols = { id: col.UInt32, k: col.Nullable(col.UInt32), s: col.String, n: col.Int64, tags: col.Array(col.String), lc: col.LowCardinality(col.String), t: col.Tuple({ x: col.UInt8, y: col.String }) };
const DDL = '(id UInt32, k Nullable(UInt32), s String, n Int64, tags Array(String), lc LowCardinality(String), t Tuple(x UInt8, y String)) ENGINE=MergeTree ORDER BY id';
const A = from(table('oa', cols, meta)), B = from(table('ob', cols, meta));
const C = from(table('oc', { id: col.UInt32, v: col.UInt32 }, meta));
let container: StartedTestContainer;
let url: string;
type Settings = Readonly<Record<string, string | number>>;
interface Result { meta?: string[]; data?: unknown[][]; error?: string }
async function execute(sql: string, params: Readonly<Record<string, string>> = {}, settings: Settings = {}, ordered = false): Promise<Result> {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(`param_${key}`, value);
  for (const [key, value] of Object.entries(settings)) endpoint.searchParams.set(key, String(value));
  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('wait_end_of_query', '1');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `${sql} FORMAT JSONCompact` });
  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 200) };
  const json = JSON.parse(text) as { meta: { type: string }[]; data: unknown[][] };
  const data = ordered ? json.data : [...json.data].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return { meta: json.meta.map(m => print(parseCHType(m.type))), data };
}
const raw = async (sql: string) => { const res = await fetch(url, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: sql }); if (!res.ok) throw new Error(await res.text()); return res.text(); };
beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8').withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' }).withExposedPorts(8123).withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;
  await raw(`CREATE TABLE oa ${DDL}`);
  await raw(`CREATE TABLE ob ${DDL}`);
  // oa: duplicate id 2, NULL k on 2 and 5, orphans 1 and 5; s castable except 'y'.
  await raw("INSERT INTO oa VALUES (1, 1, '1', 10, ['p'], 'u', (1,'a')), (2, NULL, 'y', 20, [], 'v', (2,'b')), (2, 2, '2', 21, ['q','q'], 'v', (3,'c')), (3, 3, '', 30, [], '', (4,'d')), (5, NULL, '5', 50, ['r'], 'w', (5,'e'))");
  // ob: duplicate id 2 (s 'x' is not castable), orphans 4 and 6, NULL k on 2 and 4.
  await raw("INSERT INTO ob VALUES (2, 2, 'x', 7, ['b'], 'v', (7,'g')), (2, NULL, '8', 8, [], 'u', (8,'h')), (3, 3, '9', 9, [], '', (9,'i')), (4, NULL, '4', 4, ['o'], 'o', (4,'j')), (6, 6, 'z', 6, ['s'], 'z', (6,'k'))");
  await raw('CREATE TABLE oc (id UInt32, v UInt32) ENGINE=MergeTree ORDER BY id');
  await raw('INSERT INTO oc VALUES (1, 100), (2, 200), (7, 700)');
}, 120000);
afterAll(async () => { await container?.stop(); });

const contract: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) contract.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });
contract.push({ join_use_nulls: 0 });
const NOTE = /SETTINGS (?:[a-z_]+ = \d+, )*join_use_nulls = 1 \/\* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults \*\/$/;
// Pre-existing (not slice 4a): the catalog types isNull/isNotNull/in as Bool, 24.8 returns UInt8; normalised here only.
const printed = (columns: Readonly<Record<string, CHType>>) => Object.values(columns).map(t => print(t) === 'Bool' ? 'UInt8' : print(t));
async function agree(root: Rel, options: { oracle?: string; ordered?: boolean; error?: string; label: string; outer?: boolean }) {
  const optimized = compile(root), naive = emitNaive(root);
  const context = `${options.label}\n${optimized.sql}\n${naive.sql}`;
  expect(optimized.columns, context).toEqual(naive.columns);
  for (const sql of [optimized.sql, naive.sql]) {
    if (options.outer === false) expect(sql, context).not.toContain('join_use_nulls');
    // Slice 4b: LeftToInner may make every outer join of the optimized text inner; then (only then) it drops the setting.
    else if (sql === optimized.sql && !/(LEFT|RIGHT|FULL) ALL JOIN/.test(sql)) { expect(sql, context).not.toContain('join_use_nulls'); expect(rewriteRel(root).hits.LeftToInner, context).toBeGreaterThan(0); }
    else { expect(sql, context).toMatch(NOTE); expect(sql.match(/join_use_nulls = 1/g), context).toHaveLength(2); }
  }
  let first: Result | undefined;
  for (const settings of contract) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);
    const label = `${context}\n${JSON.stringify(settings)}`;
    expect(a, label).toEqual(b);
    if (options.error !== undefined) expect(a.error, label).toBe(options.error);
    else { expect(a.error, label).toBeUndefined(); expect(a.meta, label).toEqual(printed(optimized.columns)); }
    first ??= a;
    expect(a, label).toEqual(first);
  }
  if (options.oracle) {
    const o = await execute(options.oracle, {}, {}, options.ordered);
    if (options.error !== undefined) expect(o.error, `${context}\noracle`).toBe(options.error);
    else expect({ meta: o.meta, data: o.data }, `${context}\noracle`).toEqual({ meta: first!.meta, data: first!.data });
  }
  return { optimized, naive, first: first! };
}
const J = 'SETTINGS join_use_nulls = 1';
const lj = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));

it('folded WHERE on the nullable side runs after null extension (anti-join, total comparisons, ifNull/isNull) on left/right/full', async () => {
  await agree(lj().where(r => r.b.id.isNull()).map(r => ({ id: r.a.id, n: r.a.n })).ir, { label: 'left anti-join', oracle: `SELECT a.id, a.n FROM oa a LEFT ALL JOIN ob b ON a.id = b.id WHERE b.id IS NULL ${J}` });
  await agree(lj().where(r => r.b.n.gt(5n)).map(r => ({ id: r.a.id, bn: r.b.n })).ir, { label: 'left total on nullable side', oracle: `SELECT a.id, b.n FROM oa a LEFT ALL JOIN ob b ON a.id = b.id WHERE b.n > 5 ${J}` });
  await agree(lj().where(r => r.b.n.ifNull(0n).eq(0n)).map(r => ({ id: r.a.id, bn: r.b.n })).ir, { label: 'left ifNull in WHERE', oracle: `SELECT a.id, b.n FROM oa a LEFT ALL JOIN ob b ON a.id = b.id WHERE ifNull(b.n, 0) = 0 ${J}` });
  await agree(lj().where(r => r.b.lc.isNull().or(r.b.lc.eq('v'))).map(r => ({ id: r.a.id, lc: r.b.lc })).ir, { label: 'left OR with isNull on LC(Nullable)', oracle: `SELECT a.id, b.lc FROM oa a LEFT ALL JOIN ob b ON a.id = b.id WHERE b.lc IS NULL OR b.lc = 'v' ${J}` });
  await agree(rightJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.isNull()).map(r => ({ id: r.b.id, as: r.a.s, at: r.a.t, tags: r.a.tags })).ir, { label: 'right anti-join, structured defaults', oracle: `SELECT b.id, a.s, a.t, a.tags FROM oa a RIGHT ALL JOIN ob b ON a.id = b.id WHERE a.s IS NULL ${J}` });
  await agree(fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.gt(1)).map(r => ({ a: r.a.id, b: r.b.id })).ir, { label: 'full: WHERE on a-side drops b orphans', oracle: `SELECT a.id, b.id FROM oa a FULL ALL JOIN ob b ON a.id = b.id WHERE a.id > 1 ${J}` });
  await agree(fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.id.isNull().or(r.b.id.isNull())).map(r => ({ a: r.a.id, b: r.b.id, ak: r.a.k, bk: r.b.k })).ir, { label: 'full: symmetric difference', oracle: `SELECT a.id, b.id, a.k, b.k FROM oa a FULL ALL JOIN ob b ON a.id = b.id WHERE a.id IS NULL OR b.id IS NULL ${J}` });
});

it('NULL keys never match on any kind; Nullable(k) keys stay Nullable on the preserved side', async () => {
  for (const [kind, f] of [['LEFT', leftJoin], ['RIGHT', rightJoin], ['FULL', fullJoin]] as const) {
    await agree((f as typeof leftJoin)({ a: A }, { b: B }).on(r => r.a.k.eq(r.b.k)).map(r => ({ aid: r.a.id, ak: r.a.k, bid: r.b.id, bk: r.b.k })).ir, { label: `${kind} on Nullable keys`, oracle: `SELECT a.id, a.k, b.id, b.k FROM oa a ${kind} ALL JOIN ob b ON a.k = b.k ${J}` });
  }
  // A mixed key: UInt32 = Nullable(UInt32), and a LowCardinality equality.
  await agree(leftJoin({ a: A }, { b: B }).on(r => [r.a.id.eq(r.b.k), r.a.lc.eq(r.b.lc)]).map(r => ({ aid: r.a.id, bid: r.b.id, blc: r.b.lc })).ir, { label: 'mixed nullability key + LC key', oracle: `SELECT a.id, b.id, b.lc FROM oa a LEFT ALL JOIN ob b ON a.id = b.k AND a.lc = b.lc ${J}` });
});

it('select list and aggregates over the nullable side: ifNull/isNull/element, count vs countIf, sum/avg/uniq/max, nullable GROUP BY key, HAVING', async () => {
  await agree(lj().map(r => ({ s: r.b.s.ifNull('none'), miss: r.b.lc.isNull(), lc: r.b.lc, tags: r.b.tags, t: r.b.t, x: r.b.t.element('x'), k: r.b.k })).ir, { label: 'select list', oracle: `SELECT ifNull(b.s, 'none'), b.lc IS NULL, b.lc, b.tags, b.t, tupleElement(b.t, 'x'), b.k FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
  await agree(lj().groupBy(r => ({ s: r.a.s })).aggregate(g => ({ n: count(), nb: countIf(g.b.id.isNotNull()), sm: sum(g.b.n), av: avg(g.b.n), u: uniq(g.b.s), mx: max(g.b.n) })).ir, { label: 'aggregates over nullable side', oracle: `SELECT a.s, count(), countIf(b.id IS NOT NULL), sum(b.n), avg(b.n), uniq(b.s), max(b.n) FROM oa a LEFT ALL JOIN ob b ON a.id = b.id GROUP BY a.s ${J}` });
  await agree(fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).groupBy(r => ({ s: r.b.s })).aggregate(g => ({ n: count(), sm: sum(g.a.n) })).ir, { label: 'full: nullable GROUP BY key', oracle: `SELECT b.s, count(), sum(a.n) FROM oa a FULL ALL JOIN ob b ON a.id = b.id GROUP BY b.s ${J}` });
  await agree(lj().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ c: count(), mx: max(g.b.n) })).where(r => r.c.gt(1n)).ir, { label: 'HAVING', oracle: `SELECT a.id, count() AS c, max(b.n) FROM oa a LEFT ALL JOIN ob b ON a.id = b.id GROUP BY a.id HAVING c > 1 ${J}` });
  await agree(lj().aggregate(g => ({ n: count(), sm: sum(g.b.n), av: avg(g.b.n) })).ir, { label: 'global aggregate', oracle: `SELECT count(), sum(b.n), avg(b.n) FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
});

it('DISTINCT and ORDER BY NULLS FIRST/LAST over null-extended columns', async () => {
  await agree(lj().map(r => ({ s: r.b.s, lc: r.b.lc })).distinct().ir, { label: 'distinct', oracle: `SELECT DISTINCT b.s, b.lc FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
  await agree(lj().orderBy(r => r.b.n.asc().nullsFirst()).thenBy(r => r.a.n).map(r => ({ an: r.a.n, bn: r.b.n })).ir, { ordered: true, label: 'nulls first', oracle: `SELECT a.n, b.n FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ORDER BY b.n ASC NULLS FIRST, a.n ASC ${J}` });
  await agree(fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).orderBy(r => r.a.n.desc().nullsLast()).thenBy(r => r.b.n.desc().nullsFirst()).limit(5).map(r => ({ an: r.a.n, bn: r.b.n })).ir, { ordered: true, label: 'full nulls last + limit', oracle: `SELECT an, bn FROM (SELECT a.n AS an, b.n AS bn FROM oa a FULL ALL JOIN ob b ON a.id = b.id ORDER BY a.n DESC NULLS LAST, b.n DESC NULLS FIRST LIMIT 5) ${J}` });
  await agree(lj().map(r => ({ s: r.b.s })).distinct().orderBy(r => r.s.desc().nullsFirst()).ir, { ordered: true, label: 'distinct then order', oracle: `SELECT s FROM (SELECT DISTINCT b.s AS s FROM oa a LEFT ALL JOIN ob b ON a.id = b.id) ORDER BY s DESC NULLS FIRST ${J}` });
});

it('slice 3b over outer join blocks: a fallible WHERE isolates above earlier filters and agrees in rows/error code', async () => {
  // CAST('x' AS Nullable(UInt64)) is NULL on 24.8, so the fallible form casts the ifNull'd text to a non-Nullable type.
  const bad = (r: { b: { s: any } }) => cast(r.b.s.ifNull('0'), col.UInt64).gt(0n);
  const isolated = await agree(lj().where(r => r.a.id.ne(2)).where(bad as any).map(r => ({ id: r.a.id, s: r.b.s })).ir, { label: 'total preserved-side then fallible', oracle: `SELECT id, s FROM (SELECT a.id AS id, b.s AS s FROM oa a LEFT ALL JOIN ob b ON a.id = b.id WHERE a.id != 2) WHERE CAST(ifNull(s, '0') AS UInt64) > 0 ${J}` });
  expect(isolated.optimized.sql.match(/SELECT /g)!.length).toBeGreaterThanOrEqual(2);
  await agree(lj().where(r => r.b.s.ne('x')).where(bad as any).map(r => ({ id: r.a.id, s: r.b.s })).ir, { label: 'total nullable-side then fallible', oracle: `SELECT id, s FROM (SELECT a.id AS id, b.s AS s FROM oa a LEFT ALL JOIN ob b ON a.id = b.id WHERE b.s != 'x') WHERE CAST(ifNull(s, '0') AS UInt64) > 0 ${J}` });
  await agree(lj().where(bad as any).ir, { label: 'fallible alone fails', error: '6' });
  await agree(lj().where(r => r.b.id.isNotNull()).where(bad as any).ir, { label: 'fallible after isNotNull still sees x', error: '6' });
  await agree(fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.s.ne('y')).where(r => cast(r.b.s.ifNull('0'), col.UInt64).ge(0n)).map(r => ({ a: r.a.id, b: r.b.id })).ir, { label: 'full: preserved filter then fallible', error: '6' });
  await agree(lj().where(r => cast(r.a.s, col.UInt64).gt(0n)).ir, { label: 'fallible on preserved side', error: '6' });
});

it('join_use_nulls is query-global: inner joins, IN/scalar subqueries, unions, CTEs and ARRAY JOIN elsewhere in the query are unaffected', async () => {
  const inner = join({ x: lj().map(r => ({ id: r.a.id, bn: r.b.n })), y: C }).on(r => r.x.id.eq(r.y.id)).map(r => ({ id: r.x.id, bn: r.x.bn, v: r.y.v }));
  await agree(inner.ir, { label: 'inner over outer', oracle: `SELECT x.id, x.bn, y.v FROM (SELECT a.id AS id, b.n AS bn FROM oa a LEFT ALL JOIN ob b ON a.id = b.id) x INNER ALL JOIN oc y ON x.id = y.id ${J}` });
  // An inner join beside the outer one, as a scalar subquery, and an IN subquery over an inner join.
  const sc = lj().map(r => ({ id: r.a.id, c: scalar(join({ p: A, q: C }).on(r => r.p.id.eq(r.q.id)).aggregate(() => ({ c: count() }))), m: r.a.id.in(join({ p: B, q: C }).on(r => r.p.id.eq(r.q.id)).map(r => ({ id: r.q.v }))) }));
  await agree(sc.ir, { label: 'scalar + IN subqueries with inner joins', oracle: `SELECT a.id, (SELECT count() FROM oa p INNER ALL JOIN oc q ON p.id = q.id), a.id IN (SELECT q.v FROM ob p INNER ALL JOIN oc q ON p.id = q.id) FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
  // unionAll: outer branch first and last; an inner join branch must stay non-Nullable in its own rows.
  const outerBranch = lj().map(r => ({ id: r.a.id, s: r.b.s.ifNull('-') }));
  const innerBranch = join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, s: r.b.s }));
  await agree(unionAll(outerBranch, innerBranch).ir, { label: 'union outer first', oracle: `SELECT a.id, ifNull(b.s, '-') FROM oa a LEFT ALL JOIN ob b ON a.id = b.id UNION ALL SELECT a.id, b.s FROM oa a INNER ALL JOIN ob b ON a.id = b.id ${J}` });
  await agree(unionAll(innerBranch, outerBranch).ir, { label: 'union outer last', oracle: `SELECT a.id, b.s FROM oa a INNER ALL JOIN ob b ON a.id = b.id UNION ALL SELECT a.id, ifNull(b.s, '-') FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
  // A CTE used inside the outer join and outside it.
  const shared = A.where(r => r.id.gt(1)).cte();
  const cte = join({ l: leftJoin({ a: shared }, { b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, bn: r.b.n })), r: shared }).on(r => r.l.id.eq(r.r.id)).map(r => ({ id: r.l.id, bn: r.l.bn, n: r.r.n }));
  await agree(cte.ir, { label: 'shared CTE inside and outside', oracle: `SELECT l.id, l.bn, r.n FROM (SELECT a.id AS id, b.n AS bn FROM (SELECT * FROM oa WHERE id > 1) a LEFT ALL JOIN ob b ON a.id = b.id) l INNER ALL JOIN (SELECT * FROM oa WHERE id > 1) r ON l.id = r.id ${J}` });
  // LEFT ARRAY JOIN defaults ('' for an empty array) are not NULL-ified by join_use_nulls.
  const laj = leftJoin({ x: A.leftArrayJoin(r => r.tags, 'tag') }, { b: B }).on(r => r.x.id.eq(r.b.id)).map(r => ({ id: r.x.id, tag: r.x.tag, bs: r.b.s }));
  const l = await agree(laj.ir, { label: 'LEFT ARRAY JOIN input', oracle: `SELECT x.id, x.tag, b.s FROM (SELECT id, tag FROM oa LEFT ARRAY JOIN tags AS tag) x LEFT ALL JOIN ob b ON x.id = b.id ${J}` });
  expect(l.first.meta![1]).toBe('String');
  expect(l.first.data!.some(row => row[1] === '')).toBe(true);
  // arrayJoin over a null-extended Array: unmatched rows carry [] and are dropped; LEFT ARRAY JOIN keeps them with ''.
  await agree(lj().arrayJoin(r => r.b.tags, 'tag').map(r => ({ id: r.a.id, tag: r.tag })).ir, { label: 'arrayJoin over nullable-side array', oracle: `SELECT a.id, tag FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ARRAY JOIN b.tags AS tag ${J}` });
  const lb = await agree(lj().leftArrayJoin(r => r.b.tags, 'tag').map(r => ({ id: r.a.id, tag: r.tag })).ir, { label: 'leftArrayJoin over nullable-side array', oracle: `SELECT id, tag FROM (SELECT a.id AS id, b.tags AS tags FROM oa a LEFT ALL JOIN ob b ON a.id = b.id) LEFT ARRAY JOIN tags AS tag ${J}` });
  expect(lb.first.meta![1]).toBe('String');
  // Inner-only: no setting, and the request-level join_use_nulls cell must not change the inner join.
  await agree(join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ a: r.a.id, b: r.b.s })).ir, { label: 'inner only', outer: false, oracle: 'SELECT a.id, b.s FROM oa a INNER ALL JOIN ob b ON a.id = b.id' });
});

it('composed joins: left over left (double extension), right under left, full over inner — meta and rows', async () => {
  const ll = leftJoin({ a: A }, { bc: leftJoin({ b: B }, { c: C }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.b.id)).map(r => ({ a: r.a.id, b: r.bc.b.id, c: r.bc.c.v, bt: r.bc.b.tags, blc: r.bc.b.lc }));
  await agree(ll.ir, { label: 'left over left', oracle: `SELECT a.id, bc.bid, bc.cv, bc.btags, bc.blc FROM oa a LEFT ALL JOIN (SELECT b.id AS bid, c.v AS cv, b.tags AS btags, b.lc AS blc FROM ob b LEFT ALL JOIN oc c ON b.id = c.id) bc ON a.id = bc.bid ${J}` });
  const rl = leftJoin({ a: A }, { bc: rightJoin({ b: B }, { c: C }).on(r => r.b.id.eq(r.c.id)) }).on(r => r.a.id.eq(r.bc.c.id)).map(r => ({ a: r.a.id, b: r.bc.b.id, c: r.bc.c.v }));
  await agree(rl.ir, { label: 'right under left', oracle: `SELECT a.id, bc.bid, bc.cv FROM oa a LEFT ALL JOIN (SELECT b.id AS bid, c.id AS cid, c.v AS cv FROM ob b RIGHT ALL JOIN oc c ON b.id = c.id) bc ON a.id = bc.cid ${J}` });
  const fi = fullJoin({ ab: join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id)) }, { c: C }).on(r => r.ab.b.id.eq(r.c.id)).where(r => r.ab.a.s.ne('y')).map(r => ({ a: r.ab.a.id, c: r.c.v }));
  await agree(fi.ir, { label: 'full over inner, WHERE on nested side', oracle: `SELECT ab.aid, c.v FROM (SELECT a.id AS aid, a.s AS as_, b.id AS bid FROM oa a INNER ALL JOIN ob b ON a.id = b.id) ab FULL ALL JOIN oc c ON ab.bid = c.id WHERE ab.as_ != 'y' ${J}` });
});

it('client facade: run/stream/runBuffered/toSQL tolerate the trailing comment; request settings merge with the SETTINGS clause', async () => {
  const q = lj().where(r => r.b.id.isNull()).map(r => ({ id: r.a.id, s: r.b.s, lc: r.b.lc, tags: r.b.tags }));
  const options = { url, username: 'fixture', password: 'fixture', clickhouse_settings: { join_use_nulls: 0 as const, max_threads: 1 } };
  for (const mode of ['clickhouse', 'clickhouse-naive'] as const) {
    const backend = createClickHouseBackend(options as never, mode);
    try {
      const plan = backend.compile(q.ir);
      const rows = (await collect(backend.run(plan))).flat();
      expect(rows, mode).toEqual(expect.arrayContaining([{ id: 1, s: null, lc: null, tags: [] }, { id: 5, s: null, lc: null, tags: [] }]));
      expect(rows).toHaveLength(2);
      expect(await backend.runBuffered(plan)).toEqual(rows);
    } finally { await backend.close(); }
  }
  const client = createTypedClient(options as never);
  try {
    expect((await client.run(q)).length).toBe(2);
    const streamed: unknown[] = [];
    for await (const row of client.stream(q)) streamed.push(row);
    expect(streamed.length).toBe(2);
  } finally { await client.close(); }
  // Wrapping the compiled text as a derived table or EXPLAIN keeps working; appending a second SETTINGS does not (by design).
  const sql = compile(q.ir).sql;
  expect((await execute(`SELECT count() FROM (${sql})`)).data).toEqual([['2']]);
  expect((await execute(`EXPLAIN ${sql}`)).error).toBeUndefined();
});

/** FINDING (pre-existing at HEAD for inner join blocks; the 4a planner widening makes it reachable for every outer kind):
 * an aggregate block folded onto a join source writes HAVING / ORDER BY by output alias, but the Aggregate alias guard in
 * plan-selects.ts compares output names against the join's *leaf* names (`__typedhouse_leaf_N`), never against the physical
 * column names of the join inputs. Under prefer_column_name_to_alias = 1 an alias equal to a side column resolves to that
 * column: NOT_AN_AGGREGATE (215) where naive returns rows, or silently different rows. Pinned as observed. */
it('FINDING pin: HAVING/ORDER BY alias equal to a join-side column diverges under prefer_column_name_to_alias = 1 (inner at HEAD, and now outer)', async () => {
  const cells = async (root: Rel) => {
    const o = compile(root), n = emitNaive(root);
    const out: string[] = [];
    for (const p of [0, 1]) {
      const a = await execute(o.sql, o.params, { prefer_column_name_to_alias: p }), b = await execute(n.sql, n.params, { prefer_column_name_to_alias: p });
      out.push(`${p}:${JSON.stringify(a) === JSON.stringify(b) ? 'agree' : `optimized ${a.error ? `code ${a.error}` : `${a.data!.length} rows`} vs naive ${b.error ? `code ${b.error}` : `${b.data!.length} rows`}`}`);
    }
    return out.join(' ');
  };
  const inner = join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id));
  // count() aliased n while ob.n is read by max(b.n): HAVING n / ORDER BY n bind the column.
  expect(await cells(inner.groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: count(), mx: max(g.b.n) })).where(r => r.n.gt(1n)).ir)).toBe('0:agree 1:optimized code 215 vs naive 1 rows');
  expect(await cells(lj().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: count(), mx: max(g.b.n) })).where(r => r.n.gt(1n)).ir)).toBe('0:agree 1:optimized code 215 vs naive 1 rows');
  expect(await cells(lj().groupBy(r => ({ id: r.a.id })).aggregate(g => ({ n: count(), mx: max(g.b.n) })).orderBy(r => r.n).ir)).toBe('0:agree 1:optimized code 215 vs naive 4 rows');
  // Silent: key alias s = a.lc while ob.s is another GROUP BY key; HAVING s = 'v' filters b.s instead.
  expect(await cells(lj().groupBy(r => ({ s: r.a.lc, x: r.b.s })).aggregate(() => ({ c: count() })).where(r => r.s.eq('v')).ir)).toBe('0:agree 1:optimized 0 rows vs naive 2 rows');
  expect(await cells(inner.groupBy(r => ({ s: r.a.lc, x: r.b.s })).aggregate(() => ({ c: count() })).where(r => r.s.eq('v')).ir)).toBe('0:agree 1:optimized 0 rows vs naive 2 rows');
});

/** Fix round 1 (was a DEFECT pin): 24.8 returns LowCardinality(Nullable(String)) — the SimpleAggregateFunction wrapper
 * dropped — for a null-extended SimpleAggregateFunction(max, LowCardinality(String)) column; outerColumnType now agrees. */
it('SimpleAggregateFunction over LowCardinality through LEFT JOIN: descriptor equals server meta, decode', async () => {
  await raw("CREATE TABLE saf_lc (id UInt32, m SimpleAggregateFunction(max, LowCardinality(String)), u SimpleAggregateFunction(anyLast, UUID)) ENGINE=AggregatingMergeTree ORDER BY id");
  await raw("INSERT INTO saf_lc VALUES (2, 'q', '00000000-0000-0000-0000-000000000001')");
  const saf = from(table('saf_lc', { id: col.UInt32, m: { type: parseCHType('SimpleAggregateFunction(max, LowCardinality(String))') }, u: { type: parseCHType('SimpleAggregateFunction(anyLast, UUID)') } } as never, meta));
  const q = leftJoin({ a: A }, { s: saf as typeof C }).on(r => r.a.id.eq((r.s as any).id)).map(r => ({ id: r.a.id, m: (r.s as any).m, u: (r.s as any).u }));
  const optimized = compile(q.ir), naive = emitNaive(q.ir);
  expect(optimized.columns).toEqual(naive.columns);
  const server = await execute(optimized.sql, optimized.params);
  expect(await execute(naive.sql, naive.params)).toEqual(server);
  expect(printed(optimized.columns)).toEqual(['UInt32', 'LowCardinality(Nullable(String))', 'Nullable(SimpleAggregateFunction(anyLast, UUID))']);
  expect(server.meta).toEqual(['UInt32', 'LowCardinality(Nullable(String))', 'Nullable(SimpleAggregateFunction(anyLast, UUID))']);
  expect(server.data!.filter(r => r[1] === null).length).toBe(3); // ids 1, 3, 5 unmatched: NULL, as the descriptor now says
  // The client still cannot decode a remaining SimpleAggregateFunction column (pre-existing decode_unsupported).
  const backend = createClickHouseBackend({ url, username: 'fixture', password: 'fixture' });
  try { expect(() => backend.compile(q.ir)).toThrow('decode_unsupported: SimpleAggregateFunction(anyLast, UUID)'); }
  finally { await backend.close(); }
});

it('inputs: empty sides, distinct/limit/aggregate/unionAll inputs, final() scans, a CTE-name alias', async () => {
  const none = B.where(r => r.id.gt(100));
  await agree(leftJoin({ a: A }, { b: none }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, s: r.b.s, tags: r.b.tags, t: r.b.t })).ir, { label: 'empty right', oracle: `SELECT a.id, b.s, b.tags, b.t FROM oa a LEFT ALL JOIN (SELECT * FROM ob WHERE id > 100) b ON a.id = b.id ${J}` });
  await agree(fullJoin({ a: A.where(r => r.id.gt(100)) }, { b: none }).on(r => r.a.id.eq(r.b.id)).ir, { label: 'full, both empty' });
  await agree(rightJoin({ a: A.where(r => r.id.gt(100)) }, { b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.b.id, as: r.a.s })).ir, { label: 'right, empty left', oracle: `SELECT b.id, a.s FROM (SELECT * FROM oa WHERE id > 100) a RIGHT ALL JOIN ob b ON a.id = b.id ${J}` });
  const agg = B.groupBy(r => ({ id: r.id })).aggregate(g => ({ c: count(), mx: max(g.n) }));
  await agree(leftJoin({ a: A.distinct() }, { g: agg }).on(r => r.a.id.eq(r.g.id)).map(r => ({ id: r.a.id, c: r.g.c, mx: r.g.mx })).ir, { label: 'distinct LEFT aggregate', oracle: `SELECT a.id, g.c, g.mx FROM (SELECT DISTINCT * FROM oa) a LEFT ALL JOIN (SELECT id, count() AS c, max(n) AS mx FROM ob GROUP BY id) g ON a.id = g.id ${J}` });
  const u = unionAll(A.map(r => ({ id: r.id, s: r.s })), B.map(r => ({ id: r.id, s: r.s })));
  await agree(fullJoin({ u }, { c: C }).on(r => r.u.id.eq(r.c.id)).map(r => ({ id: r.u.id, s: r.u.s, v: r.c.v })).ir, { label: 'unionAll FULL table', oracle: `SELECT u.id, u.s, c.v FROM (SELECT id, s FROM oa UNION ALL SELECT id, s FROM ob) u FULL ALL JOIN oc c ON u.id = c.id ${J}` });
  await agree(leftJoin({ a: A.orderBy(r => r.n).limit(2) }, { b: B.final() }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, bn: r.b.n })).ir, { label: 'limit LEFT final (plain MergeTree: ILLEGAL_FINAL on both)', error: '181', oracle: `SELECT a.id, b.n FROM (SELECT * FROM oa ORDER BY n LIMIT 2) a LEFT ALL JOIN (SELECT * FROM ob FINAL) b ON a.id = b.id ${J}` });
  await agree(leftJoin({ a: A.orderBy(r => r.n).limit(2) }, { b: B }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id, bn: r.b.n })).ir, { label: 'limit LEFT', oracle: `SELECT a.id, b.n FROM (SELECT * FROM oa ORDER BY n LIMIT 2) a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
  await agree(leftJoin({ t0: A }, { t1: B.cte() }).on(r => r.t0.id.eq(r.t1.id)).map(r => ({ id: r.t0.id, s: r.t1.s })).ir, { label: 'CTE-name aliases', oracle: `SELECT a.id, b.s FROM oa a LEFT ALL JOIN ob b ON a.id = b.id ${J}` });
});

// Re-verification (fix round 1): SAF combinations the Worker's probe does not list; each declared type through a
// never-matching LEFT ALL JOIN must come back as print(outerColumnType(declared)). Kinds the server refuses are recorded.
it('re-verification: every further SimpleAggregateFunction/LowCardinality combination equals outerColumnType natively', async () => {
  const kinds = [
    'SimpleAggregateFunction(anyLast, LowCardinality(String))', 'SimpleAggregateFunction(min, LowCardinality(UInt32))', 'SimpleAggregateFunction(any, LowCardinality(FixedString(3)))',
    'SimpleAggregateFunction(max, LowCardinality(Date))', "SimpleAggregateFunction(max, LowCardinality(DateTime('UTC')))", 'SimpleAggregateFunction(anyLast, LowCardinality(Float64))',
    'SimpleAggregateFunction(max, LowCardinality(Nullable(UInt32)))', 'SimpleAggregateFunction(anyLast, Nullable(String))', 'SimpleAggregateFunction(sum, LowCardinality(UInt64))',
    'SimpleAggregateFunction(groupUniqArrayArray, Array(LowCardinality(String)))', 'SimpleAggregateFunction(anyLast, Array(Nullable(String)))', 'SimpleAggregateFunction(anyLast, Tuple(a LowCardinality(String)))',
    'Tuple(a SimpleAggregateFunction(max, LowCardinality(String)))', 'Array(SimpleAggregateFunction(max, LowCardinality(String)))', 'Map(String, SimpleAggregateFunction(max, LowCardinality(String)))',
    'SimpleAggregateFunction(max, String)', 'SimpleAggregateFunction(max, Decimal(18, 2))', 'SimpleAggregateFunction(anyLast, IPv6)',
  ];
  await raw('CREATE TABLE IF NOT EXISTS rv_key (id UInt8) ENGINE=Memory');
  await raw('INSERT INTO rv_key VALUES (1)');
  const rows: string[] = [];
  for (const [i, kind] of kinds.entries()) {
    const created = await fetch(`${url}/?allow_suspicious_low_cardinality_types=1`, { method: 'POST', headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' }, body: `CREATE TABLE rv_${i} (c ${kind}) ENGINE=Memory` });
    if (!created.ok) { rows.push(`${kind} → refused ${/Code: (\d+)/.exec(await created.text())?.[1]}`); continue; }
    const r = await execute(`SELECT r.c FROM rv_key AS l LEFT ALL JOIN (SELECT c, toUInt8(0) AS p FROM rv_${i}) AS r ON l.id = r.p SETTINGS join_use_nulls = 1`);
    const rule = print(outerColumnType(parseCHType(kind)));
    expect(r.meta?.[0], `${kind}: server ${JSON.stringify(r)} vs rule ${rule}`).toBe(rule);
    rows.push(`${kind} → ${rule}`);
  }
  console.info(`re-verification SAF sweep:\n${rows.join('\n')}`);
  expect(rows.filter(r => r.includes('refused')).length).toBeLessThan(kinds.length);
});
