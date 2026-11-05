import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  cast,
  col,
  count,
  from,
  join,
  leftJoin,
  max,
  sum,
  table,
  type Rel,
} from '@typedhouse/core';
import { createKnownFunctions } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { rewriteRel } from '../../compiler/src/rewrite-rel.js';

// Slice 4d Tester probes (clickhouse/clickhouse-server:24.8). Own MergeTree tables, wait_end_of_query = 1, optimized vs naive.
import { resultsContract } from './results-contract.js';

const { fn: known } = createKnownFunctions({
  array: { isAggregate: false, deterministic: true, aliasTo: '' },
} as const);

const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const cols = { id: col.UInt32, s: col.String, n: col.Int64, arr: col.Array(col.String) };

const DDL = '(id UInt32, s String, n Int64, arr Array(String)) ENGINE=MergeTree ORDER BY id';

const A2 = from(table('ta', cols, meta)),
  A1 = from(table('t1', cols, meta)),
  B = from(table('tb', cols, meta));

const R = from(
  table('tr', cols, {
    engine: 'ReplacingMergeTree',
    sortingKey: ['id'],
    partitionKey: [],
  } as const),
);

// ALIAS column: the descriptor sees a plain UInt8, the server computes CAST(s AS UInt8) on read.
const X2 = from(table('tx', { id: col.UInt32, s: col.String, c: col.UInt8 }, meta)),
  X1 = from(table('tx1', { id: col.UInt32, s: col.String, c: col.UInt8 }, meta));

const bad = (s: any): any => cast(s, col.UInt8);

let container: StartedTestContainer;

let url: string;

type Settings = Readonly<Record<string, string | number>>;

interface Result {
  data?: unknown[][];
  meta?: string[];
  error?: string;
}

async function execute(
  sql: string,
  params: Readonly<Record<string, string>> = {},
  settings: Settings = {},
): Promise<Result> {
  const endpoint = new URL(url);

  for (const [key, value] of Object.entries(params))
    endpoint.searchParams.set(`param_${key}`, value);

  for (const [key, value] of Object.entries(settings))
    endpoint.searchParams.set(key, String(value));

  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  endpoint.searchParams.set('wait_end_of_query', '1');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: `${sql} FORMAT JSONCompact`,
  });

  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 200) };
  const json = JSON.parse(text) as { meta: { type: string }[]; data: unknown[][] };

  return {
    meta: json.meta.map(m => m.type),
    data: [...json.data].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  };
}

const raw = async (sql: string) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: sql,
  });

  if (!res.ok) throw new Error(await res.text());
  return res.text();
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
  for (const t of ['ta', 'tb', 't1']) await raw(`CREATE TABLE ${t} ${DDL}`);

  await raw(
    'CREATE TABLE tr (id UInt32, s String, n Int64, arr Array(String)) ENGINE=ReplacingMergeTree ORDER BY id',
  );

  await raw(
    'CREATE TABLE tx (id UInt32, s String, c UInt8 ALIAS CAST(s AS UInt8)) ENGINE=MergeTree ORDER BY id',
  );

  // Bad (non-numeric) s only on id 3, in its own part too so PREWHERE/granule order cannot hide it.
  await raw(
    "INSERT INTO ta VALUES (1, '1', 10, ['p']), (2, '2', 20, ['q','r']), (4, '4', 40, ['s'])",
  );

  await raw("INSERT INTO ta VALUES (3, 'y', 30, ['t'])");

  await raw(
    "INSERT INTO t1 VALUES (1, '1', 10, ['p']), (2, '2', 20, ['q','r']), (3, 'y', 30, ['t']), (4, '4', 40, ['s'])",
  );

  await raw(
    "INSERT INTO tb VALUES (1, '5', 5, ['p']), (2, 'x', -1, []), (3, '7', 7, ['u']), (9, '9', 9, ['z'])",
  );

  await raw("INSERT INTO tr VALUES (1, '1', 10, ['p']), (2, '2', 20, ['q']), (3, 'y', 30, ['t'])");
  await raw("INSERT INTO tr VALUES (3, 'y', 31, ['t']), (4, '4', 40, ['s'])");

  await raw(
    'CREATE TABLE tx1 (id UInt32, s String, c UInt8 ALIAS CAST(s AS UInt8)) ENGINE=MergeTree ORDER BY id',
  );

  await raw("INSERT INTO tx1 VALUES (1, '1'), (2, '2'), (3, 'y'), (4, '4')");
  await raw("INSERT INTO tx VALUES (1, '1'), (2, '2'), (4, '4')");
  await raw("INSERT INTO tx VALUES (3, 'y')");
  // Contract follow-up: guard-first oracle twins, every bad row (id 3) removed. Each pinned guard rejects id 3, so evaluating
  // the fallible expressions only on rows that pass the guards is evaluating them on these tables.
  for (const t of ['ta', 't1', 'tr', 'tx', 'tx1']) await raw(`CREATE TABLE ${t}_c AS ${t}`);

  for (const t of ['ta', 't1', 'tr'])
    await raw(`INSERT INTO ${t}_c SELECT * FROM ${t} WHERE id != 3`);

  for (const t of ['tx', 'tx1'])
    await raw(`INSERT INTO ${t}_c (id, s) SELECT id, s FROM ${t} WHERE id != 3`);
}, 120000);

