import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  cast,
  col,
  count,
  scalar,
  sql,
  from,
  join,
  table,
  unionAll,
  val,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

// Tester native probes for slice 3 on clickhouse/clickhouse-server:24.8. The optimizing and naive emissions must agree in
// rows, `meta` and failure class under every combination of prefer_column_name_to_alias 0/1, optimize_move_to_prewhere 0/1
// and max_threads 1/default (the contract matrix, analyzer on), and with a hand-written oracle where given. The old
// analyzer (allow_experimental_analyzer = 0) is outside the spec's contract (ClickHouse >= 24.3, analyzer default) and
// is only recorded.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const adv = table(
  'adv_s3',
  {
    id: col.UInt32,
    k: col.String,
    n: col.Int64,
    s: col.String,
    nn: col.Nullable(col.String),
    lc: col.LowCardinality(col.Nullable(col.String)),
    ids: col.Array(col.String),
    extra: col.UInt8,
    alias_id: col.UInt32,
    mat_id: col.UInt32,
    tup: col.Tuple({ a: col.String, b: col.UInt8 }),
    parts: col.Array(col.Tuple({ id: col.String, w: col.UInt8 })),
  },
  meta,
);

const other = table('adv_s3_other', { id: col.UInt32, v: col.UInt32 }, meta);

const rmt = table(
  'adv_s3_rmt',
  { id: col.UInt32, ver: col.UInt32, k: col.String, s: col.String, ids: col.Array(col.String) },
  { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] },
);

const smp = table(
  'adv_s3_smp',
  { id: col.UInt32, k: col.String, s: col.String, ids: col.Array(col.String) },
  { engine: 'MergeTree', sortingKey: ['k', 'intHash32(id)'], partitionKey: [] },
);

const t = from(adv),
  u = from(other),
  r = from(rmt),
  sm = from(smp);

const rand = () => sql`rand()`.as(col.UInt32);

let container: StartedTestContainer;

let url: string;

type Settings = Readonly<Record<string, string | number>>;

interface Result {
  meta?: { name: string; type: string }[];
  data?: Record<string, unknown>[];
  error?: string;
}

async function execute(
  sql: string,
  params: Readonly<Record<string, string>> = {},
  settings: Settings = {},
  ordered = false,
): Promise<Result> {
  const endpoint = new URL(url);

  for (const [key, value] of Object.entries(params))
    endpoint.searchParams.set(`param_${key}`, value);

  for (const [key, value] of Object.entries(settings))
    endpoint.searchParams.set(key, String(value));

  endpoint.searchParams.set('output_format_json_quote_64bit_integers', '1');
  // Without this a failure raised after the first block streamed arrives inside a 200 response (`exception` field, or a
  // trailer the JSON parser rejects); with it every server failure is an HTTP error carrying its code.
  endpoint.searchParams.set('wait_end_of_query', '1');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: `${sql} FORMAT JSON`,
  });

  const text = await response.text();
  if (!response.ok) return { error: /Code: (\d+)\./.exec(text)?.[1] ?? text.slice(0, 120) };
  const json = JSON.parse(text) as Required<Result>;

  const data = ordered
    ? json.data
    : [...json.data].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

  return { meta: json.meta, data };
}

const raw = async (sql: string) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'fixture', 'X-ClickHouse-Key': 'fixture' },
    body: sql,
  });

  if (!res.ok) throw new Error(await res.text());
};

beforeAll(async () => {
  container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({ CLICKHOUSE_USER: 'fixture', CLICKHOUSE_PASSWORD: 'fixture' })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123))
    .start();

  url = `http://${container.getHost()}:${container.getMappedPort(8123)}`;

  // ALIAS and MATERIALIZED columns are real codegen output (the fixture `coverage` table has them): they read their
  // underlying column by name on the server, which is exactly what a select alias could shadow.
  await raw(
    'CREATE TABLE adv_s3 (id UInt32, k String, n Int64, s String, nn Nullable(String), lc LowCardinality(Nullable(String)), ids Array(String), extra UInt8, alias_id UInt32 ALIAS id, mat_id UInt32 MATERIALIZED id * 10, tup Tuple(a String, b UInt8), parts Array(Tuple(id String, w UInt8))) ENGINE=MergeTree ORDER BY id',
  );

  await raw(
    "INSERT INTO adv_s3 (id, k, n, s, nn, lc, ids, extra, tup, parts) VALUES (1, 'a', 10, '1', 'x', NULL, ['p','q'], 7, ('t', 1), [('i1', 1)]), (2, 'b', 20, 'x', NULL, 'l', [], 8, ('u', 2), []), (3, 'a', 30, '3', 'y', 'm', ['q'], 9, ('t', 3), [('i3', 3), ('i3', 4)])",
  );

  await raw('CREATE TABLE adv_s3_other (id UInt32, v UInt32) ENGINE=MergeTree ORDER BY id');
  await raw('INSERT INTO adv_s3_other VALUES (1, 5), (2, 25), (3, 2), (3, 40)');

  await raw(
    'CREATE TABLE adv_s3_rmt (id UInt32, ver UInt32, k String, s String, ids Array(String)) ENGINE=ReplacingMergeTree(ver) ORDER BY id',
  );

  await raw('SYSTEM STOP MERGES adv_s3_rmt'); // keep both versions of id 1 in separate parts so FINAL is observable

  await raw(
    "INSERT INTO adv_s3_rmt VALUES (1, 1, 'a', 'bad', ['o','o']), (2, 1, 'b', '2', ['keep'])",
  );

  await raw("INSERT INTO adv_s3_rmt VALUES (1, 2, 'a', '1', ['n']), (3, 1, 'a', '3', [])");

  await raw(
    'CREATE TABLE adv_s3_smp (id UInt32, k String, s String, ids Array(String)) ENGINE=MergeTree ORDER BY (k, intHash32(id)) SAMPLE BY intHash32(id)',
  );

  await raw(
    "INSERT INTO adv_s3_smp SELECT number, ['a','b'][number % 2 + 1], toString(number), arrayMap(i -> toString(i), range(number % 3)) FROM numbers(40)",
  );
}, 120000);

afterAll(async () => {
  await container?.stop();
});

const contract: Settings[] = [];

for (const alias of [0, 1])
  for (const prewhere of [0, 1])
    for (const threads of [1, 0])
      contract.push({
        prefer_column_name_to_alias: alias,
        optimize_move_to_prewhere: prewhere,
        ...(threads ? { max_threads: 1 } : {}),
      });

const legacy: Settings[] = [0, 1].map(alias => ({
  allow_experimental_analyzer: 0,
  prefer_column_name_to_alias: alias,
}));

const legacyNotes: string[] = [];

/** Both emissions agree with each other under every contract setting (and with the oracle); the old analyzer is recorded. */
async function agree(
  root: Rel,
  options: {
    oracle?: string;
    selects?: number;
    ordered?: boolean;
    error?: string;
    label?: string;
  } = {},
) {
  const optimized = compile(root),
    naive = emitNaive(root);

  const context = `${options.label ?? ''}\n${optimized.sql}\n${naive.sql}`;

  if (options.selects !== undefined)
    expect(optimized.sql.match(/SELECT /g)?.length, context).toBe(options.selects);

  expect(Object.keys(optimized.params), context).toEqual(Object.keys(naive.params));
  expect(optimized.columns, context).toEqual(naive.columns);
  let first: Result | undefined;

  for (const settings of contract) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);
    const label = `${context}\n${JSON.stringify(settings)}`;
    expect(a, label).toEqual(b);

    if (options.error !== undefined) expect(a.error, label).toBe(options.error);
    else expect(a.error, label).toBeUndefined();

    first ??= a;
    expect(a, label).toEqual(first);
  }

  if (options.oracle)
    expect(first, context).toEqual(await execute(options.oracle, {}, {}, options.ordered));

  for (const settings of legacy) {
    const a = await execute(optimized.sql, optimized.params, settings, options.ordered);
    const b = await execute(naive.sql, naive.params, settings, options.ordered);

    if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(first))
      legacyNotes.push(
        `${options.label ?? optimized.sql} ${JSON.stringify(settings)}: optimized=${JSON.stringify(a).slice(0, 160)} naive=${JSON.stringify(b).slice(0, 160)}`,
      );
  }

  return { optimized, naive, first: first! };
}

