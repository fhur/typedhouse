import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asofJoin, asofLeftJoin, col, count, from, table } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import {
  canonical,
  closest,
  connect,
  left,
  opSql,
  paths,
  right,
  seed,
  seededRows,
  startServer,
  type Connection,
  type LeftRow,
  type Op,
  type RightRow,
  type Settings,
  type Version,
} from './asof-support.js';

/** plan-selects folds WHERE, the select list and GROUP BY into the ASOF block, on the claim that
 * no server pushes a right-side conjunct below the join. Each row of this battery compares the
 * folded text, the nested naive text and a JavaScript model, per version and per planner setting. */
const { lefts, rights } = seededRows();

const T = (ts: number) => new Date(ts * 1000);

type LeftExpected = { id: number; rid: number | null };

/** JS model: match, on the right rows `rightFilter` keeps, then filter the joined rows. */
function model(
  op: Op,
  kind: 'inner' | 'left',
  rightFilter: (r: RightRow) => boolean,
  above: (l: LeftRow, r: RightRow | undefined) => boolean,
): LeftExpected[] {
  const out: LeftExpected[] = [];

  for (const l of lefts) {
    const candidates = rights.filter(r => r.sym === l.sym && rightFilter(r));
    const r = closest(l.ts, candidates, op);
    if (!r && kind === 'inner') continue;
    if (above(l, r)) out.push({ id: l.id, rid: r?.rid ?? null });
  }

  return out;
}

const join = (
  kind: 'inner' | 'left',
  op: Op,
  q: ReturnType<typeof from<typeof right>> | any = from(right),
) => {
  const f = kind === 'inner' ? asofJoin : asofLeftJoin;

  return (f as typeof asofJoin)({ t: from(left) }, { q })
    .on(r => r.t.sym.eq((r.q as any).sym))
    .asof(r => (r.t.ts as any)[op]((r.q as any).ts)) as any;
};

const leftRebuilt = (kind: 'inner' | 'left', op: Op) =>
  ((kind === 'inner' ? asofJoin : asofLeftJoin) as typeof asofJoin)(
    {
      t: from(left)
        .where(r => r.id.gt(10))
        .where(r => r.id.lt(280)),
    },
    { q: from(right) },
  )
    .on(r => r.t.sym.eq(r.q.sym))
    .asof(r => (r.t.ts as any)[op](r.q.ts)) as any;

const CUT = 2000;

const pick = (r: any) => ({ id: r.t.id, rid: r.q.rid });

interface Case {
  name: string;
  build: (kind: 'inner' | 'left', op: Op) => any;
  expected: (kind: 'inner' | 'left', op: Op) => LeftExpected[];
}

const yes = () => true;

