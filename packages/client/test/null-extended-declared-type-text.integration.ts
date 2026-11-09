import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { col, from, leftJoin, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { connect, type Connection } from './asof-support.js';
import { GenericContainer, Wait } from 'testcontainers';

/** DEFECT, introduced by D21. The wrapper names the DECLARED type, `defaultValueOfTypeName('<print>')`,
 * so the server takes a supertype of it and the physical type, and that supertype reaches matched rows
 * too. When the descriptor lags the table (an Enum value added after codegen), 26.3 and 26.10 turn the
 * Enum field of every row, matched or not, into Int8: `{ e: 1 }` where the type says `'a'`, with no
 * error; 24.8, and 26.10 before D21, return `'a'`. When `col.JSON` describes a `JSON(a UInt8)` column,
 * 25.3 to 25.10 raise code 386 for every row, where they returned the matched rows before D21, and 26.3
 * and 26.10 lose the typed path: `{ a: '5' }` for `{ a: 5 }`.
 * `ifNull(col, defaultValueOfArgumentType(assumeNotNull(col)))` keeps the physical type on 24.3 to 26.10
 * with no type text, measured by hand. Stays failing until matched rows are unaffected by the wrapper. */
const versions = ['24.8', '25.3', '26.3', '26.10'] as const;

async function start(version: string) {
  const reuse = process.env[`D21_URL_${version.replace('.', '_')}`];
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

const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('d21d_l', { k: col.UInt8 }, opts);

// The descriptor as codegen wrote it before a migration added 'b'.
const r = table('d21d_r', { k: col.UInt8, t: col.Tuple({ e: col.Enum8({ a: 1 }) }) }, opts);

const j = table('d21d_j', { k: col.UInt8, js: col.JSON }, opts);

describe.each(versions)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await start(version);
    stop = server.stop;
    c = connect(server.url, { allow_experimental_json_type: 1 });

    for (const query of [
      'CREATE OR REPLACE TABLE d21d_l (k UInt8) ENGINE = MergeTree ORDER BY k',
      `CREATE OR REPLACE TABLE d21d_r (k UInt8, t Tuple(e Enum8('a' = 1, 'b' = 2))) ENGINE = MergeTree ORDER BY k`,
      'CREATE OR REPLACE TABLE d21d_j (k UInt8, js JSON(a UInt8)) ENGINE = MergeTree ORDER BY k',
      'INSERT INTO d21d_l VALUES (1), (2)',
      `INSERT INTO d21d_r VALUES (1, ('a'))`,
      `INSERT INTO d21d_j VALUES (1, '{"a": 5}')`,
    ])
      await c.admin.command({ query });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  it('a lagging Enum descriptor: the matched row keeps its label', async () => {
    const q = leftJoin({ t: from(l) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ k: x.t.k, t: x.q.t }));

    expect(compile(q.ir).sql).toContain('defaultValueOfTypeName');
    const rows = (await c.optimized.run(q)) as { k: number; t: { e: unknown } }[];
    expect(rows.find(row => row.k === 1)!.t).toEqual({ e: 'a' });
  });

  it('col.JSON over a JSON(a UInt8) column: the matched row still reads', async () => {
    const q = leftJoin({ t: from(l) }, { q: from(j) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ k: x.t.k, js: x.q.js }));

    const rows = (await c.optimized.run(q)) as { k: number; js: unknown }[];
    expect(rows.find(row => row.k === 1)!.js).toEqual({ a: 5 });
  });
});
