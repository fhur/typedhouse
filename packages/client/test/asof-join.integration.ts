import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  asofJoin,
  asofLeftJoin,
  col,
  count,
  from,
  join,
  sql,
  table,
  type Rel,
} from '@typedhouse/core';
import { compile, type ValidationError } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient, QueryError } from '../src/index.js';

/** D9 Worker. Native evidence for the builder and the emitted text. The Tester's D10 is separate. */
const trades = table(
  'asof_trades',
  { id: col.UInt32, sym: col.String, ts: col.DateTime('UTC'), u64: col.UInt64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const quotes = table(
  'asof_quotes',
  {
    sym: col.String,
    ts: col.DateTime('UTC'),
    flag: col.UInt8,
    v: col.UInt32,
    i64: col.Int64,
    name: col.String,
  },
  { engine: 'MergeTree', sortingKey: ['sym', 'ts'], partitionKey: [] },
);

const nullable = table(
  'asof_nullable',
  { k: col.Nullable(col.String), ts: col.Nullable(col.DateTime('UTC')), v: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['v'], partitionKey: [] },
);

let server: StartedTestContainer;

let admin: ReturnType<typeof createDriver>;

let optimized: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClickHouseBackend>;

type Executable<R> = { readonly ir: Rel; readonly _rowType: R; readonly caps: { live: false } };

const handwritten = async (query: string): Promise<unknown[]> =>
  (
    await (
      await admin.query({ query, format: 'JSON', clickhouse_settings: { join_use_nulls: 1 } })
    ).json()
  ).data;

const all = async <R>(query: Executable<R>) => {
  const streamed: R[] = [];
  for await (const row of optimized.stream(query)) streamed.push(row);

  return [
    await optimized.run(query),
    streamed,
    (await naive.runBuffered(naive.compile(query.ir))) as R[],
  ];
};

beforeAll(async () => {
  server = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_SKIP_USER_SETUP: '1',
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forResponsePredicate(body => body === 'Ok.\n'))
    .start();

  const url = `http://${server.getHost()}:${server.getMappedPort(8123)}`;
  admin = createDriver({ url });

  for (const query of [
    `CREATE TABLE asof_trades (id UInt32, sym String, ts DateTime('UTC'), u64 UInt64)
     ENGINE = MergeTree ORDER BY id`,
    `CREATE TABLE asof_quotes (sym String, ts DateTime('UTC'), flag UInt8, v UInt32, i64 Int64, name String)
     ENGINE = MergeTree ORDER BY (sym, ts)`,
    `CREATE TABLE asof_nullable (k Nullable(String), ts Nullable(DateTime('UTC')), v UInt32)
     ENGINE = MergeTree ORDER BY v`,
    `INSERT INTO asof_trades VALUES
     (1, 'A', '2024-01-01 00:00:10', 1), (2, 'A', '2024-01-01 00:00:30', 2),
     (3, 'B', '2024-01-01 00:00:10', 3), (4, 'C', '2024-01-01 00:00:10', 4)`,
    `INSERT INTO asof_quotes VALUES
     ('A', '2024-01-01 00:00:05', 1, 10, 1, 'x'), ('A', '2024-01-01 00:00:20', 0, 20, 2, 'x'),
     ('B', '2024-01-01 00:00:20', 1, 30, 3, 'x')`,
    `INSERT INTO asof_nullable VALUES
     ('A', '2024-01-01 00:00:01', 1), (NULL, '2024-01-01 00:00:01', 2), ('A', NULL, 3)`,
  ])
    await admin.command({ query });

  optimized = createClient({ url });
  naive = createClickHouseBackend({ url }, 'clickhouse-naive');
}, 120_000);

afterAll(async () => {
  await admin?.close();
  await optimized?.close();
  await naive?.close();
  await server?.stop();
});

const inner = () => asofJoin({ t: from(trades) }, { q: from(quotes) });

const left = () => asofLeftJoin({ t: from(trades) }, { q: from(quotes) });

describe('asof operators', () => {
  const forms = {
    ge: {
      build: () =>
        inner()
          .on(r => r.t.sym.eq(r.q.sym))
          .asof(r => r.t.ts.ge(r.q.ts)),
      sql: 't.ts >= q.ts',
      expected: [
        { id: 1, v: 10 },
        { id: 2, v: 20 },
      ],
    },
    gt: {
      build: () =>
        inner()
          .on(r => r.t.sym.eq(r.q.sym))
          .asof(r => r.t.ts.gt(r.q.ts)),
      sql: 't.ts > q.ts',
      expected: [
        { id: 1, v: 10 },
        { id: 2, v: 20 },
      ],
    },
    le: {
      build: () =>
        inner()
          .on(r => r.t.sym.eq(r.q.sym))
          .asof(r => r.t.ts.le(r.q.ts)),
      sql: 't.ts <= q.ts',
      expected: [
        { id: 1, v: 20 },
        { id: 3, v: 30 },
      ],
    },
    lt: {
      build: () =>
        inner()
          .on(r => r.t.sym.eq(r.q.sym))
          .asof(r => r.t.ts.lt(r.q.ts)),
      sql: 't.ts < q.ts',
      expected: [
        { id: 1, v: 20 },
        { id: 3, v: 30 },
      ],
    },
    reversed: {
      build: () =>
        inner()
          .on(r => r.q.sym.eq(r.t.sym))
          .asof(r => r.q.ts.le(r.t.ts)),
      sql: 'q.ts <= t.ts',
      expected: [
        { id: 1, v: 10 },
        { id: 2, v: 20 },
      ],
    },
  };

  for (const [name, form] of Object.entries(forms))
    it(`${name} agrees with handwritten SQL on run, stream and naive`, async () => {
      const q = form
        .build()
        .map(r => ({ id: r.t.id, v: r.q.v }))
        .orderBy(r => r.id);

      const oracle = await handwritten(
        `SELECT t.id AS id, q.v AS v FROM asof_trades t ASOF INNER JOIN asof_quotes q
         ON t.sym = q.sym AND ${form.sql} ORDER BY id`,
      );

      expect(oracle).toEqual(form.expected);
      for (const rows of await all(q)) expect(rows).toEqual(form.expected);
    });
});

describe('asofLeftJoin', () => {
  const q = () =>
    left()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts))
      .map(r => ({ id: r.t.id, v: r.q.v, name: r.q.name }))
      .orderBy(r => r.id);

  it('keeps unmatched left rows with NULL, on every path', async () => {
    const expected = [
      { id: 1, v: 10, name: 'x' },
      { id: 2, v: 20, name: 'x' },
      { id: 3, v: null, name: null },
      { id: 4, v: null, name: null },
    ];

    expect(q().ir && compile(q().ir).sql).toContain('join_use_nulls = 1');
    for (const rows of await all(q())) expect(rows).toEqual(expected);
  });

  it('the server reports the null-extended descriptors', async () => {
    const { sql } = compile(q().ir);

    const meta = (await (await admin.query({ query: sql, format: 'JSON' })).json()).meta;

    expect(meta).toEqual([
      { name: 'id', type: 'UInt32' },
      { name: 'v', type: 'Nullable(UInt32)' },
      { name: 'name', type: 'Nullable(String)' },
    ]);
  });
});

