import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asofLeftJoin,
  col,
  count,
  from,
  fullJoin,
  join,
  leftJoin,
  print,
  rightJoin,
  sql,
  table,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { canonical, connect, startServer, type Connection } from './asof-support.js';

/** D21 Worker. Raw SQL reads elements, not `toString(tup)`: 24.3 ignores `date_time_output_format` inside
 * `toString` of a Tuple holding a DateTime, which is unrelated to null extension.
 * A null-extended Tuple or JSON reads as its typed default on every version, through
 * `ifNull(col, defaultValueOfTypeName('<type>'))`. 24.8 runs first and is the baseline: every later
 * version must give its rows, and every version's `meta` must equal the descriptor. */
const versions = ['24.8', '24.3', '25.3', '25.8', '25.10', '26.3', '26.10'] as const;

/** `JSON` exists from 24.8 behind a setting, and without one from 25.3. */
const hasJson = (v: string) => v !== '24.3';

const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('d21_l', { k: col.UInt8, ts: col.UInt32 }, opts);

const tupleColumns = {
  e: col.Enum8({ "it's": 1, b: 2 }),
  t: col.DateTime('Asia/Tokyo'),
  'a b': col.UInt8,
  n: col.Nullable(col.UInt32),
  i64: col.Int64,
};

const r = table(
  'd21_r',
  {
    k: col.UInt8,
    ts: col.UInt32,
    tup: col.Tuple(tupleColumns),
    nest: col.Tuple({ i: col.Tuple({ z: col.UInt16 }) }),
  },
  opts,
);

const j = table('d21_j', { k: col.UInt8, ts: col.UInt32, js: col.JSON }, opts);

const ddl = (version: string) => [
  'CREATE OR REPLACE TABLE d21_l (k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY k',
  `CREATE OR REPLACE TABLE d21_r (k UInt8, ts UInt32,
     tup Tuple(e Enum8('it\\'s' = 1, 'b' = 2), t DateTime('Asia/Tokyo'), \`a b\` UInt8, n Nullable(UInt32), i64 Int64),
     nest Tuple(i Tuple(z UInt16))) ENGINE = MergeTree ORDER BY k`,
  'INSERT INTO d21_l VALUES (1, 10), (2, 10)',
  `INSERT INTO d21_r VALUES (1, 5, ('b', '2024-01-01 00:00:00', 7, 8, 5), ((9))), (3, 5, ('b', '2024-01-01 00:00:00', 1, NULL, 6), ((4)))`,
  ...(hasJson(version)
    ? [
        `CREATE OR REPLACE TABLE d21_j (k UInt8, ts UInt32, js JSON) ENGINE = MergeTree ORDER BY k
         SETTINGS index_granularity = 8192`,
        `INSERT INTO d21_j VALUES (1, 5, '{"a": 1}')`,
      ]
    : []),
];

type Built = { ir: any; _rowType: unknown; caps: any };

/** q is the null-extended side in every kind; rightJoin puts it first. */
const kinds = {
  leftJoin: (right: any) =>
    (leftJoin as any)({ t: from(l) }, { q: right }).on((x: any) => x.t.k.eq(x.q.k)),
  rightJoin: (right: any) =>
    (rightJoin as any)({ q: right }, { t: from(l) }).on((x: any) => x.t.k.eq(x.q.k)),
  fullJoin: (right: any) =>
    (fullJoin as any)({ t: from(l) }, { q: right }).on((x: any) => x.t.k.eq(x.q.k)),
  asofLeftJoin: (right: any) =>
    (asofLeftJoin as any)({ t: from(l) }, { q: right })
      .on((x: any) => x.t.k.eq(x.q.k))
      .asof((x: any) => x.t.ts.ge(x.q.ts)),
} as const;