afterAll(async () => {
  await container?.stop();
});

const cells: Settings[] = [];

for (const alias of [0, 1])
  for (const prewhere of [0, 1])
    for (const push of [0, 1])
      for (const threads of [1, 0])
        cells.push({
          prefer_column_name_to_alias: alias,
          optimize_move_to_prewhere: prewhere,
          query_plan_filter_push_down: push,
          ...(threads ? { max_threads: threads } : {}),
        });

// Extra, out-of-contract or secondary settings (recorded only).
const extras: Settings[] = [
  { optimize_move_to_prewhere_if_final: 1 },
  { optimize_move_to_prewhere_if_final: 0 },
  { query_plan_optimize_prewhere: 0 },
  { query_plan_optimize_prewhere: 1, optimize_move_to_prewhere: 1 },
  { query_plan_merge_filters: 1 },
  { query_plan_merge_filters: 1, optimize_move_to_prewhere: 0 },
  { allow_experimental_analyzer: 0 },
  { allow_experimental_analyzer: 0, optimize_move_to_prewhere: 0 },
  { allow_experimental_analyzer: 0, query_plan_filter_push_down: 0 },
  { query_plan_lift_up_array_join: 0 },
  { query_plan_push_down_limit: 0 },
  { short_circuit_function_evaluation: 'disable' },
  { short_circuit_function_evaluation: 'force_enable' },
];

type Outcome = {
  label: string;
  hits: Record<string, number>;
  disagree: string[];
  extra: string[];
  violations: string[];
  oracleRows: number;
  optimized: string;
  naive: string;
  summary: string;
};

/** Guard-first oracle text: the naive text over the twins without the bad row (valid when every guard rejects id 3). */
const guardFirst = (sql: string) => sql.replace(/`(ta|t1|tr|tx|tx1)`/g, '`$1_c`');

/** `guarded = false`: some guard keeps id 3 (an IN list containing it, or the bad row is in tb), so the guard-first
 * evaluation reaches a failing row and its oracle is naive itself: no optimized rows are admitted where naive fails. */
async function probe(
  label: string,
  root: Rel,
  extraRows: Settings[] = extras,
  guarded = true,
): Promise<Outcome> {
  const optimized = compile(root),
    naive = emitNaive(root);

  const disagree: string[] = [],
    extra: string[] = [],
    violations: string[] = [],
    outcomes = new Set<string>();

  let oracleRows = 0;

  const run = async (settings: Settings, into: string[], contract: boolean) => {
    const a = await execute(optimized.sql, optimized.params, settings),
      b = await execute(naive.sql, naive.params, settings);

    const ka = JSON.stringify(a.error ?? a.data),
      kb = JSON.stringify(b.error ?? b.data);

    outcomes.add(`${ka}|${kb}`);
    if (ka !== kb) into.push(`${JSON.stringify(settings)} opt=${ka} naive=${kb}`);
    if (!contract) return;

    const oracle =
      b.error !== undefined && a.error === undefined
        ? guarded
          ? await execute(guardFirst(naive.sql), naive.params, settings)
          : b
        : undefined;

    const verdict = resultsContract(a, b, oracle);

    if (!verdict.ok)
      violations.push(
        `${JSON.stringify(settings)} ${verdict.reason} opt=${ka} naive=${kb} oracle=${JSON.stringify(oracle?.error ?? oracle?.data)}`,
      );
    else if (verdict.kind === 'oracle-rows') oracleRows++;
  };

  for (const s of cells) await run(s, disagree, true);
  for (const s of extraRows) await run(s, extra, false);
  const hits = Object.fromEntries(Object.entries(rewriteRel(root).hits).filter(([, n]) => n));

  return {
    label,
    hits,
    disagree,
    extra,
    violations,
    oracleRows,
    optimized: optimized.sql,
    naive: naive.sql,
    summary: [...outcomes].join(' ; '),
  };
}

