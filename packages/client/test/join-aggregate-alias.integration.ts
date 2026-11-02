import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { col, count, max, from, join, leftJoin, rightJoin, fullJoin, table, parseCHType, print, type Rel, type CHType } from '@typedhouse/core';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';
import { compile, emitNaive } from '@typedhouse/compiler';

// Slice 4c native anchor matrix on clickhouse/clickhouse-server:24.8: an Aggregate over a join block whose output aliases
// collide with join-input columns. Per shape and join kind (inner, left, right, full, and a LeftToInner-converted left),
// both emitters x prefer_column_name_to_alias 0/1 x optimize_move_to_prewhere 0/1 agree in rows, meta and error code; meta
// equals print(compiled.columns); and the first cell equals a hand-written oracle whose inner aliases collide with nothing.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const cols = { id: col.UInt32, s: col.String, n: col.Int64, lc: col.LowCardinality(col.String), tags: col.Array(col.String) };
const DDL = '(id UInt32, s String, n Int64, lc LowCardinality(String), tags Array(String)) ENGINE=MergeTree ORDER BY id';
const A = from(table('ja', cols, meta)), B = from(table('jb', cols, meta));
const C = from(table('jc', { id: col.UInt32, v: col.String }, meta));
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
  await raw(`CREATE TABLE ja ${DDL}`);
  await raw(`CREATE TABLE jb ${DDL}`);
  await raw('CREATE TABLE jc (id UInt32, v String) ENGINE=MergeTree ORDER BY id');
  // ja: duplicate id 2, orphans 1 and 5. jb: duplicate id 2, orphans 4 and 6. s/lc values overlap across tables on purpose.
  await raw("INSERT INTO ja VALUES (1, 'v', 10, 'u', ['p']), (2, 'w', 20, 'v', []), (2, 'v', 21, 'v', ['q']), (3, 'u', 30, '', []), (5, 'v', 50, 'w', ['r'])");
  await raw("INSERT INTO jb VALUES (2, 'v', 7, 'v', ['b']), (2, 'u', 8, 'u', []), (3, 'w', 9, '', []), (4, 'v', 4, 'o', ['o']), (6, 'z', 6, 'z', ['s'])");
  await raw("INSERT INTO jc VALUES (1, 'c1'), (2, 'c2'), (3, 'c3'), (7, 'c7')");
}, 120000);
afterAll(async () => { await container?.stop(); });

const cells: Settings[] = [];
for (const alias of [0, 1]) for (const prewhere of [0, 1]) cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });
const J = 'SETTINGS join_use_nulls = 1';
const printed = (columns: Readonly<Record<string, CHType>>) => Object.values(columns).map(t => print(t));
async function agree(root: Rel, options: { label: string; oracle: string; ordered: boolean; fenced: boolean }) {
  const optimized = compile(root), naive = emitNaive(root);
  const context = `${options.label}\n${optimized.sql}`;
  expect(optimized.columns, context).toEqual(naive.columns);
  // Fenced: the aggregate reads the join block as a derived table; folded: it groups by side reads on the join block.
  expect(/GROUP BY `__typedhouse_input`\./.test(optimized.sql), context).toBe(options.fenced);
  expect(/\nGROUP BY `[a-z]+`\./.test(optimized.sql), context).toBe(!options.fenced);
  let first: Result | undefined;
  for (const settings of cells) for (const [emitter, c] of [['optimized', optimized], ['naive', naive]] as const) {
    const result = await execute(c.sql, c.params, settings, options.ordered);
    const label = `${context}\n${emitter} ${JSON.stringify(settings)}`;
    expect(result.error, label).toBeUndefined();
    expect(result.meta, label).toEqual(printed(optimized.columns));
    first ??= result;
    expect(result, label).toEqual(first);
  }
  const o = await execute(options.oracle, {}, {}, options.ordered);
  expect(o, `${context}\noracle`).toEqual(first);
}

type Kind = 'inner' | 'left' | 'right' | 'full' | 'converted';
const kinds: Kind[] = ['inner', 'left', 'right', 'full', 'converted'];
function joined(kind: Kind): any {
  if (kind === 'inner') return join({ a: A, b: B }).on(r => r.a.id.eq(r.b.id));
  if (kind === 'left') return leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
  if (kind === 'right') return rightJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
  if (kind === 'full') return fullJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));
  return leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.n.gt(0n));
}
const from_ = (kind: Kind) => kind === 'converted' ? `FROM ja a LEFT ALL JOIN jb b ON a.id = b.id WHERE b.n > 0` : `FROM ja a ${kind === 'inner' ? 'INNER' : kind.toUpperCase()} ALL JOIN jb b ON a.id = b.id`;
const settings = (kind: Kind) => kind === 'inner' ? '' : ` ${J}`;

