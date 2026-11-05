import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClickHouseBackend, createClient, createClientFromBackend } from '@typedhouse/client';
import {
  argMax,
  argMaxIf,
  argMin,
  argMinIf,
  avgIf,
  cast,
  col,
  count,
  countIf,
  from,
  leftJoin,
  max,
  maxIf,
  min,
  minIf,
  print,
  quantile,
  quantileExact,
  quantileExactIf,
  quantileIf,
  sumIf,
  table,
  unionAll,
  uniqExactIf,
  val,
  type Query,
} from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;

const settings =
  'date_time_output_format=iso&output_format_json_quote_64bit_integers=1&output_format_json_quote_denormals=1&output_format_json_quote_decimals=1';

const NullableBool = col.Nullable(col.Bool);

let container: StartedTestContainer;

let url: string;

let optimized: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClientFromBackend>;

let closeNaive: () => Promise<void>;

async function post(
  body: string,
  params: Readonly<Record<string, string>> = {},
  extra = '',
): Promise<string> {
  const endpoint = new URL(`${url}/?${settings}${extra}`);

  for (const [name, value] of Object.entries(params))
    endpoint.searchParams.set(`param_${name}`, value);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body,
  });

  const text = await response.text();

  if (!response.ok) throw new Error(text);

  return text;
}

async function json(body: string, params?: Readonly<Record<string, string>>, extra?: string) {
  const text = await post(`${body} FORMAT JSON`, params, extra);

  return JSON.parse(text) as {
    meta: { name: string; type: string }[];
    data: Record<string, unknown>[];
  };
}

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

  const options = { url, username: 'fixture', password: 'fixture' };

  optimized = createClient(options);

  const backend = createClickHouseBackend(options, 'clickhouse-naive');

  naive = createClientFromBackend(backend);
  closeNaive = backend.close;
}, 120000);

afterAll(async () => {
  await optimized?.close();
  await closeNaive?.();
  await container?.stop();
});

type AnyQuery = Query<Record<string, unknown>, never>;

/** Run and stream on both emitters, and require the declared column types to equal the server's. */
async function rows(query: unknown): Promise<Record<string, unknown>[]> {
  const typed = query as AnyQuery;
  const first = await optimized.run(typed as never);

  expect(await naive.run(typed as never)).toEqual(first);

  for (const client of [optimized, naive]) {
    const streamed: unknown[] = [];

    for await (const row of client.stream(typed as never)) streamed.push(row);

    expect(streamed).toEqual(first);
  }

  const compiled = compile(typed.ir);

  const declared = Object.entries(compiled.columns).map(([name, type]) => ({
    name,
    type: print(type),
  }));

  for (const plan of [compiled, emitNaive(typed.ir)]) {
    expect((await json(plan.sql, plan.params)).meta).toEqual(declared);
  }

  return first as Record<string, unknown>[];
}

describe('the owner requirement: a NULL predicate excludes the row', () => {
  beforeAll(async () => {
    await post('CREATE TABLE owner (v UInt32, n Nullable(UInt32)) ENGINE=Memory');
    await post('INSERT INTO owner VALUES (2,1),(100,NULL)');
  });

  const owner = from(table('owner', { v: col.UInt32, n: col.Nullable(col.UInt32) }, meta));

  it('maxIf(v, n < 10) returns 2', async () => {
    expect(await rows(owner.aggregate(g => ({ x: maxIf(g.v, g.n.lt(10)) })))).toEqual([{ x: 2 }]);
  });

  it('the server alone counts the NULL-predicate row, so these tests can fail', async () => {
    // A canary: if a later ClickHouse fixes this, the wrapper can be reconsidered.
    await post('CREATE TABLE owner_low (v UInt32, n Nullable(UInt32)) ENGINE=Memory');
    await post('INSERT INTO owner_low VALUES (2,1),(1,NULL)');

    expect((await json('SELECT maxIf(v, n < 10) AS x FROM owner')).data).toEqual([{ x: 100 }]);
    expect((await json('SELECT minIf(v, n < 10) AS x FROM owner_low')).data).toEqual([{ x: 1 }]);

    expect(
      await rows(
        from(table('owner_low', { v: col.UInt32, n: col.Nullable(col.UInt32) }, meta)).aggregate(
          g => ({ x: minIf(g.v, g.n.lt(10)) }),
        ),
      ),
    ).toEqual([{ x: 2 }]);
  });
});

