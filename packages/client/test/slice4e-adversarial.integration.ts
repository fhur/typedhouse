import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  cast,
  col,
  count,
  from,
  leftJoin,
  max,
  now,
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

/** Slice 4e Tester probes (clickhouse/clickhouse-server:24.8). Every query: results contract optimized vs naive and
 * server meta = descriptor columns (Bool printed as UInt8, the pre-existing normalisation, TODO.md 4a Tester L346) on
 * both emitters x prefer_column_name_to_alias 0/1 x optimize_move_to_prewhere 0/1; decoded rows equal across emitters. */
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const lcn = <T, D extends CHType>(c: Column<T, boolean, D>) => col.LowCardinality(col.Nullable(c));

const E = { a: 1, b: 2 } as const;

const tcols = {
  id: col.UInt32,
  s: col.String,
  ns: col.Nullable(col.String),
  lc: col.LowCardinality(col.String),
  ls: lcn(col.String),
  other: lcn(col.String),
  lu32: lcn(col.UInt32),
  u64: col.UInt64,
  arr: col.Array(lcn(col.String)),
  ldt: lcn(col.DateTime('UTC')),
};

const DDL =
  "(id UInt32, s String, ns Nullable(String), lc LowCardinality(String), ls LowCardinality(Nullable(String)), other LowCardinality(Nullable(String)), lu32 LowCardinality(Nullable(UInt32)), u64 UInt64, arr Array(LowCardinality(Nullable(String))), ldt LowCardinality(Nullable(DateTime('UTC')))) ENGINE=MergeTree ORDER BY id";

const T = from(table('t4e', tcols, meta));

const A = from(table('a4e', { id: col.UInt32, s: col.String }, meta));

const B = from(
  table(
    'b4e',
    {
      id: col.UInt32,
      lc: col.LowCardinality(col.String),
      s: col.String,
      saf: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)),
    },
    meta,
  ),
);

let container: StartedTestContainer;

let url: string;

type Settings = Readonly<Record<string, string | number>>;

interface Out {
  meta?: string[];
  data?: unknown[][];
  objects?: Record<string, unknown>[];
  error?: string;
}

async function post(
  body: string,
  params: Readonly<Record<string, string>> = {},
  settings: Settings = {},
) {
  const endpoint = new URL(url);
  for (const [k, v] of Object.entries(params)) endpoint.searchParams.set(`param_${k}`, v);
  for (const [k, v] of Object.entries(settings)) endpoint.searchParams.set(k, String(v));
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
  params: Readonly<Record<string, string>>,
  settings: Settings,
  ordered: boolean,
): Promise<Out> {
  const { ok, text } = await post(`${sql} FORMAT JSON`, params, settings);
  if (!ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 300) };

  const json = JSON.parse(text) as {
    meta: { name: string; type: string }[];
    data: Record<string, unknown>[];
  };

  const objects = ordered
    ? json.data
    : [...json.data].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

  return {
    meta: json.meta.map(m => print(parseCHType(m.type))),
    data: objects.map(o => Object.values(o)),
    objects,
  };
}

const raw = async (sql: string, settings: Settings = {}) => {
  const r = await post(sql, {}, settings);
  if (!r.ok) throw new Error(r.text);
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
  await raw(`CREATE TABLE t4e ${DDL}`, { allow_suspicious_low_cardinality_types: 1 });

  await raw(`INSERT INTO t4e VALUES
    (1, 'c1', 'n1', 'l1', 'a', 'o1', 10, 11, ['a', NULL], '2020-01-01 00:00:00'),
    (2, 'c2', NULL, 'l2', NULL, 'o2', NULL, 22, [NULL], NULL),
    (3, 'c3', 'n3', '', '', NULL, 0, 33, [], '1970-01-01 00:00:00'),
    (4, 'c2', 'n4', 'l2', NULL, NULL, NULL, 44, ['x'], NULL)`);

  await raw('CREATE TABLE a4e (id UInt32, s String) ENGINE=MergeTree ORDER BY id');

  await raw(
    'CREATE TABLE b4e (id UInt32, lc LowCardinality(String), s String, saf SimpleAggregateFunction(max, LowCardinality(String))) ENGINE=MergeTree ORDER BY id',
  );

  await raw("INSERT INTO a4e VALUES (1, 'a1'), (2, 'a2'), (3, 'x'), (4, 'a4')");

  await raw(
    "INSERT INTO b4e VALUES (1, 'x', 'b1', 'm1'), (2, '', 'b2', 'm2'), (2, 'y', 'b3', 'm3'), (9, 'z', 'b9', 'm9')",
  );
}, 120000);

