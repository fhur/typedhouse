import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import fc from 'fast-check';
import {
  avg,
  cast,
  col,
  count,
  createKnownFunctions,
  exprNode,
  from,
  join,
  quantile,
  relNode,
  scalar,
  sum,
  table,
  unionAll,
  val,
  type Rel,
} from '@typedhouse/core';
import { compile } from '../src/index.js';
import { fallibleComputation, fallibleWithin, rewriteRel } from '../src/rewrite-rel.js';
import { entries } from './fixtures/corpus/explain-corpus.js';
import * as aggregateUnion from '../../client/test/aggregate-union-arbitrary.js';
import * as arrayJoinBlocks from '../../client/test/array-join-blocks-arbitrary.js';
import * as cteArb from '../../client/test/cte-arbitrary.js';
import * as differential from '../../client/test/differential-arbitrary.js';
import * as fixtureDifferential from '../../client/test/fixture-differential-arbitrary.js';
import * as joinBlock from '../../client/test/join-block-arbitrary.js';
import * as outerJoin from '../../client/test/outer-join-arbitrary.js';
import * as projectMerge from '../../client/test/project-merge-arbitrary.js';
import * as pruning from '../../client/test/pruning-arbitrary.js';
import * as pushdown from '../../client/test/pushdown-arbitrary.js';
import { ciLimit, prefetchedCheck } from '../../client/test/prefetch-check.js';

// Slice 4d Tester probes (Docker-free): completeness of `fallibleComputation`, and the over-fencing measurement.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const t = table(
  'd4',
  {
    id: col.UInt32,
    s: col.String,
    n: col.Int64,
    d: col.Decimal64(2),
    arr: col.Array(col.String),
    tup: col.Tuple({ x: col.UInt8, y: col.String }),
  },
  meta,
);

const q = from(t),
  u = from(table('d4u', { id: col.UInt32, v: col.Int64 }, meta));

const { fn } = createKnownFunctions({
  array: { isAggregate: false, deterministic: true, aliasTo: '' },
} as const);

const raw = (parts: string) =>
  exprNode({
    kind: 'Raw',
    type: col.UInt32.type,
    resolution: 'declared',
    opaque: true,
    provenance: { origin: 'sql' },
    parts: [parts],
    args: [],
  });

/** Two total Filters (`id != 3`, `n > 0`) over `input`: MergeFilter must withhold when `input` computes a non-total value. */
const twoTotals = (input: any): Rel =>
  input.where((r: any) => r.id.ne(3)).where((r: any) => r.n.gt(0n)).ir;

