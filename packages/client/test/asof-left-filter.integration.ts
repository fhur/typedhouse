import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asofJoin, asofLeftJoin, cast, col, from, join, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { canonical, connect, startServer, type Connection } from './asof-support.js';

/** The left-filter push and its exemption. Results-only: where naive returns rows, optimized returns
 * the same rows and never raises. Rows are written out, so the model is this file's expectations. */
const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const l = table(
  'asof_f_l',
  {
    id: col.UInt32,
    k: col.String,
    ts: col.UInt32,
    s: col.String,
    nts: col.Nullable(col.UInt32),
    lc: col.LowCardinality(col.String),
    big: col.UInt64,
  },
  opts,
);

const r = table(
  'asof_f_r',
  {
    id: col.UInt32,
    k: col.String,
    ts: col.UInt32,
    v: col.UInt32,
    nts: col.Nullable(col.UInt32),
    lc: col.LowCardinality(col.String),
    u8: col.UInt8,
    i32: col.Int32,
  },
  opts,
);

// All of these left rows hold a numeric key, and the right input holds a non-numeric one.
const numeric = table('asof_f_n', { id: col.UInt32, k: col.String, ts: col.UInt32 }, opts);

const J = (a: any = from(l), b: any = from(r)) => (asofJoin as any)({ t: a }, { q: b }) as any;

const byKey = (x: any) => x.t.k.eq(x.q.k);

const ge = (x: any) => x.t.ts.ge(x.q.ts);

const pick = (x: any) => ({ id: x.t.id, v: x.q.v });

const toInt = (e: any) => cast(e, col.Int32 as never) as any;

const base = () => J().on(byKey).asof(ge);

const cases: Record<string, { build: () => any; rows: unknown[] }> = {
  'a guard above a fallible conjunct': {
    build: () =>
      base()
        .where((x: any) => x.t.s.ne('bad'))
        .where((x: any) => toInt(x.t.s).gt(0))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
      { id: 4, v: 400 },
    ],
  },
  'a guard in the left input, a fallible conjunct above': {
    build: () =>
      J(from(l).where(x => x.s.ne('bad')))
        .on(byKey)
        .asof(ge)
        .where((x: any) => toInt(x.t.s).gt(0))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
      { id: 4, v: 400 },
    ],
  },
  'a fallible conjunct with a right conjunct, after a guard': {
    build: () =>
      base()
        .where((x: any) => x.t.s.ne('bad'))
        .where((x: any) => toInt(x.t.s).gt(0).and(x.q.v.gt(0)))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
      { id: 4, v: 400 },
    ],
  },
  'a fallible expression in the left input, a safe filter above': {
    build: () =>
      J(
        from(l)
          .where(x => x.s.ne('bad'))
          .where(x => toInt(x.s).gt(0)),
      )
        .on(byKey)
        .asof(ge)
        .where((x: any) => x.t.id.gt(0))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
      { id: 4, v: 400 },
    ],
  },
  'a fallible expression in the right input, a safe filter above': {
    build: () =>
      J(
        from(l),
        from(r)
          .where(x => x.k.ne('zzz'))
          .where(x => toInt(x.k).gt(0)),
      )
        .on(byKey)
        .asof(ge)
        .where((x: any) => x.t.id.gt(0))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
      { id: 4, v: 400 },
    ],
  },
  'a guard on the right above a fallible right conjunct': {
    build: () =>
      base()
        .where((x: any) => x.q.k.ne('zzz'))
        .where((x: any) => toInt(x.q.k).gt(0))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
      { id: 4, v: 400 },
    ],
  },
  'a left filter over a Nullable inequality': {
    build: () =>
      J()
        .on(byKey)
        .asof((x: any) => x.t.nts.ge(x.q.nts))
        .where((x: any) => x.t.id.lt(3))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
    ],
  },
  'a left filter over a LowCardinality equality': {
    build: () =>
      J()
        .on((x: any) => x.t.lc.eq(x.q.lc))
        .asof(ge)
        .where((x: any) => x.t.id.lt(3))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
    ],
  },
  'a left filter over UInt32 against UInt8': {
    build: () =>
      J()
        .on(byKey)
        .asof((x: any) => x.t.ts.ge(x.q.u8))
        .where((x: any) => x.t.id.lt(3))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
    ],
  },
  'a left filter over UInt32 against a negative Int32': {
    build: () =>
      J()
        .on(byKey)
        .asof((x: any) => x.t.ts.ge(x.q.i32))
        .where((x: any) => x.t.id.lt(3))
        .map(pick),
    rows: [
      { id: 1, v: 100 },
      { id: 2, v: 200 },
    ],
  },
  'a left filter on the equality key, on the kind that keeps rows': {
    build: () =>
      (asofLeftJoin as any)({ t: from(l) }, { q: from(r) })
        .on(byKey)
        .asof(ge)
        .where((x: any) => x.t.k.eq('bad'))
        .map(pick),
    rows: [{ id: 3, v: null }],
  },
};