describe('right-side filter', () => {
  const asof = () =>
    inner()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts));

  it('above the join stays above: one row, not the rows of filtering first', async () => {
    const above = asof()
      .where(r => r.q.flag.eq(1))
      .map(r => ({ id: r.t.id, v: r.q.v }))
      .orderBy(r => r.id);

    const below = asofJoin({ t: from(trades) }, { q: from(quotes).where(r => r.flag.eq(1)) })
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts))
      .map(r => ({ id: r.t.id, v: r.q.v }))
      .orderBy(r => r.id);

    for (const rows of await all(above)) expect(rows).toEqual([{ id: 1, v: 10 }]);

    for (const rows of await all(below))
      expect(rows).toEqual([
        { id: 1, v: 10 },
        { id: 2, v: 10 },
      ]);
  });

  it('a left-side filter gives the same rows moved and nested, on both kinds', async () => {
    const expected = [{ id: 2, v: 20 }];

    const q = asof()
      .where(r => r.t.id.eq(2))
      .map(r => ({ id: r.t.id, v: r.q.v }));

    for (const rows of await all(q)) expect(rows).toEqual(expected);

    const outer = left()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts))
      .where(r => r.t.sym.eq('C'))
      .map(r => ({ id: r.t.id, v: r.q.v }));

    for (const rows of await all(outer)) expect(rows).toEqual([{ id: 4, v: null }]);
  });

  it('a right-side filter on ASOF LEFT keeps its null rows out, without becoming inner', async () => {
    const q = left()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts))
      .where(r => r.q.flag.eq(1))
      .map(r => ({ id: r.t.id, v: r.q.v }));

    expect(compile(q.ir).sql).toContain('ASOF LEFT JOIN');
    for (const rows of await all(q)) expect(rows).toEqual([{ id: 1, v: 10 }]);
  });
});

describe('expressions and parameters', () => {
  it('in both on() and asof()', async () => {
    const q = inner()
      .on(r => r.t.sym.length().plus(1n).eq(r.q.sym.length().plus(1n)))
      .asof(r => r.t.id.plus(9).ge(r.q.v.plus(1)))
      .map(r => ({ id: r.t.id, v: r.q.v }))
      .orderBy(r => r.id);

    const oracle = await handwritten(
      `SELECT t.id AS id, q.v AS v FROM asof_trades t ASOF INNER JOIN asof_quotes q
       ON length(t.sym) + 1 = length(q.sym) + 1 AND t.id + 9 >= q.v + 1 ORDER BY id`,
    );

    expect(oracle.length).toBeGreaterThan(0);
    for (const rows of await all(q)) expect(rows).toEqual(oracle);
  });
});

