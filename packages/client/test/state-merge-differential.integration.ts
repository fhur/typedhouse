import { afterAll, beforeAll, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClient } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClickHouseBackend, createClientFromBackend } from '../src/index.js';
import { collect, differential, keys } from './backend-harness.js';
import {
  build,
  dimRows,
  lateRows,
  normalize,
  oracle,
  recipes,
  repeatedParts,
  ROLLUP_COLUMNS,
  seed,
  STATE_SELECT,
  uniqueParts,
  type Recipe,
  type Row,
} from './state-merge-arbitrary.js';

/** D3: states over a multi-part aggregating fixture. Naive and optimized must return the same rows and types, on both
 * alias settings, and equal a JavaScript model. */
let container: StartedTestContainer;

let driver: ReturnType<typeof createClient>;

const defaults: ReturnType<typeof createClickHouseBackend>[] = [];

const prefers: ReturnType<typeof createClickHouseBackend>[] = [];

const LATE_COLUMNS =
  'tenant String, seq UInt32, cat String, tags Array(String), v UInt32, maybe Nullable(UInt32), w String, f Float64';

const q = (s: string) => `'${s}'`;

const rowsOf = (row: Omit<Row, 'values'>, value: Row['values'][number]) =>
  `(${q(row.tenant)},${row.seq},${q(row.cat)},[${row.tags.map(q).join(',')}],${value.v},${value.maybe ?? 'NULL'},${q(value.w)},${value.f})`;

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

  const options = {
    url: `http://${container.getHost()}:${container.getMappedPort(8123)}`,
    username: 'fixture',
    password: 'fixture',
    max_open_connections: 4,
    clickhouse_settings: { max_threads: 1 },
  };

  driver = createClient(options);

  for (const mode of ['clickhouse-naive', 'clickhouse'] as const) {
    defaults.push(createClickHouseBackend(options, mode));

    prefers.push(
      createClickHouseBackend(
        {
          ...options,
          clickhouse_settings: { max_threads: 1, prefer_column_name_to_alias: 1 },
        },
        mode,
      ),
    );
  }

  await driver.command({
    query: `CREATE TABLE fx_late (${LATE_COLUMNS}) ENGINE = MergeTree ORDER BY (tenant, seq)`,
  });

  await driver.command({
    query: `INSERT INTO fx_late VALUES ${lateRows.map(r => rowsOf(r, r)).join(',')}`,
  });

  await driver.command({
    query: 'CREATE TABLE fx_dim (tenant String, title String) ENGINE = MergeTree ORDER BY tenant',
  });

  await driver.command({
    query: `INSERT INTO fx_dim VALUES ${dimRows.map(d => `(${q(d.tenant)},${q(d.title)})`).join(',')}`,
  });

  for (const [name, parts] of [
    ['fx_unique', uniqueParts],
    ['fx_repeated', repeatedParts],
  ] as const) {
    await driver.command({
      query: `CREATE TABLE ${name} (${ROLLUP_COLUMNS}) ENGINE = AggregatingMergeTree ORDER BY (tenant, seq)`,
    });

    await driver.command({ query: `SYSTEM STOP MERGES ${name}` });

    for (const part of parts) {
      const values = part.flatMap(row => row.values.map(v => rowsOf(row, v)));

      await driver.command({
        query: `INSERT INTO ${name} SELECT tenant, seq, cat, tags, ${STATE_SELECT}
          FROM format(Values, '${LATE_COLUMNS}', ${q(values.join(',').replaceAll("'", "\\'"))})
          GROUP BY tenant, seq, cat, tags`,
      });
    }
  }
}, 180000);

afterAll(async () => {
  for (const backend of [...defaults, ...prefers]) await backend.close();
  await driver?.close();
  await container?.stop();
});