const cases: Case[] = [
  // Each row's folded text, nested naive text and model must agree.
  {
    name: 'right WHERE on a non-key column',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.flag.eq(1))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (_, r) => r?.flag === 1),
  },
  {
    name: 'right WHERE on the equality key',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.sym.eq('A'))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (_, r) => r?.sym === 'A'),
  },
  {
    name: 'right WHERE on the inequality column, below the cut',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.ts.lt(T(CUT)))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (_, r) => !!r && r.ts < CUT),
  },
  {
    name: 'right WHERE on the inequality column, above the cut',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.ts.gt(T(CUT)))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (_, r) => !!r && r.ts > CUT),
  },
  {
    name: 'a left conjunct and a right conjunct',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.t.id.lt(150).and(r.q.flag.eq(1)))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (l, r) => l.id < 150 && r?.flag === 1),
  },
  {
    name: 'one conjunct reading both inputs',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.t.id.plus(r.q.v).gt(500n))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (l, r) => !!r && l.id + r.v > 500),
  },
  {
    name: 'a left OR a right',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.t.id.lt(50).or(r.q.flag.eq(1)))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (l, r) => l.id < 50 || r?.flag === 1),
  },
  {
    name: 'left WHERE on the equality key',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.t.sym.eq('A'))
        .map(pick),
    expected: (k, o) => model(o, k, yes, l => l.sym === 'A'),
  },
  {
    name: 'left WHERE on the inequality column',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.t.ts.gt(T(CUT)))
        .map(pick),
    expected: (k, o) => model(o, k, yes, l => l.ts > CUT),
  },
  {
    name: 'a filter on a mapped right column',
    build: (k, o) =>
      join(k, o)
        .map((r: any) => ({ id: r.t.id, rid: r.q.rid, f: r.q.flag }))
        .where((r: any) => r.f.eq(1))
        .map((r: any) => ({ id: r.id, rid: r.rid })),
    expected: (k, o) => model(o, k, yes, (_, r) => r?.flag === 1),
  },
  {
    name: 'a filtered right input, written by the user, and a right WHERE above',
    build: (k, o) =>
      join(
        k,
        o,
        from(right).where(r => r.flag.eq(1)),
      )
        .where((r: any) => r.q.v.gt(300))
        .map(pick),
    expected: (k, o) =>
      model(
        o,
        k,
        r => r.flag === 1,
        (_, r) => !!r && r.v > 300,
      ),
  },
  {
    name: 'a right input through a map, with a filter on the mapped column above',
    build: (k, o) =>
      join(
        k,
        o,
        from(right).map(r => ({ sym: r.sym, ts: r.ts, rid: r.rid, flag: r.flag })),
      )
        .where((r: any) => r.q.flag.eq(0))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (_, r) => r?.flag === 0),
  },
  {
    name: 'a PREWHERE on the right input, and a WHERE above',
    build: (k, o) =>
      join(
        k,
        o,
        from(right).prewhere(r => r.flag.eq(1)),
      )
        .where((r: any) => r.q.v.gt(300))
        .map(pick),
    expected: (k, o) =>
      model(
        o,
        k,
        r => r.flag === 1,
        (_, r) => !!r && r.v > 300,
      ),
  },
  {
    name: 'a right NOT NULL above',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.nv.isNotNull())
        .map(pick),
    expected: (k, o) => model(o, k, yes, (_, r) => !!r && r.nv !== null),
  },
];

// Rebuilt by `visit`: MergeFilter rewrites an input, and the Join above is rebuilt. A rebuild that
// drops `strictness` prints an ordinary ALL join, which returns a row per candidate.
cases.push(
  {
    name: 'a right input rebuilt by MergeFilter',
    build: (k, o) =>
      join(
        k,
        o,
        from(right)
          .where(r => r.flag.eq(1))
          .where(r => r.v.gt(100)),
      ).map(pick),
    expected: (k, o) => model(o, k, r => r.flag === 1 && r.v > 100, yes),
  },
  {
    name: 'a left input rebuilt by MergeFilter, and a right WHERE above',
    build: (k, o) =>
      leftRebuilt(k, o)
        .where((r: any) => r.q.v.gt(100))
        .map(pick),
    expected: (k, o) => model(o, k, yes, (l, r) => l.id > 10 && l.id < 280 && !!r && r.v > 100),
  },
  {
    name: 'every column read, so the input prints as the bare table',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.flag.eq(1))
        .map((r: any) => ({
          id: r.t.id,
          sym: r.t.sym,
          ts: r.t.ts,
          s: r.t.s,
          n: r.t.n,
          rid: r.q.rid,
          qsym: r.q.sym,
          qts: r.q.ts,
          flag: r.q.flag,
          v: r.q.v,
          nv: r.q.nv,
        }))
        .map((r: any) => ({ id: r.id, rid: r.rid })),
    expected: (k, o) => model(o, k, yes, (_, r) => r?.flag === 1),
  },
  {
    name: 'a right WHERE and ORDER BY and LIMIT folded together',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.flag.eq(1))
        .map(pick)
        .orderBy((r: any) => r.id)
        .limit(20),
    expected: (k, o) =>
      model(o, k, yes, (_, r) => r?.flag === 1)
        .sort((a, b) => a.id - b.id)
        .slice(0, 20),
  },
);