const shapes: Record<string, (kind: (right: any) => any) => Built> = {
  whole: k => k(from(r)).map((x: any) => ({ k: x.t.k, tup: x.q.tup, nest: x.q.nest })),
  elements: k =>
    k(from(r)).map((x: any) => ({
      k: x.t.k,
      e: x.q.tup.element('e'),
      t: x.q.tup.element('t'),
      ab: x.q.tup.element('a b'),
      n: x.q.tup.element('n'),
      i64: x.q.tup.element('i64'),
      z: x.q.nest.element('i').element('z'),
    })),
  where: k =>
    k(from(r))
      .where((x: any) => x.q.tup.element('i64').eq(0n))
      .map((x: any) => ({ k: x.t.k })),
  orderBy: k =>
    k(from(r))
      .orderBy((x: any) => x.q.tup.element('i64'))
      .map((x: any) => ({ k: x.t.k, i64: x.q.tup.element('i64') })),
  groupBy: k =>
    k(from(r))
      .groupBy((x: any) => ({ i64: x.q.tup.element('i64') }))
      .aggregate(() => ({ n: count() })),
  raw: k =>
    k(from(r)).map((x: any) => ({
      k: x.t.k,
      ab: sql`tupleElement(${x.q.tup}, 'a b') + 1`.as(col.UInt16),
      i64: sql`tupleElement(${x.q.tup}, 'i64')`.as(col.Int64),
    })),
  joinOverJoin: k =>
    join({
      a: k(from(r)).map((x: any) => ({ k: x.t.k, tup: x.q.tup })),
      b: from(l),
    } as any)
      .on((x: any) => x.a.k.eq(x.b.k))
      .map((x: any) => ({ k: x.b.k, i64: x.a.tup.element('i64'), tup: x.a.tup })),
};

const jsonShapes: Record<string, (kind: (right: any) => any) => Built> = {
  json: k => k(from(j)).map((x: any) => ({ k: x.t.k, js: x.q.js })),
};

const baseline = new Map<string, string[]>();

const jsonSettings = (version: string) =>
  version === '24.8' ? { allow_experimental_json_type: 1 } : ({} as Record<string, number>);

describe.each(versions)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await startServer(version as never);
    stop = server.stop;
    c = connect(server.url, jsonSettings(version));
    for (const query of ddl(version)) await c.admin.command({ query });
  }, 120_000);

  afterAll(async () => {
    await c?.close();
    await stop?.();
  });

  const cases = Object.entries({
    ...shapes,
    ...(hasJson(version) ? jsonShapes : {}),
  }).flatMap(([shape, build]) => Object.keys(kinds).map(kind => [shape, kind, build] as const));

  it.each(cases)(
    '%s through %s: rows equal 24.8 and meta equals the descriptor',
    async (shape, kind, build) => {
      const q = build(kinds[kind as keyof typeof kinds]);

      for (const [emitter, emit] of [
        ['planned', compile],
        ['naive', emitNaive],
      ] as const) {
        const compiled = emit(q.ir);
        const { meta } = await c.json(compiled.sql, jsonSettings(version), compiled.params);

        expect(
          meta.map(m => m.type),
          `${emitter} meta`,
        ).toEqual(Object.values(compiled.columns).map(t => print(t)));
      }

      const optimized = canonical(await c.optimized.run(q as never));
      const naive = canonical((await c.naive.runBuffered(c.naive.compile(q.ir))) as unknown[]);
      expect(naive).toEqual(optimized);

      const key = `${shape}/${kind}`;

      if (version === '24.8') baseline.set(key, optimized);
      else expect(optimized).toEqual(baseline.get(key));
    },
  );

  it('the unmatched row is the typed default, not null', async () => {
    const q = (shapes.whole!(kinds.leftJoin) as any).where((x: any) => x.k.eq(2));

    expect(await c.optimized.run(q as never)).toEqual([
      {
        k: 2,
        tup: { e: "it's", t: new Date(0), 'a b': 0, n: null, i64: 0n },
        nest: { i: { z: 0 } },
      },
    ]);
  });
});