const report: Outcome[] = [];

/** Shapes whose guards keep the bad row (see `probe`'s `guarded`). */
const unguarded = new Set([
  'IN guard above fallible scan filter',
  'IN guard + total above fallible join filter',
  'fallible IN (cast subquery) then guards',
]);

const record = async (label: string, root: Rel) => {
  const o = await probe(label, root, extras, !unguarded.has(label));
  report.push(o);
  return o;
};

/** D1 (Tester 4d, BLOCKER by the brief's rule; pre-existing at HEAD f73b234, identical counts with HEAD's rewrite-rel/plan-selects):
 * Deviation 2's premise "24.8 never pushes a predicate across a Filter step" fails once the bad row sits in its own part (or
 * granule): a total key guard above an isolated fallible WHERE (`SELECT … FROM (SELECT … FROM ta WHERE CAST(s AS UInt8) > 0)
 * WHERE id != 3`, the 3b form) reaches ReadFromMergeTree's primary-key analysis (EXPLAIN indexes=1: `Condition: (id not in
 * [3, 3])`, Parts 1/2), so the cast never sees id 3, while naive's deeper nesting reads both parts (`Condition: true`) and
 * fails with code 6. With all rows in one part every contract cell agrees, which is why the Worker's probes (single INSERT)
 * saw no push. Dropping the Filter-predicate exclusion (fallibleComputation = fallibleWithin) fixes the six merged/pushed
 * shapes marked (x) below but not the single-guard 3b forms. The counts below are contract cells (of 16) where optimized and
 * naive disagreed in rows or error code (Tester observation, logged, no longer asserted).
 * Contract follow-up (user ruling after this finding, spec "Decided, and still open": the error contract is results-only):
 * naive's failure here is an artifact of its nesting, so D1 is no defect. Asserted instead, in every contract cell: when naive
 * succeeds, optimized returns its rows and types; optimized never fails where naive succeeds; when naive fails, optimized fails
 * or returns the guard-first oracle's rows (`resultsContract`, oracle = naive text over the twins without the bad row). */
const D1: Record<string, number> = {
  'scan: fallible, guard': 16,
  'scan: fallible, total, guard': 16 /* (x) */,
  'scan: fallible, guard on key range': 16,
  'scan: fallible, guard id = 1': 16,
  'expanded: fallible on s, guard': 8,
  'left expanded: fallible, total, guard': 8,
  'inner join: fallible, guard': 8,
  'inner join: fallible, total, guard': 8,
  'inner join: fallible on b side, guard on a (ON-copied)': 8,
  'left join: fallible, total, guard': 8 /* (x) */,
  'group by: fallible HAVING, total HAVING, key guard': 8 /* (x) */,
  'group by: fallible HAVING, key guard': 8,
  'expansion over fallible filter, total filters above': 16 /* (x) */,
  'join over fallible-filtered input, two totals': 8 /* (x) */,
  'group over fallible-filtered input, two HAVING': 16 /* (x) */,
};

