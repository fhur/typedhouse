import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asofJoin,
  asofLeftJoin,
  col,
  count,
  from,
  join,
  print,
  sql,
  sum,
  table,
  unionAll,
} from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';
import {
  canonical,
  closest,
  connect,
  failures,
  opSql,
  paths,
  startServer,
  type Connection,
  type Op,
  type Version,
} from './asof-support.js';

/** D10. Every case runs through run, stream and both naive paths, against handwritten SQL and, where
 * the values are known, a JavaScript model. The whole file runs on 24.3, 24.8 and 26.10. */
const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const LEFT_ORD = [5, 15, 20, 35],
  RIGHT_ORD = [10, 20, 30];

const enumType = `Enum8('e5' = 5, 'e10' = 10, 'e15' = 15, 'e20' = 20, 'e30' = 30, 'e35' = 35)`;

// name, SQL type, descriptor. Each column holds CAST(ord AS type).
const families = [
  ['i8', 'Int8', col.Int8],
  ['i16', 'Int16', col.Int16],
  ['i32', 'Int32', col.Int32],
  ['i64', 'Int64', col.Int64],
  ['i128', 'Int128', col.Int128],
  ['i256', 'Int256', col.Int256],
  ['u8', 'UInt8', col.UInt8],
  ['u16', 'UInt16', col.UInt16],
  ['u32', 'UInt32', col.UInt32],
  ['u64', 'UInt64', col.UInt64],
  ['u128', 'UInt128', col.UInt128],
  ['u256', 'UInt256', col.UInt256],
  ['f32', 'Float32', col.Float32],
  ['f64', 'Float64', col.Float64],
  ['d9', 'Decimal(9, 2)', col.Decimal(9, 2)],
  ['d18', 'Decimal(18, 4)', col.Decimal(18, 4)],
  ['d38', 'Decimal(38, 10)', col.Decimal(38, 10)],
  ['d76', 'Decimal(76, 10)', col.Decimal(76, 10)],
  ['date', 'Date', col.Date],
  ['date32', 'Date32', col.Date32],
  ['dt', `DateTime('UTC')`, col.DateTime('UTC')],
  ['dt64', `DateTime64(3, 'UTC')`, col.DateTime64(3, 'UTC')],
  ['en', enumType, col.Enum8({ e5: 5, e10: 10, e15: 15, e20: 20, e30: 30, e35: 35 })],
  ['nu32', 'Nullable(UInt32)', col.Nullable(col.UInt32)],
  ['ndt', `Nullable(DateTime('UTC'))`, col.Nullable(col.DateTime('UTC'))],
  ['lcu', 'LowCardinality(UInt32)', col.LowCardinality(col.UInt32)],
  ['saf', 'SimpleAggregateFunction(max, UInt32)', col.SimpleAggregateFunction('max', col.UInt32)],
] as const;

const columns = Object.fromEntries(families.map(([name, , c]) => [name, c]));

const famL = table('asof_fam_l', { id: col.UInt32, k: col.UInt8, ...columns } as any, opts) as any;

const famR = table('asof_fam_r', { id: col.UInt32, k: col.UInt8, ...columns } as any, opts) as any;

// The same instants in each temporal type, a day per ordinal from 2020-01-01. Date32 also pre-1970.
const temporals = [
  ['date', 'Date', col.Date],
  ['date32', 'Date32', col.Date32],
  ['utc', `DateTime('UTC')`, col.DateTime('UTC')],
  ['tokyo', `DateTime('Asia/Tokyo')`, col.DateTime('Asia/Tokyo')],
  ['ms', `DateTime64(3, 'UTC')`, col.DateTime64(3, 'UTC')],
  ['us', `DateTime64(6, 'Asia/Tokyo')`, col.DateTime64(6, 'Asia/Tokyo')],
] as const;

const temporalColumns = Object.fromEntries(temporals.map(([name, , c]) => [name, c]));

const tempL = table(
  'asof_temp_l',
  { id: col.UInt32, k: col.UInt8, ...temporalColumns } as any,
  opts,
) as any;

const tempR = table(
  'asof_temp_r',
  { id: col.UInt32, k: col.UInt8, ...temporalColumns } as any,
  opts,
) as any;

const mixL = table(
  'asof_mix_l',
  {
    id: col.UInt32,
    k: col.UInt8,
    i32: col.Int32,
    i8: col.Int8,
    i64: col.Int64,
    u32: col.UInt32,
    u64: col.UInt64,
    f32: col.Float32,
    f64: col.Float64,
    d9: col.Decimal(9, 2),
    d18z: col.Decimal(18, 0),
    dt: col.DateTime('UTC'),
    date: col.Date,
    b: col.Bool,
    en: col.Enum8({ a: 1, b: 2 }),
    s: col.String,
    lcu: col.LowCardinality(col.UInt32),
    lcn: col.LowCardinality(col.Nullable(col.UInt32)),
    lcs: col.LowCardinality(col.String),
    fs: col.FixedString(2),
    uuid: col.UUID,
    ip4: col.IPv4,
    ip6: col.IPv6,
    arr: col.Array(col.UInt8),
    tup: col.Tuple([col.UInt8]),
    mp: col.Map(col.String, col.UInt8),
  },
  opts,
) as any;

const mixR = table(
  'asof_mix_r',
  {
    id: col.UInt32,
    k: col.UInt8,
    u8: col.UInt8,
    u32: col.UInt32,
    u64: col.UInt64,
    i64: col.Int64,
    f64: col.Float64,
    f32: col.Float32,
    d18: col.Decimal(18, 4),
    d38z: col.Decimal(38, 30),
    dt: col.DateTime('UTC'),
    date: col.Date,
    b: col.Bool,
    en: col.Enum8({ a: 1, b: 2 }),
    s: col.String,
    lcu: col.LowCardinality(col.UInt32),
    lcs: col.LowCardinality(col.String),
    fs: col.FixedString(2),
    uuid: col.UUID,
    ip4: col.IPv4,
    ip6: col.IPv6,
    arr: col.Array(col.UInt8),
    tup: col.Tuple([col.UInt8]),
    mp: col.Map(col.String, col.UInt8),
  },
  opts,
) as any;

