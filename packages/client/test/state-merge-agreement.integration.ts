import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  argMax,
  argMaxMerge,
  argMaxState,
  argMin,
  argMinMerge,
  argMinState,
  avg,
  avgMerge,
  avgState,
  col,
  count,
  createKnownFunctions,
  countMerge,
  countState,
  from,
  max,
  maxMerge,
  maxState,
  min,
  minMerge,
  minState,
  print,
  quantile,
  quantileExact,
  quantileExactMerge,
  quantileExactState,
  quantileMerge,
  quantileState,
  sql,
  sum,
  sumMerge,
  sumState,
  table,
  uniq,
  uniqExact,
  uniqExactMerge,
  uniqExactState,
  uniqMerge,
  uniqState,
  type CompiledQuery,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D2: every state and merged descriptor against the server's own type names on 24.8, on both emitters. */
const DDL = `(
  k String, u UInt32, u64 UInt64, f Float64, s String,
  nu Nullable(UInt32), nf Nullable(Float64), ns Nullable(String),
  lc LowCardinality(String), lcn LowCardinality(Nullable(String)), lcu LowCardinality(UInt32),
  dec Decimal(18, 2), ndec Nullable(Decimal(18, 2)), dec76 Decimal(50, 3),
  d Date, dt DateTime('UTC'), dt64 DateTime64(3), nd Nullable(Date),
  al Array(LowCardinality(String)), tl Tuple(a LowCardinality(String), b UInt8),
  ml Map(LowCardinality(String), UInt8)
) ENGINE=MergeTree ORDER BY k`;

const source = table(
  'state_source',
  {
    k: col.String,
    u: col.UInt32,
    u64: col.UInt64,
    f: col.Float64,
    s: col.String,
    nu: col.Nullable(col.UInt32),
    nf: col.Nullable(col.Float64),
    ns: col.Nullable(col.String),
    lc: col.LowCardinality(col.String),
    lcn: col.LowCardinality(col.Nullable(col.String)),
    lcu: col.LowCardinality(col.UInt32),
    dec: col.Decimal(18, 2),
    ndec: col.Nullable(col.Decimal(18, 2)),
    dec76: col.Decimal(50, 3),
    d: col.Date,
    dt: col.DateTime('UTC'),
    dt64: col.DateTime64(3),
    nd: col.Nullable(col.Date),
    al: col.Array(col.LowCardinality(col.String)),
    tl: col.NamedTuple([
      ['a', col.LowCardinality(col.String)],
      ['b', col.UInt8],
    ]),
    ml: col.Map(col.LowCardinality(col.String), col.UInt8),
  },
  { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] },
);

// The matrix crosses every operand with every function; each pair's types are pinned in test/types/state-merge.ts.
type G = any;

type Entry = readonly [
  name: string,
  state: (g: G) => unknown,
  merge: (s: any) => unknown,
  base: (g: G) => unknown,
];

/** Every form the catalog accepts: plain, Nullable, LowCardinality, Decimal, temporal, and nested LowCardinality. */
const entries: readonly Entry[] = [
  ['count', () => countState(), (s: any) => countMerge(s), () => count()],

  ...(['u', 'u64', 'f', 'nu', 'nf', 'lcu', 'dec', 'ndec', 'dec76'] as const).map(
    c =>
      [
        `sum(${c})`,
        (g: G) => sumState(g[c]),
        (s: any) => sumMerge(s),
        (g: G) => sum(g[c]),
      ] as Entry,
  ),

  ...(
    [
      'u',
      'f',
      's',
      'nu',
      'ns',
      'lc',
      'lcn',
      'lcu',
      'dec',
      'ndec',
      'd',
      'dt',
      'dt64',
      'nd',
      'al',
      'tl',
    ] as const
  ).flatMap(c => [
    [`max(${c})`, (g: G) => maxState(g[c]), (s: any) => maxMerge(s), (g: G) => max(g[c])] as Entry,
    [`min(${c})`, (g: G) => minState(g[c]), (s: any) => minMerge(s), (g: G) => min(g[c])] as Entry,
  ]),

  ...(
    [
      ['s', 'u'],
      ['ns', 'u'],
      ['u', 'd'],
      ['nu', 'dt'],
      ['f', 'dt64'],
      ['s', 'f'],
    ] as const
  ).flatMap(([v, w]) => [
    [
      `argMax(${v},${w})`,
      (g: G) => argMaxState(g[v], g[w]),
      (s: any) => argMaxMerge(s),
      (g: G) => argMax(g[v], g[w]),
    ] as Entry,
    [
      `argMin(${v},${w})`,
      (g: G) => argMinState(g[v], g[w]),
      (s: any) => argMinMerge(s),
      (g: G) => argMin(g[v], g[w]),
    ] as Entry,
  ]),

  ...(['u', 'u64', 'f', 'nu', 'nf'] as const).flatMap(c => [
    [`avg(${c})`, (g: G) => avgState(g[c]), (s: any) => avgMerge(s), (g: G) => avg(g[c])] as Entry,
    [
      `quantile(${c})`,
      (g: G) => quantileState(0.9)(g[c]),
      (s: any) => quantileMerge(0.9)(s),
      (g: G) => quantile(0.9)(g[c]),
    ] as Entry,
    [
      `quantileExact(${c})`,
      (g: G) => quantileExactState(0.9)(g[c]),
      (s: any) => quantileExactMerge(0.9)(s),
      (g: G) => quantileExact(0.9)(g[c]),
    ] as Entry,
  ]),

  ...(['s', 'ns'] as const).flatMap(c => [
    [
      `uniq(${c})`,
      (g: G) => uniqState(g[c]),
      (s: any) => uniqMerge(s),
      (g: G) => uniq(g[c]),
    ] as Entry,
    [
      `uniqExact(${c})`,
      (g: G) => uniqExactState(g[c]),
      (s: any) => uniqExactMerge(s),
      (g: G) => uniqExact(g[c]),
    ] as Entry,
  ]),

  ...([0, 1, 0.5, 0.1, 1e-7, 0.000001, 0.30000000000000004] as const).flatMap(level => [
    [
      `quantile level ${level}`,
      (g: G) => quantileState(level)(g.f),
      (s: any) => quantileMerge(level)(s),
      (g: G) => quantile(level)(g.f),
    ] as Entry,
    [
      `quantileExact level ${level}`,
      (g: G) => quantileExactState(level)(g.u),
      (s: any) => quantileExactMerge(level)(s),
      (g: G) => quantileExact(level)(g.u),
    ] as Entry,
  ]),
];

