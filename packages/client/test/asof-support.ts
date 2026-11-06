import { ClickHouseLogLevel, createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait } from 'testcontainers';
import { col, table, type Caps, type Rel } from '@typedhouse/core';
import { createClickHouseBackend, createClient, QueryError } from '../src/index.js';

/** D10 Tester harness: one server per version, the two paths, and a JavaScript ASOF model.
 * `ASOF_TEST_URL_24_8`-style variables reuse a running server while iterating. */
export type Version = '24.3' | '24.8' | '26.10';

export async function startServer(version: Version) {
  const reuse = process.env[`ASOF_TEST_URL_${version.replace('.', '_')}`];
  if (reuse) return { url: reuse, stop: async () => undefined };

  const server = await new GenericContainer(`clickhouse/clickhouse-server:${version}`)
    .withEnvironment({ CLICKHOUSE_SKIP_USER_SETUP: '1', CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1' })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forResponsePredicate(body => body === 'Ok.\n'))
    .start();

  return {
    url: `http://${server.getHost()}:${server.getMappedPort(8123)}`,
    stop: async () => void (await server.stop()),
  };
}

export type Settings = Record<string, string | number>;

export function connect(url: string, settings: Settings = {}, database?: string) {
  const options = {
    url,
    ...(database ? { database } : {}),
    clickhouse_settings: settings as never,
    log: { level: ClickHouseLogLevel.OFF },
  };

  const admin = createDriver(options),
    optimized = createClient(options),
    naive = createClickHouseBackend(options, 'clickhouse-naive');

  return {
    admin,
    optimized,
    naive,
    close: async () => {
      await admin.close();
      await optimized.close();
      await naive.close();
    },
    json: async (query: string, extra: Settings = {}, query_params: Record<string, unknown> = {}) =>
      (await (
        await admin.query({
          query,
          query_params,
          format: 'JSON',
          clickhouse_settings: { output_format_json_quote_64bit_integers: 0, ...extra } as never,
        })
      ).json()) as { data: Record<string, unknown>[]; meta: { name: string; type: string }[] },
  };
}

export type Connection = ReturnType<typeof connect>;

export type Executable<R = unknown> = {
  readonly ir: Rel;
  readonly _rowType: R;
  readonly caps: Caps;
};

export const canonical = (rows: readonly unknown[]) =>
  rows
    .map(row => JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)))
    .sort();

/** One result per path: optimized run, optimized stream, naive run, naive stream. */
export async function paths<R>(c: Connection, q: Executable<R>) {
  const streamed: unknown[] = [];
  for await (const row of c.optimized.stream(q)) streamed.push(row);
  const plan = c.naive.compile(q.ir);
  const naiveStreamed: unknown[] = [];
  for await (const batch of c.naive.run(plan)) naiveStreamed.push(...batch);

  return {
    run: (await c.optimized.run(q)) as unknown[],
    stream: streamed,
    naiveRun: await c.naive.runBuffered(plan),
    naiveStream: naiveStreamed,
  };
}

export const serverCode = (e: unknown) => {
  if (!(e instanceof QueryError)) return `not a QueryError: ${String(e)}`;
  return String((e.cause as { code?: unknown }).code);
};

/** One failure shape per path: the code of the QueryError each path raises, or 'ok'. */
export async function failures<R>(c: Connection, q: Executable<R>) {
  const attempt = async (f: () => Promise<unknown>) =>
    f().then(
      () => 'ok',
      (e: unknown) => serverCode(e),
    );

  const plan = c.naive.compile(q.ir);

  return {
    run: await attempt(() => c.optimized.run(q)),
    stream: await attempt(async () => {
      for await (const _ of c.optimized.stream(q));
    }),
    naiveRun: await attempt(() => c.naive.runBuffered(plan)),
    naiveStream: await attempt(async () => {
      for await (const _ of c.naive.run(plan));
    }),
  };
}

/** Deterministic generator, so a failure repeats. */
export function prng(seed: number) {
  let s = seed >>> 0;

  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % n;
  };
}

