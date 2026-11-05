import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  col,
  count,
  from,
  leftJoin,
  parseCHType,
  print,
  table,
  val,
  type CHType,
  type Column,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rowDecoder } from '../src/decode.js';
import { resultsContract } from './results-contract.js';

/** Slice 4e native anchors (clickhouse/clickhouse-server:24.8): `ifNull` over LowCardinality(Nullable(T)) on a plain table
 * and through leftJoin (matched and unmatched rows); rows and meta = columns on both emitters in every
 * prefer_column_name_to_alias 0/1 x optimize_move_to_prewhere 0/1 cell, plus the probe pinning the server rule. */
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const lcn = <T, D extends CHType>(c: Column<T, boolean, D>) => col.LowCardinality(col.Nullable(c));

const pcols = {
  id: col.UInt32,
  s: col.String,
  ns: col.Nullable(col.String),
  u64: col.UInt64,
  dt: col.DateTime('UTC'),
  ls: lcn(col.String),
  lfs: lcn(col.FixedString(2)),
  lu8: lcn(col.UInt8),
  lu32: lcn(col.UInt32),
  lu64: lcn(col.UInt64),
  ld: lcn(col.Date),
  ldt: lcn(col.DateTime('UTC')),
  lf: lcn(col.Float64),
  li: lcn(col.Int32),
};

const PDDL =
  "(id UInt32, s String, ns Nullable(String), u64 UInt64, dt DateTime('UTC'), ls LowCardinality(Nullable(String)), lfs LowCardinality(Nullable(FixedString(2))), lu8 LowCardinality(Nullable(UInt8)), lu32 LowCardinality(Nullable(UInt32)), lu64 LowCardinality(Nullable(UInt64)), ld LowCardinality(Nullable(Date)), ldt LowCardinality(Nullable(DateTime('UTC'))), lf LowCardinality(Nullable(Float64)), li LowCardinality(Nullable(Int32))) ENGINE=MergeTree ORDER BY id";

const P = from(table('lp', pcols, meta));

const A = from(table('la', { id: col.UInt32 }, meta));

const B = from(
  table(
    'lb',
    {
      id: col.UInt32,
      lc: col.LowCardinality(col.String),
      saf: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)),
      lcu: col.LowCardinality(col.UInt32),
      s: col.String,
    },
    meta,
  ),
);

let container: StartedTestContainer;

let url: string;

type Settings = Readonly<Record<string, string | number>>;

interface Result {
  meta?: string[];
  data?: unknown[][];
  error?: string;
}

async function post(
  body: string,
  params: Readonly<Record<string, string>> = {},
  settings: Settings = {},
): Promise<{ ok: boolean; text: string }> {
  const endpoint = new URL(url);

  for (const [key, value] of Object.entries(params))
    endpoint.searchParams.set(`param_${key}`, value);

  for (const [key, value] of Object.entries(settings))
    endpoint.searchParams.set(key, String(value));

  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('date_time_output_format', 'iso');
  endpoint.searchParams.set('wait_end_of_query', '1');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body,
  });

  return { ok: response.ok, text: await response.text() };
}

async function execute(
  sql: string,
  params: Readonly<Record<string, string>> = {},
  settings: Settings = {},
): Promise<Result & { objects?: Record<string, unknown>[] }> {
  const { ok, text } = await post(`${sql} FORMAT JSON`, params, settings);
  if (!ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 300) };

  const json = JSON.parse(text) as {
    meta: { name: string; type: string }[];
    data: Record<string, unknown>[];
  };

  const objects = [...json.data].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

  return {
    meta: json.meta.map(m => print(parseCHType(m.type))),
    data: objects.map(o => Object.values(o)),
    objects,
  };
}

