import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  col,
  from,
  fullJoin,
  leftJoin,
  print,
  rightJoin,
  table,
  type CHType,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { canonical, connect, startServer, type Connection } from './asof-support.js';

/** D21 rework, Worker. The null-extended read takes its type from the column, so:
 * - a matched row reads exactly as the column holds it, whatever the descriptor says;
 * - an unmatched row reads the column type's default;
 * - `meta` is the column's own type on every version: LowCardinality members, SimpleAggregateFunction
 *   survive, which ifNull alone drops.
 * 24.8 runs first and is the row baseline. */
const versions = ['24.8', '24.3', '25.3', '25.8', '25.10', '26.3', '26.10'] as const;

const hasJson = (v: string) => v !== '24.3';

const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

type Case = {
  ddl: string;
  value: string;
  declared: CHType;
  json?: true;
  /** Whether the descriptor states the column exactly, so meta must equal it too. */
  exact: boolean;
};

const cases: Record<string, Case> = {
  lagging_enum: {
    ddl: "Tuple(e Enum8('a' = 1, 'b' = 2))",
    value: "tuple('b')",
    declared: col.Tuple({ e: col.Enum8({ a: 1 }) }).type,
    exact: false,
  },
  lc_enum_nullable: {
    ddl: "Tuple(l LowCardinality(String), e Enum8('a' = 1), n Nullable(Int64), i Tuple(z UInt16))",
    value: "('x', 'a', 5, tuple(9))",
    declared: col.Tuple({
      l: col.LowCardinality(col.String),
      e: col.Enum8({ a: 1 }),
      n: col.Nullable(col.Int64),
      i: col.Tuple({ z: col.UInt16 }),
    }).type,
    exact: true,
  },
  saf_tuple: {
    ddl: 'SimpleAggregateFunction(anyLast, Tuple(a UInt8))',
    value: 'tuple(7)',
    declared: col.SimpleAggregateFunction('anyLast', col.Tuple({ a: col.UInt8 })).type,
    exact: true,
  },
  json: { ddl: 'JSON', value: `'{"a": 5}'`, declared: col.JSON.type, json: true, exact: true },
  json_lagging: {
    ddl: 'JSON(a UInt8)',
    value: `'{"a": 5}'`,
    declared: col.JSON.type,
    json: true,
    exact: false,
  },
  saf_json: {
    ddl: 'SimpleAggregateFunction(anyLast, JSON)',
    value: `'{"x": 1}'`,
    declared: col.SimpleAggregateFunction('anyLast', col.JSON).type,
    json: true,
    exact: true,
  },
};

const l = table('d21p_l', { k: col.UInt8 }, opts);

const right = (name: string) =>
  table(`d21p_${name}`, { k: col.UInt8, x: { type: cases[name]!.declared } as never }, opts) as any;

const kinds: Record<string, (r: any) => any> = {
  leftJoin: r => (leftJoin as any)({ t: from(l) }, { q: from(r) }).on((x: any) => x.t.k.eq(x.q.k)),
  rightJoin: r =>
    (rightJoin as any)({ q: from(r) }, { t: from(l) }).on((x: any) => x.t.k.eq(x.q.k)),
  fullJoin: r => (fullJoin as any)({ t: from(l) }, { q: from(r) }).on((x: any) => x.t.k.eq(x.q.k)),
};

const baseline = new Map<string, string[]>();

const squash = (t: string) => t.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');

describe.each(versions)('on %s', version => {
  let stop: () => Promise<void>;

  let c: Connection;

  const names = Object.keys(cases).filter(n => hasJson(version) || !cases[n]!.json);

  /** The column's own type and its matched value, read from the table without a join. */
  const physical = new Map<string, { type: string; value: unknown }>();

  beforeAll(async () => {
    const server = await startServer(version as never);
    stop = server.stop;
    c = connect(server.url, version === '24.8' ? { allow_experimental_json_type: 1 } : {});

    await c.admin.command({
      query: 'CREATE OR REPLACE TABLE d21p_l (k UInt8) ENGINE = MergeTree ORDER BY k',
    });

    await c.admin.command({ query: 'INSERT INTO d21p_l VALUES (1), (2)' });

    for (const name of names) {
      const { ddl, value } = cases[name]!;

      await c.admin.command({
        query: `CREATE OR REPLACE TABLE d21p_${name} (k UInt8, x ${ddl}) ENGINE = MergeTree ORDER BY k`,
      });

      await c.admin.command({ query: `INSERT INTO d21p_${name} VALUES (1, ${value})` });
      const own = await c.json(`SELECT x FROM d21p_${name}`);
      physical.set(name, { type: squash(own.meta[0]!.type), value: own.data[0]!.x });
    }
  }, 120_000);

  afterAll(async () => {
    await c?.close();
    await stop?.();
  });

  const matrix = Object.keys(cases)
    .filter(n => hasJson(version) || !cases[n]!.json)
    .flatMap(name => Object.keys(kinds).map(kind => [name, kind] as const));

  it.each(matrix)('%s through %s', async (name, kind) => {
    const q = kinds[kind]!(right(name)).map((x: any) => ({ k: x.t.k, x: x.q.x }));
    const own = physical.get(name)!;

    for (const emit of [compile, emitNaive]) {
      const compiled = emit(q.ir);
      const result = await c.json(compiled.sql, {}, compiled.params);
      const type = squash(result.meta.find(m => m.name === 'x')!.type);
      expect(type, 'meta is the column type').toBe(own.type);

      if (cases[name]!.exact)
        expect(type, 'and the descriptor').toBe(squash(print(compiled.columns['x']!)));

      // The matched row reads exactly what the column holds.
      expect(result.data.find(row => row.k === 1)!.x).toEqual(own.value);
    }

    const rows = canonical((await c.naive.runBuffered(c.naive.compile(q.ir))) as unknown[]);

    const key = `${name}/${kind}`;

    if (version === '24.8') baseline.set(key, rows);
    else if (baseline.has(key)) expect(rows).toEqual(baseline.get(key));
  });
});