// [label, build, oracle (select list over inner aliases, GROUP BY, outer clause), ordered, fenced]
const shapes: [string, (q: any) => { ir: Rel }, (kind: Kind) => string, boolean, boolean][] = [
  ['aggregate alias n = count() beside max(b.n), HAVING n', q => q.groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ n: count(), mx: max(g.b.n) })).where((r: any) => r.n.gt(1n)),
    k => `SELECT kk AS id, cc AS n, mm AS mx FROM (SELECT a.id AS kk, count() AS cc, max(b.n) AS mm ${from_(k)} GROUP BY a.id) WHERE cc > 1${settings(k)}`, false, true],
  ['aggregate alias n ORDER BY n', q => q.groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ n: count(), mx: max(g.b.n) })).orderBy((r: any) => r.n).thenBy((r: any) => r.id),
    k => `SELECT kk AS id, cc AS n, mm AS mx FROM (SELECT a.id AS kk, count() AS cc, max(b.n) AS mm ${from_(k)} GROUP BY a.id) ORDER BY cc, kk${settings(k)}`, true, true],
  ['key alias s = a.lc beside key x = b.s, HAVING s', q => q.groupBy((r: any) => ({ s: r.a.lc, x: r.b.s })).aggregate(() => ({ c: count() })).where((r: any) => r.s.eq('v')),
    k => `SELECT kk AS s, xx AS x, cc AS c FROM (SELECT a.lc AS kk, b.s AS xx, count() AS cc ${from_(k)} GROUP BY a.lc, b.s) WHERE kk = 'v'${settings(k)}`, false, true],
  ['key alias id = b.id (a name both inputs carry), ORDER BY id', q => q.groupBy((r: any) => ({ id: r.b.id })).aggregate(() => ({ c: count() })).orderBy((r: any) => r.id),
    k => `SELECT kk AS id, cc AS c FROM (SELECT b.id AS kk, count() AS cc ${from_(k)} GROUP BY b.id) ORDER BY kk${settings(k)}`, true, true],
  // The HAVING mixes in the aggregate so PushFilterAggKey cannot move it below the Aggregate.
  ['key alias id = a.id (a name both inputs carry), HAVING id', q => q.groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ c: count() })).where((r: any) => r.id.ne(3).or(r.c.gt(5n))),
    k => `SELECT kk AS id, cc AS c FROM (SELECT a.id AS kk, count() AS cc ${from_(k)} GROUP BY a.id) WHERE kk != 3 OR cc > 5${settings(k)}`, false, true],
  ['key alias tags = a.s (a pruned column of both inputs), ORDER BY tags', q => q.groupBy((r: any) => ({ tags: r.a.s })).aggregate(() => ({ c: count() })).orderBy((r: any) => r.tags),
    k => `SELECT kk AS tags, cc AS c FROM (SELECT a.s AS kk, count() AS cc ${from_(k)} GROUP BY a.s) ORDER BY kk${settings(k)}`, true, true],
  ['identity key id = a.id with no HAVING/ORDER BY (ON reads id qualified only): folds', q => q.groupBy((r: any) => ({ id: r.a.id })).aggregate((g: any) => ({ c: count(), m: max(g.b.s) })),
    k => `SELECT a.id AS id, count() AS c, max(b.s) AS m ${from_(k)} GROUP BY a.id${settings(k)}`, false, false],
  ['non-colliding aliases with HAVING and ORDER BY: folds', q => q.groupBy((r: any) => ({ key: r.a.lc })).aggregate((g: any) => ({ c: count(), top: max(g.b.n) })).where((r: any) => r.c.gt(0n)).orderBy((r: any) => r.key),
    k => `SELECT a.lc AS key, count() AS c, max(b.n) AS top ${from_(k)} GROUP BY a.lc HAVING c > 0 ORDER BY key${settings(k)}`, true, false],
];

for (const kind of kinds) it(`4c anchors: ${kind}`, async () => {
  if (kind === 'converted') expect(rewriteRel(joined(kind).groupBy((r: any) => ({ id: r.a.id })).aggregate(() => ({ c: count() })).ir).hits.LeftToInner).toBe(1);
  for (const [label, build, oracle, ordered, fenced] of shapes) await agree(build(joined(kind)).ir, { label: `${kind}: ${label}`, oracle: oracle(kind), ordered, fenced });
}, 120000);