describe('minIf and maxIf equal min and max over a WHERE, for every value type', () => {
  const values = {
    u8: [col.UInt8, 'UInt8', '2', '100', '1'],
    u16: [col.UInt16, 'UInt16', '2', '100', '1'],
    u32: [col.UInt32, 'UInt32', '2', '100', '1'],
    u64: [col.UInt64, 'UInt64', '2', '100', '1'],
    u128: [col.UInt128, 'UInt128', '2', '100', '1'],
    i8: [col.Int8, 'Int8', '2', '100', '-1'],
    i16: [col.Int16, 'Int16', '2', '100', '-1'],
    i32: [col.Int32, 'Int32', '2', '100', '-1'],
    i64: [col.Int64, 'Int64', '2', '100', '-1'],
    i128: [col.Int128, 'Int128', '2', '100', '-1'],
    i256: [col.Int256, 'Int256', '2', '100', '-1'],
    f32: [col.Float32, 'Float32', '2', '100', '-1'],
    f64: [col.Float64, 'Float64', '2', '100', '-1'],
    date: [col.Date, 'Date', "'2026-01-02'", "'2026-12-31'", "'2026-01-01'"],
    date32: [col.Date32, 'Date32', "'2026-01-02'", "'2026-12-31'", "'2026-01-01'"],
    dt: [
      col.DateTime('UTC'),
      "DateTime('UTC')",
      "'2026-01-02 00:00:00'",
      "'2026-12-31 00:00:00'",
      "'2026-01-01 00:00:00'",
    ],
    dt64: [
      col.DateTime64(3, 'UTC'),
      "DateTime64(3, 'UTC')",
      "'2026-01-02 00:00:00.000'",
      "'2026-12-31 00:00:00.000'",
      "'2026-01-01 00:00:00.000'",
    ],
    str: [col.String, 'String', "'b'", "'z'", "'a'"],
    fixed: [col.FixedString(1), 'FixedString(1)', "'b'", "'z'", "'a'"],
    dec: [col.Decimal(18, 2), 'Decimal(18, 2)', '2', '100', '1'],
    bool: [col.Bool, 'Bool', 'true', 'true', 'false'],
    uuid: [
      col.UUID,
      'UUID',
      "'00000000-0000-0000-0000-000000000002'",
      "'00000000-0000-0000-0000-000000000009'",
      "'00000000-0000-0000-0000-000000000001'",
    ],
    lcs: [col.LowCardinality(col.String), 'LowCardinality(String)', "'b'", "'z'", "'a'"],
    lcu: [col.LowCardinality(col.UInt32), 'LowCardinality(UInt32)', '2', '100', '1'],
    arr: [col.Array(col.UInt32), 'Array(UInt32)', '[2]', '[100]', '[1]'],
    nu: [col.Nullable(col.UInt32), 'Nullable(UInt32)', '2', '100', '1'],
    nf: [col.Nullable(col.Float64), 'Nullable(Float64)', '2', '100', '-1'],
    nd: [col.Nullable(col.Date), 'Nullable(Date)', "'2026-01-02'", "'2026-12-31'", "'2026-01-01'"],
    ns: [col.Nullable(col.String), 'Nullable(String)', "'b'", "'z'", "'a'"],
  } as const;

  const names = Object.keys(values) as (keyof typeof values)[];

  const shape = {
    id: col.UInt32,
    g: col.UInt8,
    n: col.Nullable(col.UInt32),
    stored: NullableBool,
    ...Object.fromEntries(names.map(name => [name, values[name][0]])),
  };

  const source = from(table('matrix', shape as never, meta)) as never as Query<any, any>;

  const predicates: [string, (r: any) => unknown][] = [
    ['computed', r => r.n.lt(10)],
    ['stored', r => r.stored],
    ['composed', r => r.n.lt(10).and(r.stored.or(true))],
  ];

  beforeAll(async () => {
    const columns = names.map(name => `${name} ${values[name][1]}`).join(', ');

    const row = (id: number, g: number, n: string, stored: string, index: 2 | 3 | 4) =>
      `(${id}, ${g}, ${n}, ${stored}, ${names.map(name => values[name][index]).join(', ')})`;

    await post(
      `CREATE TABLE matrix (id UInt32, g UInt8, n Nullable(UInt32), stored Nullable(Bool), ${columns}) ENGINE=Memory`,
      {},
      '&allow_suspicious_low_cardinality_types=1',
    );

    // The kept row has the middle value. Rows with a NULL predicate hold the extremes, one larger, one smaller.
    await post(
      `INSERT INTO matrix VALUES ${row(1, 1, '1', 'true', 2)}, ${row(2, 1, 'NULL', 'NULL', 3)}, ${row(3, 1, 'NULL', 'NULL', 4)}`,
    );
  });

  it.each(names)('%s', async name => {
    const global = source.where((r: any) => r.n.isNotNull());
    const expectedHigh = await rows(global.aggregate((g: any) => ({ x: max(g[name]) })));
    const expectedLow = await rows(global.aggregate((g: any) => ({ x: min(g[name]) })));

    for (const [, predicate] of predicates) {
      expect(
        await rows(source.aggregate((g: any) => ({ x: maxIf(g[name], predicate(g) as never) }))),
      ).toEqual(expectedHigh);

      expect(
        await rows(source.aggregate((g: any) => ({ x: minIf(g[name], predicate(g) as never) }))),
      ).toEqual(expectedLow);

      const grouped = source.groupBy((r: any) => ({ g: r.g }));

      expect(
        await rows(grouped.aggregate((g: any) => ({ x: maxIf(g[name], predicate(g) as never) }))),
      ).toEqual(expectedHigh.map(row => ({ g: 1, ...row })));

      expect(
        await rows(grouped.aggregate((g: any) => ({ x: minIf(g[name], predicate(g) as never) }))),
      ).toEqual(expectedLow.map(row => ({ g: 1, ...row })));
    }
  });
});