describe.each(['24.3', '24.8', '26.10'] as const)('left filter on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  const outcome = async (f: () => Promise<unknown[]>) =>
    f().then(
      rows => ({ rows: canonical(rows) }),
      (e: { cause?: { code?: unknown } }) => ({ error: String(e.cause?.code) }),
    );

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    c = connect(server.url);

    for (const query of [
      `CREATE OR REPLACE TABLE asof_f_l (id UInt32, k String, ts UInt32, s String, nts Nullable(UInt32), lc LowCardinality(String), big UInt64) ENGINE = MergeTree ORDER BY id`,
      `CREATE OR REPLACE TABLE asof_f_r (id UInt32, k String, ts UInt32, v UInt32, nts Nullable(UInt32), lc LowCardinality(String), u8 UInt8, i32 Int32) ENGINE = MergeTree ORDER BY id`,
      `CREATE OR REPLACE TABLE asof_f_n (id UInt32, k String, ts UInt32) ENGINE = MergeTree ORDER BY id`,
      `INSERT INTO asof_f_l VALUES (1, '1', 10, '5', 10, '1', 10), (2, '2', 10, '6', 10, '2', 10), (3, 'bad', 10, 'bad', NULL, 'bad', 10), (4, '1', 20, '7', 20, '1', 18446744073709551615)`,
      `INSERT INTO asof_f_r VALUES (1, '1', 5, 100, 5, '1', 5, -5), (2, '2', 5, 200, 5, '2', 5, 5), (3, 'zzz', 5, 300, 5, 'zzz', 5, -5), (4, '1', 15, 400, 15, '1', 15, 15)`,
      `INSERT INTO asof_f_n VALUES (1, '1', 10), (2, '2', 10)`,
    ])
      await c.admin.command({ query });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  it.each(Object.keys(cases))('%s', async name => {
    const { build, rows } = cases[name]!;
    const q = build();
    const naive = await outcome(() => c.naive.runBuffered(c.naive.compile(q.ir)));
    const optimized = await outcome(() => c.optimized.run(q));
    expect(naive, compile(q.ir).sql).toEqual({ rows: canonical(rows) });
    expect(optimized, compile(q.ir).sql).toEqual(naive);
  });

  it('a pair raising 386 raises on both forms, with the filter moved or not', async () => {
    const q = J()
      .on(byKey)
      .asof((x: any) => x.t.big.ge(x.q.i32))
      .where((x: any) => x.t.id.lt(3))
      .map(pick);

    expect(compile(q.ir).sql.split('ASOF')[0]).toMatch(/WHERE `id` < /);
    expect(await outcome(() => c.optimized.run(q))).toEqual({ error: '386' });

    expect(await outcome(() => c.naive.runBuffered(c.naive.compile(q.ir)))).toEqual({
      error: '386',
    });
  });

  it('a left conjunct is not copied across ASOF equalities, where an ordinary join copies it', async () => {
    const asof = J(from(numeric))
      .on(byKey)
      .asof(ge)
      .where((x: any) => toInt(x.t.k).gt(0))
      .map(pick);

    const rows = {
      rows: canonical([
        { id: 1, v: 100 },
        { id: 2, v: 200 },
      ]),
    };

    expect(await outcome(() => c.optimized.run(asof))).toEqual(rows);
    expect(await outcome(() => c.naive.runBuffered(c.naive.compile(asof.ir)))).toEqual(rows);

    const ordinary = (join as any)({ t: from(numeric), q: from(r) })
      .on(byKey)
      .where((x: any) => toInt(x.t.k).gt(0))
      .map(pick);

    // The contrast, as measured: 24.3 returns these rows and later versions raise on 'zzz'.
    const contrast = await outcome(() => c.optimized.run(ordinary));
    expect(contrast).toEqual(version === '24.3' ? { rows: expect.anything() } : { error: '6' });
  });

  it('a conjunct on the right key reads the joined rows: no copy to the left input', async () => {
    const q = J(from(numeric))
      .on(byKey)
      .asof(ge)
      .where((x: any) => toInt(x.q.k).gt(0))
      .map(pick);

    const rows = {
      rows: canonical([
        { id: 1, v: 100 },
        { id: 2, v: 200 },
      ]),
    };

    expect(await outcome(() => c.optimized.run(q))).toEqual(rows);
    expect(await outcome(() => c.naive.runBuffered(c.naive.compile(q.ir)))).toEqual(rows);
  });
});
