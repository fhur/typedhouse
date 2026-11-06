import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asofJoin, asofLeftJoin, col, from, table, type CompiledQuery } from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { canonical, connect, paths, startServer, type Connection } from './asof-support.js';
import { structure } from '../../compiler/test/explain-corpus-support.js';

/** D10 EXPLAIN pins, in a new file: `entries` in fixtures/corpus/explain-corpus.ts cannot grow
 * without editing that file. On each version: the plan keeps a right conjunct above the ASOF step,
 * and the rows of the design note's reproduction. */
const opts = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const trades = table(
  'asof_x_trades',
  { id: col.UInt32, symbol: col.String, ts: col.DateTime('UTC') },
  opts,
);

const quotes = table(
  'asof_x_quotes',
  { symbol: col.String, ts: col.DateTime('UTC'), flag: col.UInt8, v: col.UInt32 },
  { engine: 'MergeTree', sortingKey: ['symbol', 'ts'], partitionKey: [] },
);

const pair = (Fn: typeof asofJoin, q: any = from(quotes)) =>
  (Fn as any)({ t: from(trades) }, { q })
    .on((r: any) => r.t.symbol.eq(r.q.symbol))
    .asof((r: any) => r.t.ts.ge(r.q.ts)) as any;

const pick = (r: any) => ({ id: r.t.id, v: r.q.v });