it('alias guard: self-read, pruned-only and fenced shadows agree natively; ALIAS/MATERIALIZED columns resolve against the table', async () => {
  const selfRead = await agree(
    t.where(x => x.k.eq('a')).map(x => ({ n: cast(x.n, col.String), k: x.k })).ir,
    {
      selects: 1,
      oracle: "SELECT toString(n) AS n, k FROM adv_s3 WHERE k = 'a'",
      label: 'self-read cast',
    },
  );

  expect(selfRead.first.meta).toEqual([
    { name: 'n', type: 'String' },
    { name: 'k', type: 'String' },
  ]);

  const plusOne = await agree(
    t.where(x => x.extra.gt(7)).map(x => ({ n: x.n.plus(1n), k: x.k })).ir,
    {
      selects: 1,
      oracle: 'SELECT n + 1 AS n, k FROM adv_s3 WHERE extra > 7',
      label: 'self-read plus',
    },
  );

  expect(plusOne.first.data).toEqual([
    { n: '21', k: 'b' },
    { n: '31', k: 'a' },
  ]);

  await agree(t.where(x => x.k.eq('a')).map(x => ({ extra: cast(x.n, col.String) })).ir, {
    selects: 1,
    oracle: "SELECT toString(n) AS extra FROM adv_s3 WHERE k = 'a'",
    label: 'pruned shadow',
  });

  await agree(t.map(x => ({ id: x.id.plus(x.extra), extra: x.extra })).ir, {
    selects: 1,
    oracle: 'SELECT id + extra AS id, extra FROM adv_s3',
    label: 'self-read with identity sibling',
  });

  // Fenced shapes (another item / the WHERE reads the shadowed column) still agree, with the values of the physical column.
  const fenced = await agree(t.map(x => ({ k: cast(x.n, col.String), flag: x.k.eq('a') })).ir, {
    selects: 2,
    oracle: "SELECT toString(n) AS k, flag FROM (SELECT n, k = 'a' AS flag FROM adv_s3)",
    label: 'other item reads shadow',
  }); // the first oracle draft fell into the alias trap itself

  expect(fenced.first.data).toEqual([
    { k: '10', flag: 1 },
    { k: '20', flag: 0 },
    { k: '30', flag: 1 },
  ]);

  const pushed = await agree(t.map(x => ({ n: x.n.plus(1n) })).where(x => x.n.gt(15n)).ir, {
    selects: 2,
    oracle: 'SELECT n + 1 AS n FROM adv_s3 WHERE n + 1 > 15',
    label: 'pushed WHERE reads shadow',
  });

  expect(pushed.first.data).toEqual([{ n: '21' }, { n: '31' }]);

  await agree(t.where(x => x.n.gt(15n)).map(x => ({ n: cast(x.id, col.Int64) })).ir, {
    selects: 2,
    oracle: 'SELECT toInt64(id) AS n FROM (SELECT id FROM adv_s3 WHERE n > 15)',
    label: 'WHERE reads shadow, cast',
  });

  // Sort / Limit / Distinct around the fold; a later WHERE on the fallible alias.
  await agree(t.map(x => ({ n: cast(x.k, col.String) })).orderBy(x => x.n).ir, {
    selects: 2,
    ordered: true,
    label: 'sort after fold',
  });

  await agree(
    t
      .where(x => x.k.eq('a'))
      .map(x => ({ n: cast(x.k, col.String) }))
      .distinct().ir,
    {
      selects: 1,
      oracle: "SELECT DISTINCT toString(k) AS n FROM adv_s3 WHERE k = 'a'",
      label: 'distinct after fold',
    },
  );

  await agree(t.map(x => ({ n: cast(x.s, col.Int64) })).where(x => x.n.gt(1n)).ir, {
    error: '6',
    label: 'fallible alias filtered above',
  });

  // ALIAS / MATERIALIZED columns beside a shadow of their underlying column, as an item and as the WHERE.
  const aliasItem = await agree(
    t.map(x => ({ id: cast(x.k, col.String), alias_id: x.alias_id, mat_id: x.mat_id })).ir,
    {
      selects: 1,
      oracle: 'SELECT k AS id, alias_id, mat_id FROM (SELECT k, alias_id, mat_id FROM adv_s3)',
      label: 'ALIAS column item',
    },
  );

  expect(aliasItem.first.data).toEqual([
    { id: 'a', alias_id: 1, mat_id: 10 },
    { id: 'a', alias_id: 3, mat_id: 30 },
    { id: 'b', alias_id: 2, mat_id: 20 },
  ]);

  await agree(t.where(x => x.alias_id.gt(1)).map(x => ({ id: cast(x.k, col.String) })).ir, {
    selects: 1,
    oracle: 'SELECT k AS id FROM adv_s3 WHERE alias_id > 1',
    label: 'ALIAS column WHERE',
  });

  await agree(t.where(x => x.mat_id.gt(10)).map(x => ({ id: x.k.eq('a') })).ir, {
    selects: 1,
    oracle: "SELECT k = 'a' AS id FROM adv_s3 WHERE mat_id > 10",
    label: 'MATERIALIZED column WHERE',
  });

  // Nullable / LowCardinality self-reads keep the nested form's meta.
  const typed = await agree(
    t.where(x => x.k.eq('a')).map(x => ({ lc: x.lc.isNotNull(), nn: x.nn.ifNull('w') })).ir,
    {
      selects: 1,
      oracle: "SELECT isNotNull(lc) AS lc, ifNull(nn, 'w') AS nn FROM adv_s3 WHERE k = 'a'",
      label: 'nullable self-reads',
    },
  );

  expect(typed.first.meta).toEqual([
    { name: 'lc', type: 'UInt8' },
    { name: 'nn', type: 'String' },
  ]);
});

