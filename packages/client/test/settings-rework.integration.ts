import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient as createDriver } from '@clickhouse/client';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import {
  col,
  count,
  from,
  sql,
  table,
  unionAll,
  type QuerySettings,
  type Rel,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { createClickHouseBackend, createClient, QueryError, rowDecoder } from '../src/index.js';
import { outputSettings } from '../src/backend.js';

/** Tester, SETTINGS rework: row decoding through stream() against an independent parse of the
 * raw HTTP body, data that looks like an error, cleanup, truncation behind a proxy, and limits. */
const TYPES = `id UInt32, u64 UInt64, i64 Int64, i128 Int128, u256 UInt256, dec Decimal(38, 10), f Float64,
  f32 Float32, nf Nullable(Float64), s String, ns Nullable(String), lc LowCardinality(String), fs FixedString(4),
  d Date, d32 Date32, dt DateTime('UTC'), dt64 DateTime64(3, 'UTC'), uuid UUID, b Bool, au Array(UInt64),
  an Array(Nullable(UInt64)), aa Array(Array(String)), tp Tuple(a UInt64, b String), mp Map(String, UInt64)`;

const every = table(
  'r_types',
  {
    id: col.UInt32,
    u64: col.UInt64,
    i64: col.Int64,
    i128: col.Int128,
    u256: col.UInt256,
    dec: col.Decimal(38, 10),
    f: col.Float64,
    f32: col.Float32,
    nf: col.Nullable(col.Float64),
    s: col.String,
    ns: col.Nullable(col.String),
    lc: col.LowCardinality(col.String),
    fs: col.FixedString(4),
    d: col.Date,
    d32: col.Date32,
    dt: col.DateTime('UTC'),
    dt64: col.DateTime64(3, 'UTC'),
    uuid: col.UUID,
    b: col.Bool,
    au: col.Array(col.UInt64),
    an: col.Array(col.Nullable(col.UInt64)),
    aa: col.Array(col.Array(col.String)),
    tp: col.Tuple({ a: col.UInt64, b: col.String }),
    mp: col.Map(col.String, col.UInt64),
  },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const wide = table(
  'r_wide',
  { id: col.UInt32, s: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const big = table(
  'r_big',
  { id: col.UInt64, s: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const texts = table(
  'r_texts',
  { id: col.UInt32, exception: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const mismatch = table(
  'r_texts',
  { id: col.UInt32, exception: col.UInt64 },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const STRINGS = [
  "''",
  "'Code: 396. DB::Exception: x'",
  "'a\\nCode: 396. DB::Exception: y'",
  "'\\r\\n__exception__\\r\\n'",
  "'😀é日本語'",
  "'\\0'",
  `'{"exception":"z"}'`,
  "'\\\\'",
  "unhex('FF41')",
];

const FLOATS = ['nan', 'inf', '-inf', '-0.', '1.7976931348623157e308', '0.1'];

let server: StartedTestContainer;

let url: string;

let admin: ReturnType<typeof createDriver>;

let client: ReturnType<typeof createClient>;

let naive: ReturnType<typeof createClickHouseBackend>;

type Query<R> = { readonly ir: Rel; readonly _rowType: R; readonly caps: { live: false } };

async function collect<R>(rows: AsyncIterable<R>): Promise<R[]> {
  const out: R[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

const canonical = (rows: readonly unknown[]) =>
  JSON.stringify(rows, (_key, value: unknown) =>
    typeof value === 'bigint'
      ? `bigint:${value}`
      : typeof value === 'number' && !Number.isFinite(value)
        ? `number:${value}`
        : Object.is(value, -0)
          ? 'number:-0'
          : value,
  );

/** No driver: the HTTP body split on newlines, then parsed and decoded. */
async function rawRows(query: { readonly ir: Rel }) {
  const compiled = compile(query.ir);
  const target = new URL(url);

  for (const [key, value] of Object.entries(outputSettings))
    target.searchParams.set(key, String(value));

  for (const [key, value] of Object.entries(compiled.params))
    target.searchParams.set(`param_${key}`, value);

  const response = await fetch(target, {
    method: 'POST',
    body: `${compiled.sql} FORMAT JSONEachRow`,
  });

  const body = Buffer.from(await response.arrayBuffer());
  const decode = rowDecoder(compiled.columns, compiled.columnPaths);
  const rows: unknown[] = [];
  let start = 0;

  for (let end = body.indexOf(10); end >= 0; end = body.indexOf(10, start)) {
    rows.push(decode(JSON.parse(body.subarray(start, end).toString())));
    start = end + 1;
  }

  return rows;
}

const classify = async (run: () => Promise<number>, expected: number) => {
  try {
    const rows = await run();
    return rows === expected ? 'full' : `wrong row count ${rows}`;
  } catch (error) {
    if (!(error instanceof QueryError)) return `not a QueryError: ${String(error)}`;
    const cause = error.cause as { code?: unknown; message?: unknown };
    return cause.code === undefined ? `no code: ${String(cause.message)}` : String(cause.code);
  }
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

  url = `http://${server.getHost()}:${server.getMappedPort(8123)}`;
  admin = createDriver({ url });

  const floats = FLOATS.map(text => `CAST('${text}' AS Float64)`).join(',');

  for (const query of [
    `CREATE TABLE r_types (${TYPES}) ENGINE = MergeTree ORDER BY id`,
    `INSERT INTO r_types SELECT number, 18446744073709551615 - number, -9223372036854775808 + number,
       toInt128('-170141183460469231731687303715884105728') + number,
       toUInt256('115792089237316195423570985008687907853269984665640564039457584007913129639935') - number,
       toDecimal128('1234567890123456789012345678.1234567891', 10), arrayElement([${floats}], number % ${FLOATS.length} + 1),
       toFloat32(number) / 3, if(number % 3 = 0, NULL, number / 7), arrayElement([${STRINGS.join(',')}], number % ${STRINGS.length} + 1),
       if(number % 2 = 0, NULL, 'n'), toString(number % 3), 'ab\\0\\0', toDate('2024-01-01') + number, toDate32('1900-01-01') + number,
       toDateTime('2024-01-01 00:00:00', 'UTC') + number, toDateTime64('2024-01-01 00:00:00.123', 3, 'UTC') + number,
       generateUUIDv4(), number % 2 = 0, [18446744073709551615, number], [NULL, number], [['x', '😀'], []], (number, 't'),
       map('k', number) FROM numbers(2000)`,
    'CREATE TABLE r_wide (id UInt32, s String) ENGINE = MergeTree ORDER BY id',
    `INSERT INTO r_wide SELECT number, repeat(repeat('😀é日', 100000), 20) FROM numbers(2)`,
    `INSERT INTO r_wide SELECT number + 10, repeat('é', number % 70000 + 1) FROM numbers(3000)`,
    'CREATE TABLE r_big (id UInt64, s String) ENGINE = MergeTree ORDER BY id',
    `INSERT INTO r_big SELECT number, repeat('x', 50) FROM numbers(1000000)`,
    'CREATE TABLE r_texts (id UInt32, exception String) ENGINE = MergeTree ORDER BY id',
    `INSERT INTO r_texts SELECT number, arrayElement([${STRINGS.join(',')}], number % ${STRINGS.length} + 1) FROM numbers(${STRINGS.length})`,
  ])
    await admin.command({ query });

  client = createClient({ url, request_timeout: 120000 });
  naive = createClickHouseBackend({ url, request_timeout: 120000 }, 'clickhouse-naive');
}, 180000);

afterAll(async () => {
  await client?.close();
  await naive?.close();
  await admin?.close();
  await server?.stop();
});

describe('rows through stream() equal an independent parse of the body', () => {
  const shapes = [
    ['every type', () => from(every).orderBy(r => r.id)],
    ['no rows', () => from(every).where(r => r.id.gt(99999))],
    ['rows of 18 MB and multi-byte text across chunks', () => from(wide).orderBy(r => r.id)],
  ] as const;

  it.each(shapes)('%s', async (_name, build) => {
    const query = build() as unknown as Query<unknown>;
    const expected = await rawRows(query);
    expect(canonical(await client.run(query))).toBe(canonical(expected));
    expect(canonical(await collect(client.stream(query)))).toBe(canonical(expected));
  });

  it('the fixture has what it claims', async () => {
    const rows = await client.run(
      from(every)
        .orderBy(r => r.id)
        .limit(6),
    );

    expect(rows.map(row => String(row.f))).toEqual([
      'NaN',
      'Infinity',
      '-Infinity',
      '0',
      '1.7976931348623157e+308',
      '0.1',
    ]);

    expect(Object.is(rows[3]!.f, -0)).toBe(true);
    expect(rows[0]!.u64).toBe(18446744073709551615n);
    expect(rows[0]!.dec).toBe('1234567890123456789012345678.1234567891');
    expect(rows[0]!.fs).toBe('ab\0\0');
    expect(rows[0]!.tp).toEqual({ a: 0n, b: 't' });
    const large = await client.run(from(wide).limit(1));
    expect(large[0]!.s.length).toBe(8_000_000);
  });
});

describe('error text in data stays data', () => {
  it('in any column, including one named exception, on run and stream', async () => {
    const query = from(texts).orderBy(r => r.id);
    const rows = await client.run(query);
    expect(rows).toHaveLength(STRINGS.length);
    expect(rows[1]!.exception).toBe('Code: 396. DB::Exception: x');
    expect(rows[2]!.exception).toBe('a\nCode: 396. DB::Exception: y');
    expect(rows[3]!.exception).toBe('\r\n__exception__\r\n');
    expect(canonical(await collect(client.stream(query)))).toBe(canonical(rows));
  });

  it('a multi-line server message with braces and quotes keeps its code after rows', async () => {
    const shape = from(big).map(r => ({
      id: r.id,
      v: sql`throwIf(${r.id} > 500000, 'a\nCode: 1. b {"x":1} ''q''')`.as(col.UInt8),
    }));

    const settled = shape.settings({ max_threads: 1 });

    for (const run of [
      () => client.run(settled).then(rows => rows.length),
      () => collect(client.stream(settled)).then(rows => rows.length),
    ])
      expect(await classify(run, 1_000_000)).toBe('395');
  });
});

describe('cancellation and cleanup, on one connection', () => {
  let one: ReturnType<typeof createClient>;

  beforeAll(() => {
    one = createClient({ url, max_open_connections: 1, request_timeout: 20000 });
  });

  afterAll(async () => {
    await one.close();
  });

  const settled = from(big).settings({ max_result_rows: 100_000 });

  const failingDecode = from(mismatch);

  it.each([
    [
      'stream abandoned after one row',
      async () => {
        for await (const _ of one.stream(from(big))) break;
      },
    ],
    [
      'stream returned by hand',
      async () => {
        const rows = one.stream(from(big));
        await rows.next();
        await rows.return();
      },
    ],
    ['run failing mid-body', () => one.run(settled).catch(() => undefined)],
    ['stream failing mid-body', () => collect(one.stream(settled)).catch(() => undefined)],
    ['run failing to decode', () => one.run(failingDecode).catch(() => undefined)],
    ['stream failing to decode', () => collect(one.stream(failingDecode)).catch(() => undefined)],
  ] as const)('%s, 20 times, leaves the connection usable', async (_name, attempt) => {
    for (let i = 0; i < 20; i++) await attempt();
    expect(await one.run(from(big).limit(1))).toHaveLength(1);
  });

  it('the server has nothing left running', async () => {
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await admin.query({
      query: `SELECT count() AS n FROM system.processes WHERE query LIKE '%r_big%' AND query NOT LIKE '%system.processes%'`,
      format: 'JSONEachRow',
    });

    expect(await result.json()).toEqual([{ n: '0' }]);
  });
});

describe('a killed query is an error, not a short result', () => {
  it('KILL QUERY mid-stream raises code 394', async () => {
    const tag = 'r_kill_me';
    let rows = 0;
    const slow = from(big).settings({ log_comment: tag, max_block_size: 1000 });

    const outcome = await (async () => {
      for await (const _ of client.stream(slow)) {
        rows++;

        if (rows === 50000)
          await admin.command({
            query: `KILL QUERY WHERE query LIKE '%${tag}%' AND query NOT LIKE '%KILL%' ASYNC`,
          });
      }

      return 'ended normally';
    })().catch((error: unknown) => (error as QueryError).cause as { code?: unknown });

    expect(outcome).toMatchObject({ code: '394' });
    expect(rows).toBeLessThan(1_000_000);
  });
});

describe('a local proxy between the client and a real server', () => {
  type Fault =
    'reset mid-line' | 'reset at a line end' | 'clean end mid-line' | 'clean end at a line end';

  let fault: Fault = 'reset mid-line';

  let proxy: Server;

  let proxied: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const target = new URL(url);

    proxy = createServer((incoming, outgoing) => {
      const body: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => body.push(chunk));

      incoming.on('end', () => {
        const upstream = httpRequest(
          {
            host: target.hostname,
            port: target.port,
            path: incoming.url,
            method: incoming.method,
            headers: { ...incoming.headers, host: target.host },
          },
          response => {
            const headers = { ...response.headers };
            delete headers['transfer-encoding'];
            delete headers['content-length'];
            delete headers.connection;
            delete headers['keep-alive'];
            outgoing.writeHead(response.statusCode ?? 200, headers);
            let done = false;

            response.on('data', (chunk: Buffer) => {
              if (done) return;
              done = true;
              let part = chunk.subarray(0, chunk.lastIndexOf(10) + 1);
              if (fault.endsWith('mid-line')) part = part.subarray(0, part.length - 5);
              outgoing.write(part);
              response.destroy();

              if (fault.startsWith('reset')) setImmediate(() => outgoing.socket?.destroy());
              else outgoing.end();
            });

            response.on('error', () => undefined);
          },
        );

        upstream.on('error', () => outgoing.destroy());
        upstream.end(Buffer.concat(body));
      });
    });

    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const { port } = proxy.address() as AddressInfo;
    proxied = createClient({ url: `http://127.0.0.1:${port}`, request_timeout: 20000 });
  });

  afterAll(async () => {
    await proxied?.close();
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  });

  const query = from(big);

  it.each(['reset mid-line', 'reset at a line end'] as const)(
    'a dropped connection, %s, fails run and stream',
    async dropped => {
      fault = dropped;

      expect(await classify(() => proxied.run(query).then(r => r.length), 1_000_000)).toBe(
        'ECONNRESET',
      );

      expect(
        await classify(() => collect(proxied.stream(query)).then(r => r.length), 1_000_000),
      ).toBe('ECONNRESET');
    },
  );

  // Measured limit: HTTP says the body ended, and the driver discards an unterminated last line.
  it.each(['clean end mid-line', 'clean end at a line end'] as const)(
    'measured: %s from a proxy reads as a short, successful result',
    async ended => {
      fault = ended;
      const rows = await client.run(query.limit(1));
      expect(rows).toHaveLength(1);

      expect(await classify(() => proxied.run(query).then(r => r.length), 1_000_000)).toMatch(
        /^wrong row count/,
      );

      expect(
        await classify(() => collect(proxied.stream(query)).then(r => r.length), 1_000_000),
      ).toMatch(/^wrong row count/);
    },
  );
});

describe('limits: only the five carve-out codes, or the full result', () => {
  const q = from(big);

  const shapes = [
    ['scan', q, 1_000_000],
    ['union', unionAll(q, q), 2_000_000],
    ['sorted', q.orderBy(r => r.s).thenBy(r => r.id), 1_000_000],
    ['grouped', q.groupBy(r => ({ id: r.id })).aggregate(() => ({ c: count() })), 1_000_000],
  ] as const;

  const limits: readonly [keyof QuerySettings, readonly number[], string][] = [
    ['max_result_rows', [1, 65536, 70000, 500000, 999999], '396'],
    ['max_result_bytes', [100, 1e6, 1e7, 5e7], '396'],
    ['max_execution_time', [1e-6, 0.001, 0.05, 0.3], '159'],
    ['max_memory_usage', [1e5, 5e6, 3e7], '241'],
    ['max_rows_to_read', [1, 1000, 999999], '158'],
    ['max_bytes_to_read', [1, 1e5, 1e7, 5e7], '307'],
  ];

  const cases = limits.flatMap(([key, values, code]) =>
    values.flatMap(value => shapes.map(shape => [key, value, shape[0], code, shape] as const)),
  );

  it.each(cases)(
    '%s = %d over %s',
    async (key, value, _shape, code, shape) => {
      const settled = shape[1].settings({ [key]: value }) as unknown as Query<unknown>;
      const expected = shape[2];

      const seen = [
        await classify(() => client.run(settled).then(r => r.length), expected),
        await classify(() => collect(client.stream(settled)).then(r => r.length), expected),
        await classify(
          () => naive.runBuffered(naive.compile(settled.ir)).then(r => r.length),
          expected,
        ),
      ];

      for (const outcome of seen) expect(['full', code]).toContain(outcome);
    },
    120000,
  );
});

describe('measured with response compression', () => {
  // The documented exception: a damaged gzip body can replace the code. The query must still fail.
  it('a limit keeps its code or raises Z_DATA_ERROR, and never ends with a short result', async () => {
    const gzip = createClient({ url, compression: { response: true }, request_timeout: 120000 });
    const q = from(big);

    try {
      for (const settled of [
        q.settings({ max_result_rows: 900_000 }),
        q.settings({ max_result_rows: 500_000 }),
      ]) {
        const allowed = /^(396|Z_DATA_ERROR)$/;

        expect(await classify(() => gzip.run(settled).then(r => r.length), 1_000_000)).toMatch(
          allowed,
        );

        expect(
          await classify(() => collect(gzip.stream(settled)).then(r => r.length), 1_000_000),
        ).toMatch(allowed);
      }
    } finally {
      await gzip.close();
    }
  });
});