export type Op = 'ge' | 'gt' | 'le' | 'lt';

export const opSql = { ge: '>=', gt: '>', le: '<=', lt: '<' } as const;

/** The closest right row of one left row among rows sharing the key, for `left op right`. */
export function closest<R extends { ts: number }>(
  key: number,
  rights: readonly R[],
  op: Op,
): R | undefined {
  const usable = rights.filter(r =>
    op === 'ge' ? key >= r.ts : op === 'gt' ? key > r.ts : op === 'le' ? key <= r.ts : key < r.ts,
  );

  return usable.reduce<R | undefined>(
    (best, r) =>
      !best || (op === 'ge' || op === 'gt' ? r.ts > best.ts : r.ts < best.ts) ? r : best,
    undefined,
  );
}

// The shared seeded pair: 3 parts each, right (sym, ts) unique, so no tied row.
export const left = table(
  'asof_left',
  {
    id: col.UInt32,
    sym: col.String,
    ts: col.DateTime('UTC'),
    s: col.String,
    n: col.Nullable(col.UInt32),
  },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

export const right = table(
  'asof_right',
  {
    rid: col.UInt32,
    sym: col.String,
    ts: col.DateTime('UTC'),
    flag: col.UInt8,
    v: col.UInt32,
    nv: col.Nullable(col.Int32),
  },
  { engine: 'MergeTree', sortingKey: ['sym', 'ts'], partitionKey: [] },
);

export interface LeftRow {
  id: number;
  sym: string;
  ts: number;
  s: string;
  n: number | null;
}

export interface RightRow {
  rid: number;
  sym: string;
  ts: number;
  flag: number;
  v: number;
  nv: number | null;
}

const syms = ['A', 'B', 'C', 'D', 'E', 'Z'];

export function seededRows(seed = 20261106) {
  const next = prng(seed);

  const lefts: LeftRow[] = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    sym: syms[next(6)]!,
    ts: 1000 + next(2000),
    s: String(next(1000)),
    n: next(4) === 0 ? null : next(100),
  }));

  const seen = new Set<string>();
  const rights: RightRow[] = [];

  for (let i = 0; rights.length < 500; i++) {
    const sym = syms[next(5)]!,
      ts = 1000 + next(2000);

    if (seen.has(`${sym}:${ts}`)) continue;
    seen.add(`${sym}:${ts}`);

    rights.push({
      rid: rights.length + 1,
      sym,
      ts,
      flag: next(2),
      v: next(1000),
      nv: next(4) === 0 ? null : next(100) - 50,
    });
  }

  return { lefts, rights };
}

const stamp = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');

export async function seed(c: Connection) {
  const { lefts, rights } = seededRows();

  await c.admin.command({
    query: `CREATE TABLE IF NOT EXISTS asof_left (id UInt32, sym String, ts DateTime('UTC'), s String, n Nullable(UInt32))
            ENGINE = MergeTree ORDER BY id SETTINGS allow_nullable_key = 0`,
  });

  await c.admin.command({
    query: `CREATE TABLE IF NOT EXISTS asof_right (rid UInt32, sym String, ts DateTime('UTC'), flag UInt8, v UInt32, nv Nullable(Int32))
            ENGINE = MergeTree ORDER BY (sym, ts)`,
  });

  await c.admin.command({ query: 'TRUNCATE TABLE asof_left' });
  await c.admin.command({ query: 'TRUNCATE TABLE asof_right' });

  const parts = <T>(rows: readonly T[]) => [0, 1, 2].map(p => rows.filter((_, i) => i % 3 === p));

  for (const values of parts(lefts))
    await c.admin.insert({
      table: 'asof_left',
      format: 'JSONEachRow',
      values: values.map(r => ({ ...r, ts: stamp(r.ts) })),
    });

  for (const values of parts(rights))
    await c.admin.insert({
      table: 'asof_right',
      format: 'JSONEachRow',
      values: values.map(r => ({ ...r, ts: stamp(r.ts) })),
    });

  return { lefts, rights };
}