it('expansion blocks: alias renames, shadows and casts over ARRAY JOIN; FINAL and SAMPLE scans under folded selections', async () => {
  const x = t.arrayJoin(a => a.ids, 'x');

  await agree(x.map(a => ({ n: a.x })).ir, {
    selects: 1,
    oracle: 'SELECT x AS n FROM adv_s3 ARRAY JOIN ids AS x',
    label: 'rename expansion alias to physical name',
  });

  await agree(x.where(a => a.x.eq('q')).map(a => ({ n: cast(a.x, col.String), x: a.x })).ir, {
    selects: 1,
    oracle: "SELECT x AS n, x FROM adv_s3 ARRAY JOIN ids AS x WHERE x = 'q'",
    label: 'cast of alias + WHERE on alias',
  });

  // Fenced: the expansion reads `ids` which the item shadows (ClickHouse would otherwise ARRAY JOIN a String).
  await agree(x.map(a => ({ ids: cast(a.id, col.String), x: a.x })).ir, {
    selects: 2,
    oracle: 'SELECT toString(id) AS ids, x FROM (SELECT id, x FROM adv_s3 ARRAY JOIN ids AS x)',
    label: 'expansion input shadowed',
  });

  await agree(x.map(a => ({ x: cast(a.id, col.String) })).ir, {
    selects: 2,
    label: 'expansion alias redefined',
  });

  await agree(
    t
      .where(a => a.k.eq('a'))
      .leftArrayJoin(a => a.ids, 'x')
      .map(a => ({ v: cast(a.s, col.UInt64), x: a.x })).ir,
    {
      selects: 1,
      oracle: "SELECT toUInt64(s) AS v, x FROM adv_s3 LEFT ARRAY JOIN ids AS x WHERE k = 'a'",
      label: 'cast over LEFT expansion',
    },
  );

  // FINAL: the superseded version carries the unparsable `s`; the cast folds over `FROM t FINAL WHERE`.
  const final = await agree(
    r
      .final()
      .where(a => a.k.eq('a'))
      .map(a => ({ v: cast(a.s, col.UInt64), id: a.id })).ir,
    {
      selects: 1,
      oracle: "SELECT toUInt64(s) AS v, id FROM adv_s3_rmt FINAL WHERE k = 'a'",
      label: 'FINAL cast',
    },
  );

  expect(final.optimized.sql).toBe(
    'SELECT CAST(`s` AS UInt64) AS `v`, `id` AS `id` FROM `adv_s3_rmt` FINAL WHERE `k` = {p0:String}',
  );

  expect(final.first.data).toEqual([
    { v: '1', id: 1 },
    { v: '3', id: 3 },
  ]);

  await agree(r.where(a => a.k.eq('a')).map(a => ({ v: cast(a.s, col.UInt64), id: a.id })).ir, {
    error: '6',
    label: 'no FINAL: the bad version is read',
  });

  // SAMPLE: deterministic on the sampling key, so both forms select the same rows.
  const sampled = await agree(
    sm
      .sample(0.5)
      .where(a => a.k.eq('a'))
      .map(a => ({ v: cast(a.s, col.UInt64), id: a.id })).ir,
    {
      selects: 1,
      oracle: "SELECT toUInt64(s) AS v, id FROM adv_s3_smp SAMPLE 0.5 WHERE k = 'a'",
      label: 'SAMPLE cast',
    },
  );

  expect(sampled.optimized.sql).toBe(
    'SELECT CAST(`s` AS UInt64) AS `v`, `id` AS `id` FROM `adv_s3_smp` SAMPLE 0.5 WHERE `k` = {p0:String}',
  );

  expect(sampled.first.data!.length).toBeGreaterThan(0);
});

it('house invariant: fallible selections fail or succeed identically under PREWHERE moves, OR conditions, LIMIT and thread counts', async () => {
  const bad = (q: Rel, label: string) => agree(q, { error: '6', label });

  // Filtered out by a predicate on the very column the cast reads (PREWHERE-movable), split with an array predicate, OR.
  await agree(t.where(a => a.s.ne('x')).map(a => ({ v: cast(a.s, col.UInt64) })).ir, {
    selects: 1,
    oracle: "SELECT toUInt64(s) AS v FROM adv_s3 WHERE s != 'x'",
    label: 'same-column filter',
  });

  await agree(
    t.where(a => a.s.ne('x').and(a.ids.has('q'))).map(a => ({ v: cast(a.s, col.UInt64) })).ir,
    {
      selects: 1,
      oracle: "SELECT toUInt64(s) AS v FROM adv_s3 WHERE s != 'x' AND has(ids, 'q')",
      label: 'prewhere split',
    },
  );

  await agree(
    t.where(a => a.s.ne('x').or(a.k.eq('zzz'))).map(a => ({ v: cast(a.s, col.UInt64) })).ir,
    {
      selects: 1,
      oracle: "SELECT toUInt64(s) AS v FROM adv_s3 WHERE s != 'x' OR k = 'zzz'",
      label: 'OR condition',
    },
  );

  await agree(t.where(a => a.alias_id.ne(2)).map(a => ({ v: cast(a.s, col.UInt64) })).ir, {
    selects: 1,
    oracle: 'SELECT toUInt64(s) AS v FROM adv_s3 WHERE alias_id != 2',
    label: 'ALIAS column filter',
  });

  // Kept: both fail with CANNOT_PARSE_TEXT (code 6).
  await bad(t.map(a => ({ v: cast(a.s, col.UInt64) })).ir, 'unfiltered');
  await bad(t.where(a => a.s.ne('1')).map(a => ({ v: cast(a.s, col.UInt64) })).ir, 'bad row kept');

  await bad(
    t.where(a => a.k.eq('b')).map(a => ({ v: cast(a.s, col.UInt64), k: a.k })).ir,
    'bad row selected by another column',
  );

  // LIMIT above the fold: ClickHouse may stop before the bad row; whatever it does, both forms do the same (asserted by agree).
  const limited = await agree(t.map(a => ({ v: cast(a.s, col.UInt64) })).limit(1).ir, {
    selects: 2,
    label: 'LIMIT 1 over an unfiltered cast',
  });

  console.info('slice3 probe: LIMIT 1 over a cast with a bad row', limited.first);

  await agree(
    t
      .where(a => a.k.eq('a'))
      .map(a => ({ v: cast(a.s, col.UInt64) }))
      .limit(1).ir,
    { selects: 2, label: 'LIMIT 1 over a filtered cast' },
  );

  await agree(
    t
      .map(a => ({ v: cast(a.s, col.UInt64) }))
      .orderBy(a => a.v)
      .limit(1).ir,
    { selects: 2, ordered: true, error: '6', label: 'ORDER BY + LIMIT over an unfiltered cast' },
  );

  // Volatile: one row per filtered source row.
  const volatile = await agree(
    t.where(a => a.k.eq('a')).map(a => ({ id: a.id, z: rand().multiply(0) })).ir,
    {
      selects: 1,
      oracle: "SELECT id, rand() * 0 AS z FROM adv_s3 WHERE k = 'a'",
      label: 'volatile',
    },
  );

  expect(volatile.first.data).toEqual([
    { id: 1, z: '0' },
    { id: 3, z: '0' },
  ]);
});

it('join-bound selections over Filter(Join), the spec self-join shape and a CTE-name alias agree natively', async () => {
  const j = join({ a: t, b: u }).on(x => x.a.id.eq(x.b.id));

  const renamed = await agree(
    j.where(x => x.a.id.lt(x.b.v)).map(x => ({ x: x.a.id, id: x.b.v })).ir,
    {
      selects: 2,
      oracle:
        'SELECT a.id AS x, b.v AS id FROM adv_s3 AS a INNER JOIN adv_s3_other AS b ON a.id = b.id WHERE a.id < b.v',
      label: 'rename shadow over join residual',
    },
  );

  expect(renamed.first.data).toEqual([
    { x: 1, id: 5 },
    { x: 2, id: 25 },
    { x: 3, id: 40 },
  ]);

  await agree(
    j
      .where(x => x.a.id.lt(x.b.v))
      .where(x => cast(x.a.s, col.UInt64).gt(0n))
      .map(x => ({ id: x.a.id })).ir,
    { error: '6', label: 'fallible second WHERE on the join block' },
  );

  await agree(
    j
      .where(x => x.a.id.ne(2))
      .where(x => cast(x.a.s, col.UInt64).gt(0n))
      .map(x => ({ id: x.a.id })).ir,
    {
      selects: 4,
      oracle:
        'SELECT a.id AS id FROM (SELECT id, s FROM adv_s3 WHERE id != 2) AS a INNER JOIN adv_s3_other AS b ON a.id = b.id WHERE toUInt64(a.s) > 0',
      label:
        'fallible WHERE above a total one (4b: not pushed under the fallible Filter, so 4 SELECTs, was 3)',
    },
  ); // a flat `id != 2 AND toUInt64(s) > 0` oracle fails under PREWHERE: ClickHouse reorders conjuncts

  const shared = t.where(x => x.k.eq('a'));

  const named = await agree(
    join({ a: shared, b: shared })
      .on(x => x.a.id.eq(x.b.id))
      .where(x => x.a.n.le(x.b.n))
      .map(x => ({ t0: x.a.id, b: x.b.n })).ir,
    {
      selects: 2,
      oracle:
        "SELECT a.id AS t0, b.n AS b FROM adv_s3 AS a INNER JOIN adv_s3 AS b ON a.id = b.id WHERE a.k = 'a' AND b.k = 'a' AND a.n <= b.n",
      label: 'alias equal to CTE name',
    },
  );

  expect(named.optimized.sql).toContain('AS `t0`');

  await agree(
    join({ a: t, b: t })
      .on(x => [x.a.id.eq(x.b.id), x.a.n.lt(x.b.n.plus(1n))])
      .map(x => ({ a: x.a.id, b: x.b.n })).ir,
    {
      selects: 2,
      oracle:
        'SELECT a.id AS a, b.n AS b FROM adv_s3 AS a INNER JOIN adv_s3 AS b ON a.id = b.id WHERE a.n < b.n + 1',
      label: 'spec eq+lt ON shape',
    },
  );
});