const ddl = `id UInt32, k UInt8, ${families.map(([n, t]) => `${n} ${t}`).join(', ')}`;

const tempDdl = `id UInt32, k UInt8, ${temporals.map(([n, t]) => `${n} ${t}`).join(', ')}`;

const seedStatements = [
  `CREATE TABLE asof_fam_l (${ddl}) ENGINE = MergeTree ORDER BY id`,
  `CREATE TABLE asof_fam_r (${ddl}) ENGINE = MergeTree ORDER BY id`,
  ...(['l', 'r'] as const).map(side => {
    const ords = side === 'l' ? LEFT_ORD : RIGHT_ORD;

    return `INSERT INTO asof_fam_${side} SELECT ord, 1, ${families
      .map(([n, t]) => `CAST(${n === 'en' ? 'toInt8(ord)' : 'ord'} AS ${t}) AS ${n}`)
      .join(', ')} FROM (SELECT arrayJoin([${ords.join(', ')}]) AS ord)`;
  }),
  `CREATE TABLE asof_temp_l (${tempDdl}) ENGINE = MergeTree ORDER BY id`,
  `CREATE TABLE asof_temp_r (${tempDdl}) ENGINE = MergeTree ORDER BY id`,
  ...(['l', 'r'] as const).map(side => {
    const ords = side === 'l' ? LEFT_ORD : RIGHT_ORD;

    return `INSERT INTO asof_temp_${side} SELECT ord, 1, ${temporals
      .map(
        ([n, t]) => `CAST(toDateTime('2020-01-01 00:00:00', 'UTC') + ord * 86400 AS ${t}) AS ${n}`,
      )
      .join(', ')} FROM (SELECT arrayJoin([${ords.join(', ')}]) AS ord)`;
  }),
  `CREATE TABLE asof_mix_l (id UInt32, k UInt8, i32 Int32, i8 Int8, i64 Int64, u32 UInt32, u64 UInt64,
    f32 Float32, f64 Float64, d9 Decimal(9, 2), d18z Decimal(18, 0), dt DateTime('UTC'), date Date, b Bool,
    en Enum8('a' = 1, 'b' = 2), s String, lcu LowCardinality(UInt32), lcn LowCardinality(Nullable(UInt32)),
    lcs LowCardinality(String), fs FixedString(2), uuid UUID, ip4 IPv4, ip6 IPv6, arr Array(UInt8),
    tup Tuple(UInt8), mp Map(String, UInt8)) ENGINE = MergeTree ORDER BY id`,
  `CREATE TABLE asof_mix_r (id UInt32, k UInt8, u8 UInt8, u32 UInt32, u64 UInt64, i64 Int64, f64 Float64,
    f32 Float32, d18 Decimal(18, 4), d38z Decimal(38, 30), dt DateTime('UTC'), date Date, b Bool,
    en Enum8('a' = 1, 'b' = 2), s String, lcu LowCardinality(UInt32), lcs LowCardinality(String),
    fs FixedString(2), uuid UUID, ip4 IPv4, ip6 IPv6, arr Array(UInt8), tup Tuple(UInt8),
    mp Map(String, UInt8)) ENGINE = MergeTree ORDER BY id`,
  // Distinguishing values for the numeric pairs: signs, a fraction, and a value above Int32.
  `INSERT INTO asof_mix_l (id, k, i32, i8, i64, u32, f32, f64, d9) VALUES
   (1, 1, -1, -1, -1, 3, 0.1, 0.1, 2.5),
   (2, 1, 1, 100, 5000000000, 5, 0.1, 0.1, 1.5),
   (3, 1, 3, 100, 5000000000, 5, 0.1, 0.1, 1.5)`,
  `INSERT INTO asof_mix_r (id, k, u8, u32, f64, f32, d18) VALUES
   (1, 1, 0, 0, 2.5, 0.05, 1.4999),
   (2, 1, 2, 4000000000, 3, 0.1, 1.5001)`,
];

const fam = (c: Connection, q: unknown) => paths(c, q as never);

const build = (Fn: unknown, a: any, b: any, on: (r: any) => any, ineq: (r: any) => any) =>
  (Fn as any)({ t: from(a) }, { q: from(b) })
    .on(on)
    .asof(ineq) as any;

const byKey = (r: any) => r.t.k.eq(r.q.k);

const ops: readonly Op[] = ['ge', 'gt', 'le', 'lt'];

const flipped = { ge: 'le', gt: 'lt', le: 'ge', lt: 'gt' } as const;

const modelFor = (op: Op, kind: 'inner' | 'left') =>
  LEFT_ORD.flatMap((id): { id: number; rid: number | null }[] => {
    const m = closest(
      id,
      RIGHT_ORD.map(ts => ({ ts })),
      op,
    );

    return m ? [{ id, rid: m.ts }] : kind === 'left' ? [{ id, rid: null }] : [];
  });

const pick = (r: any) => ({ id: r.t.id, rid: r.q.id });