it('4c anchors: an alias equal to a nested join side column fences (conservative); a name only one input carries folds', async () => {
  // Nested side `ac` = join(a, c): its derived table exposes only `__typedhouse_leaf_N`, so `v` cannot really be captured,
  // but N includes nested scans' full schemas by design.
  const nested = leftJoin({ ac: join({ a: A, c: C }).on(r => r.a.id.eq(r.c.id)) }, { b: B }).on(r => r.ac.a.id.eq(r.b.id));
  await agree(nested.groupBy(r => ({ v: r.b.s })).aggregate(() => ({ c: count() })).orderBy(r => r.v).ir, {
    label: 'nested side column v', ordered: true, fenced: true,
    oracle: `SELECT kk AS v, cc AS c FROM (SELECT b.s AS kk, count() AS cc FROM ja a INNER ALL JOIN jc c ON a.id = c.id LEFT ALL JOIN jb b ON a.id = b.id GROUP BY b.s) ORDER BY kk ${J}` });
  // `v` is carried by jc only: the identity read folds, and HAVING/ORDER BY v bind the grouped column under either setting.
  for (const [kind, q] of [['inner', join({ a: A, c: C }).on(r => r.a.id.eq(r.c.id))], ['left', leftJoin({ a: A }, { c: C }).on(r => r.a.id.eq(r.c.id))], ['full', fullJoin({ a: A }, { c: C }).on(r => r.a.id.eq(r.c.id))]] as const)
    await agree((q as any).groupBy((r: any) => ({ v: r.c.v })).aggregate(() => ({ n: count() })).where((r: any) => r.v.ne('zz')).orderBy((r: any) => r.v).ir, {
      label: `${kind}: identity key v only jc carries`, ordered: true, fenced: false,
      oracle: `SELECT c.v AS v, count() AS n FROM ja a ${kind === 'inner' ? 'INNER' : kind.toUpperCase()} ALL JOIN jc c ON a.id = c.id GROUP BY c.v HAVING v != 'zz' ORDER BY v${kind === 'inner' ? '' : ` ${J}`}` });
});

it('4c CTE-source probe: name: agg(name) over a CTE keeps its block only while no HAVING/ORDER BY names it', async () => {
  const shared = A.where(r => r.id.gt(0)).map(r => ({ id: r.id, n: r.n })).cte();
  const plain = shared.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: max(g.n) }));
  expect(compile(plain.ir).sql).toBe('WITH `t0` AS (SELECT `id`, `n` FROM `ja` WHERE `id` > {p0:UInt32}) SELECT `id`, max(`n`) AS `n` FROM `t0` GROUP BY `id`');
  // The pre-4c text: `HAVING n` / `ORDER BY n` bind t0.n under prefer_column_name_to_alias = 1 (code 215).
  const before = 'WITH `t0` AS (SELECT `id`, `n` FROM `ja` WHERE `id` > 0) SELECT `id`, max(`n`) AS `n` FROM `t0` GROUP BY `id`';
  expect((await execute(`${before} HAVING n > 20`, {}, { prefer_column_name_to_alias: 1 })).error).toBe('215');
  expect((await execute(`${before} ORDER BY n`, {}, { prefer_column_name_to_alias: 1 })).error).toBe('215');
  for (const [label, q, ordered] of [['HAVING n', plain.where(r => r.n.gt(20n)), false], ['ORDER BY n', plain.orderBy(r => r.n), true]] as const) {
    const optimized = compile(q.ir), naive = emitNaive(q.ir);
    expect(optimized.sql, label).not.toMatch(/max\(`n`\) AS `n` FROM `t0`/);
    let first: Result | undefined;
    for (const s of cells) for (const c of [optimized, naive]) {
      const r = await execute(c.sql, c.params, s, ordered);
      expect(r.error, `${label} ${JSON.stringify(s)}\n${c.sql}`).toBeUndefined();
      first ??= r;
      expect(r, `${label} ${JSON.stringify(s)}`).toEqual(first);
    }
    expect((await execute(`SELECT id, mm AS n FROM (SELECT id, max(n) AS mm FROM ja WHERE id > 0 GROUP BY id) ${label === 'HAVING n' ? 'WHERE mm > 20' : 'ORDER BY mm'}`, {}, {}, ordered)).data).toEqual(first!.data);
  }
});