describe('composed predicates match a WHERE oracle in both emitters', () => {
  const allow = '&allow_suspicious_low_cardinality_types=1';

  const shape = {
    id: col.UInt32,
    g: col.UInt8,
    v: col.UInt32,
    f: col.Float64,
    n: col.Nullable(col.UInt32),
    s: col.Nullable(col.String),
    b: NullableBool,
    lb: col.LowCardinality(NullableBool),
    lcs: col.LowCardinality(col.Nullable(col.String)),
    arr: col.Array(col.Nullable(col.UInt32)),
    tup: col.Tuple({ a: NullableBool }),
  };

  const source = from(table('sweep', shape, meta));

  beforeAll(async () => {
    await post(
      'CREATE TABLE sweep (id UInt32, g UInt8, v UInt32, f Float64, n Nullable(UInt32), s Nullable(String), b Nullable(Bool), lb LowCardinality(Nullable(Bool)), lcs LowCardinality(Nullable(String)), arr Array(Nullable(UInt32)), tup Tuple(a Nullable(Bool))) ENGINE=Memory',
      {},
      allow,
    );

    await post(
      `INSERT INTO sweep VALUES
      (1, 1, 2, 2, 1, 'a', true, true, 'a', [1], tuple(true)),
      (2, 1, 100, 100, NULL, NULL, NULL, NULL, NULL, [NULL], tuple(NULL)),
      (3, 1, 50, 50, 20, 'b', false, false, 'b', [2], tuple(false)),
      (4, 1, 1, 1, NULL, NULL, NULL, NULL, NULL, [], tuple(NULL)),
      (5, 2, 7, 7, NULL, NULL, NULL, NULL, NULL, [], tuple(NULL))`,
      {},
      allow,
    );
  });

  const predicates: Record<string, (r: any) => any> = {
    'n < 10': r => r.n.lt(10),
    'n > 0': r => r.n.gt(0),
    'n = 1': r => r.n.eq(1),
    'n != 1': r => r.n.ne(1),
    between: r => r.n.between(0, 10),
    in: r => r.n.in([1]),
    'not in': r => r.n.notIn([1]),
    'in subquery': r => r.n.in(source.where(x => x.id.eq(1)).map(x => x.n)),
    not: r => r.n.lt(10).not(),
    'and true': r => r.n.lt(10).and(true),
    'and false': r => r.n.lt(10).and(false),
    'or true': r => r.n.lt(10).or(true),
    'or false': r => r.n.lt(10).or(false),
    'and column': r => r.n.lt(10).and(r.v.gt(50)),
    'or column': r => r.n.lt(10).or(r.v.gt(50)),
    'not and': r => r.n.lt(10).and(r.v.gt(0)).not(),
    'not or': r => r.n.lt(10).or(r.v.gt(50)).not(),
    nested: r => r.n.lt(10).or(r.n.gt(100)).and(r.b.or(false)).not(),
    'and null': r => r.n.lt(10).and(null),
    'or null': r => r.n.lt(10).or(null),
    'true and null': r => r.v.gt(0).and(null),
    'true or null': r => r.v.gt(0).or(null),
    stored: r => r.b,
    'not stored': r => r.b.not(),
    'stored or false': r => r.b.or(false),
    'LowCardinality(Nullable(Bool))': r => r.lb,
    'not LowCardinality(Nullable(Bool))': r => r.lb.not(),
    'LowCardinality(Nullable(String)) =': r => r.lcs.eq('a'),
    'LowCardinality(Nullable(String)) empty': r => r.lcs.empty(),
    'nullable string starts': r => r.s.startsWith('a'),
    'nullable string not empty': r => r.s.notEmpty(),
    'constant NULL': () => val(null, NullableBool),
    'constant NULL and': r => val(null, NullableBool).and(r.v.gt(0)),
    'constant NULL or': r => val(null, NullableBool).or(r.v.gt(0)),
    'not constant NULL': () => val(null, NullableBool).not(),
    'NULL version operand': r => val(null, col.Nullable(col.UInt32)).lt(r.v),
    'ifNull(n, 99) < 10': r => r.n.ifNull(99).lt(10),
    'ifNull(b, false)': r => r.b.ifNull(false),
    'ifNull(b, true)': r => r.b.ifNull(true),
    'ifNull(b, null)': r => r.b.ifNull(null),
    isNull: r => r.n.isNull(),
    isNotNull: r => r.n.isNotNull(),
    'array has': r => r.arr.has(1),
    'array element': r => r.arr.arrayElement(1).lt(10),
    'tuple element': r => r.tup.element('a'),
    'not tuple element': r => r.tup.element('a').not(),
    'cast nullable': r => cast(r.n.lt(10), NullableBool),
  };

  it.each(Object.keys(predicates))('%s', async name => {
    const predicate = predicates[name]!;

    const kept = await rows(
      source.where(r => predicate(r) as never).map(r => ({ id: r.id, g: r.g, v: r.v, f: r.f })),
    );

    const extreme = (values: number[], pick: (...n: number[]) => number) =>
      values.length ? pick(...values) : 0;

    const of = (subset: typeof kept) => subset.map(row => row.v as number);

    const build = (g: any) => ({
      high: maxIf(g.v, predicate(g) as never),
      low: minIf(g.v, predicate(g) as never),
      highFloat: maxIf(g.f, predicate(g) as never),
      lowFloat: minIf(g.f, predicate(g) as never),
    });

    expect(await rows(source.aggregate(build as never))).toEqual([
      {
        high: extreme(of(kept), Math.max),
        low: extreme(of(kept), Math.min),
        highFloat: extreme(of(kept), Math.max),
        lowFloat: extreme(of(kept), Math.min),
      },
    ]);

    const grouped = await rows(
      source
        .groupBy(r => ({ g: r.g }))
        .aggregate(build as never)
        .orderBy(r => r.g),
    );

    expect(grouped).toEqual(
      [1, 2].map(g => {
        const subset = of(kept.filter(row => row.g === g));

        return {
          g,
          high: extreme(subset, Math.max),
          low: extreme(subset, Math.min),
          highFloat: extreme(subset, Math.max),
          lowFloat: extreme(subset, Math.min),
        };
      }),
    );
  });
});

describe('composition around a wrapped predicate', () => {
  const composed = from(
    table('composed', { k: col.UInt8, v: col.UInt32, n: col.Nullable(col.UInt32) }, meta),
  );

  const right = from(table('composed_right', { k: col.UInt8, ok: col.Bool, w: col.UInt32 }, meta));

  const grouped = composed
    .groupBy(r => ({ k: r.k }))
    .aggregate(g => ({ hi: maxIf(g.v, g.n.lt(10)), lo: minIf(g.v, g.n.lt(10)) }));

  beforeAll(async () => {
    await post('CREATE TABLE composed (k UInt8, v UInt32, n Nullable(UInt32)) ENGINE=Memory');
    await post('INSERT INTO composed VALUES (1,2,1),(1,100,NULL),(2,50,20),(2,70,NULL),(3,7,NULL)');
    await post('CREATE TABLE composed_right (k UInt8, ok Bool, w UInt32) ENGINE=Memory');
    await post('INSERT INTO composed_right VALUES (1,true,2),(9,true,500)');
  });

  it('a filter on the key, above the aggregate', async () => {
    expect(await rows(grouped.where(r => r.k.eq(1)))).toEqual([{ k: 1, hi: 2, lo: 2 }]);
  });

  it('a filter on the aggregate itself', async () => {
    expect(await rows(grouped.where(r => r.hi.gt(1)))).toEqual([{ k: 1, hi: 2, lo: 2 }]);

    expect(await rows(grouped.where(r => r.hi.eq(0)).orderBy(r => r.k))).toEqual([
      { k: 2, hi: 0, lo: 0 },
      { k: 3, hi: 0, lo: 0 },
    ]);
  });

  it('ordering by the aggregate', async () => {
    expect(
      await rows(
        grouped
          .orderBy(r => r.hi.desc())
          .thenBy(r => r.k)
          .limit(1),
      ),
    ).toEqual([{ k: 1, hi: 2, lo: 2 }]);
  });

  it('a predicate computed in a subquery, merged or not', async () => {
    const mapped = composed.map(r => ({ v: r.v, p: r.n.lt(10) }));

    expect(await rows(mapped.aggregate(g => ({ x: maxIf(g.v, g.p) })))).toEqual([{ x: 2 }]);

    expect(await rows(mapped.limit(100).aggregate(g => ({ x: maxIf(g.v, g.p) })))).toEqual([
      { x: 2 },
    ]);

    expect(
      await rows(
        mapped.distinct().aggregate(g => ({ x: maxIf(g.v, g.p), y: minIf(g.v, g.p.not()) })),
      ),
    ).toEqual([{ x: 2, y: 50 }]);
  });

  it('a union input', async () => {
    const left = composed.map(r => ({ v: r.v, p: r.n.lt(10) }));
    const other = composed.map(r => ({ v: r.v, p: r.n.gt(1000) }));

    expect(await rows(unionAll(left, other).aggregate(g => ({ x: maxIf(g.v, g.p) })))).toEqual([
      { x: 2 },
    ]);
  });

  it('a CTE-shared aggregate', async () => {
    const shared = composed
      .map(r => ({ k: r.k, v: r.v, p: r.n.lt(10) }))
      .limit(100)
      .groupBy(r => ({ k: r.k }))
      .aggregate(g => ({ hi: maxIf(g.v, g.p) }));

    const joined = leftJoin({ a: shared }, { b: shared })
      .on(r => r.a.k.eq(r.b.k))
      .map(r => ({ k: r.a.k, x: r.a.hi, y: r.b.hi }))
      .orderBy(r => r.k);

    expect(compile(joined.ir).sql).toMatch(/^WITH /);

    expect(await rows(joined)).toEqual([
      { k: 1, x: 2, y: 2 },
      { k: 2, x: 0, y: 0 },
      { k: 3, x: 0, y: 0 },
    ]);
  });

  it('a null-extended join column, as a predicate and inside one', async () => {
    const joined = leftJoin({ a: composed }, { b: right }).on(r => r.a.k.eq(r.b.k));

    expect(
      await rows(
        joined.aggregate(g => ({
          hi: maxIf(g.a.v, g.b.ok),
          lo: minIf(g.a.v, g.b.ok),
          cmp: maxIf(g.a.v, g.b.w.lt(10)),
        })),
      ),
    ).toEqual([{ hi: 100, lo: 2, cmp: 100 }]);
  });

  it('arithmetic over the aggregate', async () => {
    const plan = await rows(
      composed.aggregate(g => ({ x: maxIf(g.v, g.n.lt(10)).plus(val(1, col.UInt32)) })),
    );

    expect(plan).toEqual([{ x: 3n }]);
  });
});