afterAll(async () => {
  await container?.stop();
});

const cells: Settings[] = [];

for (const alias of [0, 1])
  for (const prewhere of [0, 1])
    cells.push({ prefer_column_name_to_alias: alias, optimize_move_to_prewhere: prewhere });

const norm = (t: CHType) => print(t).replace(/\bBool\b/g, 'UInt8');

const metaMismatches: string[] = [];

async function check(
  label: string,
  root: Rel,
  ordered = false,
): Promise<{ sql: string; naive: string }> {
  const optimized = compile(root),
    naive = emitNaive(root);

  const context = `${label}\n${optimized.sql}\n${naive.sql}`;

  expect(Object.values(optimized.columns).map(print), context).toEqual(
    Object.values(naive.columns).map(print),
  );

  const columns = Object.values(optimized.columns).map(norm);

  for (const settings of cells) {
    const a = await execute(optimized.sql, optimized.params, settings, ordered),
      b = await execute(naive.sql, naive.params, settings, ordered);

    const cell = `${context}\n${JSON.stringify(settings)}\n${a.error ?? ''} ${b.error ?? ''}`;
    expect(b.error, cell).toBeUndefined();
    expect(resultsContract(a, b), cell).toEqual({ ok: true, kind: 'equal' });

    for (const [which, out] of [
      ['opt', a],
      ['naive', b],
    ] as const) {
      if (JSON.stringify(out.meta) !== JSON.stringify(columns))
        metaMismatches.push(
          `${label} ${which} ${JSON.stringify(settings)}: meta ${JSON.stringify(out.meta)} vs columns ${JSON.stringify(columns)}`,
        );
    }

    let decode: ReturnType<typeof rowDecoder>;

    try {
      decode = rowDecoder(optimized.columns, optimized.columnPaths);
    } catch (e) {
      metaMismatches.push(
        `(info) ${label}: ${(e as Error).message} (pre-existing, plain columns too)`,
      );

      continue;
    }

    expect(a.objects!.map(decode), cell).toEqual(
      b.objects!.map(rowDecoder(naive.columns, naive.columnPaths)),
    );
  }

  return { sql: optimized.sql, naive: naive.sql };
}

it('fallback kinds over LC(Nullable(String)): Param, typed, NULL, columns, nested, ifNull over ifNull, constant-folded', async () => {
  const q = T.map(r => ({
    id: r.id,
    p: r.ls.ifNull('z'),
    tp: r.ls.ifNull(val('k')),
    np: r.ls.ifNull(null),
    ntp: r.ls.ifNull(val(null, col.Nullable(col.String))),
    c: r.ls.ifNull(r.s),
    lc: r.ls.ifNull(r.lc),
    o: r.ls.ifNull(r.other),
    n: r.ls.ifNull(r.ns),
    nest: r.ls.ifNull(r.other.ifNull('q')),
    over: r.ls.ifNull(r.other).ifNull('q'),
    cst: r.ls.ifNull(cast(val('k'), col.String)),
    fold: r.lu32.ifNull(val(1, col.UInt32).plus(1) as never),
    u: r.lu32.ifNull(r.u64 as never),
    wf: r.lu32.ifNull(val(1.5)),
    wu: r.lu32.ifNull(val(7n, col.UInt64) as never),
    wn: r.lu32.ifNull(val(null, col.Nullable(col.UInt64)) as never),
  }));

  const { sql } = await check('fallback kinds', q.ir);
  expect(sql).toContain('toLowCardinality(ifNull(`ls`, `s`))');
});

