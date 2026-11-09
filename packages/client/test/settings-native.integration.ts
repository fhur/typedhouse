import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  col,
  count,
  from,
  join,
  leftJoin,
  relNode,
  sql,
  table,
  unionAll,
  uniqExactMerge,
  val,
  type QuerySettings,
  type Rel,
  type SettingsQuery,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient, QueryError } from '../src/index.js';
import { differential } from './backend-harness.js';
import { build, recipeArbitrary, seed as arbitrarySeed } from './differential-arbitrary.js';

/** D6 Tester. Native evidence for `settings()`, on both emitters, independent of settings.integration.ts. */
const t = table(
  'd6_t',
  { id: col.UInt32, cat: col.String, day: col.Date, at: col.DateTime('UTC'), big: col.UInt64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const u = table(
  'd6_u',
  { id: col.UInt32, name: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const rollup = table(
  'd6_rollup',
  { k: col.UInt32, ids: col.AggregateFunction('uniqExact', col.String) },
  { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
);

const q = from(t);

const others = from(u);

const reading = (key: string) => sql`toString(getSetting(${key}))`.as(col.String);

let server: StartedTestContainer;

let url: string;

let admin: ReturnType<typeof createDriver>;

let optimized: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClickHouseBackend>;

let differentialBackends: ReturnType<typeof createClickHouseBackend>[];

type Executable<R> = { readonly ir: Rel; readonly _rowType: R; readonly caps: { live: false } };

const runNaive = async <R>(query: { readonly ir: Rel; readonly _rowType: R }): Promise<R[]> =>
  (await naive.runBuffered(naive.compile(query.ir))) as R[];

const runStream = async <R>(query: Executable<R>): Promise<R[]> => {
  const rows: R[] = [];
  for await (const row of optimized.stream(query)) rows.push(row);
  return rows;
};

/** optimized run, optimized stream, naive buffered. */
const all = async <R>(query: Executable<R>) => [
  await optimized.run(query),
  await runStream(query),
  await runNaive(query),
];

const failure = async (run: () => Promise<unknown>) => {
  const error = await run().then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(QueryError);
  return String(((error as QueryError).cause as { code?: unknown }).code);
};

const failures = async <R>(query: Executable<R>) => [
  await failure(() => optimized.run(query)),
  await failure(() => runStream(query)),
  await failure(() => runNaive(query)),
];

beforeAll(async () => {
  server = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_SKIP_USER_SETUP: '1',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forResponsePredicate(body => body === 'Ok.\n'))
    .start();

  url = `http://${server.getHost()}:${server.getMappedPort(8123)}`;
  admin = createDriver({ url });

  for (const query of [
    `CREATE TABLE d6_t (id UInt32, cat String, day Date, at DateTime('UTC'), big UInt64)
     ENGINE = MergeTree ORDER BY id`,
    'CREATE TABLE d6_u (id UInt32, name String) ENGINE = MergeTree ORDER BY id',
    `CREATE TABLE d6_rollup (k UInt32, ids AggregateFunction(uniqExact, String))
     ENGINE = AggregatingMergeTree ORDER BY k`,
    `INSERT INTO d6_t SELECT number, toString(number % 3), toDate('2024-01-01') + number % 40,
     toDateTime('2024-01-01 00:00:00', 'UTC') + number, 18446744073709551615 - number FROM numbers(1000)`,
    `INSERT INTO d6_u SELECT number, toString(number) FROM numbers(10)`,
    `INSERT INTO d6_rollup SELECT number, uniqExactState(toString(c))
     FROM numbers(1000) ARRAY JOIN range(1000) AS c GROUP BY number`,
    `CREATE TABLE differential_components (tenant String,id String,category Nullable(String),ids Array(String),at Date,amount UInt64) ENGINE=Memory`,
    `CREATE TABLE differential_parts (tenant String,id String) ENGINE=Memory`,
    `INSERT INTO differential_components VALUES
     ('acme','a','visible',['p','p','q'],'2024-03-11',2),('acme','b','',['p','orphan'],'2024-03-12',3),
     ('acme','c',NULL,[],'2024-03-13',0),('other','a','hidden',['p'],'2024-03-14',5)`,
    `INSERT INTO differential_parts VALUES ('acme','p'),('acme','p'),('acme','q'),('other','p')`,
    'CREATE USER ro1 IDENTIFIED WITH no_password SETTINGS readonly = 1',
    'CREATE USER ro2 IDENTIFIED WITH no_password SETTINGS readonly = 2',
    'GRANT SELECT ON default.* TO ro1, ro2',
  ])
    await admin.command({ query });

  optimized = createClient({ url });
  naive = createClickHouseBackend({ url }, 'clickhouse-naive');

  differentialBackends = [
    createClickHouseBackend({ url }, 'clickhouse'),
    createClickHouseBackend({ url }, 'clickhouse-naive'),
  ];
}, 120000);

afterAll(async () => {
  await optimized?.close();
  await naive?.close();
  for (const backend of differentialBackends ?? []) await backend.close();
  await admin?.close();
  await server?.stop();
});

/** Every key, at a value the queries here do not reach. */
const ordinary: readonly [keyof QuerySettings, number | bigint | string, string][] = [
  ['max_threads', 3, '3'],
  ['max_execution_time', 123.5, '123.5'],
  ['max_memory_usage', 5_000_000_000, '5000000000'],
  ['max_rows_to_read', 100_000_000n, '100000000'],
  ['max_bytes_to_read', 100_000_000_000, '100000000000'],
  ['max_result_rows', 1_000_000, '1000000'],
  ['max_result_bytes', 1_000_000_000n, '1000000000'],
  ['max_block_size', 4096, '4096'],
  ['max_bytes_before_external_group_by', 123_456_789, '123456789'],
  ['max_bytes_before_external_sort', 987_654_321n, '987654321'],
  ['priority', 7, '7'],
  ['log_comment', 'd6 read-back', 'd6 read-back'],
];

describe('read-back through each shape, on both emitters', () => {
  /** Each shape reports what every part of the query saw, so a branch that kept the default fails. */
  const shapes: readonly [
    string,
    RegExp,
    (key: string) => { settings(s: QuerySettings): Executable<Record<string, string>> },
    (read: string) => readonly Record<string, string>[],
  ][] = [
    [
      'scan',
      /FROM `d6_t`/,
      key => q.where(r => r.id.eq(5)).map(() => ({ v: reading(key) })),
      read => [{ v: read }],
    ],
    [
      'join, read on both inputs and above',
      /INNER ALL JOIN/,
      key =>
        join({
          a: q.where(r => r.id.eq(5)).map(r => ({ id: r.id, v: reading(key) })),
          b: others.map(r => ({ id: r.id, v: reading(key) })),
        })
          .on(r => r.a.id.eq(r.b.id))
          .map(r => ({ a: r.a.v, b: r.b.v, top: reading(key) })),
      read => [{ a: read, b: read, top: read }],
    ],
    [
      'left join, with compiler-owned join_use_nulls beside it',
      /LEFT ALL JOIN[\s\S]*join_use_nulls = 1/,
      key =>
        leftJoin(
          { a: q.where(r => r.id.eq(5)).map(r => ({ id: r.id, v: reading(key) })) },
          { b: others.map(r => ({ id: r.id, w: reading(key) })) },
        )
          .on(r => r.a.id.eq(r.b.id))
          .map(r => ({ a: r.a.v, b: r.b.w.ifNull('unmatched') })),
      read => [{ a: read, b: read }],
    ],
    [
      'CTE read twice',
      /WITH `t0` AS|FROM \(SELECT/,
      key => {
        const shared = q
          .where(r => r.id.eq(5))
          .map(() => ({ v: reading(key) }))
          .cte();

        return join({ a: shared, b: shared })
          .on(r => r.a.v.eq(r.b.v))
          .map(r => ({ a: r.a.v, b: r.b.v }));
      },
      read => [{ a: read, b: read }],
    ],
    [
      'UNION ALL, three branches, each named',
      /UNION ALL.*UNION ALL/s,
      key =>
        unionAll(
          q.where(r => r.id.eq(1)).map(() => ({ branch: val('1', col.String), v: reading(key) })),
          q.where(r => r.id.eq(2)).map(() => ({ branch: val('2', col.String), v: reading(key) })),
          others
            .where(r => r.id.eq(3))
            .map(() => ({ branch: val('3', col.String), v: reading(key) })),
        ).orderBy(r => r.branch),
      read => [
        { branch: '1', v: read },
        { branch: '2', v: read },
        { branch: '3', v: read },
      ],
    ],
    [
      'root UNION ALL, not wrapped in an outer SELECT',
      /UNION ALL/,
      key =>
        unionAll(
          q.where(r => r.id.eq(1)).map(() => ({ v: reading(key) })),
          q.where(r => r.id.eq(2)).map(() => ({ v: reading(key) })),
        ),
      read => [{ v: read }, { v: read }],
    ],
    [
      'filter inside a set subquery',
      /\bin\(/,
      key =>
        others
          .where(r =>
            r.id.in(
              q
                .where(() => reading(key).ne(val('never', col.String)))
                .where(i => i.id.eq(5))
                .map(i => i.id),
            ),
          )
          .map(() => ({ v: reading(key) })),
      read => [{ v: read }],
    ],
  ];

  for (const [name, text, shape, expected] of shapes)
    it.each(ordinary)(`${name}: %s`, async (key, value, read) => {
      const query = shape(key).settings({ [key]: value });
      expect(compile(query.ir).sql).toMatch(text);
      expect(emitNaive(query.ir).sql).toMatch(text);
      const want = expected(read);

      for (const rows of await all(query)) expect(rows).toEqual(want);
    });

  it.each(ordinary)('UNION DISTINCT from a hand-built node: %s', async (key, value, read) => {
    const branch = (name: string, id: number) =>
      q.where(r => r.id.eq(id)).map(() => ({ branch: val(name, col.String), v: reading(key) })).ir;

    const first = branch('a', 1);

    const union = relNode({
      kind: 'Union',
      inputs: [first, branch('b', 2), branch('b', 2)],
      all: false,
      output: first.output,
    });

    const node = relNode({
      kind: 'Settings',
      input: union,
      settings: { [key]: value },
      output: union.output,
    });

    expect(compile(node).sql).toContain('UNION DISTINCT');
    expect(emitNaive(node).sql).toContain('UNION DISTINCT');

    const rows = [
      await optimized.run({ ir: node, _rowType: {}, caps: { live: false as const } }),
      await runNaive({ ir: node, _rowType: {} }),
    ];

    for (const row of rows)
      expect(
        (row as { branch: string }[]).sort((x, y) => x.branch.localeCompare(y.branch)),
      ).toEqual([
        { branch: 'a', v: read },
        { branch: 'b', v: read },
      ]);
  });

  it('every key at once, in a union with a join in a branch, keeps its own value', async () => {
    const settings = Object.fromEntries(ordinary.map(([key, value]) => [key, value]));
    const expected = Object.fromEntries(ordinary.map(([key, , read]) => [key, read]));

    const readings = () =>
      Object.fromEntries(ordinary.map(([key]) => [key, reading(key)])) as Record<
        keyof QuerySettings,
        ReturnType<typeof reading>
      >;

    const query = unionAll(
      q.where(r => r.id.eq(1)).map(() => readings()),
      others.where(r => r.id.eq(1)).map(() => readings()),
    ).settings(settings);

    for (const rows of await all(query)) expect(rows).toEqual([expected, expected]);
  });

  it('a limit bites in each part of the query, not only where getSetting was read', async () => {
    // A read-back alone cannot tell a setting in force from one reported by a constant fold.
    const wide = q.map(r => ({ id: r.id }));
    const narrow = others.map(r => ({ id: r.id }));
    const limit = { max_rows_to_read: 100 };

    const shapes: readonly [string, Executable<unknown>][] = [
      ['first branch', unionAll(wide, narrow).settings(limit)],
      ['last branch', unionAll(narrow, wide).settings(limit)],
      [
        'right join input',
        join({ a: narrow, b: wide })
          .on(r => r.a.id.eq(r.b.id))
          .map(r => ({ id: r.a.id }))
          .settings(limit),
      ],
      [
        'CTE',
        (() => {
          const shared = wide.cte();

          return join({ a: shared, b: shared })
            .on(r => r.a.id.eq(r.b.id))
            .map(r => ({ id: r.a.id }))
            .settings(limit);
        })(),
      ],
      ['set subquery', narrow.where(r => r.id.in(wide.map(w => w.id))).settings(limit)],
    ];

    for (const [name, shape] of shapes)
      expect(await failures(shape), name).toEqual(['158', '158', '158']);
  });
});

describe('ordinary values read back exactly', () => {
  const integerKeys = [
    'max_memory_usage',
    'max_bytes_before_external_group_by',
    'max_bytes_before_external_sort',
    'priority',
    'max_rows_to_read',
    'max_bytes_to_read',
    'max_result_rows',
    'max_result_bytes',
  ] as const;

  const values: readonly (number | bigint)[] = [
    1_000_000,
    Number.MAX_SAFE_INTEGER,
    2n ** 53n,
    2n ** 63n - 1n,
    2n ** 63n,
    2n ** 64n - 1n,
  ];

  const pairs = integerKeys.flatMap(key => values.map(value => [key, value] as const));

  it.each(pairs)('%s = %s', async (key, value) => {
    const query = others.limit(1).map(() => ({ v: reading(key) }));
    const rows = await all(query.settings({ [key]: value }));
    for (const row of rows) expect(row).toEqual([{ v: String(value) }]);
  });

  it.each([1, 2, 1024, 4096])('max_threads = %i, up to the cap', async value => {
    const rows = await all(
      others
        .limit(1)
        .map(() => ({ v: reading('max_threads') }))
        .settings({ max_threads: value }),
    );

    for (const row of rows) expect(row).toEqual([{ v: String(value) }]);
  });

  it.each([1, 2, 65409, 65536, 4294967296])('max_block_size = %i, up to the cap', async value => {
    const rows = await all(
      others
        .limit(1)
        .map(() => ({ v: reading('max_block_size') }))
        .settings({ max_block_size: value }),
    );

    for (const row of rows) expect(row).toEqual([{ v: String(value) }]);
  });

  it.each([0, 0.25, 0.5, 1, 1.5, 2.5, 60, 3600, 1234.5, 86400.125, 9223372036854])(
    'max_execution_time = %d',
    async value => {
      const rows = await all(
        others
          .limit(1)
          .map(() => ({ v: reading('max_execution_time') }))
          .settings({ max_execution_time: value }),
      );

      for (const row of rows) expect(row).toEqual([{ v: String(value) }]);
    },
  );
});

describe('edges the server normalizes, as measured on 24.8', () => {
  const read = async (key: keyof QuerySettings, value: number | bigint) => {
    const rows = await all(
      others
        .limit(1)
        .map(() => ({ v: reading(key) }))
        .settings({ [key]: value }),
    );

    const [first] = rows;
    for (const row of rows) expect(row).toEqual(first);
    return first![0]!.v;
  };

  it('max_threads = 0 reads as the auto value, a positive thread count', async () => {
    expect(Number(await read('max_threads', 0))).toBeGreaterThan(0);
  });

  it.each([4097, 2 ** 40, Number.MAX_SAFE_INTEGER, 2n ** 64n - 1n])(
    'max_threads = %s reads as 4096',
    async value => {
      expect(await read('max_threads', value)).toBe('4096');
    },
  );

  it('max_block_size = 0 reads as 65409', async () => {
    expect(await read('max_block_size', 0)).toBe('65409');
  });

  it.each([4294967297, Number.MAX_SAFE_INTEGER, 2n ** 64n - 1n])(
    'max_block_size = %s reads as 4294967296',
    async value => {
      expect(await read('max_block_size', value)).toBe('4294967296');
    },
  );

  it.each([
    [1.0000001, '1'],
    [1.0000019, '1.000001'],
    // The server truncates seconds * 1e6, so an ordinary-looking fraction can lose a microsecond.
    [1.001, '1.000999'],
    [1.005, '1.004999'],
    [2.002, '2.001999'],
    [4.004, '4.003999'],
  ])('max_execution_time = %d reads as %s', async (value, measured) => {
    expect(await read('max_execution_time', value)).toBe(measured);
  });

  it('those edges return the same rows as no setting', async () => {
    const shape = q.orderBy(r => r.id).limit(3);
    const plain = await optimized.run(shape);

    for (const settings of [
      { max_threads: 0 },
      { max_threads: 2n ** 64n - 1n },
      { max_block_size: 0 },
      { max_block_size: 2n ** 64n - 1n },
      { priority: 2n ** 64n - 1n },
    ] satisfies QuerySettings[])
      for (const rows of await all(shape.settings(settings))) expect(rows).toEqual(plain);
  });
});

describe('compiler and client settings stay in force next to user settings', () => {
  const user: QuerySettings = { max_threads: 2, log_comment: "it's */ --", priority: 1 };

  it('join_use_nulls: an unmatched row is NULL, not a default', async () => {
    const query = leftJoin({ a: q }, { b: others })
      .on(r => r.a.id.eq(r.b.id))
      .map(r => ({
        id: r.a.id,
        name: r.b.name,
        nulls: reading('join_use_nulls'),
        threads: reading('max_threads'),
      }))
      .where(r => r.id.eq(50))
      .settings(user);

    for (const rows of await all(query))
      expect(rows).toEqual([{ id: 50, name: null, nulls: 'true', threads: '2' }]);
  });

  it('transform_null_in = 0 beats a client default of 1', async () => {
    const forcing = createClient({ url, clickhouse_settings: { transform_null_in: 1 } });

    const query = q
      .where(r => r.id.eq(1))
      .map(r => ({
        member: r.day.in([new Date('2024-01-02')]),
        policy: reading('transform_null_in'),
        threads: reading('max_threads'),
      }))
      .settings(user);

    try {
      expect(compile(query.ir).sql).toContain('transform_null_in = 0');

      expect(await forcing.run(query)).toEqual([{ member: true, policy: 'false', threads: '2' }]);
    } finally {
      await forcing.close();
    }

    for (const rows of await all(query))
      expect(rows).toEqual([{ member: true, policy: 'false', threads: '2' }]);
  });

  it('enable_extended_results_for_datetime_functions = 1 stays with user settings', async () => {
    const query = q
      .where(r => r.id.eq(0))
      .map(r => ({
        week: r.day.toStartOfWeek(),
        extended: reading('enable_extended_results_for_datetime_functions'),
        threads: reading('max_threads'),
      }))
      .settings(user);

    for (const rows of await all(query)) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ extended: 'true', threads: '2' });
    }

    expect(compile(query.ir).sql).toMatch(
      /max_threads = 2, log_comment = '[^']*\\'[^']*', priority = 1, enable_extended_results_for_datetime_functions = 1/,
    );
  });

  it('all three compiler settings at once, with the comment last', async () => {
    const query = leftJoin(
      {
        a: q.map(r => ({
          id: r.id,
          week: r.day.toStartOfWeek(),
          member: r.day.in([new Date('2024-01-02')]),
        })),
      },
      { b: others },
    )
      .on(r => r.a.id.eq(r.b.id))
      .map(r => ({
        id: r.a.id,
        name: r.b.name,
        member: r.a.member,
        nulls: reading('join_use_nulls'),
        policy: reading('transform_null_in'),
        extended: reading('enable_extended_results_for_datetime_functions'),
        comment: reading('log_comment'),
      }))
      .where(r => r.id.eq(1))
      .settings(user);

    for (const emit of [compile, emitNaive])
      expect(emit(query.ir).sql).toMatch(/join_use_nulls = 1 \/\* [^*]* \*\/$/);

    for (const rows of await all(query))
      expect(rows).toEqual([
        {
          id: 1,
          name: '1',
          member: true,
          nulls: 'true',
          policy: 'false',
          extended: 'true',
          comment: "it's */ --",
        },
      ]);
  });

  it('output settings the client sends hold, so values decode as without settings', async () => {
    const shape = q
      .where(r => r.id.lt(2))
      .orderBy(r => r.id)
      .map(r => ({
        id: r.id,
        at: r.at,
        big: r.big,
        day: r.day,
        format: reading('date_time_output_format'),
        quoted: reading('output_format_json_quote_64bit_integers'),
      }));

    const plain = await optimized.run(shape);

    expect(plain[1]).toEqual({
      id: 1,
      at: new Date('2024-01-01T00:00:01Z'),
      big: 18446744073709551614n,
      day: new Date('2024-01-02'),
      format: 'iso',
      quoted: 'true',
    });

    for (const rows of await all(shape.settings(user))) expect(rows).toEqual(plain);
  });

  it('a settings() value beats the same key from the client configuration', async () => {
    const preset = createClient({ url, clickhouse_settings: { max_threads: 1, priority: '9' } });

    try {
      const query = others.limit(1).map(() => ({
        threads: reading('max_threads'),
        priority: reading('priority'),
      }));

      expect(await preset.run(query)).toEqual([{ threads: '1', priority: '9' }]);

      expect(await preset.run(query.settings({ max_threads: 2 }))).toEqual([
        { threads: '2', priority: '9' },
      ]);
    } finally {
      await preset.close();
    }
  });
});

describe('each resource limit is a QueryError with its code, when it fails before output starts', () => {
  const wide = q.map(r => ({ id: r.id, cat: r.cat, at: r.at }));

  it.each([
    ['max_rows_to_read', { max_rows_to_read: 10 }, '158'],
    ['max_bytes_to_read', { max_bytes_to_read: 10 }, '307'],
    ['max_result_rows', { max_result_rows: 10 }, '396'],
    ['max_result_bytes', { max_result_bytes: 10 }, '396'],
  ] satisfies readonly [string, QuerySettings, string][])('%s', async (_name, settings, code) => {
    expect(await failures(wide.settings(settings))).toEqual([code, code, code]);
  });

  it('max_execution_time: code 159 at the smallest accepted value', async () => {
    const shape = wide.settings({ max_execution_time: 0.000001 });
    expect(await failures(shape)).toEqual(['159', '159', '159']);
  });

  it('max_execution_time: code 159 on a query that outlasts a realistic limit', async () => {
    const slow = q
      .limit(1)
      .map(() => ({ slept: sql`sleep(1)`.as(col.UInt8) }))
      .settings({ max_execution_time: 0.2 });

    expect(await failures(slow)).toEqual(['159', '159', '159']);
  });

  it('max_execution_time: 0 means no limit, on the same query', async () => {
    const slow = q
      .limit(1)
      .map(() => ({ slept: sql`sleep(0.3)`.as(col.UInt8) }))
      .settings({ max_execution_time: 0 });

    for (const rows of await all(slow)) expect(rows).toEqual([{ slept: 0 }]);
  });

  it('max_memory_usage: code 241 from uniqExactMerge over 1,000 stored rows', async () => {
    const shape = from(rollup)
      .groupBy(r => ({ k: r.k }))
      .aggregate(g => ({ ids: uniqExactMerge(g.ids) }));

    const unlimited = await optimized.run(shape.orderBy(r => r.k).limit(1));
    expect(unlimited).toEqual([{ k: 0, ids: 1000n }]);
    const limited = shape.settings({ max_memory_usage: 1000000 });
    expect(await failures(limited)).toEqual(['241', '241', '241']);
  });

  it('the QueryError names the input as its node, with the SQL and parameters', async () => {
    const shape = q.where(r => r.id.gt(0));
    const settled = shape.settings({ max_rows_to_read: 10 });
    const error = await optimized.run(settled).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).node).toBe(settled.ir.input);
    expect((error as QueryError).sql).toBe(compile(settled.ir).sql);
    expect((error as QueryError).params).toEqual(compile(shape.ir).params);
  });

  it('a limit that is not reached leaves rows alone', async () => {
    const shape = q.orderBy(r => r.id).limit(5);
    const plain = await optimized.run(shape);

    for (const rows of await all(
      shape.settings({
        max_result_rows: 5,
        max_rows_to_read: 1000,
        max_execution_time: 60,
        max_memory_usage: 1_000_000_000,
      }),
    ))
      expect(rows).toEqual(plain);
  });

  it('measured: count() over a table answers from metadata and ignores read limits', async () => {
    const counted = q.aggregate(() => ({ c: count() }));

    for (const settings of [
      { max_rows_to_read: 1 },
      { max_bytes_to_read: 1 },
    ] satisfies QuerySettings[])
      for (const rows of await all(counted.settings(settings)))
        expect(rows).toEqual([{ c: 1000n }]);
  });
});