it('(vii)/(viii): aggregates over expansions with FINAL, SAMPLE, Params and HAVING; whole-row selections over DISTINCT', async () => {
  const agg = r
    .final()
    .where(a => a.k.eq('a'))
    .leftArrayJoin(a => a.ids, 'x')
    .where(a => a.x.ne('zz'))
    .groupBy(a => ({ x: a.x }))
    .aggregate(() => ({ c: count() }))
    .where(a => a.c.ge(1n))
    .orderBy(a => a.x)
    .limit(5);

  const folded = await agree(agg.ir, {
    selects: 1,
    ordered: true,
    oracle:
      "SELECT x, count() AS c FROM adv_s3_rmt FINAL LEFT ARRAY JOIN ids AS x WHERE k = 'a' AND x != 'zz' GROUP BY x HAVING c >= 1 ORDER BY x LIMIT 5",
    label: '(vii) FINAL LEFT expansion aggregate',
  });

  expect(folded.first.data).toEqual([
    { x: '', c: '1' },
    { x: 'n', c: '1' },
  ]); // FINAL dropped ['o','o']; id 3 has an empty array

  await agree(
    sm
      .sample(0.5)
      .arrayJoin(a => a.ids, 'x')
      .groupBy(a => ({ k: a.k }))
      .aggregate(() => ({ c: count() }))
      .orderBy(a => a.k).ir,
    {
      selects: 1,
      ordered: true,
      oracle:
        'SELECT k, count() AS c FROM adv_s3_smp SAMPLE 0.5 ARRAY JOIN ids AS x GROUP BY k ORDER BY k',
      label: '(vii) SAMPLE expansion aggregate',
    },
  );

  // Param in the expansion expression and in a WHERE below it: the two texts number them differently; rows agree.
  const parameterised = t
    .where(a => a.k.eq('a'))
    .arrayJoin(a => a.parts.element('id'), 'x')
    .groupBy(a => ({ x: a.x }))
    .aggregate(() => ({ c: count() }))
    .orderBy(a => a.x);

  const p = await agree(parameterised.ir, {
    selects: 1,
    ordered: true,
    oracle:
      "SELECT x, count() AS c FROM adv_s3 ARRAY JOIN tupleElement(parts, 'id') AS x WHERE k = 'a' GROUP BY x ORDER BY x",
    label: '(vii) Param in expansion',
  });

  expect(p.optimized.params).toEqual({ p0: 'id', p1: 'a' });
  expect(p.naive.params).toEqual({ p0: 'a', p1: 'id' });

  expect(p.first.data).toEqual([
    { x: 'i1', c: '1' },
    { x: 'i3', c: '2' },
  ]);

  await agree(t.arrayJoin(a => a.ids, 'x').aggregate(() => ({ c: count(), m: count() })).ir, {
    selects: 1,
    oracle: 'SELECT count() AS c, count() AS m FROM adv_s3 ARRAY JOIN ids AS x',
    label: '(vii) keyless',
  });

  // (viii) whole-row reorder over an expanded DISTINCT, sorted and limited: rows, meta names and order equal the oracle.
  const whole = t
    .arrayJoin(a => a.ids, 'x')
    .distinct()
    .map(a => ({
      x: a.x,
      id: a.id,
      k: a.k,
      n: a.n,
      s: a.s,
      nn: a.nn,
      lc: a.lc,
      ids: a.ids,
      extra: a.extra,
      alias_id: a.alias_id,
      mat_id: a.mat_id,
      tup: a.tup,
      parts: a.parts,
    }))
    .orderBy(a => a.x)
    .thenBy(a => a.id.desc())
    .limit(2);

  const w = await agree(whole.ir, {
    selects: 1,
    ordered: true,
    oracle:
      'SELECT DISTINCT x, id, k, n, s, nn, lc, ids, extra, alias_id, mat_id, tup, parts FROM adv_s3 ARRAY JOIN ids AS x ORDER BY x, id DESC LIMIT 2',
    label: '(viii) whole-row over expanded distinct',
  });

  expect(w.first.meta!.map(m => m.name)).toEqual([
    'x',
    'id',
    'k',
    'n',
    's',
    'nn',
    'lc',
    'ids',
    'extra',
    'alias_id',
    'mat_id',
    'tup',
    'parts',
  ]);

  expect(w.first.data!.map(d => [d.x, d.id])).toEqual([
    ['p', 1],
    ['q', 3],
  ]);

  await agree(
    t
      .where(a => a.k.eq('a'))
      .distinct()
      .map(a => ({
        k: a.k,
        id: a.id,
        n: a.n,
        s: a.s,
        nn: a.nn,
        lc: a.lc,
        ids: a.ids,
        extra: a.extra,
        alias_id: a.alias_id,
        mat_id: a.mat_id,
        tup: a.tup,
        parts: a.parts,
      }))
      .orderBy(a => a.id)
      .map(a => ({ id: a.id })).ir,
    {
      selects: 2,
      ordered: true,
      oracle: "SELECT id FROM (SELECT DISTINCT * FROM adv_s3 WHERE k = 'a' ORDER BY id)",
      label: '(viii) pruned consumer above the fold',
    },
  );
});

it('stacked fallible WHERE scopes preserve the naive rows and failures under all eight contracts', async () => {
  // Regression: a single AND failed on the excluded bad row (scan with PREWHERE,
  // join with every setting). A compiler boundary must be proved on the server,
  // not just by counting SELECTs: ClickHouse can optimize derived tables too.
  const scan = t
    .where(a => a.id.ne(2))
    .where(a => cast(a.s, col.UInt64).gt(0n))
    .map(a => ({ id: a.id }));

  const fixed = await agree(scan.ir, { selects: 2, label: 'isolated scan CAST' });
  expect(fixed.first.data).toEqual([{ id: 1 }, { id: 3 }]);

  const joined = join({ a: t, b: u })
    .on(x => x.a.id.eq(x.b.id))
    .where(x => x.a.id.plus(x.b.v).ne(27n))
    .where(x => cast(x.a.s, col.UInt64).gt(0n))
    .map(x => ({ id: x.a.id }));

  const fixedJoin = await agree(joined.ir, { label: 'isolated join CAST' });
  expect(fixedJoin.first.data).toEqual([{ id: 1 }, { id: 3 }, { id: 3 }]);

  await agree(
    t
      .where(a => a.id.ne(1))
      .where(a => cast(a.s, col.UInt64).gt(0n))
      .map(a => ({ id: a.id })).ir,
    { error: '6', label: 'CAST bad row kept' },
  );

  await agree(
    t
      .where(a => cast(a.s, col.UInt64).gt(0n))
      .where(a => a.id.ne(2))
      .map(a => ({ id: a.id })).ir,
    { error: '6', label: 'CAST before exclusion' },
  );

  for (const source of [t, t.cte(), t.map(a => ({ ...a, s: a.s }))]) {
    await agree(
      source
        .where(a => a.id.ne(2))
        .where(a => sql`intDiv(${a.n}, ${a.n.minus(20n)})`.as(col.Int64).ne(0n))
        .map(a => ({ id: a.id })).ir,
      { label: 'isolated integer division' },
    );

    await agree(
      source
        .where(a => a.id.ne(1))
        .where(a => sql`intDiv(${a.n}, ${a.n.minus(20n)})`.as(col.Int64).ne(0n))
        .map(a => ({ id: a.id })).ir,
      { error: '153', label: 'division bad row kept' },
    );

    await agree(
      source
        .where(a => sql`intDiv(${a.n}, ${a.n.minus(20n)})`.as(col.Int64).ne(0n))
        .where(a => a.id.ne(2))
        .map(a => ({ id: a.id })).ir,
      { error: '153', label: 'division before exclusion' },
    );
  }

  await agree(
    t
      .where(a => a.id.ne(2))
      .leftArrayJoin(a => a.ids, 'x')
      .where(a => cast(a.s, col.UInt64).gt(0n))
      .map(a => ({ id: a.id, x: a.x })).ir,
    { label: 'expanded isolated CAST' },
  );

  const groups = t.groupBy(a => ({ s: a.s })).aggregate(() => ({ c: count() }));

  await agree(groups.where(a => a.c.gt(1n)).where(a => cast(a.s, col.UInt64).gt(0n)).ir, {
    label: 'HAVING excludes every bad group',
  });

  await agree(groups.where(a => a.c.gt(0n)).where(a => cast(a.s, col.UInt64).gt(0n)).ir, {
    error: '6',
    label: 'HAVING keeps bad group',
  });
});