const raw = async (sql: string) => {
  const res = await post(sql);
  if (!res.ok) throw new Error(res.text);
  return res.text;
};

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_USER: 'fixture',
      CLICKHOUSE_PASSWORD: 'fixture',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123))
    .start();

  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;

  // allow_suspicious_low_cardinality_types only for the DDL: the probe needs LC(Nullable(UInt8|Float64|Date|...)) columns.
  const res = await post(
    `CREATE TABLE lp ${PDDL}`,
    {},
    { allow_suspicious_low_cardinality_types: 1 },
  );

  if (!res.ok) throw new Error(res.text);

  await raw(
    "INSERT INTO lp VALUES (1, 'c1', 'n1', 11, '2021-01-01 00:00:00', 'a', 'ab', 1, 10, 100, '2020-01-01', '2020-01-01 01:02:03', 1.5, -1), (2, 'c2', NULL, 22, '2022-02-02 00:00:00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL), (3, 'c3', 'n3', 33, '2023-03-03 00:00:00', '', 'cd', 0, 0, 0, '1970-01-01', '1970-01-01 00:00:00', 0, 0)",
  );

  await raw('CREATE TABLE la (id UInt32) ENGINE=MergeTree ORDER BY id');

  const lb = await post(
    'CREATE TABLE lb (id UInt32, lc LowCardinality(String), saf SimpleAggregateFunction(max, LowCardinality(String)), lcu LowCardinality(UInt32), s String) ENGINE=MergeTree ORDER BY id',
    {},
    { allow_suspicious_low_cardinality_types: 1 },
  );

  if (!lb.ok) throw new Error(lb.text);
  // la: 1 and 2 matched (2 twice in lb), 3 and 4 unmatched; lb: orphan 9.
  await raw('INSERT INTO la VALUES (1), (2), (3), (4)');

  await raw(
    "INSERT INTO lb VALUES (1, 'x', 'sx', 5, 'b1'), (2, '', 's2', 0, 'b2'), (2, 'y', 's2', 7, 'b3'), (9, 'z', 'sz', 9, 'b9')",
  );
}, 120000);

afterAll(async () => {
  await container?.stop();
});

const cells: Settings[] = [];

for (const alias of [0, 1])
  for (const prewhere of [0, 1])
    cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });

// Pre-existing and outside 4e: the catalog types predicates as Bool, 24.8 returns UInt8 (and LowCardinality(…UInt8) over LC receivers).
const printed = (columns: Readonly<Record<string, CHType>>) => Object.values(columns).map(print);

async function agree(
  root: Rel,
  label: string,
  expected: { columns: string[]; rows: Record<string, unknown>[] },
) {
  const optimized = compile(root),
    naive = emitNaive(root);

  const context = `${label}\n${optimized.sql}\n${naive.sql}`;
  expect(optimized.columns, context).toEqual(naive.columns);
  expect(printed(optimized.columns), context).toEqual(expected.columns);

  for (const settings of cells) {
    const a = await execute(optimized.sql, optimized.params, settings),
      b = await execute(naive.sql, naive.params, settings);

    const cell = `${context}\n${JSON.stringify(settings)}`;
    expect(a.error, cell).toBeUndefined();
    expect(b.error, cell).toBeUndefined();
    expect(resultsContract(a, b), cell).toEqual({ ok: true, kind: 'equal' });
    expect(a.meta, cell).toEqual(expected.columns);
    expect(b.meta, cell).toEqual(expected.columns);
    const decode = rowDecoder(optimized.columns, optimized.columnPaths);
    expect(a.objects!.map(decode), cell).toEqual(expected.rows);
  }
}