describe('read-only users', () => {
  const as = (username: string) => createClient({ url, username, password: '' });

  it('readonly = 1: run and stream raise 164 with and without settings', async () => {
    const client = as('ro1');

    try {
      for (const query of [others.limit(1), others.limit(1).settings({ max_threads: 1 })]) {
        expect(await failure(() => client.run(query))).toBe('164');

        expect(
          await failure(async () => {
            for await (const row of client.stream(query)) void row;
          }),
        ).toBe('164');
      }
    } finally {
      await client.close();
    }
  });

  it('readonly = 1: toSQL text fails only when it has a SETTINGS clause', async () => {
    const driver = createDriver({ url, username: 'ro1', password: '' });

    const plainly = (text: string) =>
      driver.query({ query: text, format: 'JSONEachRow' }).then(result => result.json());

    try {
      const shape = others.orderBy(r => r.id).limit(1);
      expect(await plainly(compile(shape.ir).sql)).toEqual([{ id: 0, name: '0' }]);

      await expect(
        plainly(compile(shape.settings({ max_threads: 1 }).ir).sql),
      ).rejects.toMatchObject({ code: '164' });

      const outer = leftJoin({ a: others }, { b: others }).on(r => r.a.id.eq(r.b.id));
      await expect(plainly(compile(outer.ir).sql)).rejects.toMatchObject({ code: '164' });
    } finally {
      await driver.close();
    }
  });

  it('readonly = 2: every key is accepted and reads back', async () => {
    const client = as('ro2');

    try {
      for (const [key, value, read] of ordinary) {
        const query = others
          .limit(1)
          .map(() => ({ v: reading(key) }))
          .settings({ [key]: value });

        expect(await client.run(query)).toEqual([{ v: read }]);
      }
    } finally {
      await client.close();
    }
  });
});