describe('conditional aggregates that did not change stay correct', () => {
  it('exclude a NULL predicate for value types where maxIf would not', async () => {
    await post(
      'CREATE TABLE siblings (v UInt32, f Float64, s String, n Nullable(UInt32)) ENGINE=Memory',
    );

    await post("INSERT INTO siblings VALUES (2,2,'a',1),(100,100,'b',NULL)");

    const source = from(
      table(
        'siblings',
        { v: col.UInt32, f: col.Float64, s: col.String, n: col.Nullable(col.UInt32) },
        meta,
      ),
    );

    expect(
      await rows(
        source.aggregate(g => ({
          count: countIf(g.n.lt(10)),
          sum: sumIf(g.v, g.n.lt(10)),
          avg: avgIf(g.f, g.n.lt(10)),
          argMax: argMaxIf(g.s, g.v, g.n.lt(10)),
          argMin: argMinIf(g.s, g.v, g.n.gt(0)),
          quantile: quantileIf(0.5)(g.v, g.n.lt(10)),
          exact: quantileExactIf(0.5)(g.v, g.n.lt(10)),
          distinct: uniqExactIf(g.s, g.n.lt(10)),
        })),
      ),
    ).toEqual([
      { count: 1n, sum: 2n, avg: 2, argMax: 'a', argMin: 'a', quantile: 2, exact: 2, distinct: 1n },
    ]);
  });
});

describe('result types and decoding', () => {
  const huge = 170141183460469231731687303715884105727n;
  const hugeLow = -170141183460469231731687303715884105728n;

  it('min and minIf over every requested type, global aggregate, non-empty and empty', async () => {
    await post(
      "CREATE TABLE decoded (id UInt32, ok Bool, i128 Int128, u64 UInt64, f32 Float32, d Date, dt DateTime('UTC'), dt64 DateTime64(3, 'UTC'), s String, nu Nullable(UInt32), nu64 Nullable(UInt64), ni128 Nullable(Int128), nf Nullable(Float32), nd Nullable(Date), ndt Nullable(DateTime('UTC')), ndt64 Nullable(DateTime64(3, 'UTC')), ns Nullable(String), allNull Nullable(UInt32)) ENGINE=Memory",
    );

    await post(`INSERT INTO decoded VALUES
      (1, true, ${huge}, 18446744073709551615, 0.5, '2026-01-02', '2026-01-02 00:00:00', '1960-01-01 00:00:00.500', 'b', NULL, 18446744073709551615, 5, NULL, NULL, NULL, NULL, NULL, NULL),
      (2, false, ${hugeLow}, 18446744073709551614, 0.25, '2026-01-01', '2026-01-01 00:00:00', '1960-01-01 00:00:00.250', 'a', 3, NULL, NULL, 0.5, '2026-01-01', '2026-01-01 00:00:00', '2026-01-01 00:00:00.000', 'a', NULL)`);

    const source = from(
      table(
        'decoded',
        {
          id: col.UInt32,
          ok: col.Bool,
          i128: col.Int128,
          u64: col.UInt64,
          f32: col.Float32,
          d: col.Date,
          dt: col.DateTime('UTC'),
          dt64: col.DateTime64(3, 'UTC'),
          s: col.String,
          nu: col.Nullable(col.UInt32),
          nu64: col.Nullable(col.UInt64),
          ni128: col.Nullable(col.Int128),
          nf: col.Nullable(col.Float32),
          nd: col.Nullable(col.Date),
          ndt: col.Nullable(col.DateTime('UTC')),
          ndt64: col.Nullable(col.DateTime64(3, 'UTC')),
          ns: col.Nullable(col.String),
          allNull: col.Nullable(col.UInt32),
        },
        meta,
      ),
    );

    const every = (g: any, pick: (operand: any) => unknown) =>
      Object.fromEntries(
        [
          'i128',
          'u64',
          'f32',
          'd',
          'dt',
          'dt64',
          's',
          'nu',
          'nu64',
          'ni128',
          'nf',
          'nd',
          'ndt',
          'ndt64',
          'ns',
          'allNull',
        ].map(k => [k, pick(g[k])]),
      );

    const smallest = {
      i128: hugeLow,
      u64: 18446744073709551614n,
      f32: 0.25,
      d: new Date('2026-01-01T00:00:00Z'),
      dt: new Date('2026-01-01T00:00:00Z'),
      dt64: new Date('1960-01-01T00:00:00.250Z'),
      s: 'a',
      nu: 3,
      nu64: 18446744073709551615n,
      ni128: 5n,
      nf: 0.5,
      nd: new Date('2026-01-01T00:00:00Z'),
      ndt: new Date('2026-01-01T00:00:00Z'),
      ndt64: new Date('2026-01-01T00:00:00Z'),
      ns: 'a',
      allNull: null,
    };

    const defaults = {
      i128: 0n,
      u64: 0n,
      f32: 0,
      d: new Date(0),
      dt: new Date(0),
      dt64: new Date(0),
      s: '',
      nu: null,
      nu64: null,
      ni128: null,
      nf: null,
      nd: null,
      ndt: null,
      ndt64: null,
      ns: null,
      allNull: null,
    };

    expect(await rows(source.aggregate(g => every(g, min) as never))).toEqual([smallest]);

    expect(
      await rows(source.where(r => r.id.gt(99)).aggregate(g => every(g, min) as never)),
    ).toEqual([defaults]);

    expect(
      await rows(source.aggregate(g => every(g, x => minIf(x, g.id.gt(99))) as never)),
    ).toEqual([defaults]);

    expect(
      await rows(
        source.aggregate(
          g => every(g, x => minIf(x, g.id.ge(1).and(val(null, NullableBool)))) as never,
        ),
      ),
    ).toEqual([defaults]);

    expect(
      await rows(
        source
          .where(r => r.id.gt(99))
          .groupBy(r => ({ id: r.id }))
          .aggregate(g => every(g, min) as never),
      ),
    ).toEqual([]);

    const first = await rows(
      source.aggregate(g => ({
        huge: minIf(g.i128, g.ok),
        big: minIf(g.u64, g.ok),
        real: minIf(g.f32, g.ok),
      })),
    );

    expect(first).toEqual([{ huge, big: 18446744073709551615n, real: 0.5 }]);
  });
});