it('the fixture is multi-part with stored rows above distinct keys on the repeated table', async () => {
  const result = await driver.query({
    query: `SELECT (SELECT count() FROM system.parts WHERE table = 'fx_repeated' AND active) AS parts,
      (SELECT count() FROM fx_repeated) AS stored, (SELECT uniqExact(tenant, seq) FROM fx_repeated) AS distinct_keys`,
    format: 'JSONEachRow',
  });

  const [row] = await result.json<{ parts: number; stored: string; distinct_keys: string }>();
  expect(Number(row!.parts)).toBe(4);
  expect(Number(row!.stored)).toBeGreaterThan(Number(row!.distinct_keys));
});

it('finalizeAggregation row count: 3 stored rows for 2 days, as the design note measured', async () => {
  await driver.command({
    query:
      'CREATE TABLE fx_days (day Date, total AggregateFunction(sum, UInt64)) ENGINE = AggregatingMergeTree ORDER BY day',
  });

  await driver.command({ query: 'SYSTEM STOP MERGES fx_days' });

  await driver.command({
    query:
      "INSERT INTO fx_days SELECT toDate('2024-01-01') + number, sumState(toUInt64(1)) FROM numbers(2) GROUP BY number",
  });

  await driver.command({
    query: "INSERT INTO fx_days SELECT toDate('2024-01-01'), sumState(toUInt64(1))",
  });

  const result = await driver.query({
    query: 'SELECT count() AS c FROM (SELECT finalizeAggregation(total) FROM fx_days)',
    format: 'JSONEachRow',
  });

  expect(await result.json()).toEqual([{ c: '3' }]);
});

const tally = new Map<string, number>();

const note = (label: string) => tally.set(label, (tally.get(label) ?? 0) + 1);

async function check(recipe: Recipe) {
  const query = build(recipe);
  const expected = keys(query, oracle(recipe));

  for (const [label, backends] of [
    ['default', defaults],
    ['prefer', prefers],
  ] as const) {
    // Runs naive first, then optimized, and compares rows and output descriptors.
    const rows = await differential(backends, query);
    expect(keys(query, rows), `${label} against the model`).toEqual(expected);
  }

  const n = normalize(recipe);
  note(`source:${n.source}`);
  note(`tail:${n.tail}`);
  note(`final:${n.final}`);
  note(`table:${n.repeated ? 'repeated' : 'unique'}`);
  for (const o of n.ops) note(`op:${o.op}`);
}

it('naive, optimized and the model agree over states', async () => {
  await fc.assert(fc.asyncProperty(recipes, check), { seed, numRuns: 400, endOnFailure: true });

  for (const label of [
    'source:rollup',
    'source:final',
    'source:prewhere',
    'source:cte',
    'source:selfUnion',
    'source:fresh',
    'source:sharedJoin',
    'tail:dimJoin',
    'tail:dimLeft',
    'final:total',
    'final:byTenant',
    'final:having',
    'final:sortedLimit',
    'final:count',
    'final:keys',
    'final:twoLevel',
    'final:partial',
    'op:whereTenant',
    'op:whereSeq',
    'op:whereCat',
    'op:rename',
    'op:mapPlain',
    'op:arrayJoin',
    'op:limit',
    'op:limitBy',
    'op:cte',
    'table:repeated',
    'table:unique',
  ])
    expect(tally.get(label) ?? 0, label).toBeGreaterThanOrEqual(5);
}, 300000);

it('a sample of the recipes through the client facade, run and stream, on both emitters', async () => {
  const samples = fc.sample(recipes, { seed: seed + 1, numRuns: 40 });

  for (const recipe of samples) {
    const query = build(recipe);
    const expected = keys(query, oracle(recipe));

    for (const backend of defaults) {
      const client = createClientFromBackend(backend);
      expect(keys(query, await client.run(query)), JSON.stringify(recipe)).toEqual(expected);

      expect(keys(query, await collect(client.stream(query))), JSON.stringify(recipe)).toEqual(
        expected,
      );
    }
  }
}, 120000);