// `system.functions` does not list combinator forms, so generated catalogs have no `agg.uniqMerge`: this is a hand-written catalog.
const { fn, agg } = createKnownFunctions({
  uniqMerge: { name: 'uniqMerge', isAggregate: true, deterministic: true, aliasTo: '' },
  finalizeAggregation: {
    name: 'finalizeAggregation',
    isAggregate: false,
    deterministic: true,
    aliasTo: '',
  },
} as never) as any;

let container: StartedTestContainer;

let url: string;

async function post(
  sqlText: string,
  params: Readonly<Record<string, string>> = {},
): Promise<string> {
  const endpoint = new URL(url);

  for (const [key, value] of Object.entries(params))
    endpoint.searchParams.set(`param_${key}`, value);

  endpoint.searchParams.set('wait_end_of_query', '1');
  endpoint.searchParams.set('allow_suspicious_low_cardinality_types', '1');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: sqlText,
  });

  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text;
}

const run = async (query: CompiledQuery) =>
  JSON.parse(await post(`${query.sql} FORMAT JSON`, query.params)) as {
    meta: { name: string; type: string }[];
    data: Record<string, unknown>[];
  };

const emitters = [
  ['optimized', compile],
  ['naive', emitNaive],
] as const;

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
  await post(`CREATE TABLE state_source ${DDL}`);

  await post(`INSERT INTO state_source VALUES
    ('a',1,1,1.5,'x',1,1.5,'x','x','x',1,1.5,1.5,1.5,'2024-01-01','2024-01-01 00:00:00','2024-01-01 00:00:00.000','2024-01-01',['x'],('x',1),{'x':1}),
    ('b',2,2,2.5,'y',NULL,NULL,NULL,'y',NULL,2,2.5,NULL,2.5,'2024-01-02','2024-01-02 00:00:00','2024-01-02 00:00:00.000',NULL,['y'],('y',2),{'y':2})`);
}, 120000);

afterAll(async () => {
  await container?.stop();
});

describe.each(entries)('%s', (_name, state, merge, base) => {
  const stateQuery = (): any =>
    from(source)
      .groupBy(r => r.k)
      .aggregate(g => ({ s: state(g) as any }));

  it('state and merged descriptors match the server on both emitters', async () => {
    const states = stateQuery();
    const stored = (states.ir as Extract<Rel, { kind: 'Aggregate' }>).columns.s!;
    // The trusted snippet reads the state, so the state stays intermediate and never reaches a result.
    const named = states.map((r: any) => ({ t: sql`toTypeName(${r.s})`.as(col.String) }));
    const merged = states.aggregate((g: any) => ({ m: merge(g.s) }));
    const direct = from(source).aggregate(g => ({ m: base(g) as any }));

    for (const [mode, emit] of emitters) {
      const names = await run(emit(named.ir));
      expect(names.data.length, mode).toBe(2);
      for (const row of names.data) expect(row.t, `${mode} state`).toBe(print(stored));

      const compiled = emit(merged.ir);
      const result = await run(compiled);
      expect(result.meta[0]!.type, `${mode} merged`).toBe(print(compiled.columns.m!));

      // A merged result has the base function's type.
      const plain = await run(emit(direct.ir));
      expect(result.meta[0]!.type, `${mode} base`).toBe(plain.meta[0]!.type);
    }
  });
});

