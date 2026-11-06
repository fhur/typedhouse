import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  col,
  count,
  from,
  fullJoin,
  join,
  leftJoin,
  outputLeaves,
  print,
  rightJoin,
  table,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';
import { canonical, connect, startServer, type Connection } from './asof-support.js';

/** The alias-order fix: position decides which input is null-extended, so the output's inputs, the
 * descriptors, the emitted order and real rows must all agree, on both emitters. */
const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const a = table('alias_rows_a', { id: col.UInt32, k: col.UInt8, v: col.UInt32 }, opts);

const b = table('alias_rows_b', { id: col.UInt32, k: col.UInt8, v: col.UInt32 }, opts);

const c3 = table('alias_rows_c', { id: col.UInt32, k: col.UInt8, v: col.UInt32 }, opts);

type Row = { id: number; k: number; v: number };

const rowsA: Row[] = [
  { id: 1, k: 1, v: 10 },
  { id: 2, k: 2, v: 20 },
  { id: 3, k: 2, v: 21 },
];

const rowsB: Row[] = [
  { id: 10, k: 1, v: 100 },
  { id: 30, k: 3, v: 300 },
  { id: 31, k: 1, v: 101 },
];

type Kind = 'left' | 'right' | 'full';

const kinds = { left: leftJoin, right: rightJoin, full: fullJoin } as Record<Kind, any>;

/** The JavaScript outer join: every matched pair, plus the unmatched rows the kind keeps. */
function outer(kind: Kind, ls: readonly Row[], rs: readonly Row[]) {
  const pairs: { l: Row | null; r: Row | null }[] = [];

  for (const l of ls) for (const r of rs) if (l.k === r.k) pairs.push({ l, r });

  if (kind !== 'right')
    for (const l of ls) if (!rs.some(r => r.k === l.k)) pairs.push({ l, r: null });

  if (kind !== 'left')
    for (const r of rs) if (!ls.some(l => l.k === r.k)) pairs.push({ l: null, r });

  return pairs;
}

const aliases = [
  ['2', '1'],
  ['1', '2'],
  ['10', '9'],
  ['0', '1'],
  ['1', '0'],
  ['01', '1'],
  ['1', '01'],
  ['01', '001'],
  ['x', '1'],
  ['1', 'x'],
  ['x', 'y'],
  ['-1', '1'],
  ['1.5', '1'],
  ['4294967296', '1'],
] as const;

const inputKinds: Record<
  string,
  { build: () => [any, any]; rows: () => [readonly Row[], readonly Row[]] }
> = {
  scans: { build: () => [from(a), from(b)], rows: () => [rowsA, rowsB] },
  'filtered inputs (subqueries)': {
    build: () => [from(a).where(r => r.v.gt(10)), from(b).where(r => r.v.gt(100))],
    rows: () => [rowsA.filter(r => r.v > 10), rowsB.filter(r => r.v > 100)],
  },
  'a CTE on both sides': {
    build: () => {
      const shared = from(a).where(r => r.v.gt(10));
      return [shared, shared];
    },
    rows: () => [rowsA.filter(r => r.v > 10), rowsA.filter(r => r.v > 10)],
  },
  'a CTE and a scan': {
    build: () => {
      const shared = from(b).where(r => r.k.eq(1));
      return [shared, from(a)];
    },
    rows: () => [rowsB.filter(r => r.k === 1), rowsA],
  },
};

const position = { left: [false, true], right: [true, false], full: [true, true] } as const;