it('agent2 repair review: nested Boolean predicates retain outcomes through wrapper and scalar scopes', async () => {
  const base = t.map(a => ({ id: a.id, n: a.n, s: a.s }));

  const sources = [
    base,
    base.cte(),
    base.distinct(),
    base.orderBy(a => a.id).limit(3),
    base.orderBy(a => a.id).limit(1),
    unionAll(base, base),
    t.leftArrayJoin(a => a.ids, 'x').map(a => ({ id: a.id, n: a.n, s: a.s })),
    t.arrayJoin(a => a.ids, 'x').map(a => ({ id: a.id, n: a.n, s: a.s })),
  ];

  const excluded = val(2, col.UInt32),
    zero = val(0n, col.UInt64);

  let comparisons = 0;

  for (const [sourceIndex, source] of sources.entries())
    for (const stacked of [false, true])
      for (const reverse of [false, true]) {
        const safe = (a: typeof source.row) => a.id.ne(excluded).or(a.id.eq(99));
        const bad = (a: typeof source.row) => cast(a.s, col.UInt64).gt(zero).or(a.id.eq(98));

        const filtered = stacked
          ? reverse
            ? source.where(bad).where(safe)
            : source.where(safe).where(bad)
          : source.where(a => (reverse ? bad(a).and(safe(a)) : safe(a).and(bad(a))));

        // A shadowed output alias, ORDER/LIMIT/DISTINCT and a scalar-subquery consumer
        // must not turn the original single AND into ordered filters (or vice versa).
        const rows = filtered
          .map(a => ({ s: a.id, id: a.s }))
          .distinct()
          .orderBy(a => a.s)
          .limit(5);

        const nested = t
          .where(a => a.id.eq(1))
          .map(() => ({ n: scalar(filtered.aggregate(() => count())) }));

        for (const root of [rows.ir, nested.ir]) {
          const a = compile(root),
            b = emitNaive(root);

          expect(a.columns).toEqual(b.columns);
          expect(Object.values(a.params).sort()).toEqual(Object.values(b.params).sort());

          for (const settings of contract) {
            expect(
              await execute(a.sql, a.params, settings),
              JSON.stringify({
                sourceIndex,
                stacked,
                reverse,
                settings,
                optimized: a.sql,
                naive: b.sql,
              }),
            ).toEqual(await execute(b.sql, b.params, settings));

            comparisons++;
          }
        }
      }

  expect(comparisons).toBe(512);
}, 120000);

const fallibleRecipes = fc.record({
  source: fc.integer({ min: 0, max: 7 }),
  excluded: fc.integer({ min: 1, max: 3 }),
  reverse: fc.boolean(),
  division: fc.boolean(),
  mixed: fc.boolean(),
  repeats: fc.integer({ min: 1, max: 4 }),
  setting: fc.integer({ min: 0, max: 7 }),
});

type FallibleRecipe = {
  source: number;
  excluded: number;
  reverse: boolean;
  division: boolean;
  mixed: boolean;
  repeats: number;
  setting: number;
};

function fallibleQuery(r: FallibleRecipe) {
  const source =
    r.source === 3
      ? join({ a: t, b: u })
          .on(x => x.a.id.eq(x.b.id))
          .map(x => ({ id: x.a.id, n: x.a.n, s: x.a.s }))
      : r.source === 1
        ? t.leftArrayJoin(a => a.ids, 'x')
        : r.source === 7
          ? t.arrayJoin(a => a.ids, 'x')
          : r.source === 4
            ? unionAll(t, t)
            : r.source === 5
              ? t.groupBy(a => ({ id: a.id, n: a.n, s: a.s })).aggregate(() => ({ c: count() }))
              : r.source === 6
                ? t.map(a => ({ id: a.id, n: a.n.plus(0n), s: a.s }))
                : r.source === 2
                  ? t.cte()
                  : t;

  const fallible = (a: typeof source.row) =>
    r.division
      ? sql`intDiv(${a.n}, ${a.n.minus(20n)})`.as(col.Int64).ne(0n)
      : cast(a.s, col.UInt64).gt(0n);

  if (r.mixed)
    return source
      .where(a =>
        r.reverse ? fallible(a).and(a.id.ne(r.excluded)) : a.id.ne(r.excluded).and(fallible(a)),
      )
      .map(a => ({ id: a.id }));

  let q = r.reverse ? source.where(fallible) : source;
  for (let i = 0; i < r.repeats; i++) q = q.where(a => a.id.ne(r.excluded));
  if (!r.reverse) q = q.where(fallible);
  return q.map(a => ({ id: a.id }));
}

it('checks original AND versus stacked evaluation at every boundary under all eight settings', async () => {
  for (let source = 0; source < 8; source++)
    for (const mixed of [false, true])
      for (const reverse of [false, true])
        for (const division of [false, true]) {
          const recipe: FallibleRecipe = {
            source,
            mixed,
            reverse,
            division,
            excluded: 2,
            repeats: 1,
            setting: 0,
          };

          const root = fallibleQuery(recipe).ir,
            a = compile(root),
            b = emitNaive(root);

          expect(a.columns).toEqual(b.columns);

          for (const settings of contract) {
            expect(
              await execute(a.sql, a.params, settings),
              JSON.stringify({ recipe, settings, sql: a.sql }),
            ).toEqual(await execute(b.sql, b.params, settings));
          }
        }

  // Direct Join boundaries (without an intervening Project), and opaque volatile
  // expressions whose output is stable so independent executions can be compared.
  const joined = join({ a: t, b: u }).on(a => a.a.id.eq(a.b.id));

  for (const reverse of [false, true])
    for (const mixed of [false, true]) {
      const safe = (a: typeof joined.row) => a.a.id.ne(2);
      const bad = (a: typeof joined.row) => cast(a.a.s, col.UInt64).gt(0n);

      const q = mixed
        ? joined.where(a => (reverse ? bad(a).and(safe(a)) : safe(a).and(bad(a))))
        : reverse
          ? joined.where(bad).where(safe)
          : joined.where(safe).where(bad);

      const expanded = t.leftArrayJoin(a => a.ids, 'x');
      const volatile = () => sql`rand() % 1 = 0`.as(col.Bool);

      const v = mixed
        ? expanded.where(a => (reverse ? volatile().and(a.id.ne(2)) : a.id.ne(2).and(volatile())))
        : reverse
          ? expanded.where(volatile).where(a => a.id.ne(2))
          : expanded.where(a => a.id.ne(2)).where(volatile);

      for (const root of [q.map(a => ({ id: a.a.id })).ir, v.map(a => ({ id: a.id })).ir]) {
        const a = compile(root),
          b = emitNaive(root);

        for (const settings of contract)
          expect(
            await execute(a.sql, a.params, settings),
            JSON.stringify({ mixed, reverse, settings, sql: a.sql }),
          ).toEqual(await execute(b.sql, b.params, settings));
      }
    }
}, 120000);