describe('log_comment reads back byte for byte, in getSetting and system.query_log', () => {
  const comments: readonly [string, string][] = [
    ['single quote', "it's"],
    ['two quotes', "''"],
    ['double quote', '"quoted"'],
    ['backtick', '`x`'],
    ['backslash', 'a\\b'],
    ['trailing backslash', 'trailing\\'],
    ['backslash then quote', "\\'"],
    ['escape-looking text', '\\n \\t \\0 \\x41 \\u0041'],
    ['newline', 'a\nb'],
    ['carriage return', 'a\rb'],
    ['tab', 'a\tb'],
    ['NUL', 'a\0b'],
    ['NUL then digit', 'a\x001'],
    ['leading and trailing NUL', '\0x\0'],
    ['control characters', '\u0001\u0007\b\f\u000b\u001b\u007f'],
    ['close comment', '*/'],
    ['open comment', '/*'],
    ['both comments', '/* x */ -- y # z'],
    ['line comment', '-- rest'],
    ['parameter text', '{p0:String}'],
    ['parameter text with a quote', "'{p0:String}'"],
    ['settings text', "x', limit = 1, log_comment = 'y"],
    ['settings words', 'SETTINGS limit = 1'],
    ['format words', ' FORMAT JSON'],
    ['semicolon', "'; DROP TABLE d6_t; --"],
    ['trailing semicolon', 'x;'],
    ['leading and trailing spaces', '  x  '],
    ['emoji', '😀 🇨🇱 é'],
    ['line separators', '  \u0085'],
    ['BOM and noncharacter', '﻿￿'],
    ['max code point', '\u{10ffff}'],
    ['100 KB ascii', 'k'.repeat(100_000)],
    ['60 KB of quotes and backslashes', "'\\".repeat(30_000)],
    ['100 KB of emoji', '😀'.repeat(25_000)],
  ];

  const parameterized = q.where(r => r.cat.eq('{p0:String}')).limit(1);

  it.each(comments)('%s', async (_name, comment) => {
    const query = others.limit(1).map(() => ({ v: reading('log_comment') }));
    const rows = await all(query.settings({ log_comment: comment }));
    for (const row of rows) expect(row).toEqual([{ v: comment }]);
  });

  it('system.query_log has the same bytes', async () => {
    // Every comment on both paths, then compared by hex, so no client decoding is involved.
    const shape = others.limit(1);

    for (const [, comment] of comments) {
      const settled = shape.settings({ log_comment: comment });
      await optimized.run(settled);
      await runNaive(settled);
    }

    await admin.command({ query: 'SYSTEM FLUSH LOGS' });

    const result = await admin.query({
      query: `SELECT hex(log_comment) AS comment, count() AS n FROM system.query_log
              WHERE type = 'QueryFinish' AND query LIKE '%d6_u%' AND query LIKE '%log_comment =%'
              GROUP BY comment`,
      format: 'JSONEachRow',
    });

    const logged = new Map(
      (await result.json<{ comment: string; n: string }>()).map(row => [
        row.comment,
        Number(row.n),
      ]),
    );

    for (const [name, comment] of comments) {
      const hex = Buffer.from(comment, 'utf8').toString('hex').toUpperCase();
      expect(logged.get(hex) ?? 0, name).toBeGreaterThanOrEqual(2);
    }

    const tables = await admin.query({ query: 'EXISTS TABLE d6_t', format: 'TabSeparated' });
    expect((await tables.text()).trim()).toBe('1');
  });

  it.each(comments)('%s: the parameter map and query text are undisturbed', (_name, comment) => {
    const settled = parameterized.settings({ log_comment: comment });

    for (const emit of [compile, emitNaive]) {
      const plain = emit(parameterized.ir);
      const compiled = emit(settled.ir);
      expect(compiled.params).toEqual(plain.params);
      expect(compiled.parameterTypes).toEqual(plain.parameterTypes);
      expect(compiled.sql.startsWith(`${plain.sql} SETTINGS log_comment = '`)).toBe(true);
    }
  });

  it.each(comments)(
    '%s: a parameter still binds beside it, in the optimized and naive SQL',
    async (_name, comment) => {
      const query = q
        .where(r => r.cat.eq('1'))
        .orderBy(r => r.id)
        .limit(1)
        .map(r => ({ id: r.id, c: reading('log_comment') }))
        .settings({ log_comment: comment });

      for (const rows of await all(query)) expect(rows).toEqual([{ id: 1, c: comment }]);
    },
  );

  it.each(comments)('%s: survives the trailing join_use_nulls comment', async (_name, comment) => {
    const query = leftJoin({ a: q.where(r => r.id.gt(8)) }, { b: others })
      .on(r => r.a.id.eq(r.b.id))
      .map(r => ({ id: r.a.id, name: r.b.name, c: reading('log_comment') }))
      .orderBy(r => r.id)
      .limit(2)
      .settings({ log_comment: comment });

    for (const emit of [compile, emitNaive])
      expect(emit(query.ir).sql).toMatch(/ \/\* join_use_nulls = 1: [^/]* \*\/$/);

    for (const rows of await all(query))
      expect(rows).toEqual([
        { id: 9, name: '9', c: comment },
        { id: 10, name: null, c: comment },
      ]);
  });

  it('over max_query_size: code 62', async () => {
    const query = others.limit(1).settings({ log_comment: 'k'.repeat(300_000) });
    expect(await failures(query)).toEqual(['62', '62', '62']);
  });
});