describe.each(['24.3', '24.8', '26.10'] as const)('ASOF plan on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  beforeAll(async () => {
    const server = await startServer(version);
    stop = server.stop;
    c = connect(server.url);

    for (const query of [
      `CREATE OR REPLACE TABLE asof_x_trades (id UInt32, symbol String, ts DateTime('UTC')) ENGINE = MergeTree ORDER BY id`,
      `CREATE OR REPLACE TABLE asof_x_quotes (symbol String, ts DateTime('UTC'), flag UInt8, v UInt32) ENGINE = MergeTree ORDER BY (symbol, ts)`,
      `INSERT INTO asof_x_trades VALUES (1, 'A', '2024-01-01 00:00:10'), (2, 'A', '2024-01-01 00:00:30')`,
      `INSERT INTO asof_x_quotes VALUES ('A', '2024-01-01 00:00:05', 1, 10), ('A', '2024-01-01 00:00:20', 0, 20)`,
    ])
      await c.admin.command({ query });
  });

  afterAll(async () => {
    await c?.close();
    await stop();
  });

  const explain = async (compiled: CompiledQuery) => {
    const result = await c.admin.query({
      query: `EXPLAIN actions = 1 ${compiled.sql}`,
      query_params: compiled.params,
      format: 'TabSeparatedRaw',
    });

    return (await result.text()).split('\n');
  };

  /** Lines above the Join step, and lines from it down: reads and whatever was pushed to them. */
  const around = (lines: readonly string[]) => {
    const at = lines.findIndex(l => /\bJoin \(/.test(l));
    expect(at, lines.join('\n')).toBeGreaterThanOrEqual(0);
    return { above: lines.slice(0, at).join('\n'), below: lines.slice(at).join('\n') };
  };

  const filterLines = (text: string) =>
    text.split('\n').filter(l => /Filter column|Prewhere filter column/.test(l));

  it.each([
    ['the planned text', compile],
    ['the naive text', emitNaive],
  ] as const)(
    'a right conjunct stays above the ASOF step in %s, on both kinds',
    async (_, emit) => {
      for (const Fn of [asofJoin, asofLeftJoin]) {
        const q = pair(Fn as never)
          .where((r: any) => r.q.flag.eq(1))
          .map(pick);

        const compiled = emit(q.ir);
        const lines = await explain(compiled);
        const { above, below } = around(lines);
        expect(lines.join('\n')).toMatch(/Strictness: (ASOF|asof)/);
        // The naive text filters a leaf alias, not `flag`: only the position decides there.
        expect(filterLines(above).length, lines.join('\n')).toBeGreaterThan(0);
        expect(filterLines(below), lines.join('\n')).toEqual([]);
      }
    },
  );

  it('a right conjunct on the inequality column and on the equality key stay above too', async () => {
    const T = new Date('2024-01-01T00:00:15Z');

    for (const [q, word] of [
      [
        pair(asofJoin)
          .where((r: any) => r.q.ts.gt(T))
          .map(pick),
        'ts',
      ],
      [
        pair(asofJoin)
          .where((r: any) => r.q.symbol.eq('A'))
          .map(pick),
        'symbol',
      ],
    ] as const) {
      const lines = await explain(compile(q.ir));
      const { below } = around(lines);

      expect(filterLines(below).join('\n'), `${word}\n${lines.join('\n')}`).not.toMatch(
        new RegExp(word),
      );
    }
  });

  it('a left conjunct is below the step, by the rule on the planned text', async () => {
    const q = pair(asofJoin)
      .where((r: any) => r.t.id.eq(2))
      .map(pick);

    const compiled = compile(q.ir);
    expect(compiled.sql.split('ASOF')[0]).toMatch(/FROM \(SELECT [^]*WHERE `id` = /);
    expect(filterLines(around(await explain(compiled)).below).join('\n')).toMatch(/id/);
  });

  it('the right input never sees a left conjunct, on the equality key', async () => {
    // The ordinary join copies a key conjunct across ON on 24.8 and 26.10; ASOF was measured not to.
    const q = pair(asofJoin)
      .where((r: any) => r.t.symbol.eq('A'))
      .map(pick);

    const lines = (await explain(compile(q.ir))).join('\n');
    const reads = lines.split(/ReadFromMergeTree/);
    expect(reads.length).toBe(3);
    expect(reads[2]!).not.toMatch(/Prewhere filter column|Filter column/);
  });

  it('structure(): one SELECT when the join folds, none extra for a right filter', () => {
    const q = pair(asofJoin)
      .where((r: any) => r.q.flag.eq(1))
      .map(pick);

    const s = structure(q.ir);
    expect(s.selects.filter(e => e.role === 'root').length).toBe(1);
    expect(s.fences.has('Join')).toBe(true);
    expect(compile(q.ir).sql).toMatch(/\nWHERE /);
  });

  it('the rows the docs reproduce: above the join, then the input filtered first', async () => {
    const above = pair(asofJoin)
      .where((r: any) => r.q.flag.eq(1))
      .map(pick);

    const below = pair(
      asofJoin,
      from(quotes).where(r => r.flag.eq(1)),
    ).map(pick);

    const handwritten = async (sql: string) => (await c.json(sql)).data;

    expect(
      await handwritten(
        `SELECT t.id AS id, q.v AS v FROM asof_x_trades AS t ASOF INNER JOIN asof_x_quotes AS q
         ON t.symbol = q.symbol AND t.ts >= q.ts WHERE q.flag = 1 ORDER BY id`,
      ),
    ).toEqual([{ id: 1, v: 10 }]);

    expect(
      await handwritten(
        `SELECT t.id AS id, q.v AS v FROM asof_x_trades AS t ASOF INNER JOIN (SELECT * FROM asof_x_quotes WHERE flag = 1) AS q
         ON t.symbol = q.symbol AND t.ts >= q.ts ORDER BY id`,
      ),
    ).toEqual([
      { id: 1, v: 10 },
      { id: 2, v: 10 },
    ]);

    for (const [path, rows] of Object.entries(await paths(c, above)))
      expect(canonical(rows), path).toEqual(canonical([{ id: 1, v: 10 }]));

    for (const [path, rows] of Object.entries(await paths(c, below)))
      expect(canonical(rows), path).toEqual(
        canonical([
          { id: 1, v: 10 },
          { id: 2, v: 10 },
        ]),
      );
  });
});