it('executes 500 fixed-seed original-AND and stacked fallible-filter recipes, including kept errors', async () => {
  const branches = new Set<string>(),
    outcomes = new Set<string>();

  const result = await fc.check(
    fc.asyncProperty(fallibleRecipes, async r => {
      const root = fallibleQuery(r).ir,
        a = compile(root),
        b = emitNaive(root);

      const settings = contract[r.setting]!;

      const actual = await execute(a.sql, a.params, settings),
        expected = await execute(b.sql, b.params, settings);

      expect(a.columns).toEqual(b.columns);
      expect(Object.values(a.params).sort()).toEqual(Object.values(b.params).sort());
      expect(actual, JSON.stringify({ r, optimized: a.sql, naive: b.sql })).toEqual(expected);
      branches.add(`${r.source}/${r.reverse}/${r.division}/${r.mixed}`);
      outcomes.add(actual.error ?? 'rows');
    }),
    { seed: 20261204, numRuns: 500 },
  );

  console.info('fallible-filter differential', {
    runs: result.numRuns,
    seed: result.seed,
    branches: branches.size,
    outcomes: [...outcomes].sort(),
  });

  if (result.failed)
    throw new Error(
      `seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks}\n${String(result.errorInstance)}`,
    );

  expect(result.numRuns).toBe(500);
  expect(branches.size).toBe(64);
  expect([...outcomes].sort()).toEqual(['153', '6', 'rows']);
}, 120000);

it('detects the old flattened-WHERE fault natively, shrinks and replays it', async () => {
  const property = fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async repeats => {
    const r: FallibleRecipe = {
      source: 0,
      excluded: 2,
      reverse: false,
      division: false,
      mixed: false,
      repeats,
      setting: 0,
    };

    const naive = emitNaive(fallibleQuery(r).ir);
    const expected = await execute(naive.sql, naive.params, { optimize_move_to_prewhere: 1 });

    const faulty = await execute(
      `SELECT id FROM adv_s3 WHERE ${Array(repeats).fill('id != 2').join(' AND ')} AND CAST(s AS UInt64) > 0`,
      {},
      { optimize_move_to_prewhere: 1 },
    );

    expect(faulty).toEqual(expected);
  });

  const result = await fc.check(property, { seed: 20261204, numRuns: 500 });
  expect(result.failed).toBe(true);
  expect(result.numShrinks).toBeGreaterThan(0);

  const replay = await fc.check(property, {
    seed: result.seed,
    path: result.counterexamplePath!,
    numRuns: 500,
  });

  expect(replay.failed).toBe(true);
  expect(replay.counterexample).toEqual(result.counterexample);

  console.info('fallible-filter fault', {
    seed: result.seed,
    shrinks: result.numShrinks,
    path: result.counterexamplePath,
  });
}, 120000);

it('agent2: a mixed conjunction over LEFT ARRAY JOIN preserves the original failure', async () => {
  const query = t
    .leftArrayJoin(a => a.ids, 'x')
    .where(a => a.id.ne(2).and(cast(a.s, col.UInt64).gt(0n)))
    .map(a => ({ id: a.id, x: a.x }));

  // Before the new isolation guard, the pushed total predicate and residual
  // cast shared this WHERE. It agrees with naive failure under PREWHERE=1.
  expect(
    await execute(
      'SELECT id AS id, x AS x FROM adv_s3 LEFT ARRAY JOIN ids AS x WHERE id != 2 AND CAST(s AS UInt64) > 0',
      {},
      { prefer_column_name_to_alias: 0, optimize_move_to_prewhere: 1, max_threads: 1 },
    ),
  ).toEqual({ error: '6' });

  const optimized = compile(query.ir),
    naive = emitNaive(query.ir);

  for (const settings of contract) {
    const actual = await execute(optimized.sql, optimized.params, settings);
    const expected = await execute(naive.sql, naive.params, settings);
    expect(actual, JSON.stringify(settings)).toEqual(expected);

    if (
      settings.prefer_column_name_to_alias === 0 &&
      settings.optimize_move_to_prewhere === 1 &&
      settings.max_threads === 1
    ) {
      expect(expected).toEqual({ error: '6' });
      expect(actual).toEqual({ error: '6' });
    }
  }
});

it('slice 3b (formerly "PRE-EXISTING … as observed"): a filter outside the total fragment keeps its own SELECT over earlier filters, so both texts agree in rows, meta and failure code on scan and join blocks', async () => {
  // Before the fix the planner rendered consecutive Filters as one `WHERE a AND b`: `SELECT id FROM adv_s3 WHERE id != {p0}
  // AND CAST(s AS UInt64) > {p1}` failed with CANNOT_PARSE_TEXT under optimize_move_to_prewhere = 1 (the CAST ran first)
  // while the naive nesting returned [1, 3], and the join form failed under every setting (the one-sided CAST was pushed
  // below the join). Now the fallible filter closes the block below it into a derived table, and a total filter above a
  // fallible one does the same. `agree` runs both emitters through the contract matrix (prefer_column_name_to_alias 0/1 ×
  // optimize_move_to_prewhere 0/1 × max_threads 1/default) and requires rows, meta and error code to agree cell by cell.
  const bad = (a: typeof t.row) => cast(a.s, col.UInt64).gt(0n);

  // Scan block, bad row (id 2, s = 'x') filtered out by the total filter below the cast: rows and meta agree everywhere.
  const out = await agree(
    t
      .where(a => a.id.ne(2))
      .where(bad)
      .map(a => ({ id: a.id })).ir,
    {
      selects: 2,
      oracle: 'SELECT id FROM (SELECT id, s FROM adv_s3 WHERE id != 2) WHERE toUInt64(s) > 0',
      label: '3b scan, bad row filtered out',
    },
  );

  expect(out.optimized.sql).toBe(
    'SELECT `__typedhouse_input`.`id` FROM (SELECT `id`, `s` FROM `adv_s3` WHERE `id` != {p0:UInt32}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`s` AS UInt64) > {p1:UInt64}',
  );

  expect(out.first).toEqual({
    meta: [{ name: 'id', type: 'UInt32' }],
    data: [{ id: 1 }, { id: 3 }],
  });

  // Bad row kept: both fail with CANNOT_PARSE_TEXT (6) in every cell.
  await agree(
    t
      .where(a => a.id.ne(1))
      .where(bad)
      .map(a => ({ id: a.id })).ir,
    { selects: 2, error: '6', label: '3b scan, bad row kept' },
  );

  // Fallible first: the cast sees every row in both forms (6), and the total filter above it is not AND-ed into its WHERE.
  const reversed = await agree(
    t
      .where(bad)
      .where(a => a.id.ne(2))
      .map(a => ({ id: a.id })).ir,
    { selects: 2, error: '6', label: '3b scan, fallible then total' },
  );

  expect(reversed.optimized.sql).toBe(
    'SELECT `__typedhouse_input`.`id` FROM (SELECT `id` FROM `adv_s3` WHERE CAST(`s` AS UInt64) > {p0:UInt64}) AS `__typedhouse_input` WHERE `__typedhouse_input`.`id` != {p1:UInt32}',
  ); // `s` is read by the inner WHERE only, so the derived list is pruned to `id`

  // A fallible filter alone is its block's first WHERE; a total pair still shares one WHERE.
  await agree(t.where(bad).map(a => ({ id: a.id })).ir, {
    selects: 1,
    error: '6',
    label: '3b scan, fallible alone',
  });

  await agree(
    t
      .where(a => a.s.ne('x'))
      .where(a => a.id.ne(2))
      .map(a => ({ id: a.id })).ir,
    {
      selects: 1,
      oracle: "SELECT id FROM adv_s3 WHERE s != 'x' AND id != 2",
      label: '3b scan, total pair',
    },
  );

  // Join block: the two-sided total residual stays in the join block's WHERE, the cast opens a derived table over the whole
  // block (its references re-qualified by the derived leaf names) and the direct selection folds above it.
  // Sums: (1,5) → 6, (2,25) → 27, (3,2) → 5, (3,40) → 43; the bad row is id 2.
  const j = join({ a: t, b: u }).on(x => x.a.id.eq(x.b.id));

  const jout = await agree(
    j
      .where(x => x.a.id.plus(x.b.v).ne(27n))
      .where(x => cast(x.a.s, col.UInt64).gt(0n))
      .map(x => ({ id: x.a.id })).ir,
    {
      selects: 3,
      oracle:
        'SELECT id FROM (SELECT a.id AS id, a.s AS s FROM adv_s3 AS a INNER JOIN adv_s3_other AS b ON a.id = b.id WHERE a.id + b.v != 27) WHERE toUInt64(s) > 0',
      label: '3b join, bad row filtered out',
    },
  );

  expect(jout.optimized.sql).toBe(
    'SELECT `__typedhouse_input`.`__typedhouse_leaf_0` AS `id` FROM (SELECT `a`.`id` AS `__typedhouse_leaf_0`, `a`.`s` AS `__typedhouse_leaf_3` FROM (SELECT `id`, `s` FROM `adv_s3`) AS `a` INNER ALL JOIN `adv_s3_other` AS `b` ON `a`.`id` = `b`.`id` WHERE (`a`.`id` + `b`.`v` != {p0:UInt64})) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`__typedhouse_leaf_3` AS UInt64) > {p1:UInt64}',
  );

  expect(jout.first).toEqual({
    meta: [{ name: 'id', type: 'UInt32' }],
    data: [{ id: 1 }, { id: 3 }, { id: 3 }],
  });

  await agree(
    j
      .where(x => x.a.id.plus(x.b.v).ne(5n))
      .where(x => cast(x.a.s, col.UInt64).gt(0n))
      .map(x => ({ id: x.a.id })).ir,
    { selects: 3, error: '6', label: '3b join, bad row kept' },
  );

  // Fallible first on the join block (its first WHERE), total two-sided filter above it: not AND-ed in, both fail (6).
  await agree(
    j
      .where(x => cast(x.a.s, col.UInt64).gt(0n))
      .where(x => x.a.id.plus(x.b.v).ne(27n))
      .map(x => ({ id: x.a.id })).ir,
    { selects: 3, error: '6', label: '3b join, fallible then total' },
  );
});