it('completeness: every fallible computation kind is seen by fallibleComputation and withholds MergeFilter', () => {
  const sub = q.aggregate(g => ({ m: sum(g.n) }));

  // `merges`: MergeFilter hits expected (union: PushFilterUnion copies the pair into both branches, only the total branch merges;
  // count over id: PushFilterAggKey moves `id != 3` below the Aggregate first, so no pair is left).
  const cases: [string, any, boolean, number?][] = [
    ['decimal arithmetic', q.map(r => ({ id: r.id, n: r.n, x: r.d.plus(r.d) })), true],
    ['decimal multiply', q.map(r => ({ id: r.id, n: r.n, x: r.d.multiply(r.d) })), true],
    ['avg', q.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: count(), a: avg(g.n) })), true],
    [
      'quantile(level)',
      q.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: count(), p: quantile(0.5)(g.n) })),
      true,
    ],
    ['arrayElement', q.map(r => ({ id: r.id, n: r.n, x: r.arr.arrayElement(5) })), true],
    [
      'arrayElement Param index',
      q.map(r => ({ id: r.id, n: r.n, x: r.arr.arrayElement(val(-9, col.Int32)) })),
      true,
    ],
    ['scalar subquery in a projection', q.map(r => ({ id: r.id, n: r.n, m: scalar(sub) })), true],
    ['sort key cast', q.orderBy(r => cast(r.s, col.UInt8)), true],
    [
      'union branch cast',
      unionAll(
        q.map(r => ({ id: r.id, n: r.n, c: cast(r.s, col.UInt8) })),
        q.map(r => ({ id: r.id, n: r.n, c: val(1, col.UInt8) })),
      ),
      true,
      1,
    ],
    ['cte over a cast', q.map(r => ({ id: r.id, n: r.n, c: cast(r.s, col.UInt8) })).cte(), true],
    [
      'fallible expansion',
      q.arrayJoin(r => fn.array(cast(r.s, col.UInt8)).as(col.Array(col.UInt8)), 'x'),
      true,
    ],
    [
      'element of a named tuple (total by slice 1 ruling)',
      q.map(r => ({ id: r.id, n: r.n, x: r.tup.element('x') })),
      false,
    ],
    [
      'integer arithmetic',
      q.map(r => ({ id: r.id, n: r.n.plus(1n), m: r.n.multiply(r.n) })),
      false,
    ],
    ['count/max', q.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: count() })), false, 0],
  ];

  const out: string[] = [];

  for (const [label, input, expected, merges] of cases) {
    const root = twoTotals(input);

    const f =
      root.kind === 'Filter' && root.input.kind === 'Filter'
        ? fallibleComputation(root.input.input)
        : undefined;

    out.push(`${label}: fallibleComputation=${f} MergeFilter=${rewriteRel(root).hits.MergeFilter}`);
    expect.soft(f, label).toBe(expected);
    expect.soft(rewriteRel(root).hits.MergeFilter, label).toBe(merges ?? (expected ? 0 : 1));
  }

  // Raw projection and RawRel-free Raw predicate (hand-built IR).
  const base = q.ir;

  const rawProject = relNode({
    kind: 'Project',
    input: base,
    exprs: {
      id: exprNode({ kind: 'ColumnRef', type: col.UInt32.type, rel: base.id, path: ['id'] }),
      r: raw('throwIf(id = 3)'),
    },
    output: { shape: 'flat', columns: { id: col.UInt32.type, r: col.UInt32.type } },
  } as any) as Rel;

  expect.soft(fallibleComputation(rawProject), 'raw projection').toBe(true);

  // A Subquery/IN or a cast inside a Filter predicate is excluded by design (Deviation 2).
  const inFilter = q.where(r =>
    r.n.in(from(table('d4u', { id: col.UInt32, v: col.Int64 }, meta)).map(x => x.v)),
  ).ir;

  expect.soft(fallibleComputation(inFilter), 'IN subquery predicate excluded').toBe(false);
  expect.soft(fallibleWithin(inFilter), 'IN subquery predicate in fallibleWithin').toBe(true);
  console.log(out.join('\n'));
});

it('planner Filter arm agrees with MergeFilter across Project/Filter layers and stops nowhere (over-fence by design)', () => {
  // A fallible computation behind a real fence (Limit, Aggregate) still withholds: the walk does not stop at fences.
  const behindLimit = twoTotals(
    q
      .map(r => ({ id: r.id, n: r.n, c: cast(r.s, col.UInt8) }))
      .limit(5)
      .map(r => ({ id: r.id, n: r.n })),
  );

  const hits = rewriteRel(behindLimit).hits.MergeFilter;

  const behindJoinOther = join({
    a: q.map(r => ({ id: r.id, n: r.n, c: cast(r.s, col.UInt8) })).limit(5),
    b: u,
  })
    .on(r => r.a.id.eq(r.b.id))
    .where(r => r.b.v.gt(0n))
    .where(r => r.a.id.ne(3)).ir;

  console.log(
    `behind Limit: MergeFilter=${hits}; join over limited cast input: MergeFilter=${rewriteRel(behindJoinOther).hits.MergeFilter}`,
  );

  expect(hits).toBe(0);
});

const selects = (sql: string) => sql.match(/\bSELECT\b/g)?.length ?? 0;