it('probe: 24.8 keeps LowCardinality for a constant fallback, drops it for a column one; toLowCardinality is idempotent', async () => {
  const types = async (e: string) =>
    (
      await execute(`SELECT toTypeName(${e}) AS t FROM lp, lb LIMIT 1`, {
        x: 'q',
        y: '3',
        n: '\\N',
      })
    ).objects?.[0]?.t ?? 'error';

  const table: [string, string][] = [
    ['ifNull(lp.ls, {x:String})', 'LowCardinality(String)'],
    ["ifNull(lp.lfs, toFixedString('zz', 2))", 'LowCardinality(FixedString(2))'],
    ['ifNull(lp.lu8, toUInt8(3))', 'LowCardinality(UInt8)'],
    ['ifNull(lp.lu32, {y:UInt32})', 'LowCardinality(UInt32)'],
    ['ifNull(lp.lu64, toUInt64(3))', 'LowCardinality(UInt64)'],
    ["ifNull(lp.ld, toDate('2020-01-01'))", 'LowCardinality(Date)'],
    ["ifNull(lp.ldt, toDateTime('2020-01-01 00:00:00', 'UTC'))", "LowCardinality(DateTime('UTC'))"],
    ['ifNull(lp.lf, toFloat64(1))', 'LowCardinality(Float64)'],
    ['ifNull(lp.li, toInt32(1))', 'LowCardinality(Int32)'],
    ['ifNull(lp.ls, {n:Nullable(String)})', 'LowCardinality(Nullable(String))'],
    ['ifNull(lp.ls, CAST(NULL AS Nullable(String)))', 'LowCardinality(Nullable(String))'],
    ['ifNull(lp.ls, lp.s)', 'String'],
    ['ifNull(lp.ls, lp.ns)', 'Nullable(String)'],
    ['ifNull(lp.ls, lb.lc)', 'String'],
    ['ifNull(lp.ls, upper({x:String}))', 'LowCardinality(String)'],
    ['toLowCardinality(ifNull(lp.ls, lp.s))', 'LowCardinality(String)'],
    ['toLowCardinality(ifNull(lp.ls, lp.ns))', 'LowCardinality(Nullable(String))'],
    ['toLowCardinality(ifNull(lp.ls, upper({x:String})))', 'LowCardinality(String)'],
    ['toLowCardinality(ifNull(lp.lu32, lp.u64))', 'LowCardinality(UInt64)'],
    ['isNull(lp.ls)', 'UInt8'],
    ['isNotNull(lp.ls)', 'UInt8'],
    ['lp.ls = {x:String}', 'LowCardinality(Nullable(UInt8))'],
    ['lp.ls = lp.s', 'Nullable(UInt8)'],
    ['coalesce(lp.ls, {x:String})', 'LowCardinality(String)'],
  ];

  const seen: [string, string][] = [];
  for (const [e] of table) seen.push([e, String(await types(e)).replace(/\\'/g, "'")]);
  expect(seen).toEqual(table);
});

it('plain table: every probed T with a JS fallback, matched (non-NULL) and NULL rows, both emitters, every cell', async () => {
  const d0 = new Date(Date.UTC(2000, 0, 1));

  const q = P.map(r => ({
    id: r.id,
    ls: r.ls.ifNull('z'),
    lfs: r.lfs.ifNull('zz'),
    lu8: r.lu8.ifNull(3),
    lu32: r.lu32.ifNull(3),
    lu64: r.lu64.ifNull(3n),
    ld: r.ld.ifNull(d0),
    lf: r.lf.ifNull(2.5),
    li: r.li.ifNull(7),
  }));

  await agree(q.ir, 'plain JS fallbacks', {
    columns: [
      'UInt32',
      'LowCardinality(String)',
      'LowCardinality(FixedString(2))',
      'LowCardinality(UInt8)',
      'LowCardinality(UInt32)',
      'LowCardinality(UInt64)',
      'LowCardinality(Date)',
      'LowCardinality(Float64)',
      'LowCardinality(Int32)',
    ],
    rows: [
      {
        id: 1,
        ls: 'a',
        lfs: 'ab',
        lu8: 1,
        lu32: 10,
        lu64: 100n,
        ld: new Date(Date.UTC(2020, 0, 1)),
        lf: 1.5,
        li: -1,
      },
      { id: 2, ls: 'z', lfs: 'zz', lu8: 3, lu32: 3, lu64: 3n, ld: d0, lf: 2.5, li: 7 },
      { id: 3, ls: '', lfs: 'cd', lu8: 0, lu32: 0, lu64: 0n, ld: new Date(0), lf: 0, li: 0 },
    ],
  });
});

it('plain table: column, nullable column, NULL and typed-constant fallbacks (toLowCardinality wrap for non-constants), and a WHERE over ifNull', async () => {
  const q = P.map(r => ({
    id: r.id,
    c: r.ls.ifNull(r.s),
    n: r.ls.ifNull(r.ns),
    z: r.ls.ifNull(null),
    v: r.ls.ifNull(val('k')),
    w: r.lu32.ifNull(r.u64 as never),
    t: r.ldt.ifNull(r.dt),
  }));

  await agree(q.ir, 'plain non-constant fallbacks', {
    columns: [
      'UInt32',
      'LowCardinality(String)',
      'LowCardinality(Nullable(String))',
      'LowCardinality(Nullable(String))',
      'LowCardinality(String)',
      'LowCardinality(UInt64)',
      "LowCardinality(DateTime('UTC'))",
    ],
    rows: [
      { id: 1, c: 'a', n: 'a', z: 'a', v: 'a', w: 10n, t: new Date(Date.UTC(2020, 0, 1, 1, 2, 3)) },
      { id: 2, c: 'c2', n: null, z: null, v: 'k', w: 22n, t: new Date(Date.UTC(2022, 1, 2)) },
      { id: 3, c: '', n: '', z: '', v: '', w: 0n, t: new Date(0) },
    ],
  });

  const w = P.where(r => r.ls.ifNull('z').ne('a'))
    .where(r => r.lu32.ifNull(5).gt(1))
    .map(r => ({ id: r.id, ls: r.ls.ifNull('z') }));

  await agree(w.ir, 'WHERE over ifNull', {
    columns: ['UInt32', 'LowCardinality(String)'],
    rows: [{ id: 2, ls: 'z' }],
  });
});

it('through leftJoin: LC(String), SAF(max, LC(String)) and LC(UInt32) on the null-extended side, matched and unmatched rows', async () => {
  const j = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));

  const q = j().map(r => ({
    id: r.a.id,
    lc: r.b.lc.ifNull('none'),
    saf: r.b.saf.ifNull('none' as never),
    u: r.b.lcu.ifNull(42),
    c: r.b.lc.ifNull(r.b.s),
    raw: r.b.lc,
  }));

  await agree(q.ir, 'leftJoin select', {
    // b.s is Nullable(String) on the null-extended side: a nullable fallback keeps Nullable inside LowCardinality.
    columns: [
      'UInt32',
      'LowCardinality(String)',
      'LowCardinality(String)',
      'LowCardinality(UInt32)',
      'LowCardinality(Nullable(String))',
      'LowCardinality(Nullable(String))',
    ],
    rows: [
      { id: 1, lc: 'x', saf: 'sx', u: 5, c: 'x', raw: 'x' },
      { id: 2, lc: '', saf: 's2', u: 0, c: '', raw: '' },
      { id: 2, lc: 'y', saf: 's2', u: 7, c: 'y', raw: 'y' },
      { id: 3, lc: 'none', saf: 'none', u: 42, c: null, raw: null },
      { id: 4, lc: 'none', saf: 'none', u: 42, c: null, raw: null },
    ],
  });

  // A total, non-null-rejecting WHERE over the ifNull keeps the join LEFT and keeps unmatched rows.
  const w = j()
    .where(r => r.b.lc.ifNull('none').ne('y'))
    .map(r => ({ id: r.a.id, lc: r.b.lc.ifNull('none') }));

  expect(compile(w.ir).sql).toContain('LEFT ALL JOIN');

  await agree(w.ir, 'leftJoin WHERE', {
    columns: ['UInt32', 'LowCardinality(String)'],
    rows: [
      { id: 1, lc: 'x' },
      { id: 2, lc: '' },
      { id: 3, lc: 'none' },
      { id: 4, lc: 'none' },
    ],
  });

  // Grouped by the ifNull over the null-extended side.
  const g = j()
    .groupBy(r => ({ k: r.b.lc.ifNull('none') }))
    .aggregate(() => ({ n: count() }));

  await agree(g.ir, 'leftJoin group key', {
    columns: ['LowCardinality(String)', 'UInt64'],
    rows: [
      { k: '', n: 1n },
      { k: 'none', n: 2n },
      { k: 'x', n: 1n },
      { k: 'y', n: 1n },
    ],
  });
});