// Aliases colliding with what ON and WHERE read: a captured name would silently change the match.
cases.push(
  {
    name: 'select aliases named as the join keys, holding other columns',
    build: (k, o) =>
      join(k, o)
        .map((r: any) => ({ id: r.t.id, rid: r.q.rid, sym: r.q.flag, ts: r.q.v }))
        .map((r: any) => ({ id: r.id, rid: r.rid })),
    expected: (k, o) => model(o, k, yes, yes),
  },
  {
    name: 'a WHERE on a column whose alias holds another column',
    build: (k, o) =>
      join(k, o)
        .where((r: any) => r.q.flag.eq(1))
        .map((r: any) => ({ id: r.t.id, flag: r.q.rid }))
        .map((r: any) => ({ id: r.id, rid: r.flag })),
    expected: (k, o) => model(o, k, yes, (_, r) => r?.flag === 1),
  },
);

const grouped = (kind: 'inner' | 'left', op: Op) =>
  join(kind, op)
    .where((r: any) => r.q.ts.lt(T(CUT)))
    .groupBy((r: any) => ({ f: r.q.flag }))
    .aggregate(() => ({ n: count() }));

// FINAL and SAMPLE, on each input, with a right WHERE folded above.
const stamp = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');

const rep = table(
  'asof_right_rep',
  {
    rid: col.UInt32,
    sym: col.String,
    ts: col.DateTime('UTC'),
    flag: col.UInt8,
    v: col.UInt32,
    ver: col.UInt32,
  },
  { engine: 'ReplacingMergeTree', sortingKey: ['sym', 'ts'], partitionKey: [] },
);

const sampled = table(
  'asof_right_sampled',
  { rid: col.UInt32, sym: col.String, ts: col.DateTime('UTC'), flag: col.UInt8, h: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['sym', 'h'], partitionKey: [], samplingKey: 'h' } as never,
);

const leftRep = table(
  'asof_left_rep',
  { id: col.UInt32, sym: col.String, ts: col.DateTime('UTC'), ver: col.UInt32 },
  { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] },
);

async function seedHints(c: Connection) {
  for (const query of [
    `CREATE OR REPLACE TABLE asof_right_rep (rid UInt32, sym String, ts DateTime('UTC'), flag UInt8, v UInt32, ver UInt32) ENGINE = ReplacingMergeTree(ver) ORDER BY (sym, ts)`,
    `CREATE OR REPLACE TABLE asof_right_sampled (rid UInt32, sym String, ts DateTime('UTC'), flag UInt8, h UInt32) ENGINE = MergeTree ORDER BY (sym, h) SAMPLE BY h`,
    `CREATE OR REPLACE TABLE asof_left_rep (id UInt32, sym String, ts DateTime('UTC'), ver UInt32) ENGINE = ReplacingMergeTree(ver) ORDER BY id`,
  ])
    await c.admin.command({ query });

  // Two versions in two parts, not merged: the second flips flag and moves left rows to their real sym.
  await c.admin.insert({
    table: 'asof_right_rep',
    format: 'JSONEachRow',
    values: rights.map(r => ({
      rid: r.rid,
      sym: r.sym,
      ts: stamp(r.ts),
      flag: 1 - r.flag,
      v: r.v,
      ver: 1,
    })),
  });

  await c.admin.insert({
    table: 'asof_right_rep',
    format: 'JSONEachRow',
    values: rights.map(r => ({
      rid: r.rid,
      sym: r.sym,
      ts: stamp(r.ts),
      flag: r.flag,
      v: r.v,
      ver: 2,
    })),
  });

  await c.admin.insert({
    table: 'asof_right_sampled',
    format: 'JSONEachRow',
    values: rights.map(r => ({
      rid: r.rid,
      sym: r.sym,
      ts: stamp(r.ts),
      flag: r.flag,
      h: (r.rid * 2654435761) % 4294967296,
    })),
  });

  await c.admin.insert({
    table: 'asof_left_rep',
    format: 'JSONEachRow',
    values: lefts.map(l => ({ id: l.id, sym: 'Z', ts: stamp(l.ts), ver: 1 })),
  });

  await c.admin.insert({
    table: 'asof_left_rep',
    format: 'JSONEachRow',
    values: lefts.map(l => ({ id: l.id, sym: l.sym, ts: stamp(l.ts), ver: 2 })),
  });
}