describe('Enum operands', () => {
  it('fail through the client on empty input when the Enum has no zero member', async () => {
    await post("CREATE TABLE enums (e Enum8('x' = 1, 'y' = 2)) ENGINE=Memory");

    const source = from(table('enums', { e: col.Enum8({ x: 1, y: 2 }) }, meta));

    await expect(optimized.run(source.aggregate(g => ({ low: min(g.e) })))).rejects.toThrow();
    await expect(optimized.run(source.aggregate(g => ({ high: max(g.e) })))).rejects.toThrow();

    await expect(
      optimized.run(source.groupBy(r => ({ e: r.e })).aggregate(g => ({ low: min(g.e) }))),
    ).resolves.toEqual([]);

    await post(
      "CREATE TABLE enums_rows (k UInt8, ok Bool, e Enum8('x' = 1, 'y' = 2)) ENGINE=Memory",
    );

    await post("INSERT INTO enums_rows VALUES (1,false,'y')");

    const rows_ = from(
      table('enums_rows', { k: col.UInt8, ok: col.Bool, e: col.Enum8({ x: 1, y: 2 }) }, meta),
    );

    await expect(
      optimized.run(rows_.aggregate(g => ({ low: minIf(g.e, g.ok) }))),
    ).rejects.toThrow();

    await expect(
      optimized.run(rows_.aggregate(g => ({ high: maxIf(g.e, g.ok) }))),
    ).rejects.toThrow();

    await expect(
      optimized.run(rows_.groupBy(r => ({ k: r.k })).aggregate(g => ({ low: minIf(g.e, g.ok) }))),
    ).rejects.toThrow();
  });
});

