import { afterAll, beforeAll, expect, it } from 'vitest';
import { asofLeftJoin, col, from, leftJoin, print, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { connect, startServer, type Connection } from './asof-support.js';

/** DEFECT, not specific to ASOF. On 26.10 `join_use_nulls = 1` turns a Tuple into Nullable(Tuple),
 * so the descriptor (`outerColumnType`, measured on 24.8: Tuple keeps its type and its default) and
 * the server disagree, and reading an unmatched row raises decode_invalid. Stays failing until the
 * descriptor is decided for that version, or until 26.10 is out of the documented range. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('tl', { k: col.UInt8, ts: col.UInt32 }, opts);

const r = table('tr', { k: col.UInt8, ts: col.UInt32, tup: col.Tuple({ a: col.UInt8 }) }, opts);

let stop: () => Promise<void>;

let c: Connection;

beforeAll(async () => {
  const server = await startServer('26.10');
  stop = server.stop;
  c = connect(server.url);

  await c.admin.command({
    query: 'CREATE OR REPLACE TABLE tl (k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY k',
  });

  await c.admin.command({
    query:
      'CREATE OR REPLACE TABLE tr (k UInt8, ts UInt32, tup Tuple(a UInt8)) ENGINE = MergeTree ORDER BY k',
  });

  await c.admin.command({ query: 'INSERT INTO tl VALUES (1, 10)' });
});

afterAll(async () => {
  await c?.close();
  await stop();
});

const queries = {
  asofLeftJoin: () =>
    asofLeftJoin({ t: from(l) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .asof(x => x.t.ts.ge(x.q.ts))
      .map(x => ({ tup: x.q.tup })),
  leftJoin: () =>
    leftJoin({ t: from(l) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ tup: x.q.tup })),
};

it.each(Object.keys(queries) as (keyof typeof queries)[])(
  '%s: an unmatched Tuple decodes, and meta equals the descriptor',
  async name => {
    const q = queries[name]();
    const compiled = compile(q.ir);
    const { meta } = await c.json(compiled.sql, {}, compiled.params);
    expect(meta[0]!.type).toBe(print(compiled.columns['tup']!));
    expect(await c.optimized.run(q)).toEqual([{ tup: { a: 0 } }]);
  },
);