it.skipIf(!process.env.TH4D_MEASURE)(
  'measure: SELECT counts over the EXPLAIN corpus and 500 values of every differential arbitrary',
  async () => {
    const result: Record<string, string[]> = {};
    result.corpus = entries.map(e => compile(e.query.ir).sql);

    const suites: [string, Record<string, any>, string, string][] = [
      ['aggregate-union', aggregateUnion, 'recipeArbitrary', 'build'],
      ['array-join-blocks', arrayJoinBlocks, 'recipeArbitrary', 'build'],
      ['cte', cteArb, 'recipeArbitrary', 'build'],
      ['differential', differential, 'recipeArbitrary', 'build'],
      ['fixture-differential', fixtureDifferential, 'recipes', 'build'],
      ['join-block', joinBlock, 'recipes', 'build'],
      ['join-block-colliding', joinBlock, 'colliding', 'buildColliding'],
      ['outer-join', outerJoin, 'recipes', 'build'],
      ['project-merge', projectMerge, 'recipeArbitrary', 'build'],
      ['pruning', pruning, 'recipeArbitrary', 'build'],
      ['pushdown', pushdown, 'recipeArbitrary', 'build'],
    ];

    for (const [name, mod, arb, builder] of suites) {
      const values = fc.sample(mod[arb], { seed: Number(mod.seed), numRuns: 500 });

      result[name] = values.map(v => {
        try {
          const built = mod[builder](v);
          return compile((built.ir ?? built.query?.ir ?? built) as Rel).sql;
        } catch (e) {
          return `ERROR ${String(e).slice(0, 80)}`;
        }
      });
    }

    writeFileSync(process.env.TH4D_MEASURE!, JSON.stringify(result));

    console.log(
      Object.entries(result)
        .map(
          ([k, v]) =>
            `${k}: ${v.length} sql, ${v.reduce((a, s) => a + selects(s), 0)} SELECTs, errors ${v.filter(s => s.startsWith('ERROR')).length}`,
        )
        .join('\n'),
    );
  },
  600000,
);