describe('quantileExact', () => {
  const widths = {
    u8: col.UInt8,
    u16: col.UInt16,
    u32: col.UInt32,
    u64: col.UInt64,
    u128: col.UInt128,
    u256: col.UInt256,
    i8: col.Int8,
    i16: col.Int16,
    i32: col.Int32,
    i64: col.Int64,
    i128: col.Int128,
    i256: col.Int256,
    f32: col.Float32,
    f64: col.Float64,
  } as const;

  const names = Object.keys(widths) as (keyof typeof widths)[];
  const asBigInt = new Set(['u64', 'u128', 'u256', 'i64', 'i128', 'i256']);

  const shape = {
    id: col.UInt32,
    ok: col.Bool,
    mb: col.Nullable(col.UInt32),
    ...widths,
    ...Object.fromEntries(names.map(name => [`n${name}`, col.Nullable(widths[name] as never)])),
  };

  const source = from(table('levels', shape as never, meta)) as never as Query<any, any>;

  beforeAll(async () => {
    const columns = names
      .flatMap(name => [
        `${name} ${print(widths[name].type)}`,
        `n${name} Nullable(${print(widths[name].type)})`,
      ])
      .join(', ');

    const row = (id: number, ok: boolean, mb: string, x: number, nx: string) =>
      `(${id}, ${ok}, ${mb}, ${names.map(() => `${x}, ${nx}`).join(', ')})`;

    await post(
      `CREATE TABLE levels (id UInt32, ok Bool, mb Nullable(UInt32), ${columns}) ENGINE=Memory`,
    );

    await post(
      `INSERT INTO levels VALUES ${row(1, true, '1', 1, 'NULL')}, ${row(2, false, 'NULL', 2, '2')}, ${row(3, true, '50', 3, '3')}, ${row(4, false, 'NULL', 4, '4')}`,
    );
  });

  it.each(names)('levels, empties and result type over %s', async name => {
    const value = (x: number) => (asBigInt.has(name) ? BigInt(x) : x);
    const empty = name.startsWith('f') ? NaN : value(0);

    expect(
      await rows(
        source.aggregate((g: any) => ({
          l0: quantileExact(0)(g[name]),
          l5: quantileExact(0.5)(g[name]),
          l1: quantileExact(1)(g[name]),
          i: quantileExactIf(0.5)(g[name], g.ok),
          iNull: quantileExactIf(1)(g[name], g.mb.lt(10)),
          nl0: quantileExact(0)(g[`n${name}`]),
          nl1: quantileExact(1)(g[`n${name}`]),
          nI: quantileExactIf(1)(g[`n${name}`], g.mb.lt(10)),
        })),
      ),
    ).toEqual([
      {
        l0: value(1),
        l5: value(3),
        l1: value(4),
        i: value(3),
        iNull: value(1),
        nl0: value(2),
        nl1: value(4),
        nI: null,
      },
    ]);

    expect(
      await rows(
        source
          .where((r: any) => r.id.gt(99))
          .aggregate((g: any) => ({
            a: quantileExact(0.5)(g[name]),
            b: quantileExactIf(0.5)(g[name], g.ok),
            c: quantileExact(0.5)(g[`n${name}`]),
            d: quantileExactIf(0.5)(g[`n${name}`], g.mb.lt(10)),
          })),
      ),
    ).toEqual([{ a: empty, b: empty, c: null, d: null }]);
  });

  it('does not interpolate on [1,2,3,4], where quantile does', async () => {
    const low = source.where((r: any) => r.id.le(4));

    expect(
      await rows(
        low.aggregate((g: any) => ({
          exact: quantileExact(0.5)(g.f64),
          exactIf: quantileExactIf(0.5)(g.f64, g.id.gt(0)),
          approx: quantile(0.5)(g.f64),
          approxIf: quantileIf(0.5)(g.f64, g.id.gt(0)),
        })),
      ),
    ).toEqual([{ exact: 3, exactIf: 3, approx: 2.5, approxIf: 2.5 }]);
  });

  it('keeps extremes exact at every wide integer width', async () => {
    await post('CREATE TABLE wide (u UInt64, i Int128, nu Nullable(UInt64)) ENGINE=Memory');

    await post(
      'INSERT INTO wide VALUES (9007199254740993, 170141183460469231731687303715884105727, 9007199254740993), (18446744073709551615, -170141183460469231731687303715884105728, NULL)',
    );

    const wide = from(
      table('wide', { u: col.UInt64, i: col.Int128, nu: col.Nullable(col.UInt64) }, meta),
    );

    expect(
      await rows(
        wide.aggregate(g => ({
          a: quantileExact(0)(g.u),
          b: quantileExact(1)(g.u),
          c: quantileExact(0)(g.i),
          d: quantileExact(1)(g.i),
          e: quantileExact(0.5)(g.nu),
        })),
      ),
    ).toEqual([
      {
        a: 9007199254740993n,
        b: 18446744073709551615n,
        c: -170141183460469231731687303715884105728n,
        d: 170141183460469231731687303715884105727n,
        e: 9007199254740993n,
      },
    ]);
  });

  it('skips NaN and returns NaN only when every value is NaN', async () => {
    await post(
      'CREATE TABLE nans (id UInt32, f Float64, f3 Float32, nf Nullable(Float64)) ENGINE=Memory',
    );

    await post(
      'INSERT INTO nans VALUES (1,nan,nan,nan),(2,1,1,1),(3,inf,inf,NULL),(4,nan,nan,nan),(5,-inf,-inf,-inf)',
    );

    const nans = from(
      table(
        'nans',
        { id: col.UInt32, f: col.Float64, f3: col.Float32, nf: col.Nullable(col.Float64) },
        meta,
      ),
    );

    expect(
      await rows(
        nans.aggregate(g => ({
          a: quantileExact(1)(g.f),
          b: quantileExact(0)(g.f),
          c: quantileExact(0.5)(g.f3),
          d: quantileExact(1)(g.nf),
        })),
      ),
    ).toEqual([{ a: Infinity, b: -Infinity, c: 1, d: 1 }]);

    expect(
      await rows(
        nans
          .where(r => r.id.eq(1))
          .aggregate(g => ({
            a: quantileExact(0.5)(g.f),
            b: quantileExact(0.5)(g.f3),
            d: quantileExact(0.5)(g.nf),
          })),
      ),
    ).toEqual([{ a: NaN, b: NaN, d: NaN }]);

    expect(
      await rows(nans.where(r => r.id.eq(3)).aggregate(g => ({ d: quantileExact(0.5)(g.nf) }))),
    ).toEqual([{ d: null }]);
  });

  it('accepts constant operands', async () => {
    expect(
      await rows(
        source.aggregate((g: any) => ({
          a: quantileExact(0.5)(val(8)),
          b: quantileExact(0.5)(val(8n, col.UInt64)),
          c: quantileExactIf(0.5)(val(null, col.Nullable(col.Float64)), g.ok),
        })),
      ),
    ).toEqual([{ a: 8, b: 8n, c: null }]);
  });
});

describe('argMin versions', () => {
  const versions = {
    u8: col.UInt8,
    u64: col.UInt64,
    i128: col.Int128,
    u256: col.UInt256,
    f32: col.Float32,
    f64: col.Float64,
    d: col.Date,
    d32: col.Date32,
    dt: col.DateTime('UTC'),
    dtLocal: col.DateTime(),
    dt640: col.DateTime64(0, 'UTC'),
    dt641: col.DateTime64(1, 'UTC'),
    dt642: col.DateTime64(2, 'UTC'),
    dt643: col.DateTime64(3, 'UTC'),
  } as const;

  const names = Object.keys(versions) as (keyof typeof versions)[];

  const source = from(
    table(
      'versions',
      {
        id: col.UInt32,
        ok: col.Bool,
        mb: col.Nullable(col.UInt32),
        s: col.String,
        n: col.Nullable(col.UInt32),
        big: col.UInt64,
        ...versions,
      } as never,
      meta,
    ),
  ) as never as Query<any, any>;

  beforeAll(async () => {
    const columns = names.map(name => `${name} ${print(versions[name].type)}`).join(', ');
    const date = (i: number) => [`'1950-01-0${i}'`, `'1950-01-0${i} 00:00:00'`];

    const row = (
      id: number,
      ok: boolean,
      mb: string,
      s: string,
      n: string,
      big: string,
      i: number,
    ) => {
      const numeric = Array.from({ length: 6 }, () => String(i));
      const [day, at] = date(i);

      return `(${id}, ${ok}, ${mb}, '${s}', ${n}, ${big}, ${[...numeric, `'2000-01-0${i}'`, day, `'2000-01-0${i} 00:00:00'`, `'2000-01-0${i} 00:00:00'`, at, `'1950-01-0${i} 00:00:00.1'`, `'1950-01-0${i} 00:00:00.12'`, `'1950-01-0${i} 00:00:00.123'`].join(', ')})`;
    };

    await post(
      `CREATE TABLE versions (id UInt32, ok Bool, mb Nullable(UInt32), s String, n Nullable(UInt32), big UInt64, ${columns}) ENGINE=Memory`,
    );

    await post(
      `INSERT INTO versions VALUES ${row(1, true, '1', 'b', 'NULL', '18446744073709551615', 2)}, ${row(2, false, 'NULL', 'a', '7', '9007199254740993', 1)}, ${row(3, true, 'NULL', 'c', '8', '5', 3)}`,
    );
  });

  it.each(names)('%s', async name => {
    expect(
      await rows(
        source.aggregate((g: any) => ({
          s: argMin(g.s, g[name]),
          n: argMin(g.n, g[name]),
          big: argMin(g.big, g[name]),
          conditional: argMinIf(g.s, g[name], g.ok),
          nullPredicate: argMinIf(g.s, g[name], g.mb.lt(10)),
          opposite: argMax(g.s, g[name]),
        })),
      ),
    ).toEqual([
      { s: 'a', n: 7, big: 9007199254740993n, conditional: 'b', nullPredicate: 'b', opposite: 'c' },
    ]);
  });

  it('empty input and no qualifying row', async () => {
    const empty = source.where((r: any) => r.id.gt(99));

    expect(
      await rows(
        empty.aggregate((g: any) => ({
          s: argMin(g.s, g.d),
          n: argMin(g.n, g.dt643),
          big: argMin(g.big, g.u8),
        })),
      ),
    ).toEqual([{ s: '', n: null, big: 0n }]);

    expect(
      await rows(
        source.aggregate((g: any) => ({
          s: argMinIf(g.s, g.d, g.id.gt(99)),
          n: argMinIf(g.n, g.d, g.id.gt(99)),
          nullOnly: argMinIf(g.s, g.d, g.mb.gt(99)),
        })),
      ),
    ).toEqual([{ s: '', n: null, nullOnly: '' }]);
  });

  it('tied versions pick one of the tied rows, never a later version', async () => {
    await post('CREATE TABLE ties (v String, ver UInt32) ENGINE=Memory');
    await post("INSERT INTO ties VALUES ('first',5),('second',5),('late',9)");

    const ties = from(table('ties', { v: col.String, ver: col.UInt32 }, meta));

    const [row] = await rows(
      ties.aggregate(g => ({ low: argMin(g.v, g.ver), high: argMax(g.v, g.ver) })),
    );

    expect(['first', 'second']).toContain(row!.low);
    expect(row!.high).toBe('late');
  });
});

