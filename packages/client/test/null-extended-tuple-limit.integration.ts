import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asofLeftJoin,
  col,
  from,
  fullJoin,
  leftJoin,
  print,
  rightJoin,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { QueryError } from '../src/index.js';
import { connect, startServer, type Connection } from './asof-support.js';

/** A documented limit, by owner decision (joins.md, "Tuple columns on ClickHouse 26.10"). Under
 * `join_use_nulls = 1`, 26.10 wraps a Tuple in Nullable and sends NULL for an unmatched row, where the
 * descriptor, from 24.8, keeps Tuple and its default. So on 26.10 a matched row reads normally and an
 * unmatched one raises QueryError with decode_invalid. 24.3 and 24.8 keep Tuple and its default.
 * `.element()` over such a column is not covered by this limit: left-join-tuple-element-null. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('tuple_limit_l', { k: col.UInt8, ts: col.UInt32 }, opts);

const r = table(
  'tuple_limit_r',
  {
    k: col.UInt8,
    ts: col.UInt32,
    named: col.Tuple({ a: col.UInt8, b: col.String }),
    unnamed: col.Tuple([col.UInt8, col.String]),
    arr: col.Array(col.UInt8),
    mp: col.Map(col.String, col.UInt8),
  },
  opts,
);

const select = (x: any) => ({
  k: x.t.k,
  named: x.q.named,
  unnamed: x.q.unnamed,
  arr: x.q.arr,
  mp: x.q.mp,
});

const joins: Record<string, (t: any, q: any) => any> = {
  leftJoin: (t, q) => (leftJoin as any)({ t }, { q }).on((x: any) => x.t.k.eq(x.q.k)),
  rightJoin: (t, q) => (rightJoin as any)({ q }, { t }).on((x: any) => x.t.k.eq(x.q.k)),
  fullJoin: (t, q) => (fullJoin as any)({ t }, { q }).on((x: any) => x.t.k.eq(x.q.k)),
  asofLeftJoin: (t, q) =>
    (asofLeftJoin as any)({ t }, { q })
      .on((x: any) => x.t.k.eq(x.q.k))
      .asof((x: any) => x.t.ts.ge(x.q.ts)),
};

const matched = {
  k: 1,
  named: { a: 7, b: 'x' },
  unnamed: [7, 'x'],
  arr: [1],
  mp: { a: 1 },
};

const unmatched = { k: 2, named: { a: 0, b: '' }, unnamed: [0, ''], arr: [], mp: {} };

describe.each(['24.3', '24.8', '26.10'] as const)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    c = connect(server.url);

    for (const query of [
      'CREATE OR REPLACE TABLE tuple_limit_l (k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY k',
      `CREATE OR REPLACE TABLE tuple_limit_r (k UInt8, ts UInt32, named Tuple(a UInt8, b String),
       unnamed Tuple(UInt8, String), arr Array(UInt8), mp Map(String, UInt8)) ENGINE = MergeTree ORDER BY k`,
      'INSERT INTO tuple_limit_l VALUES (1, 10), (2, 10)',
      `INSERT INTO tuple_limit_r VALUES (1, 5, (7, 'x'), (7, 'x'), [1], {'a': 1})`,
    ])
      await c.admin.command({ query });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  describe.each(Object.keys(joins))('%s', name => {
    const query = (t: any) => joins[name]!(t, from(r)).map(select);

    it('a matched row reads normally', async () => {
      const q = query(from(l).where(x => x.k.eq(1)));
      expect(await c.optimized.run(q)).toEqual([matched]);
    });

    it('an unmatched row: its default before 26.10, QueryError with decode_invalid on 26.10', async () => {
      const q = query(from(l).where(x => x.k.eq(2)));

      const paths = [
        () => c.optimized.run(q),
        async () => {
          const rows: unknown[] = [];
          for await (const row of c.optimized.stream(q)) rows.push(row);
          return rows;
        },
        () => c.naive.runBuffered(c.naive.compile(q.ir)),
      ];

      for (const path of paths) {
        if (version !== '26.10') {
          const rows = (await path()) as { k: number | null }[];
          // fullJoin also keeps the right row k = 1, with `t` unmatched.
          expect(rows.filter(row => row.k === 2)).toEqual([unmatched]);
          continue;
        }

        const error = await path().then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(QueryError);
        expect(String((error as QueryError).cause)).toMatch(/decode_invalid: Tuple\(/);
      }
    });

    it('meta: Tuple before 26.10, Nullable(Tuple) on 26.10; Array and Map keep their type', async () => {
      const compiled = compile(query(from(l)).ir);
      const { meta } = await c.json(compiled.sql, {}, compiled.params);
      const types = Object.fromEntries(meta.map(m => [m.name, m.type]));
      const wrap = (t: string) => (version === '26.10' ? `Nullable(${t})` : t);
      expect(types['named']).toBe(wrap('Tuple(a UInt8, b String)'));
      expect(types['unnamed']).toBe(wrap('Tuple(UInt8, String)'));
      expect(types['arr']).toBe('Array(UInt8)');
      expect(types['mp']).toBe('Map(String, UInt8)');
      expect(print(compiled.columns['named']!)).toBe('Tuple(a UInt8, b String)');
    });
  });
});