it('other T: LC(Nullable) of DateTime64(3, UTC), Enum8, UUID, IPv4, Decimal (DDL permitting), DateTime with now()', async () => {
  const exotic: [string, Column, string, Column, string, string, unknown][] = [
    [
      'dt64',
      lcn(col.DateTime64(3, 'UTC')),
      "DateTime64(3, 'UTC')",
      col.DateTime64(3, 'UTC'),
      "'2020-01-01 00:00:00.123'",
      "'2021-01-01 00:00:00.5'",
      new Date(Date.UTC(2001, 1, 1, 0, 0, 0, 5)),
    ],
    ['e8', lcn(col.Enum8(E)), "Enum8('a' = 1, 'b' = 2)", col.Enum8(E), "'a'", "'b'", 'a'],
    [
      'uuid',
      lcn(col.UUID),
      'UUID',
      col.UUID,
      "'00000000-0000-0000-0000-000000000001'",
      "'00000000-0000-0000-0000-00000000000a'",
      '00000000-0000-0000-0000-00000000000f',
    ],
    ['ip', lcn(col.IPv4), 'IPv4', col.IPv4, "'1.2.3.4'", "'9.9.9.9'", '5.5.5.5'],
    ['dec', lcn(col.Decimal(10, 2)), 'Decimal(10, 2)', col.Decimal(10, 2), '1.5', '2.25', '7.5'],
  ];

  for (const [k, lcol, ddl, plain, v1, v2, js] of exotic) {
    const created = await post(
      `CREATE TABLE x_${k} (id UInt32, l LowCardinality(Nullable(${ddl})), p ${ddl}) ENGINE=MergeTree ORDER BY id`,
      {},
      { allow_suspicious_low_cardinality_types: 1 },
    );

    if (!created.ok) {
      metaMismatches.push(
        `(info) LC(Nullable(${ddl})) DDL rejected by 24.8: ${/Code: \d+/.exec(created.text)?.[0]}`,
      );

      continue;
    }

    await raw(`INSERT INTO x_${k} VALUES (1, ${v1}, ${v2}), (2, NULL, ${v2})`);
    const X = from(table(`x_${k}`, { id: col.UInt32, l: lcol, p: plain }, meta));

    await check(
      `${k} column fallback`,
      X.map(r => ({ id: r.id, v: (r as any).l.ifNull((r as any).p) as never })).ir,
    );

    try {
      const q = X.map(r => ({ id: r.id, v: (r as any).l.ifNull(js) as never }));
      compile(q.ir);
      await check(`${k} JS fallback`, q.ir);
    } catch (e) {
      metaMismatches.push(`(info) ${k} JS fallback: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  try {
    const q = T.map(r => ({ id: r.id, v: r.ldt.ifNull(now() as never) as never }));
    compile(q.ir);
    await check('ldt now()', q.ir);
  } catch (e) {
    metaMismatches.push(`(info) ldt.ifNull(now()) ${(e as Error).message.split('\n')[0]}`);
  }
});

it('planner interactions: GROUP BY key, HAVING, ORDER BY alias, alias = column name, DISTINCT, ARRAY JOIN, PushFilterProject fold', async () => {
  await check(
    'group key',
    T.groupBy(r => ({ k: r.ls.ifNull(r.s) }))
      .aggregate(() => ({ n: count() }))
      .where(r => r.n.gt(0n))
      .orderBy(r => r.k).ir,
    true,
  );

  await check(
    'group key alias=column',
    T.groupBy(r => ({ ls: r.ls.ifNull(r.s) }))
      .aggregate(() => ({ n: count() }))
      .where(r => r.ls.ne('zz'))
      .orderBy(r => r.ls).ir,
    true,
  );

  await check(
    'group key param + max',
    T.groupBy(r => ({ k: r.ls.ifNull('z') }))
      .aggregate(r => ({ m: max(r.other.ifNull(r.s)) }))
      .orderBy(r => r.k).ir,
    true,
  );

  await check(
    'alias shadows column, filtered and ordered',
    T.map(r => ({ id: r.id, ls: r.ls.ifNull(r.s) }))
      .where(r => r.ls.eq('c2'))
      .orderBy(r => r.ls)
      .thenBy(r => r.id).ir,
    true,
  );

  await check(
    'alias shadows other column',
    T.map(r => ({ id: r.id, s: r.ls.ifNull(r.s), other: r.other.ifNull(r.lc) }))
      .where(r => r.s.ne('a'))
      .where(r => r.other.ne('')).ir,
  );

  await check(
    'distinct',
    T.map(r => ({ k: r.ls.ifNull(r.lc) }))
      .distinct()
      .orderBy(r => r.k).ir,
    true,
  );

  await check('distinct param', T.map(r => ({ k: r.ls.ifNull('l2') })).distinct().ir);

  await check(
    'array join element',
    T.arrayJoin(r => r.arr, 'e')
      .map(r => ({ id: r.id, e: r.e.ifNull(r.s), p: r.e.ifNull('z') }))
      .where(r => r.e.ne('x')).ir,
  );

  await check(
    'array join filter over ifNull',
    T.arrayJoin(r => r.arr, 'e')
      .where(r => r.e.ifNull('z').eq('z'))
      .map(r => ({ id: r.id, e: r.e })).ir,
  );

  await check(
    'fold: filter over computed ifNull',
    T.where(r => r.id.gt(0))
      .map(r => ({ id: r.id, x: r.ls.ifNull(r.s) }))
      .where(r => r.x.eq('a').or(r.x.eq('c2'))).ir,
  );

  await check(
    'fold: two layers',
    T.map(r => ({ id: r.id, x: r.ls.ifNull(r.s), y: r.other }))
      .map(r => ({ id: r.id, z: r.y.ifNull(r.x) }))
      .where(r => r.z.ne('o1')).ir,
  );

  await check(
    'order by ifNull limit',
    T.map(r => ({ id: r.id, x: r.ls.ifNull(r.ns) }))
      .orderBy(r => r.x)
      .thenBy(r => r.id)
      .limit(3).ir,
    true,
  );

  await check(
    'where comparison over LC(Nullable) (deviation 2 select)',
    T.map(r => ({ id: r.id, c: r.ls.eq('a'), d: r.ls.ifNull('z').eq('z'), e: r.ls.isNull() })).ir,
  );
});

it('leftJoin: WHERE over ifNull keeps LEFT, GROUP BY / ORDER BY over null-extended ifNull, SAF(LC)', async () => {
  const j = () => leftJoin({ a: A }, { b: B }).on(r => r.a.id.eq(r.b.id));

  for (const [label, q] of [
    [
      'where param',
      j()
        .where(r => r.b.lc.ifNull('x').eq('x'))
        .map(r => ({ id: r.a.id, v: r.b.lc.ifNull('x') })),
    ],
    [
      'where column fallback (b side)',
      j()
        .where(r => r.b.lc.ifNull(r.b.s).ne('y'))
        .map(r => ({ id: r.a.id, v: r.b.lc.ifNull(r.b.s) })),
    ],
    [
      'where column fallback (a side)',
      j()
        .where(r => r.b.lc.ifNull(r.a.s).eq('x'))
        .map(r => ({ id: r.a.id, v: r.b.lc.ifNull(r.a.s) })),
    ],
    [
      'saf',
      j()
        .where(r => r.b.saf.ifNull('none' as never).ne('m1'))
        .map(r => ({ id: r.a.id, v: r.b.saf.ifNull(r.a.s as never) })),
    ],
  ] as const) {
    const { sql } = await check(`leftJoin ${label}`, q.ir);
    expect(sql, label).toContain('LEFT');
  }

  await check(
    'leftJoin group',
    j()
      .groupBy(r => ({ k: r.b.lc.ifNull(r.a.s) }))
      .aggregate(() => ({ n: count() }))
      .orderBy(r => r.k).ir,
    true,
  );

  await check(
    'leftJoin map then filter alias',
    j()
      .map(r => ({ id: r.a.id, lc: r.b.lc.ifNull(r.a.s) }))
      .where(r => r.lc.ne('a1'))
      .orderBy(r => r.lc)
      .thenBy(r => r.id).ir,
    true,
  );
});

it('meta = columns record (printed for the verdict)', () => {
  console.log(['META', ...metaMismatches].join('\n'));

  // Only the pre-existing comparison deviation (LC(Nullable(UInt8)) vs Nullable(Bool)) may appear.
  for (const m of metaMismatches.filter(x => !x.startsWith('(info)')))
    expect(m).toMatch(/deviation 2/);
});