describe.each(['24.3', '24.8', '26.10'] as const)('alias order on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  const both = async (q: any) => [
    await c.optimized.run(q),
    await c.naive.runBuffered(c.naive.compile(q.ir)),
  ];

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    const base = connect(server.url);
    const database = `alias_rows_${Date.now()}`;
    await base.admin.command({ query: `CREATE DATABASE ${database}` });
    await base.close();
    c = connect(server.url, {}, database);

    for (const name of ['a', 'b', 'c'])
      await c.admin.command({
        query: `CREATE TABLE alias_rows_${name} (id UInt32, k UInt8, v UInt32) ENGINE = MergeTree ORDER BY id`,
      });

    await c.admin.command({
      query: `INSERT INTO alias_rows_a VALUES (1, 1, 10), (2, 2, 20), (3, 2, 21)`,
    });

    await c.admin.command({
      query: `INSERT INTO alias_rows_b VALUES (10, 1, 100), (30, 3, 300), (31, 1, 101)`,
    });

    await c.admin.command({ query: `INSERT INTO alias_rows_c VALUES (1, 1, 1), (2, 2, 2)` });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  describe.each(Object.keys(kinds) as Kind[])('%sJoin', kind => {
    describe.each(Object.keys(inputKinds))('%s', inputName => {
      it.each(aliases)('aliases %s and %s', async (L, R) => {
        const { build, rows } = inputKinds[inputName]!;
        const [x, y] = build();
        const [ls, rs] = rows();
        const expected = outer(kind, ls, rs);
        const q = kinds[kind]({ [L]: x }, { [R]: y }).on((r: any) => r[L].k.eq(r[R].k));

        // Positions, output inputs and descriptors agree.
        const ir = q.ir as Extract<Rel, { kind: 'Join' }>;
        expect(ir.inputs.map(([alias]) => alias)).toEqual([L, R]);

        const output = ir.output as Extract<Rel['output'], { shape: 'nested' }>;
        expect(output.inputs.map(([alias]) => alias)).toEqual([L, R]);

        const declared = (alias: string) =>
          outputLeaves(ir.output)
            .filter(l => l.path[0] === alias)
            .map(l => print(l.type));

        expect(declared(L)[0]).toBe(position[kind][0] ? 'Nullable(UInt32)' : 'UInt32');
        expect(declared(R)[0]).toBe(position[kind][1] ? 'Nullable(UInt32)' : 'UInt32');

        const pick = (r: any) => ({ x: r[L].id, y: r[R].id });
        const map = q.map(pick);

        for (const compiled of [compile(map.ir), emitNaive(map.ir)]) {
          const { meta } = await c.json(compiled.sql, {}, compiled.params);
          expect(meta.map(m => m.type)).toEqual(Object.values(compiled.columns).map(t => print(t)));
        }

        for (const got of await both(map))
          expect(canonical(got)).toEqual(
            canonical(expected.map(p => ({ x: p.l?.id ?? null, y: p.r?.id ?? null }))),
          );

        // The whole row: alias keys, whichever order JavaScript gives them.
        for (const got of await both(q))
          expect(
            canonical(got.map((r: any) => ({ x: r[L].id, xk: r[L].k, y: r[R].id, yk: r[R].k }))),
          ).toEqual(
            canonical(
              expected.map(p => ({
                x: p.l?.id ?? null,
                xk: p.l?.k ?? null,
                y: p.r?.id ?? null,
                yk: p.r?.k ?? null,
              })),
            ),
          );

        // A chained where on each side, then map: a null-rejecting one may become a narrower kind.
        const whereL = q.where((r: any) => r[L].v.gt(15)).map(pick);

        for (const got of await both(whereL))
          expect(canonical(got)).toEqual(
            canonical(
              expected
                .filter(p => p.l !== null && p.l.v > 15)
                .map(p => ({ x: p.l!.id, y: p.r?.id ?? null })),
            ),
          );

        const nullR = q.where((r: any) => r[R].id.isNull()).map(pick);

        for (const got of await both(nullR))
          expect(canonical(got)).toEqual(
            canonical(
              expected.filter(p => p.r === null).map(p => ({ x: p.l?.id ?? null, y: null })),
            ),
          );

        // Group by a key of the right argument.
        const grouped = q.groupBy((r: any) => ({ g: r[R].k })).aggregate(() => ({ n: count() }));
        const groups = new Map<number | null, bigint>();

        for (const p of expected) {
          const g = p.r?.k ?? null;
          groups.set(g, (groups.get(g) ?? 0n) + 1n);
        }

        for (const got of await both(grouped))
          expect(canonical(got)).toEqual(canonical([...groups].map(([g, n]) => ({ g, n }))));
      });
    });
  });

  describe('plain join takes one record, so an integer-like alias sorts first', () => {
    it('two inputs: the sorted one prints first, with the same rows', async () => {
      const q = (join as any)({ 2: from(a), 1: from(b) }).on((r: any) => r[2].k.eq(r[1].k));
      const ir = q.ir as Extract<Rel, { kind: 'Join' }>;
      expect(ir.inputs.map(([alias]) => alias)).toEqual(['1', '2']);

      expect(compile(q.ir).sql).toMatch(
        /FROM `alias_rows_b` AS `1`\s+INNER ALL JOIN `alias_rows_a` AS `2`/,
      );

      const pick = (r: any) => ({ x: r[2].id, y: r[1].id });

      for (const got of await both(q.map(pick)))
        expect(canonical(got)).toEqual(
          canonical(
            outer('left', rowsA, rowsB)
              .filter(p => p.r)
              .map(p => ({ x: p.l!.id, y: p.r!.id })),
          ),
        );
    });

    const threeInputs = () =>
      (join as any)({ 3: from(c3), 2: from(a), 1: from(b) }).on((r: any) => [
        r[3].k.eq(r[2].k),
        r[2].k.eq(r[1].k),
      ]);

    it('three inputs, written in a chain: the sort still connects them, with the same rows', async () => {
      const q = threeInputs().map((r: any) => ({ c: r[3].id, a: r[2].id, b: r[1].id }));
      expect(compile(q.ir).sql).toMatch(/alias_rows_b`\) AS `1`\s+INNER ALL JOIN/);

      const oracle = (
        await c.json(
          `SELECT c.id AS c, a.id AS a, b.id AS b FROM alias_rows_c AS c INNER JOIN alias_rows_a AS a ON c.k = a.k
           INNER JOIN alias_rows_b AS b ON a.k = b.k`,
        )
      ).data;

      expect(oracle.length).toBeGreaterThan(0);
      for (const got of await both(q)) expect(canonical(got)).toEqual(canonical(oracle));
    });

    it('three inputs where the sort breaks the chain: a refusal, not wrong rows', () => {
      const sorted = (join as any)({ 9: from(a), 5: from(b), 1: from(c3) }).on((r: any) => [
        r[9].k.eq(r[5].k),
        r[9].k.eq(r[1].k),
      ]);

      // Sorted 1, 5, 9: 5 connects only to 9, which comes later.
      let code = 'no error';

      try {
        compile(sorted.ir);
      } catch (e) {
        code = e instanceof ValidationError ? e.code : String(e);
      }

      expect(code).toBe('join_condition_arity');
    });
  });
});