const hinted = (kind: 'inner' | 'left', op: Op, a: any, b: any) =>
  ((kind === 'inner' ? asofJoin : asofLeftJoin) as typeof asofJoin)({ t: a }, { q: b })
    .on((r: any) => r.t.sym.eq(r.q.sym))
    .asof((r: any) => r.t.ts[op](r.q.ts)) as any;

// A key named as a join column, and an aggregate named as one: neither may capture the ON columns.
const capturing = (kind: 'inner' | 'left', op: Op) =>
  join(kind, op)
    .groupBy((r: any) => ({ sym: r.q.flag }))
    .aggregate(() => ({ ts: count() }));

const matrix: readonly (readonly [Version, readonly (readonly [string, Settings])[]])[] = [
  [
    '24.3',
    [
      ['analyzer off (the 24.3 default is on in this image)', { allow_experimental_analyzer: 0 }],
      ['analyzer on', { allow_experimental_analyzer: 1 }],
      ['default', {}],
      ['filter push-down off', { query_plan_filter_push_down: 0 }],
      ['hash', { join_algorithm: 'hash' }],
      ['parallel_hash', { join_algorithm: 'parallel_hash' }],
      ['auto', { join_algorithm: 'auto' }],
      ['one thread', { max_threads: 1 }],
      ['join_use_nulls from a profile', { join_use_nulls: 1 }],
    ],
  ],
  [
    '24.8',
    [
      ['analyzer off', { allow_experimental_analyzer: 0 }],
      ['default', {}],
      ['filter push-down off', { query_plan_filter_push_down: 0 }],
      ['hash', { join_algorithm: 'hash' }],
      ['parallel_hash', { join_algorithm: 'parallel_hash' }],
      ['full_sorting_merge', { join_algorithm: 'full_sorting_merge' }],
      ['one thread', { max_threads: 1 }],
      ['join_use_nulls from a profile', { join_use_nulls: 1 }],
    ],
  ],
  [
    '26.10',
    [
      ['analyzer off', { enable_analyzer: 0 }],
      ['default', {}],
      ['filter push-down off', { query_plan_filter_push_down: 0 }],
      ['hash', { join_algorithm: 'hash' }],
      ['parallel_hash', { join_algorithm: 'parallel_hash' }],
      ['full_sorting_merge', { join_algorithm: 'full_sorting_merge' }],
      ['one thread', { max_threads: 1 }],
      ['join_use_nulls from a profile', { join_use_nulls: 1 }],
    ],
  ],
];