it('issue2: total scan projections under LIMIT have independent native row and metadata anchors', async () => {
  const q = t
    .where(a => a.id.eq(2))
    .map(a => ({ renamed: a.n.plus(1n), nullable: a.nn, flag: a.k.eq('b') }))
    .limit(1);

  const result = await agree(q.ir, {
    selects: 1,
    oracle:
      "SELECT n + toInt64(1) AS renamed, nn AS nullable, k = 'b' AS flag FROM adv_s3 WHERE id = 2 LIMIT 1",
  });

  expect(result.first).toEqual({
    meta: [
      { name: 'renamed', type: 'Int64' },
      { name: 'nullable', type: 'Nullable(String)' },
      { name: 'flag', type: 'UInt8' },
    ],
    data: [{ renamed: '21', nullable: null, flag: 1 }],
  });

  const offset = t
    .where(a => a.id.eq(2))
    .map(a => ({ renamed: a.n.plus(1n) }))
    .limit(1, 1);

  expect(
    (
      await agree(offset.ir, {
        oracle: 'SELECT n + toInt64(1) AS renamed FROM adv_s3 WHERE id = 2 LIMIT 1 OFFSET 1',
      })
    ).first.data,
  ).toEqual([]);
});

it('agent2 issue2: empty/nested caps and reordered/dropped outputs have independent anchors', async () => {
  const shared = val(7n, col.Int64);

  const projected = t
    .where(a => a.id.eq(2))
    .map(a => ({ value: a.n.plus(shared), twin: a.n.minus(shared), nullable: a.nn }));

  const cases = [
    [
      projected.limit(0, 1),
      'SELECT n + toInt64(7) AS value, n - toInt64(7) AS twin, nn AS nullable FROM adv_s3 WHERE id = 2 LIMIT 0 OFFSET 1',
    ],
    [
      projected.limit(1).limit(1, 1),
      'SELECT n + toInt64(7) AS value, n - toInt64(7) AS twin, nn AS nullable FROM adv_s3 WHERE id = 2 LIMIT 0',
    ],
    [
      projected.limit(0).limit(1),
      'SELECT n + toInt64(7) AS value, n - toInt64(7) AS twin, nn AS nullable FROM adv_s3 WHERE id = 2 LIMIT 0',
    ],
    [
      projected.limit(1).map(a => ({ nullable: a.nullable, twin: a.twin, value: a.value })),
      'SELECT nn AS nullable, n - toInt64(7) AS twin, n + toInt64(7) AS value FROM adv_s3 WHERE id = 2',
    ],
    [
      projected.limit(1).map(a => ({ nullable: a.nullable })),
      'SELECT nn AS nullable FROM adv_s3 WHERE id = 2',
    ],
    [
      t
        .where(a => a.id.eq(2))
        .map(a => ({ n: a.id, sibling: a.n }))
        .limit(1),
      'SELECT id AS n, original AS sibling FROM (SELECT id, n AS original FROM adv_s3 WHERE id = 2)',
    ],
  ] as const;

  for (const [q, oracle] of cases) {
    const a = compile(q.ir),
      b = emitNaive(q.ir);

    expect(a.params).toEqual(b.params);
    expect(a.parameterTypes).toEqual(b.parameterTypes);

    for (const settings of contract) {
      const expected = await execute(oracle, {}, settings);
      expect(expected.error).toBeUndefined();
      expect(await execute(a.sql, a.params, settings)).toEqual(expected);
      expect(await execute(b.sql, b.params, settings)).toEqual(expected);
    }
  }
});

it('final agent2 LIMIT: tuple/LowCardinality/constant metadata and shared consumers match independent SQL', async () => {
  const filtered = t.where(a => a.id.eq(2));
  const projected = filtered.map(a => ({ v: a.n.plus(7n) }));

  const rich = filtered.map(a => ({
    text: a.lc.ifNull(a.k),
    tupleField: a.tup.element('b'),
    parts: a.parts.element('id'),
    nil: val(null, col.Nullable(col.String)),
    fixed: val(9n, col.Int64),
  }));

  const cases = [
    [
      rich.limit(1),
      "SELECT toLowCardinality(ifNull(lc, k)) AS text, tupleElement(tup, 'b') AS tupleField, tupleElement(parts, 'id') AS parts, CAST(NULL AS Nullable(String)) AS nil, toInt64(9) AS fixed FROM adv_s3 WHERE id = 2 LIMIT 1",
    ],
    [
      rich.limit(0, Number.MAX_SAFE_INTEGER),
      "SELECT toLowCardinality(ifNull(lc, k)) AS text, tupleElement(tup, 'b') AS tupleField, tupleElement(parts, 'id') AS parts, CAST(NULL AS Nullable(String)) AS nil, toInt64(9) AS fixed FROM adv_s3 WHERE id = 2 LIMIT 0",
    ],
    [
      unionAll(projected.limit(1), projected.limit(1, 1)),
      'SELECT n + toInt64(7) AS v FROM adv_s3 WHERE id = 2',
    ],
    [
      unionAll(
        filtered.map(a => ({ v: a.n.plus(7n) })).limit(1),
        filtered.map(a => ({ v: a.n.minus(7n) })).limit(1),
      ),
      'SELECT n + toInt64(7) AS v FROM adv_s3 WHERE id = 2 UNION ALL SELECT n - toInt64(7) AS v FROM adv_s3 WHERE id = 2',
    ],
    [
      unionAll(
        t
          .where(a => a.id.eq(1))
          .map(a => ({ v: a.n.plus(7n) }))
          .limit(1),
        t
          .where(a => a.id.eq(2))
          .map(a => ({ v: a.n.minus(7n) }))
          .limit(1),
      ),
      'SELECT n + toInt64(7) AS v FROM adv_s3 WHERE id = 1 UNION ALL SELECT n - toInt64(7) AS v FROM adv_s3 WHERE id = 2',
    ],
    [
      filtered.map(a => ({ id: a.id.plus(1), original: a.alias_id, stored: a.mat_id })).limit(1),
      'SELECT id + toUInt32(1) AS id, original, stored FROM (SELECT id, alias_id AS original, mat_id AS stored FROM adv_s3 WHERE id = 2)',
    ],
  ] as const;

  for (const [index, [query, oracle]] of cases.entries()) {
    const a = compile(query.ir),
      b = emitNaive(query.ir);

    expect(a.columns).toEqual(b.columns);
    if (index < 2) expect(a.sql.match(/SELECT /g)).toHaveLength(1);
    if (index >= 2 && index <= 4) expect(a.sql).toContain('WITH');

    for (const settings of contract) {
      const expected = await execute(oracle, {}, settings);
      expect(expected.error, oracle).toBeUndefined();

      expect(
        await execute(a.sql, a.params, settings),
        JSON.stringify({ index, settings, sql: a.sql }),
      ).toEqual(expected);

      expect(
        await execute(b.sql, b.params, settings),
        JSON.stringify({ index, settings, sql: b.sql }),
      ).toEqual(expected);
    }
  }
});