describe.each(['24.3', '24.8', '26.10'] as const)('ASOF native on %s', (version: Version) => {
  let stop: () => Promise<void>;

  let c: Connection;

  let url: string;

  let database: string;

  const handwritten = async (query: string) =>
    (await c.json(query, { join_use_nulls: 1 })).data as Record<string, unknown>[];

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    url = server.url;
    const base = connect(server.url);
    database = `asof_native_${Date.now()}`;
    await base.admin.command({ query: `CREATE DATABASE ${database}` });
    await base.close();
    c = connect(server.url, {}, database);

    for (const query of seedStatements)
      await c.admin.command({
        query,
        clickhouse_settings: { allow_suspicious_low_cardinality_types: 1 },
      });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  const allEqual = async (q: unknown, expected: readonly unknown[], label = '') => {
    const got = await fam(c, q);

    for (const [path, rows] of Object.entries(got))
      expect(canonical(rows), `${label} on ${path}`).toEqual(canonical(expected));
  };

  describe('each type family, all four operators, both kinds', () => {
    // `lcu` against itself is refused; a LowCardinality on one side has its own test below.
    it.each(families.map(f => f[0]).filter(n => n !== 'lcu'))('%s', async name => {
      for (const op of ops) {
        for (const [kind, Fn] of [
          ['inner', asofJoin],
          ['left', asofLeftJoin],
        ] as const) {
          const expected = modelFor(op, kind);
          const q = build(Fn, famL, famR, byKey, r => r.t[name][op](r.q[name])).map(pick);

          const oracle = await handwritten(
            `SELECT t.id AS id, q.id AS rid FROM asof_fam_l AS t ASOF ${kind === 'inner' ? 'INNER' : 'LEFT'} JOIN asof_fam_r AS q
             ON t.k = q.k AND t.${name} ${opSql[op]} q.${name}`,
          );

          expect(canonical(oracle), `${name} ${op} ${kind} oracle`).toEqual(canonical(expected));
          await allEqual(q, expected, `${name} ${op} ${kind}`);

          // Reversed operands, and the equality reversed too.
          const reversed = build(
            Fn,
            famL,
            famR,
            r => r.q.k.eq(r.t.k),
            r => r.q[name][flipped[op]](r.t[name]),
          ).map(pick);

          await allEqual(reversed, expected, `${name} ${op} ${kind} reversed`);
        }
      }
    });
  });

  describe('temporal pairs compare the instant', () => {
    const names = temporals.map(t => t[0]);

    const pairs = names.flatMap(a => names.filter(b => a !== b).map(b => [a, b] as const));

    it.each(pairs)('%s against %s', async (a, b) => {
      for (const op of ops) {
        // The oracle is the plain comparison over a CROSS join, not an assumption about zones: a Date
        // against a zoned column reads as midnight in that zone, on the server's own comparison too.
        const closer = op === 'ge' || op === 'gt' ? 'argMax' : 'argMin';

        const plain = await handwritten(
          `SELECT t.id AS id, ${closer}(q.id, q.id) AS rid FROM asof_temp_l AS t CROSS JOIN asof_temp_r AS q
           WHERE t.${a} ${opSql[op]} q.${b} GROUP BY t.id`,
        );

        const q = build(asofJoin, tempL, tempR, byKey, r => r.t[a][op](r.q[b])).map(pick);
        await allEqual(q, plain, `${a} ${op} ${b}`);

        // Same-zone pairs need no such care, and must match the ordinal model.
        if (!['date', 'date32'].includes(a) && !['date', 'date32'].includes(b))
          expect(canonical(plain), `${a} ${op} ${b} model`).toEqual(
            canonical(modelFor(op, 'inner')),
          );
      }
    });
  });

  describe('numeric pairs, with distinguishing values', () => {
    const pairs = [
      [
        'i32',
        'u8',
        [
          { id: 2, rid: 1 },
          { id: 3, rid: 2 },
        ],
      ],
      [
        'i8',
        'u8',
        [
          { id: 2, rid: 2 },
          { id: 3, rid: 2 },
        ],
      ],
      [
        'i64',
        'u32',
        [
          { id: 2, rid: 2 },
          { id: 3, rid: 2 },
        ],
      ],
      [
        'f32',
        'f32',
        [
          { id: 1, rid: 2 },
          { id: 2, rid: 2 },
          { id: 3, rid: 2 },
        ],
      ],
      // 3 >= 3, and 5 >= 3: the fractional 2.5 is passed over.
      [
        'u32',
        'f64',
        [
          { id: 1, rid: 2 },
          { id: 2, rid: 2 },
          { id: 3, rid: 2 },
        ],
      ],
      // Decimal(9,2) against Decimal(18,4): 2.5 >= 1.5001, and 1.5 passes over 1.5001.
      [
        'd9',
        'd18',
        [
          { id: 1, rid: 2 },
          { id: 2, rid: 1 },
          { id: 3, rid: 1 },
        ],
      ],
    ] as const;

    it.each(pairs)('%s against %s, on ge', async (a, b, expected) => {
      const q = build(asofJoin, mixL, mixR, byKey, r => r.t[a].ge(r.q[b])).map(pick);
      await allEqual(q, expected, `${a} ge ${b}`);
    });

    it('Float32 against Float64 compares as Float64: 0.1f is above 0.1 and above 0.05', async () => {
      const q = build(asofJoin, mixL, mixR, byKey, r => r.t.f64.ge(r.q.f32)).map(pick);

      const oracle = await handwritten(
        `SELECT t.id AS id, q.id AS rid FROM asof_mix_l AS t ASOF INNER JOIN asof_mix_r AS q ON t.k = q.k AND t.f64 >= q.f32`,
      );

      expect(oracle.length).toBeGreaterThan(0);
      await allEqual(q, oracle);
    });
  });

  describe('pairs the server refuses', () => {
    const raising = [
      ['u64', 'i64', '386'],
      ['u64', 'f64', '386'],
      ['i64', 'f64', '386'],
      ['d9', 'f64', '386'],
    ] as const;

    it.each(raising)('%s against %s surfaces one QueryError on every path', async (a, b, code) => {
      const q = build(asofJoin, mixL, mixR, byKey, r => r.t[a].ge(r.q[b])).map(pick);

      expect(await failures(c, q)).toEqual({
        run: code,
        stream: code,
        naiveRun: code,
        naiveStream: code,
      });
    });

    it('a computed operand reaches 386: plus against minus is UInt64 against Int64', async () => {
      const q = build(asofJoin, mixL, mixR, byKey, r => r.t.u32.plus(1).ge(r.q.u32.minus(1))).map(
        pick,
      );

      expect(await failures(c, q)).toEqual({
        run: '386',
        stream: '386',
        naiveRun: '386',
        naiveStream: '386',
      });
    });

    const codeOf = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof ValidationError ? e.code : String((e as Error).message);
      }

      return 'no error';
    };

    const serverOn = async (a: string, b: string) =>
      c.admin
        .query({
          query: `SELECT 1 FROM asof_mix_l AS t ASOF INNER JOIN asof_mix_r AS q ON t.k = q.k AND t.${a} >= q.${b}`,
        })
        .then(
          async r => {
            await r.text();
            return 'ok';
          },
          (e: { code?: string }) => String(e.code),
        );

    // Orchestrator ruling: the resolver's refusal stands on both emitters.
    it.each([
      ['dt', 'u32', '386'],
      ['date', 'u32', '43'],
      ['u32', 'dt', '386'],
    ])('%s against %s: incompatible_operands, and the server raises %s', async (a, b, code) => {
      const q = () => build(asofJoin, mixL, mixR, byKey, r => r.t[a].ge(r.q[b])).map(pick);
      expect(codeOf(() => compile(q().ir))).toBe('incompatible_operands');
      expect(codeOf(() => emitNaive(q().ir))).toBe('incompatible_operands');
      expect(await serverOn(a, b)).toBe(code);
    });

    // Known stricter refusal: the server accepts these.
    it.each([
      ['b', 'u8'],
      ['en', 'u8'],
    ])('%s against %s: refused though the server accepts', async (a, b) => {
      const q = () => build(asofJoin, mixL, mixR, byKey, r => r.t[a].ge(r.q[b])).map(pick);
      expect(codeOf(() => compile(q().ir))).toBe('incompatible_operands');
      expect(codeOf(() => emitNaive(q().ir))).toBe('incompatible_operands');
      expect(await serverOn(a, b)).toBe('ok');
    });

    it.each(['s', 'fs', 'uuid', 'ip4', 'ip6', 'arr', 'tup', 'mp', 'lcs', 'lcu'])(
      '%s against itself: invalid_asof_type, and the server raises 169',
      async name => {
        const q = () => build(asofJoin, mixL, mixR, byKey, r => r.t[name].ge(r.q[name])).map(pick);
        const codes = [codeOf(() => compile(q().ir)), codeOf(() => emitNaive(q().ir))];
        expect(codes).toEqual(['invalid_asof_type', 'invalid_asof_type']);
        expect(await serverOn(name, name)).toBe('169');
      },
    );

    it('a LowCardinality on one side works, in either position', async () => {
      await c.admin.command({
        query: `INSERT INTO asof_mix_l (id, k, lcu) VALUES (10, 2, 15)`,
      });

      await c.admin.command({
        query: `INSERT INTO asof_mix_r (id, k, u32, lcu) VALUES (10, 2, 10, 10), (20, 2, 20, 20)`,
      });

      for (const [a, b] of [
        ['lcu', 'u32'],
        ['u32', 'lcu'],
      ]) {
        const q = build(
          asofJoin,
          mixL,
          mixR,
          r => r.t.k.eq(r.q.k).and(r.t.k.eq(r.q.k)),
          r => (a === 'lcu' ? r.t.lcu.ge(r.q.u32) : r.t.lcu.ge(r.q.lcu.minus(0))),
        );

        expect(q.ir.kind).toBe('Join');

        const oracle = await handwritten(
          `SELECT t.id AS id, q.id AS rid FROM asof_mix_l AS t ASOF INNER JOIN asof_mix_r AS q ON t.k = q.k AND t.lcu >= q.u32 WHERE t.k = 2`,
        );

        expect(oracle).toEqual([{ id: 10, rid: 10 }]);
      }

      const q = build(asofJoin, mixL, mixR, byKey, r => r.t.lcu.ge(r.q.u32))
        .where((r: any) => r.t.k.eq(2))
        .map(pick);

      await allEqual(q, [{ id: 10, rid: 10 }]);

      await c.admin.command({
        query: `ALTER TABLE asof_mix_l DELETE WHERE k = 2 SETTINGS mutations_sync = 2`,
      });

      await c.admin.command({
        query: `ALTER TABLE asof_mix_r DELETE WHERE k = 2 SETTINGS mutations_sync = 2`,
      });
    });

    it('Bool and Enum against themselves, and a LowCardinality String equality', async () => {
      await c.admin.command({
        query: `INSERT INTO asof_mix_l (id, k, b, en, lcs) VALUES (30, 3, true, 'b', 'x'), (31, 3, false, 'a', 'x')`,
      });

      await c.admin.command({
        query: `INSERT INTO asof_mix_r (id, k, b, en, s) VALUES (30, 3, false, 'a', 'x')`,
      });

      const on = (form: (r: any) => any, eq: (r: any) => any = byKey) =>
        build(asofJoin, mixL, mixR, eq, form)
          .where((r: any) => r.t.k.eq(3))
          .map(pick);

      await allEqual(
        on(r => r.t.b.gt(r.q.b)),
        [{ id: 30, rid: 30 }],
      );

      await allEqual(
        on(r => r.t.en.gt(r.q.en)),
        [{ id: 30, rid: 30 }],
      );

      await allEqual(
        on(
          r => r.t.b.ge(r.q.b),
          r => r.t.lcs.eq(r.q.s),
        ),
        [
          { id: 30, rid: 30 },
          { id: 31, rid: 30 },
        ],
      );

      await c.admin.command({
        query: `ALTER TABLE asof_mix_l DELETE WHERE k = 3 SETTINGS mutations_sync = 2`,
      });

      await c.admin.command({
        query: `ALTER TABLE asof_mix_r DELETE WHERE k = 3 SETTINGS mutations_sync = 2`,
      });
    });

    it('toUInt8(lc) slips through to a server 169, as one QueryError shape on both paths', async () => {
      const q = build(asofJoin, mixL, mixR, byKey, r =>
        sql`toUInt8(${r.t.lcu})`.as(col.UInt8).ge(sql`toUInt8(${r.q.lcu})`.as(col.UInt8)),
      ).map(pick);

      expect(await failures(c, q)).toEqual({
        run: '169',
        stream: '169',
        naiveRun: '169',
        naiveStream: '169',
      });
    });
  });

  describe('Nullable on both sides', () => {
    const nl = table(
      'asof_null_l',
      { id: col.UInt32, k: col.Nullable(col.String), ts: col.Nullable(col.UInt32) },
      opts,
    );

    const nr = table(
      'asof_null_r',
      {
        id: col.UInt32,
        k: col.Nullable(col.String),
        ts: col.Nullable(col.UInt32),
        v: col.Nullable(col.UInt32),
      },
      opts,
    );

    beforeAll(async () => {
      for (const side of ['l', 'r'])
        await c.admin.command({
          query: `CREATE TABLE asof_null_${side} (id UInt32, k Nullable(String), ts Nullable(UInt32)${side === 'r' ? ', v Nullable(UInt32)' : ''}) ENGINE = MergeTree ORDER BY id`,
        });

      await c.admin.command({
        query: `INSERT INTO asof_null_l VALUES (1, 'a', 10), (2, NULL, 10), (3, 'a', NULL), (4, 'b', 10), (5, NULL, NULL)`,
      });

      await c.admin.command({
        query: `INSERT INTO asof_null_r VALUES (1, 'a', 5, NULL), (2, NULL, 5, 2), (3, 'a', NULL, 3), (4, 'b', NULL, 4)`,
      });
    });

    it('a NULL on either side never matches; ASOF LEFT keeps that row with NULLs', async () => {
      const inner = asofJoin({ t: from(nl) }, { q: from(nr) })
        .on(r => r.t.k.eq(r.q.k))
        .asof(r => r.t.ts.ge(r.q.ts))
        .map(r => ({ id: r.t.id, rid: r.q.id }));

      await allEqual(inner, [{ id: 1, rid: 1 }]);

      const outer = asofLeftJoin({ t: from(nl) }, { q: from(nr) })
        .on(r => r.t.k.eq(r.q.k))
        .asof(r => r.t.ts.ge(r.q.ts))
        .map(r => ({ id: r.t.id, rid: r.q.id, v: r.q.v, k: r.q.k, ts: r.q.ts }));

      const expected = [
        { id: 1, rid: 1, v: null, k: 'a', ts: 5 },
        { id: 2, rid: null, v: null, k: null, ts: null },
        { id: 3, rid: null, v: null, k: null, ts: null },
        { id: 4, rid: null, v: null, k: null, ts: null },
        { id: 5, rid: null, v: null, k: null, ts: null },
      ];

      await allEqual(outer, expected);

      const oracle = await handwritten(
        `SELECT t.id AS id, q.id AS rid, q.v AS v, q.k AS k, q.ts AS ts FROM asof_null_l AS t
         ASOF LEFT JOIN asof_null_r AS q ON t.k = q.k AND t.ts >= q.ts`,
      );

      expect(canonical(oracle)).toEqual(canonical(expected));
    });

    it('LeftToInner leaves IS NULL and IS NOT NULL above: an unmatched row and a NULL match differ', async () => {
      const q = (f: (r: any) => any) =>
        asofLeftJoin({ t: from(nl) }, { q: from(nr) })
          .on(r => r.t.k.eq(r.q.k))
          .asof(r => r.t.ts.ge(r.q.ts))
          .where(f as never)
          .map(r => ({ id: r.t.id, rid: r.q.id }));

      const isNull = q(r => r.q.v.isNull());
      expect(compile(isNull.ir).sql).toContain('ASOF LEFT JOIN');

      // id 1 matched a right row whose v is NULL; 2 to 5 did not match.
      await allEqual(isNull, [
        { id: 1, rid: 1 },
        { id: 2, rid: null },
        { id: 3, rid: null },
        { id: 4, rid: null },
        { id: 5, rid: null },
      ]);

      const notNull = q(r => r.q.id.isNotNull());
      expect(compile(notNull.ir).sql).toContain('ASOF LEFT JOIN');
      await allEqual(notNull, [{ id: 1, rid: 1 }]);
    });
  });

  describe('expression and parameter operands', () => {
    it('a parameter in each operand, numbered in text order', async () => {
      const q = build(
        asofJoin,
        famL,
        famR,
        r => r.t.u32.plus(0).minus(r.t.u32.plus(0)).eq(r.q.k.minus(1)),
        r => r.t.u32.plus(5).ge(r.q.u32.plus(1)),
      ).map(pick);

      const compiled = compile(q.ir);
      const numbers = [...compiled.sql.matchAll(/\{p(\d+):/g)].map(m => Number(m[1]));
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      expect(numbers.length).toBe(5);

      // id + 5 >= v + 1, so the closest v is at or below id + 4.
      const expected = LEFT_ORD.flatMap(id => {
        const m = closest(
          id + 4,
          RIGHT_ORD.map(ts => ({ ts })),
          'ge',
        );

        return m ? [{ id, rid: m.ts }] : [];
      });

      await allEqual(q, expected);
    });

    it('a sql snippet with a temporal offset, and a Cast', async () => {
      const offset = build(asofJoin, famL, famR, byKey, r =>
        sql`${r.t.dt} - ${5}`.as(col.DateTime('UTC')).ge(r.q.dt),
      ).map(pick);

      const oracle = await handwritten(
        `SELECT t.id AS id, q.id AS rid FROM asof_fam_l AS t ASOF INNER JOIN asof_fam_r AS q ON t.k = q.k AND t.dt - 5 >= q.dt`,
      );

      expect(oracle.length).toBeGreaterThan(0);
      await allEqual(offset, oracle);
    });
  });

  describe('inputs', () => {
    it('a CTE on the left and on the right', async () => {
      const shared = from(famR).where((r: any) => r.k.eq(1));

      const q = (asofJoin as any)({ a: shared }, { b: shared })
        .on((r: any) => r.a.k.eq(r.b.k))
        .asof((r: any) => r.a.u32.gt(r.b.u32))
        .map((r: any) => ({ id: r.a.id, rid: r.b.id }));

      await allEqual(q, [
        { id: 20, rid: 10 },
        { id: 30, rid: 20 },
      ]);

      const cte = from(famL).where((r: any) => r.id.gt(5));

      const twice = unionAll(
        (asofJoin as any)({ t: cte }, { q: from(famR) })
          .on(byKey)
          .asof((r: any) => r.t.u32.ge(r.q.u32))
          .map(pick),
        (asofLeftJoin as any)({ t: cte }, { q: from(famR) })
          .on(byKey)
          .asof((r: any) => r.t.u32.lt(r.q.u32))
          .map((r: any) => ({ id: r.t.id, rid: r.q.id }))
          .where((r: any) => r.rid.isNotNull())
          .map((r: any) => ({ id: r.id, rid: sql`assumeNotNull(${r.rid})`.as(col.UInt32) })),
      );

      expect(emitNaive((twice as any).ir).sql.match(/ASOF/g)!.length).toBe(2);

      await allEqual(twice, [
        { id: 15, rid: 10 },
        { id: 20, rid: 20 },
        { id: 35, rid: 30 },
        { id: 15, rid: 20 },
        { id: 20, rid: 30 },
      ]);
    });

    it('a self-join on the base table, with a filter on each side above', async () => {
      const q = (asofJoin as any)({ a: from(famR) }, { b: from(famR) })
        .on((r: any) => r.a.k.eq(r.b.k))
        .asof((r: any) => r.a.u32.gt(r.b.u32))
        .where((r: any) => r.a.id.gt(10).and(r.b.id.lt(20)))
        .map((r: any) => ({ id: r.a.id, rid: r.b.id }));

      await allEqual(q, [{ id: 20, rid: 10 }]);
    });
  });

  describe('null-extended meta per column kind', () => {
    const kinds = [
      ['u32', 'UInt32', col.UInt32, 7],
      ['s', 'String', col.String, 'x'],
      ['fs', 'FixedString(2)', col.FixedString(2), 'ab'],
      ['b', 'Bool', col.Bool, true],
      ['f64', 'Float64', col.Float64, 1.5],
      ['dec', 'Decimal(9, 2)', col.Decimal(9, 2), '1.50'],
      ['date', 'Date', col.Date, '2024-01-02'],
      ['date32', 'Date32', col.Date32, '2024-01-02'],
      ['dt', `DateTime('UTC')`, col.DateTime('UTC'), '2024-01-02 00:00:00'],
      ['dt64', `DateTime64(3, 'UTC')`, col.DateTime64(3, 'UTC'), '2024-01-02 00:00:00.000'],
      ['en', `Enum8('a' = 1, 'b' = 2)`, col.Enum8({ a: 1, b: 2 }), 'b'],
      ['uuid', 'UUID', col.UUID, '00000000-0000-0000-0000-000000000001'],
      ['ip4', 'IPv4', col.IPv4, '1.2.3.4'],
      ['nu', 'Nullable(UInt32)', col.Nullable(col.UInt32), 9],
      ['lc', 'LowCardinality(String)', col.LowCardinality(col.String), 'l'],
      [
        'lcn',
        'LowCardinality(Nullable(String))',
        col.LowCardinality(col.Nullable(col.String)),
        'n',
      ],
      ['arr', 'Array(UInt8)', col.Array(col.UInt8), [1]],
      ['mp', 'Map(String, UInt8)', col.Map(col.String, col.UInt8), { a: 1 }],
      [
        'tup',
        'Tuple(a UInt8, b String)',
        col.Tuple({ a: col.UInt8, b: col.String }),
        { a: 1, b: 'x' },
      ],
      [
        'saf',
        'SimpleAggregateFunction(max, UInt32)',
        col.SimpleAggregateFunction('max', col.UInt32),
        3,
      ],
    ] as const;

    const wide = table(
      'asof_wide',
      {
        k: col.UInt8,
        ts: col.UInt32,
        ...Object.fromEntries(kinds.map(([n, , d]) => [n, d])),
      } as any,
      opts,
    ) as any;

    const keys = table('asof_keys', { id: col.UInt32, k: col.UInt8, ts: col.UInt32 }, opts) as any;

    const q = () =>
      (asofLeftJoin as any)({ t: from(keys) }, { q: from(wide) })
        .on((r: any) => r.t.k.eq(r.q.k))
        .asof((r: any) => r.t.ts.ge(r.q.ts))
        .map((r: any) => ({
          id: r.t.id,
          rk: r.q.k,
          rts: r.q.ts,
          // 26.10 reports a null-extended Tuple as Nullable(Tuple): null-extended-tuple-limit.integration.ts.
          ...Object.fromEntries(
            kinds.filter(([n]) => version !== '26.10' || n !== 'tup').map(([n]) => [n, r.q[n]]),
          ),
        }));

    beforeAll(async () => {
      await c.admin.command({
        query: `CREATE TABLE asof_wide (k UInt8, ts UInt32, ${kinds.map(([n, t]) => `${n} ${t}`).join(', ')}) ENGINE = MergeTree ORDER BY k`,
      });

      await c.admin.command({
        query: `CREATE TABLE asof_keys (id UInt32, k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY id`,
      });

      await c.admin.command({
        query: `INSERT INTO asof_keys VALUES (1, 1, 10), (2, 2, 10), (3, 1, 0)`,
      });

      await c.admin.insert({
        table: 'asof_wide',
        format: 'JSONEachRow',
        values: [{ k: 1, ts: 5, ...Object.fromEntries(kinds.map(([n, , , v]) => [n, v])) }],
      });
    });

    it('the descriptors match the server on both emitters and through a nesting of each shape', async () => {
      const shapes: Record<string, () => any> = {
        direct: q,
        filtered: () => q().where((r: any) => r.id.gt(0)),
        sorted: () => q().orderBy((r: any) => r.id),
        limited: () =>
          q()
            .orderBy((r: any) => r.id)
            .limit(10),
        'join input': () => {
          const inner = q();

          return join({ a: inner, b: from(keys) })
            .on((r: any) => r.a.id.eq(r.b.id))
            .map((r: any) => ({ ...r.a }));
        },
        'CTE, read twice': () => {
          const inner = q();

          return join({ a: inner, b: inner })
            .on((r: any) => r.a.id.eq(r.b.id))
            .map((r: any) => ({ ...r.b }));
        },
        'union branch': () => unionAll(q(), q()),
      };

      for (const [name, shape] of Object.entries(shapes)) {
        const query = shape();

        for (const compiled of [compile(query.ir), emitNaive(query.ir)]) {
          expect(compiled.sql, name).toContain('join_use_nulls = 1');
          const { meta } = await c.json(compiled.sql, {}, compiled.params);

          expect(
            Object.fromEntries(meta.map(m => [m.name, m.type])),
            `${name}: ${compiled.sql}`,
          ).toEqual(
            Object.fromEntries(Object.entries(compiled.columns).map(([k, t]) => [k, print(t)])),
          );
        }
      }
    });

    it('an unmatched row: NULL where the kind can sit in Nullable, the default where it cannot', async () => {
      const rows = await fam(c, q());

      for (const [path, got] of Object.entries(rows)) {
        const unmatched = got.filter((r: any) => r.id !== 1);
        expect(unmatched.length, path).toBe(2);

        for (const row of unmatched as any[]) {
          for (const [name, type] of Object.entries(compile(q().ir).columns)) {
            if (name === 'id') continue;
            const value = row[name];

            if (print(type).startsWith('Array')) expect(value, `${path} ${name}`).toEqual([]);
            else if (print(type).startsWith('Map')) expect(value, `${path} ${name}`).toEqual({});
            else if (print(type).startsWith('Tuple'))
              expect(value, `${path} ${name}`).toEqual({ a: 0, b: '' });
            else expect(value, `${path} ${name}`).toBeNull();
          }
        }

        const matched = got.find((r: any) => r.id === 1) as any;
        expect(matched.rk, path).toBe(1);
        expect(matched.rts, path).toBe(5);
        expect(matched.nu, path).toBe(9);
        expect(matched.arr, path).toEqual([1]);
      }
    });

    it('the same when nested in a subquery set, where the tail setting has to apply', async () => {
      const inner = q().where((r: any) => r.rk.isNull());
      const outer = from(keys).where((r: any) => r.id.in(inner.map((x: any) => x.id)));
      expect(compile(outer.ir).sql).toContain('join_use_nulls = 1');
      expect(emitNaive(outer.ir).sql).toContain('join_use_nulls = 1');

      const got = await fam(
        c,
        outer.map((r: any) => ({ id: r.id })),
      );

      for (const [path, rows] of Object.entries(got))
        expect(canonical(rows), path).toEqual(canonical([{ id: 2 }, { id: 3 }]));
    });

    it('aggregates over null-extended columns skip the NULLs', async () => {
      const g = (asofLeftJoin as any)({ t: from(keys) }, { q: from(wide) })
        .on((r: any) => r.t.k.eq(r.q.k))
        .asof((r: any) => r.t.ts.ge(r.q.ts))
        .aggregate((r: any) => ({ n: count(), s: sum(r.q.u32) }));

      await allEqual(g, [{ n: 3n, s: 7n }]);
    });
  });

  describe('ties: only the count, and one of the tied rows', () => {
    const tl = table('asof_tie_l', { id: col.UInt32, k: col.UInt8, ts: col.UInt32 }, opts) as any;

    const tr = table(
      'asof_tie_r',
      { rid: col.UInt32, k: col.UInt8, ts: col.UInt32, wide: col.String },
      opts,
    ) as any;

    beforeAll(async () => {
      await c.admin.command({
        query: `CREATE TABLE asof_tie_l (id UInt32, k UInt8, ts UInt32) ENGINE = MergeTree ORDER BY id`,
      });

      await c.admin.command({
        query: `CREATE TABLE asof_tie_r (rid UInt32, k UInt8, ts UInt32, wide String) ENGINE = MergeTree ORDER BY rid`,
      });

      await c.admin.command({
        query: `INSERT INTO asof_tie_l SELECT number + 1, number % 2, 100 FROM numbers(200)`,
      });

      // 3 parts, 3 tied rows per key at the closest value, and a farther row that must never win.
      for (const part of [0, 1, 2])
        await c.admin.command({
          query: `INSERT INTO asof_tie_r SELECT ${part} * 10 + k + 1, k, 50, 'w' FROM (SELECT arrayJoin([0, 1]) AS k)`,
        });

      await c.admin.command({
        query: `INSERT INTO asof_tie_r VALUES (90, 0, 40, 'far'), (91, 1, 40, 'far')`,
      });
    });

    it('asofLeftJoin keeps the count as well, with a row from the tied set', async () => {
      const q = (asofLeftJoin as any)({ t: from(tl) }, { q: from(tr) })
        .on((r: any) => r.t.k.eq(r.q.k))
        .asof((r: any) => r.t.ts.ge(r.q.ts))
        .map((r: any) => ({ id: r.t.id, k: r.t.k, rid: r.q.rid }));

      const tied = { 0: [1, 11, 21], 1: [2, 12, 22] } as Record<number, number[]>;

      for (const [path, rows] of Object.entries(await fam(c, q))) {
        expect(rows.length, path).toBe(200);
        for (const row of rows as any[]) expect(tied[row.k], path).toContain(row.rid);
      }
    });

    it('run and stream return 200 rows, each from the tied set of its key', async () => {
      const q = (asofJoin as any)({ t: from(tl) }, { q: from(tr) })
        .on((r: any) => r.t.k.eq(r.q.k))
        .asof((r: any) => r.t.ts.ge(r.q.ts))
        .map((r: any) => ({ id: r.t.id, k: r.t.k, rid: r.q.rid }));

      const tied = { 0: [1, 11, 21], 1: [2, 12, 22] } as Record<number, number[]>;
      const got = await fam(c, q);

      for (const [path, rows] of Object.entries(got)) {
        expect(rows.length, path).toBe(200);
        for (const row of rows as any[]) expect(tied[row.k], path).toContain(row.rid);
      }
    });
  });

  describe('operators above the join', () => {
    it('distinct, limitBy and settings, on both emitters', async () => {
      const base = () => build(asofLeftJoin, famL, famR, byKey, r => r.t.u32.ge(r.q.u32));
      const expected = modelFor('ge', 'left');

      await allEqual(base().map(pick).distinct(), expected, 'distinct');

      const limited = base()
        .orderBy((r: any) => r.t.id)
        .limitBy((r: any) => r.q.id)
        .take(1)
        .map(pick);

      const oracle = await handwritten(
        `SELECT t.id AS id, q.id AS rid FROM asof_fam_l AS t ASOF LEFT JOIN asof_fam_r AS q
         ON t.k = q.k AND t.u32 >= q.u32 ORDER BY t.id LIMIT 1 BY q.id`,
      );

      await allEqual(limited, oracle, 'limitBy');

      const set = base().map(pick).settings({ max_threads: 1 });

      for (const s of [compile(set.ir).sql, emitNaive(set.ir).sql]) {
        expect(s).toContain('max_threads = 1');
        expect(s).toContain('join_use_nulls = 1');
      }

      await allEqual(set, expected, 'settings');
    });

    it('an inner ASOF under a left join: join_use_nulls = 1 applies to it too, types hold', async () => {
      const inner = build(asofJoin, famL, famR, byKey, r => r.t.u32.ge(r.q.u32)).map(pick);

      const q = (join as any)({ a: inner, b: from(famL) })
        .on((r: any) => r.a.id.eq(r.b.id))
        .map((r: any) => ({ id: r.a.id, rid: r.a.rid }));

      await allEqual(q, modelFor('ge', 'inner'));

      const outer = (asofLeftJoin as any)({ c: from(famL) }, { a: inner })
        .on((r: any) => r.c.u32.eq(r.a.id))
        .asof((r: any) => r.c.u32.ge(r.a.rid))
        .map((r: any) => ({ id: r.c.id, rid: r.a.rid }));

      const compiled = compile(outer.ir);
      const { meta } = await c.json(compiled.sql, {}, compiled.params);
      expect(meta.map(m => m.type)).toEqual(Object.values(compiled.columns).map(t => print(t)));
      await allEqual(outer, modelFor('ge', 'left'));
    });

    it('a pending value completed twice, in one union', async () => {
      const p = (asofJoin as any)({ t: from(famL) }, { q: from(famR) }).on(byKey);
      const a = p.asof((r: any) => r.t.u32.ge(r.q.u32)).map(pick);
      const b = p.asof((r: any) => r.t.u32.lt(r.q.u32)).map(pick);

      await allEqual(unionAll(a, b), [...modelFor('ge', 'inner'), ...modelFor('lt', 'inner')]);
    });
  });

  describe('Decimal across scales, where the common scale overflows', () => {
    // Pinned as measured. The server compares in Decimal(38, 30), where 1e17 wraps: `1e17 >= 1` is
    // false and `1e17 <= 1` true, with no error, on a plain comparison too. "Decimal across scales
    // compared correctly" in the docs does not hold here.
    it('a wrong match, with no error, on the same terms as the plain comparison', async () => {
      await c.admin.command({
        query: `INSERT INTO asof_mix_l (id, k, d18z) VALUES (50, 7, 100000000000000000)`,
      });

      await c.admin.command({ query: `INSERT INTO asof_mix_r (id, k, d38z) VALUES (50, 7, 1)` });

      const on = (op: Op) =>
        build(asofJoin, mixL, mixR, byKey, r => r.t.d18z[op](r.q.d38z))
          .where((r: any) => r.t.k.eq(7))
          .map(pick);

      expect(
        await handwritten(
          `SELECT toDecimal64('100000000000000000', 0) >= toDecimal128('1', 30) AS g`,
        ),
      ).toEqual([{ g: 0 }]);

      await allEqual(on('ge'), []);
      await allEqual(on('le'), [{ id: 50, rid: 50 }]);

      await c.admin.command({
        query: `ALTER TABLE asof_mix_l DELETE WHERE k = 7 SETTINGS mutations_sync = 2`,
      });

      await c.admin.command({
        query: `ALTER TABLE asof_mix_r DELETE WHERE k = 7 SETTINGS mutations_sync = 2`,
      });
    });
  });

  describe('NaN, on each side, pinned as measured', () => {
    const nl = table('asof_nan_l', { id: col.UInt32, k: col.UInt8, x: col.Float64 }, opts) as any;
    const nr = table('asof_nan_r', { id: col.UInt32, k: col.UInt8, x: col.Float64 }, opts) as any;

    beforeAll(async () => {
      for (const s of ['l', 'r'])
        await c.admin.command({
          query: `CREATE TABLE asof_nan_${s} (id UInt32, k UInt8, x Float64) ENGINE = MergeTree ORDER BY id`,
        });

      // Key 1: NaN on the right only. Key 2: NaN on the left only. Key 3: the control, no NaN.
      await c.admin.command({
        query: `INSERT INTO asof_nan_l VALUES (1, 1, 1), (2, 2, nan), (3, 3, 1)`,
      });

      await c.admin.command({
        query: `INSERT INTO asof_nan_r VALUES (1, 1, nan), (2, 2, 1), (3, 3, 2)`,
      });
    });

    it('each direction matched a row where a comparison would not; the control behaves', async () => {
      const on = (op: Op) =>
        build(asofJoin, nl, nr, byKey, r => r.t.x[op](r.q.x)).map((r: any) => ({
          id: r.t.id,
          rid: r.q.id,
        }));

      // A plain comparison with NaN is false, so a comparison gives no row for keys 1 and 2.
      const plain = await handwritten(`SELECT 1 >= nan AS a, nan >= 1 AS b`);
      expect(plain).toEqual([{ a: 0, b: 0 }]);

      await allEqual(on('ge'), [
        { id: 1, rid: 1 },
        { id: 2, rid: 2 },
      ]);

      // Control on the same operator family: 1 <= 2 matches key 3.
      const rows = await fam(c, on('le'));

      for (const got of Object.values(rows))
        expect(canonical(got)).toContain(canonical([{ id: 3, rid: 3 }])[0]);
    });
  });

  describe('join_algorithm through a client-level setting', () => {
    const table_: Record<Version, Record<string, string>> = {
      '24.3': {
        hash: 'ok',
        parallel_hash: 'ok',
        auto: 'ok',
        full_sorting_merge: '48',
        partial_merge: '48',
        grace_hash: '48',
        direct: '48',
      },
      '24.8': {
        hash: 'ok',
        parallel_hash: 'ok',
        auto: 'ok',
        full_sorting_merge: 'ok',
        partial_merge: '48',
        grace_hash: '48',
        direct: '48',
      },
      '26.10': {
        hash: 'ok',
        parallel_hash: 'ok',
        auto: 'ok',
        full_sorting_merge: 'ok',
        partial_merge: '48',
        grace_hash: '48',
        direct: '48',
      },
    };

    it.each(Object.keys(table_['24.8']))('%s', async algorithm => {
      const client = connect(url, { join_algorithm: algorithm }, database);

      try {
        const q = build(asofJoin, famL, famR, byKey, r => r.t.u32.ge(r.q.u32)).map(pick);
        const expected = table_[version][algorithm]!;
        const got = await failures(client, q);

        expect(got).toEqual({
          run: expected,
          stream: expected,
          naiveRun: expected,
          naiveStream: expected,
        });

        if (expected === 'ok')
          expect(canonical(await client.optimized.run(q as never))).toEqual(
            canonical(modelFor('ge', 'inner')),
          );
      } finally {
        await client.close();
      }
    });
  });
});