/** A result that is UInt64 whatever is stored: rollup columns built by the server, read through the typed merge. */
describe('count, uniq and uniqExact over any stored arguments', () => {
  const forms = [
    ['UInt64', 'number', [col.UInt64]],
    ['Int32', 'toInt32(number)', [col.Int32]],
    ['Float64', 'toFloat64(number)', [col.Float64]],
    ['Nullable(UInt64)', 'toNullable(number)', [col.Nullable(col.UInt64)]],
    ['Nullable(String)', 'toNullable(toString(number))', [col.Nullable(col.String)]],
    ['String', 'toString(number)', [col.String]],
    [
      'LowCardinality(String)',
      'toLowCardinality(toString(number))',
      [col.LowCardinality(col.String)],
    ],
    [
      'LowCardinality(Nullable(String))',
      'toLowCardinality(toNullable(toString(number)))',
      [col.LowCardinality(col.Nullable(col.String))],
    ],
    [
      'Tuple(String, UInt64)',
      'tuple(toString(number), number)',
      [col.Tuple([col.String, col.UInt64])],
    ],
    [
      'Tuple(a String)',
      "CAST(tuple(toString(number)), 'Tuple(a String)')",
      [col.NamedTuple([['a', col.String]])],
    ],
    ['Decimal(18, 2)', 'toDecimal64(number, 2)', [col.Decimal(18, 2)]],
    ['Date', 'toDate(number)', [col.Date]],
    ['Array(String)', '[toString(number)]', [col.Array(col.String)]],
    ['String, UInt64', 'toString(number), number', [col.String, col.UInt64]],
    [
      'Nullable(UInt64), String',
      'toNullable(number), toString(number)',
      [col.Nullable(col.UInt64), col.String],
    ],
    [
      'LowCardinality(String), UInt64',
      'toLowCardinality(toString(number)), number',
      [col.LowCardinality(col.String), col.UInt64],
    ],
    [
      'Tuple(String, UInt64), UInt8',
      'tuple(toString(number), number), toUInt8(number)',
      [col.Tuple([col.String, col.UInt64]), col.UInt8],
    ],
  ] as const;

  const merges = [
    ['uniq', uniqMerge],
    ['uniqExact', uniqExactMerge],
    ['count', countMerge],
  ] as const;

  const cells = merges.flatMap(([name, merge]) =>
    forms
      // The server allows `count` no argument or one; see the test below.
      .filter(([, , columns]) => name !== 'count' || columns.length === 1)
      .map(
        ([type, sqlArgs, columns]) =>
          [`${name}(${type})`, name, merge, type, sqlArgs, columns] as const,
      ),
  );

  it.each(cells)(
    '%s merges to UInt64 on both emitters',
    async (label, name, merge, type, sqlArgs, columns) => {
      const id = `any_${cells.findIndex(c => c[0] === label)}`;

      await post(
        `CREATE TABLE ${id} (s AggregateFunction(${name}, ${type})) ENGINE=AggregatingMergeTree ORDER BY tuple()`,
      );

      await post(`INSERT INTO ${id} SELECT ${name}State(${sqlArgs}) FROM numbers(3)`);

      const rollup = table(
        id,
        { s: col.AggregateFunction(name, ...(columns as never as [])) },
        { engine: 'AggregatingMergeTree', sortingKey: [], partitionKey: [] },
      );

      const query: any = from(rollup).aggregate((g: any) => ({ m: (merge as any)(g.s) }));

      for (const [mode, emit] of emitters) {
        const compiled = emit(query.ir);
        const result = await run(compiled);
        expect(print(compiled.columns.m!), mode).toBe('UInt64');
        expect(result.meta[0]!.type, mode).toBe('UInt64');
        expect(result.data[0]!.m, mode).toBe('3');
      }
    },
  );

  it('a count state with no stored argument merges too', async () => {
    await post(
      'CREATE TABLE any_count0 (s AggregateFunction(count)) ENGINE=AggregatingMergeTree ORDER BY tuple()',
    );

    await post('INSERT INTO any_count0 SELECT countState() FROM numbers(3)');

    const rollup = table(
      'any_count0',
      { s: col.AggregateFunction('count') },
      { engine: 'AggregatingMergeTree', sortingKey: [], partitionKey: [] },
    );

    for (const [mode, emit] of emitters) {
      const result = await run(emit(from(rollup).aggregate(g => ({ m: countMerge(g.s) })).ir));
      expect(result.meta[0]!.type, mode).toBe('UInt64');
      expect(result.data[0]!.m, mode).toBe('3');
    }
  });

  it('the forms that stay rejected do not exist on the server (code 42)', async () => {
    for (const type of ['count, String, UInt64', 'uniq', 'uniqExact'])
      await expect(
        post(
          `CREATE TABLE any_refused (s AggregateFunction(${type})) ENGINE=AggregatingMergeTree ORDER BY tuple()`,
        ),
      ).rejects.toThrow(/Code: 42\./);
  });
});