describe.each(matrix)('ASOF folding on %s', (version, settings) => {
  let stop: () => Promise<void>;

  const connections = new Map<string, Connection>();

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    const base = connect(server.url);
    await seed(base);
    await seedHints(base);
    await base.close();
    for (const [name, s] of settings) connections.set(name, connect(server.url, s));
  });

  afterAll(async () => {
    for (const c of connections.values()) await c.close();
    await stop();
  });

  describe.each(settings)('%s', name => {
    describe.each(['inner', 'left'] as const)('%s', kind => {
      it.each(['ge', 'gt', 'le', 'lt'] as const)('%s', async op => {
        const c = connections.get(name)!;

        for (const row of cases) {
          const q = row.build(kind, op);
          const expected = canonical(row.expected(kind, op));
          expect(expected.length, row.name).toBeGreaterThan(0);
          const got = await paths(c, q);

          for (const [path, rows] of Object.entries(got))
            expect(canonical(rows), `${row.name} on ${path}: ${compile(q.ir).sql}`).toEqual(
              expected,
            );
        }

        const cap = capturing(kind, op);
        const flags = new Map<number | null, bigint>();

        for (const e of model(op, kind, yes, yes)) {
          const f = e.rid === null ? null : rights.find(r => r.rid === e.rid)!.flag;
          flags.set(f, (flags.get(f) ?? 0n) + 1n);
        }

        for (const [path, rows] of Object.entries(await paths(c, cap)))
          expect(canonical(rows), `capturing aggregate on ${path}: ${compile(cap.ir).sql}`).toEqual(
            canonical([...flags].map(([sym, ts]) => ({ sym, ts }))),
          );

        const g = grouped(kind, op);
        const got = await paths(c, g);
        const expectedRows = model(op, kind, yes, (_, r) => !!r && r.ts < CUT);
        const byFlag = new Map<number, bigint>();

        for (const e of expectedRows) {
          const f = rights.find(r => r.rid === e.rid)!.flag;
          byFlag.set(f, (byFlag.get(f) ?? 0n) + 1n);
        }

        const expected = canonical([...byFlag].map(([f, n]) => ({ f, n })));

        for (const [path, rows] of Object.entries(got))
          expect(canonical(rows), `grouped on ${path}`).toEqual(expected);
      });
    });

    describe.each(['inner', 'left'] as const)('hints, %s', kind => {
      it.each(['ge', 'lt'] as const)('FINAL and SAMPLE, %s', async op => {
        const c = connections.get(name)!;
        const finalExpected = canonical(model(op, kind, yes, (_, r) => r?.flag === 1));

        // FINAL on the right: the model reads the last version of each row.
        const rightFinal = hinted(kind, op, from(left), from(rep).final())
          .where((r: any) => r.q.flag.eq(1))
          .map(pick);

        expect(compile(rightFinal.ir).sql).toContain('FINAL');

        for (const [path, rows] of Object.entries(await paths(c, rightFinal)))
          expect(canonical(rows), `right FINAL on ${path}`).toEqual(finalExpected);

        // FINAL on the left: without FINAL every left row would also appear under sym Z.
        const leftFinal = hinted(kind, op, from(leftRep).final(), from(right))
          .where((r: any) => r.q.flag.eq(1))
          .map(pick);

        for (const [path, rows] of Object.entries(await paths(c, leftFinal)))
          expect(canonical(rows), `left FINAL on ${path}`).toEqual(finalExpected);

        // PREWHERE on a FINAL input is a filter on the input, so it does not commute with one above:
        // only a parity check against nested handwritten SQL can decide it.
        // SAMPLE on the right: the same rows as the nested handwritten form.
        const rightSample = hinted(kind, op, from(left), from(sampled).sample(0.5))
          .where((r: any) => r.q.flag.eq(1))
          .map(pick);

        expect(compile(rightSample.ir).sql).toContain('SAMPLE');

        const oracle = (
          await c.json(
            `SELECT id, rid FROM (SELECT t.id AS id, q.rid AS rid, q.flag AS flag FROM asof_left AS t
             ASOF ${kind === 'inner' ? 'INNER' : 'LEFT'} JOIN (SELECT * FROM asof_right_sampled SAMPLE 0.5) AS q
             ON t.sym = q.sym AND t.ts ${opSql[op]} q.ts) WHERE flag = 1`,
            { join_use_nulls: 1 },
          )
        ).data;

        expect(oracle.length).toBeGreaterThan(0);

        for (const [path, rows] of Object.entries(await paths(c, rightSample)))
          expect(canonical(rows), `right SAMPLE on ${path}`).toEqual(canonical(oracle));
      });
    });

    it('the folded text keeps a right WHERE in the join block, and naive nests it', () => {
      const q = join('inner', 'ge')
        .where((r: any) => r.q.flag.eq(1))
        .map(pick);

      expect(compile(q.ir).sql).toMatch(/ASOF INNER JOIN [^]*\nWHERE /);
      expect(emitNaive(q.ir).sql.match(/SELECT /g)!.length).toBeGreaterThan(2);
      expect(opSql.ge).toBe('>=');
    });
  });
});