for (const [parts, A] of [
  ['2 parts', A2],
  ['1 part', A1],
] as const)
  it(`D1 FINDING pin + Deviation 2 probe (${parts}): total guards above a fallible Filter (scan, expansion, join, GROUP BY, FINAL, IN) and the 4d target shapes`, async () => {
    report.length = 0;

    const shapes: [string, Rel][] = [
      ['scan: fallible, guard', A.where(r => bad(r.s).gt(0)).where(r => r.id.ne(3)).ir],
      [
        'scan: fallible, total, guard',
        A.where(r => bad(r.s).gt(0))
          .where(r => r.n.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'scan: total, fallible, total, guard (3b)',
        A.where(r => r.n.gt(0n))
          .where(r => bad(r.s).gt(0))
          .where(r => r.n.lt(100n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'scan: fallible, guard on key range',
        A.where(r => bad(r.s).gt(0)).where(r => r.id.lt(3)).ir,
      ],
      ['scan: fallible, guard id = 1', A.where(r => bad(r.s).gt(0)).where(r => r.id.eq(1)).ir],
      [
        'expanded: fallible on s, guard',
        A.arrayJoin(r => r.arr, 'x')
          .where(r => bad(r.s).gt(0))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'expanded: x total, fallible, x guard, id guard',
        A.arrayJoin(r => r.arr, 'x')
          .where(r => r.x.ne(''))
          .where(r => bad(r.s).gt(0))
          .where(r => r.x.ne('t'))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'left expanded: fallible, total, guard',
        A.leftArrayJoin(r => r.arr, 'x')
          .where(r => bad(r.s).gt(0))
          .where(r => r.n.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'inner join: fallible, guard',
        join({ a: A, b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.a.id.ne(3)).ir,
      ],
      [
        'inner join: fallible, total, guard',
        join({ a: A, b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.b.n.gt(0n))
          .where(r => r.a.id.ne(3)).ir,
      ],
      [
        'inner join: fallible on b side, guard on a (ON-copied)',
        join({ a: A, b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.b.id.ne(3)).ir,
      ],
      [
        'left join: fallible, total, guard',
        leftJoin({ a: A }, { b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.b.id.isNull().not())
          .where(r => r.a.id.ne(3)).ir,
      ],
      [
        'left join: isNull, fallible, guard',
        leftJoin({ a: A }, { b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => r.b.n.isNotNull())
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.a.id.ne(3)).ir,
      ],
      [
        'group by: fallible HAVING, total HAVING, key guard',
        A.groupBy(r => ({ id: r.id, s: r.s }))
          .aggregate(() => ({ c: count() }))
          .where(r => bad(r.s).gt(0))
          .where(r => r.c.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'group by: fallible HAVING, key guard',
        A.groupBy(r => ({ id: r.id, s: r.s }))
          .aggregate(() => ({ c: count() }))
          .where(r => bad(r.s).gt(0))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'FINAL scan: fallible, total, guard',
        R.final()
          .where(r => bad(r.s).gt(0))
          .where(r => r.n.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'FINAL join: fallible, total, guard',
        join({ a: R.final(), b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.b.n.gt(0n))
          .where(r => r.a.id.ne(3)).ir,
      ],
      [
        'IN guard above fallible scan filter',
        A.where(r => bad(r.s).gt(0)).where(r => r.id.in(B.where(b => b.n.gt(0n)).map(b => b.id)))
          .ir,
      ],
      [
        'IN guard + total above fallible join filter',
        join({ a: A, b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => bad(r.a.s).gt(0))
          .where(r => r.b.n.gt(0n))
          .where(r => r.a.id.in(B.where(b => b.n.gt(0n)).map(b => b.id))).ir,
      ],
      [
        'fallible IN (cast subquery) then guards',
        A.where(r => r.n.in(B.map(b => cast(b.s, col.Int64))))
          .where(r => r.n.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'expansion over fallible filter, total filters above',
        A.where(r => bad(r.s).gt(0))
          .arrayJoin(r => r.arr, 'x')
          .where(r => r.x.ne(''))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        'join over fallible-filtered input, two totals',
        leftJoin({ a: A.where(r => bad(r.s).gt(0)) }, { b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => r.b.id.isNull())
          .where(r => r.a.id.ne(3)).ir,
      ],
      [
        '4d pin: left join, fallible input projection, isNull, guard',
        leftJoin({ a: A.map(r => ({ id: r.id, c: bad(r.s) })) }, { b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => r.b.id.isNull())
          .where(r => r.a.id.ne(3))
          .map(r => ({ id: r.a.id, c: r.a.c })).ir,
      ],
      [
        '4d: inner join, fallible input projection, cross conj, guard',
        join({ a: A.map(r => ({ id: r.id, c: bad(r.s) })), b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where((r: any) => r.a.id.plus(r.b.n).ne(0n))
          .where(r => r.a.id.ne(3))
          .map(r => ({ id: r.a.id, c: r.a.c })).ir,
      ],
      [
        '4d: scan, fallible selection, c > 0, guard',
        A.map(r => ({ id: r.id, c: bad(r.s) }))
          .where(r => r.c.gt(0))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        '4d: scan, fallible selection, guard only',
        A.map(r => ({ id: r.id, c: bad(r.s) })).where(r => r.id.ne(3)).ir,
      ],
      [
        '4d: fallible aggregate, two HAVING',
        A.groupBy(r => ({ id: r.id }))
          .aggregate(g => ({ t: sum(bad(g.s)) }))
          .where((r: any) => r.t.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
      [
        '4d: fallible expansion, two filters',
        (A as any)
          .arrayJoin((r: any) => known.array(bad(r.s)).as(col.Array(col.UInt8)), 'x')
          .where((r: any) => r.x.gt(0))
          .where((r: any) => r.id.ne(3)).ir,
      ],
      [
        '4d: fallible selection below expansion, two filters',
        A.map(r => ({ id: r.id, c: bad(r.s), s: r.s }))
          .arrayJoin(r => known.array(r.s).as(col.Array(col.String)), 'x')
          .where(r => r.x.ne(''))
          .where(r => r.id.ne(3))
          .map(r => ({ id: r.id, c: r.c })).ir,
      ],
      [
        'group over fallible-filtered input, two HAVING',
        A.where(r => bad(r.s).gt(0))
          .groupBy(r => ({ id: r.id }))
          .aggregate(() => ({ c: count() }))
          .where(r => r.c.gt(0n))
          .where(r => r.id.ne(3)).ir,
      ],
    ];

    for (const [label, root] of shapes) await record(label, root);

    // Out-of-contract rows (extras: analyzer 0, FINAL/PREWHERE variants, merge_filters, short-circuit) are recorded only.
    for (const o of report)
      expect.soft(o.violations, `${parts} ${o.label}\n${o.optimized}\n${o.naive}`).toEqual([]);

    // The oracle branch is not vacuous: on two parts the D1 shapes succeed where naive fails, with the guard-first rows.
    if (parts === '2 parts')
      expect(
        report
          .filter(o => o.oracleRows > 0)
          .map(o => o.label)
          .sort(),
      ).toEqual(
        Object.keys(D1)
          .filter(k => D1[k]! > 0)
          .sort(),
      );
    else expect(report.every(o => o.oracleRows === 0)).toBe(true);

    console.log(
      `PROBE ${parts}\n` +
        report
          .map(
            o =>
              `${o.label} | hits ${JSON.stringify(o.hits)} | contract cells disagreeing ${o.disagree.length}/16 (expected D1 ${D1[o.label] ?? 0}), guard-first rows ${o.oracleRows} | extra ${o.extra.map(e => e.split(' opt=')[0]).join(',')} | ${o.summary.slice(0, 120)}`,
          )
          .join('\n'),
    );
  }, 600000);

/** D2 (Tester 4d, major, pre-existing; 4f class): a descriptor-visible ALIAS column whose expression can fail (`c UInt8 ALIAS
 * CAST(s AS UInt8)`) is a plain ColumnRef to `fallibleComputation`/`fallibleWithin`, so MergeFilter, PushFilterJoin and
 * PushFilterAggKey move `id != 3` below the read that computes it: optimized rows, naive code 6, in every contract cell (the
 * single-scan form only with the bad row in its own part). Observed counts: [2 parts 16 / 1 part 0, 16, 16, 16], logged.
 * Contract follow-up (user ruling: results-only, see D1): asserted instead, in every contract cell, that optimized agrees with
 * naive when naive succeeds and otherwise fails or returns the guard-first oracle's rows. */
for (const [parts, X] of [
  ['2 parts', X2],
  ['1 part', X1],
] as const)
  it(`D2 FINDING pin (${parts}): fallible ALIAS columns are invisible to the fence`, async () => {
    const out: Outcome[] = [];

    out.push(
      await probe(
        'alias scan: c > 0 then id != 3',
        X.where(r => r.c.gt(0)).where(r => r.id.ne(3)).ir,
      ),
    );

    out.push(
      await probe(
        'alias left join: isNull then guard',
        leftJoin({ a: X }, { b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where(r => r.b.id.isNull())
          .where(r => r.a.id.ne(3))
          .map(r => ({ id: r.a.id, c: r.a.c })).ir,
      ),
    );

    out.push(
      await probe(
        'alias inner join: cross conj then guard',
        join({ a: X, b: B })
          .on(r => r.a.id.eq(r.b.id))
          .where((r: any) => r.a.id.plus(r.b.n).ne(0n))
          .where(r => r.a.id.ne(3))
          .map(r => ({ id: r.a.id, c: r.a.c })).ir,
      ),
    );

    out.push(
      await probe(
        'alias group: two HAVING',
        X.groupBy(r => ({ id: r.id }))
          .aggregate(g => ({ m: count(), c: max(g.c) }))
          .where((r: any) => r.m.gt(0n))
          .where((r: any) => r.id.ne(3)).ir,
      ),
    );

    console.log(
      `ALIAS ${parts}\n` +
        out
          .map(
            o =>
              `${o.label} | hits ${JSON.stringify(o.hits)} | contract cells disagreeing ${o.disagree.length}/16 | ${o.summary.slice(0, 160)}`,
          )
          .join('\n'),
    );

    for (const o of out)
      expect.soft(o.violations, `${parts} ${o.label}\n${o.optimized}\n${o.naive}`).toEqual([]);

    // Every disagreement is a naive failure answered by the guard-first rows (16 cells each, as observed).
    expect(out.map(o => o.oracleRows)).toEqual(out.map(o => o.disagree.length));
    expect(out.map(o => o.oracleRows)).toEqual([parts === '2 parts' ? 16 : 0, 16, 16, 16]);
  }, 600000);

for (const [parts, A] of [
  ['2 parts', A2],
  ['1 part', A1],
] as const)
  it(`Deviation 3 probe (${parts}): one filter over an inner/LEFT expansion of a fallible selection`, async () => {
    const sel = A.map(r => ({ id: r.id, c: bad(r.s), arr: r.arr }));

    const shapes: [string, Rel][] = [
      [
        'inner expansion, x and id guard',
        sel
          .arrayJoin(r => r.arr, 'x')
          .where(r => r.x.ne('').and(r.id.ne(3)))
          .map(r => ({ id: r.id, c: r.c, x: r.x })).ir,
      ],
      [
        'LEFT expansion, x and id guard',
        sel
          .leftArrayJoin(r => r.arr, 'x')
          .where(r => r.x.ne('').and(r.id.ne(3)))
          .map(r => ({ id: r.id, c: r.c, x: r.x })).ir,
      ],
      [
        'inner expansion, id guard only',
        sel
          .arrayJoin(r => r.arr, 'x')
          .where(r => r.id.ne(3))
          .map(r => ({ id: r.id, c: r.c, x: r.x })).ir,
      ],
      [
        'LEFT expansion, id guard only',
        sel
          .leftArrayJoin(r => r.arr, 'x')
          .where(r => r.id.ne(3))
          .map(r => ({ id: r.id, c: r.c, x: r.x })).ir,
      ],
    ];

    const out: Outcome[] = [];
    for (const [label, root] of shapes) out.push(await probe(label, root, []));

    for (const o of out) {
      expect.soft(o.disagree.length, o.label).toBe(0);
      expect.soft(o.hits.PushFilterArrayJoin ?? 0, o.label).toBe(0);
    } // flip-verified: 8/16 (push-down 0) without the fence

    console.log(
      `DEV3 ${parts}\n` +
        out
          .map(
            o =>
              `${o.label} | hits ${JSON.stringify(o.hits)} | contract cells disagreeing ${o.disagree.length}/16 | ${o.disagree
                .map(d => d.split(' opt=')[0])
                .join(',')
                .slice(0, 400)}`,
          )
          .join('\n'),
    );
  }, 600000);