describe('inputs and folded shapes', () => {
  it('a shared input as a self-join', async () => {
    const shared = from(quotes).where(r => r.sym.eq('A'));

    const q = asofJoin({ a: shared }, { b: shared })
      .on(r => r.a.sym.eq(r.b.sym))
      .asof(r => r.a.ts.gt(r.b.ts))
      .map(r => ({ later: r.a.v, earlier: r.b.v }));

    expect(compile(q.ir).sql).toContain('ASOF INNER JOIN');
    for (const rows of await all(q)) expect(rows).toEqual([{ later: 20, earlier: 10 }]);
  });

  it('a grouped result over the join, and a join over an ASOF input', async () => {
    const grouped = inner()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts))
      .groupBy(r => ({ flag: r.q.flag }))
      .aggregate(() => ({ n: count() }))
      .orderBy(r => r.flag);

    for (const rows of await all(grouped))
      expect(rows).toEqual([
        { flag: 0, n: 1n },
        { flag: 1, n: 1n },
      ]);

    const asofInput = inner()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.ts.ge(r.q.ts))
      .map(r => ({ id: r.t.id, v: r.q.v }));

    const nested = join({ a: asofInput, b: from(trades) })
      .on(r => r.a.id.eq(r.b.id))
      .where(r => r.b.sym.eq('A'))
      .map(r => ({ id: r.b.id, v: r.a.v }))
      .orderBy(r => r.id);

    expect(compile(nested.ir).sql).toContain('ASOF INNER JOIN');

    for (const rows of await all(nested))
      expect(rows).toEqual([
        { id: 1, v: 10 },
        { id: 2, v: 20 },
      ]);
  });
});

describe('a temporal offset, through a sql snippet', () => {
  it('reads one input on each side, with a parameter', async () => {
    const q = inner()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => sql`${r.t.ts} - ${5}`.as(col.DateTime('UTC')).ge(r.q.ts))
      .map(r => ({ id: r.t.id, v: r.q.v }))
      .orderBy(r => r.id);

    const oracle = await handwritten(
      `SELECT t.id AS id, q.v AS v FROM asof_trades t ASOF INNER JOIN asof_quotes q
       ON t.sym = q.sym AND t.ts - 5 >= q.ts ORDER BY id`,
    );

    expect(oracle).toEqual([
      { id: 1, v: 10 },
      { id: 2, v: 20 },
    ]);

    for (const rows of await all(q)) expect(rows).toEqual(oracle);
  });
});

describe('Nullable', () => {
  it('a NULL on either side never matches', async () => {
    const q = asofJoin({ n: from(nullable) }, { q: from(quotes) })
      .on(r => r.n.k.eq(r.q.sym))
      .asof(r => r.n.ts.le(r.q.ts))
      .map(r => ({ v: r.n.v }));

    for (const rows of await all(q)) expect(rows).toEqual([{ v: 1 }]);

    const outer = asofLeftJoin({ q: from(quotes) }, { n: from(nullable) })
      .on(r => r.q.sym.eq(r.n.k))
      .asof(r => r.q.ts.ge(r.n.ts))
      .map(r => ({ sym: r.q.sym, v: r.n.v }))
      .orderBy(r => r.sym);

    for (const rows of await all(outer))
      expect(rows).toEqual([
        { sym: 'A', v: 1 },
        { sym: 'A', v: 1 },
        { sym: 'B', v: null },
      ]);
  });
});

describe('types', () => {
  const asofAny = (f: (r: any) => unknown) =>
    (
      inner().on(r => r.t.sym.eq(r.q.sym)) as unknown as { asof(f: unknown): Executable<unknown> }
    ).asof(f);

  const server = async (query: string) =>
    admin.query({ query }).then(
      () => 'ok',
      (e: { code?: string }) => e.code,
    );

  it('refuses String, which the server refuses with 169', async () => {
    expect(
      await server(
        'SELECT 1 FROM asof_trades t ASOF INNER JOIN asof_quotes q ON t.sym = q.sym AND t.sym >= q.name',
      ),
    ).toBe('169');

    let code = '';

    try {
      compile(asofAny(r => r.t.sym.ge(r.q.name)).ir);
    } catch (error) {
      code = (error as ValidationError).code;
    }

    expect(code).toBe('invalid_asof_type');
  });

  it('plus against minus is UInt64 against Int64, code 386', async () => {
    const q = inner()
      .on(r => r.t.sym.eq(r.q.sym))
      .asof(r => r.t.id.plus(1).ge(r.q.v.minus(1)));

    const error = await optimized.run(q).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(QueryError);
    expect(String(((error as QueryError).cause as { code?: unknown }).code)).toBe('386');
  });

  it('a mixed pair raising 386 surfaces as one QueryError on every path', async () => {
    const q = asofAny(r => r.t.u64.ge(r.q.i64));

    for (const run of [
      () => optimized.run(q),
      async () => {
        for await (const _ of optimized.stream(q));
      },
      () => naive.runBuffered(naive.compile(q.ir)),
    ]) {
      const error = await (run as () => Promise<unknown>)().then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(QueryError);
      expect(String(((error as QueryError).cause as { code?: unknown }).code)).toBe('386');
    }
  });
});
