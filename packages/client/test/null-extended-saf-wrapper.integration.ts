import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { col, from, leftJoin, print, table } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { connect, type Connection } from './asof-support.js';
import { GenericContainer, Wait } from 'testcontainers';

/** DEFECT in D21's scope. `keepsDefault` reads `Tuple` and `JSON` but not the same kinds under
 * `SimpleAggregateFunction`, which the parser models, so codegen emits it for an AggregatingMergeTree
 * column. The descriptor keeps the type (`OuterDescriptor` looks through the wrapper), but the server
 * wraps it: `SimpleAggregateFunction(anyLast, Tuple(a UInt8))` raises decode_invalid on an unmatched row
 * from 26.3, and `SimpleAggregateFunction(anyLast, JSON)` returns `null`, with no error, from 25.3.
 * Stays failing until the wrapper is read through. Passes on 24.8. */
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

const opts = { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table(
  'd21s_l',
  { k: col.UInt8 },
  { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] },
);

const r = table(
  'd21s_r',
  {
    k: col.UInt8,
    st: col.SimpleAggregateFunction('anyLast', col.Tuple({ a: col.UInt8 })),
    sj: col.SimpleAggregateFunction('anyLast', col.JSON),
  },
  opts,
);

describe.each(versions)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await start(version);
    stop = server.stop;
    c = connect(server.url, { allow_experimental_json_type: 1 });

    for (const query of [
      'CREATE OR REPLACE TABLE d21s_l (k UInt8) ENGINE = MergeTree ORDER BY k',
      `CREATE OR REPLACE TABLE d21s_r (k UInt8, st SimpleAggregateFunction(anyLast, Tuple(a UInt8)),
       sj SimpleAggregateFunction(anyLast, JSON)) ENGINE = AggregatingMergeTree ORDER BY k`,
      'INSERT INTO d21s_l VALUES (1), (2)',
      `INSERT INTO d21s_r VALUES (1, (7), '{"x": 1}')`,
    ])
      await c.admin.command({ query });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  const q = () =>
    leftJoin({ t: from(l) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ k: x.t.k, st: x.q.st, sj: x.q.sj }));

  it('meta equals the descriptor on both emitters', async () => {
    for (const compiled of [compile(q().ir), emitNaive(q().ir)]) {
      const { meta } = await c.json(compiled.sql, {}, compiled.params);
      expect(meta.map(m => m.type)).toEqual(Object.values(compiled.columns).map(t => print(t)));
    }
  });

  it('an unmatched row reads the default, as on 24.8', async () => {
    const rows = (await c.optimized.run(q())) as { k: number; st: unknown; sj: unknown }[];
    expect(rows.find(row => row.k === 2)).toEqual({ k: 2, st: { a: 0 }, sj: {} });
  });
});