describe('NaN semantics, pinned as ClickHouse 24.8 behaviour', () => {
  const shape = {
    id: col.UInt32,
    g: col.UInt8,
    ok: col.Bool,
    mb: col.Nullable(col.UInt32),
    f: col.Float64,
    f3: col.Float32,
    nf: col.Nullable(col.Float64),
  };

  const source = (name: string) => from(table(name, shape, meta));

  const create = async (name: string, values: readonly (readonly [number, string])[]) => {
    await post(
      `CREATE TABLE ${name} (id UInt32, g UInt8, ok Bool, mb Nullable(UInt32), f Float64, f3 Float32, nf Nullable(Float64)) ENGINE=Memory`,
    );

    await post(
      `INSERT INTO ${name} VALUES ${values.map(([ok, x], i) => `(${i}, 1, ${ok === 1}, ${ok === 1 ? 1 : 'NULL'}, ${x}, ${x}, ${x})`).join(', ')}`,
    );
  };

  const conditional = (g: any) => ({
    a: minIf(g.f, g.ok),
    b: minIf(g.f, g.mb.lt(10)),
    c: minIf(g.f3, g.ok),
    d: minIf(g.nf, g.ok),
    e: minIf(g.nf, g.mb.lt(10)),
  });

  const all = (x: unknown) => ({ a: x, b: x, c: x, d: x, e: x });

  it.each([
    [
      'nan_first',
      [
        [1, 'nan'],
        [1, '2'],
        [1, '1'],
      ],
      NaN,
    ],
    [
      'nan_mid',
      [
        [1, '2'],
        [1, 'nan'],
        [1, '1'],
      ],
      1,
    ],
    [
      'nan_last',
      [
        [1, '2'],
        [1, '1'],
        [1, 'nan'],
      ],
      1,
    ],
    [
      'nan_unqualified_first',
      [
        [0, 'nan'],
        [1, '2'],
        [1, '1'],
      ],
      1,
    ],
    [
      'nan_unqualified_mid',
      [
        [1, '2'],
        [0, 'nan'],
        [1, '1'],
      ],
      1,
    ],
    [
      'nan_first_qualifying',
      [
        [0, '5'],
        [1, 'nan'],
        [1, '2'],
        [1, '1'],
      ],
      NaN,
    ],
    [
      'nan_only',
      [
        [1, 'nan'],
        [1, 'nan'],
      ],
      NaN,
    ],
  ] as const)('minIf docs claim: %s', async (name, values, expected) => {
    await create(name, values);

    expect(await rows(source(name).aggregate(conditional as never))).toEqual([all(expected)]);

    expect(
      await rows(
        source(name)
          .groupBy(r => ({ g: r.g }))
          .aggregate(conditional as never),
      ),
    ).toEqual([{ g: 1, ...all(expected) }]);
  });

  it('a NaN at the start of a later block hides that block from a global min', async () => {
    await post('CREATE TABLE nan_blocks (ok Bool, f Float64) ENGINE=Memory');
    await post('INSERT INTO nan_blocks VALUES (true,5),(true,4)');
    await post('INSERT INTO nan_blocks VALUES (true,nan),(true,1)');

    const blocks = from(table('nan_blocks', { ok: col.Bool, f: col.Float64 }, meta));

    const plan = compile(
      blocks.aggregate(g => ({ low: min(g.f), lowIf: minIf(g.f, g.ok), high: max(g.f) })).ir,
    );

    expect((await json(plan.sql, plan.params, '&max_threads=1')).data).toEqual([
      { low: 4, lowIf: 4, high: 5 },
    ]);
  });

  it('the documented block examples hold for max and maxIf, and GROUP BY does not hide the block', async () => {
    await post('CREATE TABLE nan_blocks_max (g UInt8, ok Bool, f Float64) ENGINE=Memory');
    await post('INSERT INTO nan_blocks_max VALUES (1,true,1),(1,true,2)');
    await post('INSERT INTO nan_blocks_max VALUES (1,true,nan),(1,true,9)');

    const blocks = from(
      table('nan_blocks_max', { g: col.UInt8, ok: col.Bool, f: col.Float64 }, meta),
    );

    const build = (g: any) => ({
      low: min(g.f),
      high: max(g.f),
      lowIf: minIf(g.f, g.ok),
      highIf: maxIf(g.f, g.ok),
    });

    const global = compile(blocks.aggregate(build as never).ir);
    const grouped = compile(blocks.groupBy(r => ({ g: r.g })).aggregate(build as never).ir);

    expect((await json(global.sql, global.params, '&max_threads=1')).data).toEqual([
      { low: 1, high: 2, lowIf: 1, highIf: 2 },
    ]);

    expect((await json(grouped.sql, grouped.params, '&max_threads=1')).data).toEqual([
      { g: 1, low: 1, high: 9, lowIf: 1, highIf: 9 },
    ]);
  });

  it('for the If forms, the first qualifying row of a block decides, not the first row', async () => {
    const run = async (table_: string, later: string) => {
      await post(`CREATE TABLE ${table_} (ok Bool, f Float64) ENGINE=Memory`);
      await post(`INSERT INTO ${table_} VALUES (true,5),(true,4)`);
      await post(`INSERT INTO ${table_} VALUES ${later}`);

      const plan = compile(
        from(table(table_, { ok: col.Bool, f: col.Float64 }, meta)).aggregate(g => ({
          low: minIf(g.f, g.ok),
          high: maxIf(g.f, g.ok),
        })).ir,
      );

      return (await json(plan.sql, plan.params, '&max_threads=1')).data;
    };

    expect(await run('nan_if_unqualified', '(false,nan),(true,1),(true,9)')).toEqual([
      { low: 1, high: 9 },
    ]);

    expect(await run('nan_if_qualifying', '(false,7),(true,nan),(true,1),(true,9)')).toEqual([
      { low: 4, high: 5 },
    ]);
  });

  it('a NaN first version picks a different value with and without GROUP BY', async () => {
    await post('CREATE TABLE nan_versions (g UInt8, s String, ver Float64) ENGINE=Memory');
    await post("INSERT INTO nan_versions VALUES (1,'first',nan),(1,'second',2),(1,'third',1)");

    const versions = from(
      table('nan_versions', { g: col.UInt8, s: col.String, ver: col.Float64 }, meta),
    );

    expect(
      await rows(
        versions.aggregate(g => ({ x: argMin(g.s, g.ver), y: argMinIf(g.s, g.ver, g.g.eq(1)) })),
      ),
    ).toEqual([{ x: '', y: 'first' }]);

    expect(
      await rows(
        versions
          .groupBy(r => ({ g: r.g }))
          .aggregate(g => ({ x: argMin(g.s, g.ver), y: argMinIf(g.s, g.ver, g.g.eq(1)) })),
      ),
    ).toEqual([{ g: 1, x: 'first', y: 'first' }]);
  });
});