describe('differential under performance settings', () => {
  const performance: readonly QuerySettings[] = [
    { max_threads: 1 },
    { max_threads: 8 },
    { max_threads: 0 },
    { max_block_size: 1 },
    { max_block_size: 7 },
    { max_block_size: 0 },
    { max_bytes_before_external_group_by: 1 },
    { max_bytes_before_external_group_by: 100_000_000 },
    { max_bytes_before_external_sort: 1 },
    { max_bytes_before_external_sort: 100_000_000 },
    { priority: 1 },
    { log_comment: "it's a differential" },
    {
      max_threads: 2,
      max_block_size: 3,
      max_bytes_before_external_group_by: 1,
      max_bytes_before_external_sort: 1,
      priority: 5,
      log_comment: 'all of them',
    },
  ];

  const shapes = () =>
    [
      [
        'filter and map',
        q.where(r => r.id.lt(100)).map(r => ({ id: r.id, next: r.id.plus(1) })),
        false,
      ],
      ['sort and limit', q.orderBy(r => r.id).limit(10, 5), true],
      [
        'aggregate',
        q
          .groupBy(r => ({ cat: r.cat }))
          .aggregate(() => ({ c: count() }))
          .orderBy(r => r.cat),
        true,
      ],
      ['distinct', q.map(r => ({ cat: r.cat })).distinct(), false],
      [
        'union',
        unionAll(
          q.where(r => r.id.lt(5)).map(r => ({ id: r.id })),
          others.map(r => ({ id: r.id })),
        ),
        false,
      ],
      [
        'left join',
        leftJoin({ a: q.where(r => r.id.lt(20)) }, { b: others })
          .on(r => r.a.id.eq(r.b.id))
          .map(r => ({ id: r.a.id, name: r.b.name })),
        false,
      ],
      [
        'cte',
        (() => {
          const shared = q.where(r => r.id.lt(50)).cte();

          return join({ a: shared, b: shared })
            .on(r => r.a.id.eq(r.b.id))
            .map(r => ({ id: r.a.id }));
        })(),
        false,
      ],
    ] as const;

  const shapeCases = shapes().flatMap(([name, shape, ordered]) =>
    performance.map(
      settings => [name, JSON.stringify(settings), shape, ordered, settings] as const,
    ),
  );

  it.each(shapeCases)('%s, %s', async (_name, _text, shape, ordered, settings) => {
    const plain = await differential(differentialBackends, shape, ordered);
    const settled = await differential(differentialBackends, shape.settings(settings), ordered);
    expect(plain.length).toBeGreaterThan(0);

    const key = (rows: unknown[]) =>
      rows
        .map(row =>
          JSON.stringify(row, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
        )
        .sort();

    expect(key(settled)).toEqual(key(plain));
    if (ordered) expect(settled).toEqual(plain);
  });

  it('random trees: naive and optimized agree, with and without the settings', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipeArbitrary,
        fc.constantFrom(...performance),
        async (recipe, settings) => {
          const shape = build(recipe);
          const ordered = recipe.end === 'limit';
          const plain = await differential(differentialBackends, shape, ordered);

          const settled = await differential(
            differentialBackends,
            shape.settings(settings),
            ordered,
          );

          const key = (rows: unknown[]) =>
            rows
              .map(row =>
                JSON.stringify(row, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
              )
              .sort();

          expect(key(settled)).toEqual(key(plain));
        },
      ),
      { numRuns: 100, seed: arbitrarySeed },
    );
  });
});

describe('measured, for the row contract', () => {
  it('a client-level result_overflow_mode = break ends a settings() limit with no error, at a block boundary', async () => {
    // Not settable through settings(), and the docs limit their promise to the server's default modes.
    const breaking = createClient({ url, clickhouse_settings: { result_overflow_mode: 'break' } });

    try {
      const rows = await breaking.run(q.settings({ max_result_rows: 10 }));
      expect(rows.length).toBeGreaterThan(10);
    } finally {
      await breaking.close();
    }
  });

  it('the client request timeout, not the server limit, ends a slow query', async () => {
    const hasty = createClient({ url, request_timeout: 100 });

    const slow = others
      .limit(1)
      .map(() => ({ slept: sql`sleep(1)`.as(col.UInt8) }))
      .settings({ max_execution_time: 60 });

    try {
      const error = await hasty.run(slow).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(QueryError);
      expect(((error as QueryError).cause as { code?: unknown }).code).toBeUndefined();
    } finally {
      await hasty.close();
    }
  });
});