// ---- Item 0: prefetchedCheck, independently of the Worker's prefetch-check.test.ts. ----
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Deterministic pseudo-random delay per value, so completion order differs from generation order. */
const delay = (v: unknown) => {
  let h = 0;
  for (const c of fc.stringify(v)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 4;
};

const realCampaigns: [string, fc.Arbitrary<any>, number, number][] = [
  [
    'aggregate-union',
    aggregateUnion.recipeArbitrary as fc.Arbitrary<any>,
    Number(aggregateUnion.seed),
    500,
  ],
  ['cte', cteArb.recipeArbitrary as fc.Arbitrary<any>, Number(cteArb.seed), 500],
  ['join-block colliding', joinBlock.colliding as fc.Arbitrary<any>, Number(joinBlock.seed), 500],
  ['outer-join', outerJoin.recipes as fc.Arbitrary<any>, Number(outerJoin.seed), 500],
  ['pruning', pruning.recipeArbitrary as fc.Arbitrary<any>, Number(pruning.seed), 500],
  ['pushdown', pushdown.recipeArbitrary as fc.Arbitrary<any>, Number(pushdown.seed), 700],
];

it.each(realCampaigns)(
  'tester: %s planned stream == fc.check stream (recipes compared), cached evaluation bound to its own value under scrambled completion',
  async (_, arbitrary, seed, numRuns) => {
    const options = { seed, numRuns };
    const live: string[] = [];

    await fc.check(
      fc.asyncProperty(arbitrary, async v => {
        live.push(fc.stringify(v));
      }),
      options,
    );

    const sampled = fc.sample(arbitrary, options).map(v => fc.stringify(v));
    expect(sampled).toEqual(live);
    const seen: string[] = [];

    const { result, prefetched } = await prefetchedCheck(
      arbitrary,
      options,
      async v => {
        await sleep(delay(v));
        return fc.stringify(v);
      },
      (v, e) => {
        expect(e).toBe(fc.stringify(v));
        seen.push(e);
      },
    );

    expect(result.failed).toBe(false);
    expect(seen).toEqual(live);
    expect(prefetched).toBe(new Set(live).size);
  },
  120000,
);

it('tester: an evaluate failure mid-stream (outer-join recipes, scrambled concurrency) fails, shrinks and replays exactly like live; stopped halts the pool', async () => {
  const options = { seed: Number(outerJoin.seed), numRuns: 500 };

  // Content-based fault, first hit late in the stream.
  const faulty = (r: any) =>
    r.inputCast === 'failing' && r.distinct && r.order === 'last' && r.project === 'aggregates';

  const firstIndex = fc.sample(outerJoin.recipes, options).findIndex(faulty);
  expect(firstIndex).toBeGreaterThan(20);

  const reference = await fc.check(
    fc.asyncProperty(outerJoin.recipes, async r => {
      if (faulty(r)) throw new Error('fault');
    }),
    options,
  );

  for (const where of ['evaluate', 'property'] as const) {
    let calls = 0,
      inFlightAtReturn = 0,
      active = 0;

    const { result, prefetched } = await prefetchedCheck(
      outerJoin.recipes,
      options,
      async r => {
        calls++;
        active++;

        try {
          await sleep(delay(r));
          if (where === 'evaluate' && faulty(r)) throw new Error('fault');
          return r;
        } finally {
          active--;
        }
      },
      r => {
        if (where === 'property' && faulty(r)) throw new Error('fault');
      },
    );

    inFlightAtReturn = active;
    const callsAtReturn = calls;
    await sleep(100);

    console.log(
      `${where}: firstIndex=${firstIndex} prefetched=${prefetched} calls=${callsAtReturn} after=${calls} inFlightAtReturn=${inFlightAtReturn} shrinks=${result.numShrinks} ref=${reference.numShrinks}`,
    );

    expect(result.failed).toBe(true);
    expect(result.numRuns).toBe(reference.numRuns);
    expect(result.counterexamplePath).toBe(reference.counterexamplePath);
    expect(fc.stringify(result.counterexample)).toBe(fc.stringify(reference.counterexample));
    expect(result.numShrinks).toBe(reference.numShrinks);
    expect(result.numShrinks).toBeGreaterThan(0);
    expect(prefetched).toBe(firstIndex + 1);
    // No new evaluation starts after the check returned (stopped); only in-flight ones may finish.
    expect(calls - callsAtReturn).toBe(0);
    // Replay evaluates live and reproduces the counterexample.
    let replayCalls = 0;

    const replay = await prefetchedCheck(
      outerJoin.recipes,
      { ...options, path: result.counterexamplePath! },
      async r => {
        replayCalls++;
        return r;
      },
      r => {
        if (faulty(r)) throw new Error('fault');
      },
    );

    expect(replay.prefetched).toBe(0);
    expect(replayCalls).toBeGreaterThan(0);
    expect(fc.stringify(replay.result.counterexample)).toBe(fc.stringify(reference.counterexample));
  }
}, 120000);

it('tester: a later concurrent evaluation failure after an earlier property failure is not reported and raises no unhandled rejection', async () => {
  const arbitrary = fc.integer({ min: 0, max: 1000 });
  const options = { seed: 7, numRuns: 100 };
  const values = fc.sample(arbitrary, options);

  const first = values.findIndex(n => n > 900),
    later = values.findIndex((n, i) => i > first && n % 2 === 1);

  const { result } = await prefetchedCheck(
    arbitrary,
    options,
    async n => {
      if (n === values[later]) throw new Error('late evaluation');
      return n;
    },
    n => {
      if (n > 900) throw new Error('property');
    },
  );

  expect(result.failed).toBe(true);
  expect(String(result.errorInstance)).toContain('property');
});

it('tester: ciLimit is identity without CI, doubles only with CI=true (m2 fixed in the 4d follow-up)', () => {
  const saved = process.env.CI;

  try {
    delete process.env.CI;
    expect(ciLimit(120000)).toBe(120000);
    process.env.CI = '';
    expect(ciLimit(120000)).toBe(120000);
    process.env.CI = 'true';
    expect(ciLimit(120000)).toBe(240000);
    process.env.CI = 'false';
    expect(ciLimit(120000)).toBe(120000); // 4d follow-up (m2 fixed): was 240000, 'false' doubled
  } finally {
    if (saved === undefined) delete process.env.CI;
    else process.env.CI = saved;
  }
});

it('tester: input-cast recipe content counts (pushdown 700, outer-join 500)', () => {
  const p = fc.sample(pushdown.recipeArbitrary, {
    seed: Number(pushdown.seed),
    numRuns: 700,
  }) as any[];

  const o = fc.sample(outerJoin.recipes, { seed: Number(outerJoin.seed), numRuns: 500 }) as any[];

  const by = (xs: any[], k: string) =>
    xs.reduce((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {} as Record<string, number>);

  console.log(
    'pushdown inputCast',
    by(p, 'inputCast'),
    'fallible&failing',
    p.filter(r => r.fallible && r.inputCast === 'failing').length,
    'outer-join inputCast',
    by(o, 'inputCast'),
  );
});