describe('filter push-down with min', () => {
  const pushed = from(
    table(
      'pushed',
      {
        k: col.UInt8,
        a: col.String,
        v: col.UInt32,
        s: col.String,
        b: col.Bool,
        f: col.Float64,
        n: col.Nullable(col.UInt32),
      },
      meta,
    ),
  );

  beforeAll(async () => {
    await post(
      'CREATE TABLE pushed (k UInt8, a String, v UInt32, s String, b Bool, f Float64, n Nullable(UInt32)) ENGINE=Memory',
    );

    await post(
      "INSERT INTO pushed VALUES (2,'x',9,'z',true,nan,NULL),(1,'y',5,'m',false,1,5),(1,'z',3,'q',true,nan,NULL),(3,'y',1,'a',true,3,1)",
    );
  });

  it('a key filter pushed below min keeps each group result', async () => {
    const query = pushed
      .groupBy(r => ({ k: r.k }))
      .aggregate(g => ({ v: min(g.v), s: min(g.s), b: min(g.b), hi: max(g.v), rows: count() }))
      .where(r => r.k.eq(1));

    expect(compile(query.ir).sql).toMatch(/WHERE .*GROUP BY/);
    expect(await rows(query)).toEqual([{ k: 1, v: 3, s: 'm', b: false, hi: 5, rows: 2n }]);
  });

  it('a filter on the min itself stays above the aggregate', async () => {
    const query = pushed
      .groupBy(r => ({ k: r.k }))
      .aggregate(g => ({ low: min(g.v) }))
      .where(r => r.low.gt(2))
      .orderBy(r => r.k);

    expect(compile(query.ir).sql).toMatch(/HAVING/);

    expect(await rows(query)).toEqual([
      { k: 1, low: 3 },
      { k: 2, low: 9 },
    ]);
  });

  it('mixed conjuncts split across the aggregate', async () => {
    const query = pushed
      .groupBy(r => ({ k: r.k, a: r.a }))
      .aggregate(g => ({ low: min(g.v) }))
      .where(r => r.k.eq(1).and(r.low.gt(4)));

    expect(compile(query.ir).sql).toMatch(/WHERE .*GROUP BY .*HAVING/);
    expect(await rows(query)).toEqual([{ k: 1, a: 'y', low: 5 }]);
  });

  it('a nullable or float operand blocks the push-down, as for max', async () => {
    for (const build of [(g: any) => ({ x: min(g.n) }), (g: any) => ({ x: min(g.f) })]) {
      const query = pushed.groupBy(r => ({ k: r.k })).aggregate(build as never);
      const filtered = (query as any).where((r: any) => r.k.eq(1));

      expect(compile(filtered.ir).sql).toMatch(/HAVING/);
      expect(compile(filtered.ir).sql).not.toMatch(/WHERE/);

      expect(await rows(filtered)).toEqual(
        await rows(query).then(all => all.filter(row => row.k === 1)),
      );
    }
  });

  it('a global min keeps its single row: a constant-false filter removes it above the aggregate', async () => {
    const query = pushed
      .aggregate(g => ({ low: min(g.v), rows: count() }))
      .where(() => val(1, col.UInt8).eq(2));

    expect(compile(query.ir).sql).toMatch(/HAVING/);
    expect(await rows(query)).toEqual([]);

    expect(
      await rows(pushed.where(r => r.k.eq(99)).aggregate(g => ({ v: min(g.v), rows: count() }))),
    ).toEqual([{ v: 0, rows: 0n }]);
  });

  it('min on a key absent from the data returns no row', async () => {
    expect(
      await rows(
        pushed
          .groupBy(r => ({ k: r.k }))
          .aggregate(g => ({ v: min(g.v) }))
          .where(r => r.k.eq(77)),
      ),
    ).toEqual([]);
  });
});