describe('design corrections, measured', () => {
  const rollup = table(
    'state_rollup',
    {
      k: col.String,
      q: col.AggregateFunction('quantile(0.9)', col.Float64),
      nq: col.AggregateFunction('quantile(0.9)', col.Nullable(col.Float64)),
      ids: col.AggregateFunction('uniq', col.String),
      total: col.AggregateFunction('sum', col.UInt64),
    },
    { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
  );

  beforeAll(async () => {
    await post(
      `CREATE TABLE state_rollup (k String, q AggregateFunction(quantile(0.9), Float64), nq AggregateFunction(quantile(0.9), Nullable(Float64)), ids AggregateFunction(uniq, String), total AggregateFunction(sum, UInt64)) ENGINE=AggregatingMergeTree ORDER BY k`,
    );

    await post(
      `INSERT INTO state_rollup SELECT 'a', quantileState(0.9)(toFloat64(number)), quantileState(0.9)(toNullable(toFloat64(number))), uniqState(toString(number)), sumState(number) FROM numbers(101)`,
    );
  }, 60000);

  it('the merge level decides for a non-nullable state', async () => {
    for (const [mode, emit] of emitters)
      for (const [level, expected] of [
        [0.9, 90],
        [0.1, 10],
      ] as const) {
        const result = await run(
          emit(from(rollup).aggregate(g => ({ v: quantileMerge(level)(g.q) })).ir),
        );

        expect(result.data[0]!.v, `${mode} ${level}`).toBe(expected);
      }
  });

  it('a nullable state merges at its stored level, and the server refuses any other: the reason for invalid_merge_state', async () => {
    for (const [mode, emit] of emitters) {
      const same = await run(
        emit(from(rollup).aggregate(g => ({ v: quantileMerge(0.9)(g.nq) })).ir),
      );

      expect(same.data[0]!.v, mode).toBe(90);
      expect(same.meta[0]!.type, mode).toBe('Nullable(Float64)');

      expect(() => emit(from(rollup).aggregate(g => ({ v: quantileMerge(0.1)(g.nq) })).ir)).toThrow(
        /invalid_merge_state/,
      );
    }

    await expect(post('SELECT quantileMerge(0.1)(nq) FROM state_rollup')).rejects.toThrow(
      /Code: 43\./,
    );

    await expect(post('SELECT quantileMerge(nq) FROM state_rollup')).rejects.toThrow(/Code: 43\./);
  });

  it('known-tier merges and scalar calls read a state; count and a plain map skip it', async () => {
    for (const [mode, emit] of emitters) {
      const merged = await run(
        emit(from(rollup).aggregate(g => ({ n: agg.uniqMerge(g.ids).as(col.UInt64) })).ir),
      );

      expect(merged.data[0]!.n, mode).toBe('101');

      const final = await run(
        emit(from(rollup).map(r => ({ t: fn.finalizeAggregation(r.total).as(col.UInt64) })).ir),
      );

      expect(final.data[0]!.t, mode).toBe('5050');
      expect((await run(emit(from(rollup).count().ir))).data[0]!.count, mode).toBe('1');
      expect((await run(emit(from(rollup).map(r => ({ k: r.k })).ir))).data[0]!.k, mode).toBe('a');

      expect(
        (await run(emit(from(rollup).aggregate(g => ({ t: sumMerge(g.total) })).ir))).data[0]!.t,
      ).toBe('5050');
    }
  });

  it('a built state descriptor is valid DDL for the column it feeds', async () => {
    const built = from(source)
      .groupBy(r => r.k)
      .aggregate(g => ({ s: quantileState(0.9)(g.f) }));

    const type = print((built.ir as Extract<Rel, { kind: 'Aggregate' }>).columns.s!);
    await post(`CREATE TABLE state_ddl (s ${type}) ENGINE=AggregatingMergeTree ORDER BY tuple()`);

    await post(
      'INSERT INTO state_ddl SELECT quantileState(0.9)(toFloat64(number)) FROM numbers(101)',
    );

    const columns = await post(
      "SELECT type FROM system.columns WHERE table = 'state_ddl' FORMAT TSV",
    );

    expect(columns.trim()).toBe(type);
  });
});