// One physical row per selected id makes LIMIT deterministic without relying on scan order.
// Expansion recipes retain every expanded row. Error comparisons below are bounded fixture
// regressions, not a general strengthening of the results-only compiler contract.
const limitRecipes = fc.record({
  shape: fc.integer({ min: 0, max: 9 }),
  id: fc.integer({ min: 1, max: 3 }),
  increment: fc.integer({ min: -10, max: 10 }),
  offset: fc.integer({ min: 0, max: 2 }),
  setting: fc.integer({ min: 0, max: 7 }),
});

it('issue2: 500 LIMIT recipes cover total folds and retained scopes with native metadata and errors', async () => {
  const shapes = new Set<number>(),
    settingsSeen = new Set<number>(),
    outcomes = new Set<string>();

  let folded = 0,
    fenced = 0;

  const result = await fc.check(
    fc.asyncProperty(limitRecipes, async r => {
      const source = t.where(a => a.id.eq(r.id));
      const shared = val(BigInt(r.increment), col.Int64);

      const simple = source.map(a => ({
        v: a.n.plus(shared),
        sibling: a.n.minus(shared),
        nullable: a.nn,
      }));

      const q =
        r.shape === 0
          ? simple.limit(1, r.offset)
          : r.shape === 1
            ? source.map(a => ({ renamed: a.id, nullable: a.nn })).limit(1, r.offset)
            : r.shape === 2
              ? source
                  .map(a => ({ n: a.n.plus(shared), nullable: a.nn.ifNull('missing') }))
                  .limit(1, r.offset)
              : r.shape === 3
                ? simple.cte().limit(1, r.offset)
                : r.shape === 4
                  ? simple.orderBy(a => a.v).limit(1, r.offset)
                  : r.shape === 5
                    ? simple.distinct().limit(1, r.offset)
                    : r.shape === 6
                      ? source.map(a => ({ v: cast(a.s, col.UInt64) })).limit(3)
                      : r.shape === 7
                        ? source
                            .map(a => ({ v: sql`intDiv(${a.n}, ${a.n.minus(20n)})`.as(col.Int64) }))
                            .limit(3)
                        : r.shape === 8
                          ? source
                              .leftArrayJoin(a => a.ids, 'element')
                              .map(a => ({ v: a.id, element: a.element }))
                              .limit(10)
                          : simple.limit(3).limit(1, r.offset);

      const a = compile(q.ir),
        b = emitNaive(q.ir),
        settings = contract[r.setting]!;

      const actual = await execute(a.sql, a.params, settings),
        expected = await execute(b.sql, b.params, settings);

      expect(a.columns).toEqual(b.columns);
      expect(Object.values(a.params).sort()).toEqual(Object.values(b.params).sort());
      expect(actual, JSON.stringify({ r, optimized: a.sql, naive: b.sql })).toEqual(expected);

      if (r.shape < 3) {
        expect(a.sql.match(/SELECT /g)?.length).toBe(1);

        const items =
          r.shape === 0
            ? `n + toInt64(${r.increment}) AS v, n - toInt64(${r.increment}) AS sibling, nn AS nullable`
            : r.shape === 1
              ? 'id AS renamed, nn AS nullable'
              : `n + toInt64(${r.increment}) AS n, ifNull(nn, 'missing') AS nullable`;

        expect(actual).toEqual(
          await execute(
            `SELECT ${items} FROM adv_s3 WHERE id = ${r.id} LIMIT 1 OFFSET ${r.offset}`,
            {},
            settings,
          ),
        );

        folded++;
      } else {
        expect(a.sql.match(/SELECT /g)!.length).toBeGreaterThan(1);
        fenced++;
      }

      if ((r.shape === 6 || r.shape === 7) && r.id === 2)
        expect(actual.error).toBe(r.shape === 6 ? '6' : '153');
      else expect(actual.error).toBeUndefined();

      shapes.add(r.shape);
      settingsSeen.add(r.setting);
      outcomes.add(actual.error ?? 'rows');
    }),
    { seed: 20261205, numRuns: 500 },
  );

  if (result.failed)
    throw new Error(
      `seed=${result.seed} path=${result.counterexamplePath} shrinks=${result.numShrinks}\n${String(result.errorInstance)}`,
    );

  expect(result.numRuns).toBe(500);
  expect(shapes.size).toBe(10);
  expect(settingsSeen.size).toBe(8);
  expect(folded).toBeGreaterThan(100);
  expect(fenced).toBeGreaterThan(250);
  expect([...outcomes].sort()).toEqual(['153', '6', 'rows']);

  console.info('project-limit differential', {
    runs: result.numRuns,
    seed: result.seed,
    shapes: shapes.size,
    folded,
    fenced,
    outcomes: [...outcomes].sort(),
  });
}, 120000);

it('issue2: removing the folded OFFSET is detected, genuinely shrunk and replayed', async () => {
  const property = fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async offset => {
    const root = t
      .where(a => a.id.eq(1))
      .map(a => ({ renamed: a.n.plus(1n) }))
      .limit(1, offset).ir;

    const a = compile(root),
      b = emitNaive(root);

    expect(a.sql.match(/SELECT /g)?.length).toBe(1);
    const faulty = a.sql.replace(/ OFFSET [0-9]+$/, '');
    expect(faulty).not.toBe(a.sql);
    expect(await execute(faulty, a.params)).toEqual(await execute(b.sql, b.params));
  });

  const result = await fc.check(property, { seed: 20261205, numRuns: 500 });
  expect(result.failed).toBe(true);
  expect(result.numShrinks).toBeGreaterThan(0);

  const replay = await fc.check(property, {
    seed: result.seed,
    path: result.counterexamplePath!,
    numRuns: 500,
  });

  expect(replay.failed).toBe(true);
  expect(replay.counterexample).toEqual(result.counterexample);

  console.info('project-limit fault', {
    seed: result.seed,
    shrinks: result.numShrinks,
    path: result.counterexamplePath,
  });
}, 120000);

it('records old-analyzer (allow_experimental_analyzer = 0) behaviour, outside the spec contract', () => {
  console.info(
    'slice3 probe: old analyzer disagreements',
    legacyNotes.length ? legacyNotes : 'none',
  );
});
