import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asofLeftJoin,
  col,
  from,
  fullJoin,
  leftJoin,
  print,
  rightJoin,
  sql,
  table,
} from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { canonical, connect, startServer, type Connection } from './asof-support.js';

/** DEFECT on 26.10, not specific to ASOF. `.element()` over a null-extended Tuple field is Nullable on
 * the server and `meta` says so, but the descriptor does not. On an unmatched row, a field whose decoder
 * does not check returns `null` with no error (UInt8, String, FixedString, Decimal, Enum, UUID, IPv4,
 * LowCardinality); the others raise decode_invalid (Int64, UInt64, Float64, Bool, Date, Date32, DateTime,
 * DateTime64). A filter above changes the rows silently, whatever the field: `element('u8').eq(0)` keeps
 * the unmatched row on 24.3 and 24.8 and drops it on 26.10. Stays failing until the descriptor is right
 * or the behaviour is loud. Passes on 24.3 and 24.8. Array and Map element access stay typed. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const fields = [
  ['u8', 'UInt8', col.UInt8, 0],
  ['i64', 'Int64', col.Int64, 0n],
  ['u64', 'UInt64', col.UInt64, 0n],
  ['f64', 'Float64', col.Float64, 0],
  ['s', 'String', col.String, ''],
  ['fs', 'FixedString(1)', col.FixedString(1), '\0'],
  ['dec', 'Decimal(9, 2)', col.Decimal(9, 2), '0'],
  ['b', 'Bool', col.Bool, false],
  ['date', 'Date', col.Date, new Date(0)],
  ['dt', `DateTime('UTC')`, col.DateTime('UTC'), new Date(0)],
  ['en', `Enum8('a' = 1, 'b' = 2)`, col.Enum8({ a: 1, b: 2 }), 'a'],
  ['uuid', 'UUID', col.UUID, '00000000-0000-0000-0000-000000000000'],
  ['ip', 'IPv4', col.IPv4, '0.0.0.0'],
] as const;

const l = table('tuple_el_l', { k: col.UInt8, ts: col.UInt32 }, opts);

const r = table(
  'tuple_el_r',
  {
    k: col.UInt8,
    ts: col.UInt32,
    tup: col.Tuple(Object.fromEntries(fields.map(([n, , d]) => [n, d])) as never),
    nest: col.Tuple({ i: col.Tuple({ z: col.UInt16 }) }),
  },
  opts,
) as any;

const joins: Record<string, () => any> = {
  leftJoin: () => (leftJoin as any)({ t: from(l) }, { q: from(r) }).on((x: any) => x.t.k.eq(x.q.k)),
  rightJoin: () =>
    (rightJoin as any)({ q: from(r) }, { t: from(l) }).on((x: any) => x.t.k.eq(x.q.k)),
  fullJoin: () => (fullJoin as any)({ t: from(l) }, { q: from(r) }).on((x: any) => x.t.k.eq(x.q.k)),
  asofLeftJoin: () =>
    (asofLeftJoin as any)({ t: from(l) }, { q: from(r) })
      .on((x: any) => x.t.k.eq(x.q.k))
      .asof((x: any) => x.t.ts.ge(x.q.ts)),
};

describe.each(['24.3', '24.8', '26.10'] as const)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    c = connect(server.url);

    await c.admin.command({
      query:
        'CREATE OR REPLACE TABLE tuple_el_l (k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY k',
    });

    await c.admin.command({
      query: `CREATE OR REPLACE TABLE tuple_el_r (k UInt8, ts UInt32, tup Tuple(${fields.map(([n, t]) => `${n} ${t}`).join(', ')}),
              nest Tuple(i Tuple(z UInt16))) ENGINE = MergeTree ORDER BY k`,
    });

    await c.admin.command({ query: 'INSERT INTO tuple_el_l VALUES (1, 10), (2, 10)' });
    await c.admin.command({ query: `INSERT INTO tuple_el_r (k, ts) VALUES (1, 5)` });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  describe.each(Object.keys(joins))('%s', name => {
    it.each(fields.map(f => f[0]))(
      'tup.element(%s) on an unmatched row is its typed default',
      async field => {
        const q = joins[name]!()
          .map((x: any) => ({ k: x.t.k, v: x.q.tup.element(field) }))
          .where((x: any) => x.k.eq(2));

        const compiled = compile(q.ir);
        const { meta } = await c.json(compiled.sql, {}, compiled.params);
        expect(meta.find(m => m.name === 'v')!.type).toBe(print(compiled.columns['v']!));

        const expected = fields.find(f => f[0] === field)![3];
        const rows = (await c.optimized.run(q)) as { v: unknown }[];
        expect(rows[0]!.v).not.toBeNull();
        expect(rows[0]!.v).toEqual(expected);
      },
    );

    it('a nested element keeps its type', async () => {
      const q = joins[name]!()
        .map((x: any) => ({ k: x.t.k, v: x.q.nest.element('i').element('z') }))
        .where((x: any) => x.k.eq(2));

      expect(await c.optimized.run(q)).toEqual([{ k: 2, v: 0 }]);
    });

    it('a filter on the default keeps the unmatched row, as the type says', async () => {
      const q = joins[name]!()
        .where((x: any) => x.q.tup.element('u8').eq(0))
        .map((x: any) => ({ k: x.t.k }));

      expect(canonical(await c.optimized.run(q))).toContain(canonical([{ k: 2 }])[0]);
    });

    it('Array and Map element access stay typed, on all versions', async () => {
      const q = (leftJoin as any)({ t: from(l) }, { q: from(arrays) })
        .on((x: any) => x.t.k.eq(x.q.k))
        .map((x: any) => ({
          k: x.t.k,
          first: x.q.arr.arrayElement(1),
          row: x.q.at.arrayElement(1),
          key: sql`${x.q.mp}['a']`.as(col.UInt8),
        }))
        .where((x: any) => x.k.eq(2));

      const compiled = compile(q.ir);
      const { meta } = await c.json(compiled.sql, {}, compiled.params);
      expect(meta.map(m => m.type)).toEqual(Object.values(compiled.columns).map(t => print(t)));
      expect(await c.optimized.run(q)).toEqual([{ k: 2, first: 0, row: { a: 0 }, key: 0 }]);
    });
  });

  const arrays = table(
    'tuple_el_arr',
    {
      k: col.UInt8,
      arr: col.Array(col.UInt8),
      at: col.Array(col.Tuple({ a: col.UInt8 })),
      mp: col.Map(col.String, col.UInt8),
    },
    opts,
  ) as any;

  beforeAll(async () => {
    await c.admin.command({
      query:
        'CREATE OR REPLACE TABLE tuple_el_arr (k UInt8, arr Array(UInt8), at Array(Tuple(a UInt8)), mp Map(String, UInt8)) ENGINE = MergeTree ORDER BY k',
    });
  });
});
