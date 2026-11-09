import { describe, expect, it } from 'vitest';
import {
  asofLeftJoin,
  col,
  from,
  fullJoin,
  join,
  leftJoin,
  rightJoin,
  table,
  type CHType,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D21 rework, Worker. A null-extended Tuple or JSON takes its default and its type from the column,
 * `CAST(ifNull(c, defaultValueOfTypeName(T)), T)` with T = the column's type name without Nullable, so
 * no descriptor text reaches the SQL. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('l', { k: col.UInt8, ts: col.UInt32 }, opts);

const T = (c: string) =>
  `replaceRegexpOne(toTypeName(${c}), '(?s)^Nullable\\\\((.*)\\\\)$', '\\\\1')`;

const form = (c: string) => `CAST(ifNull(${c}, defaultValueOfTypeName(${T(c)})), ${T(c)})`;

const both = (ir: unknown) => [compile(ir as never).sql, emitNaive(ir as never).sql];

const read = (type: CHType) => {
  const r = table('r', { k: col.UInt8, ts: col.UInt32, h: { type } as never }, opts) as any;

  return (leftJoin as any)({ t: from(l) }, { q: from(r) })
    .on((x: any) => x.t.k.eq(x.q.k))
    .map((x: any) => ({ h: x.q.h }));
};

const wrapped: Record<string, CHType> = {
  Tuple: col.Tuple({ a: col.UInt8 }).type,
  JSON: col.JSON.type,
  'SimpleAggregateFunction over Tuple': col.SimpleAggregateFunction(
    'anyLast',
    col.Tuple({ a: col.UInt8 }),
  ).type,
  'SimpleAggregateFunction over JSON': col.SimpleAggregateFunction('anyLast', col.JSON).type,
};

const unwrapped: Record<string, CHType> = {
  'Nullable(Tuple)': col.Nullable(col.Tuple({ a: col.UInt8 }) as never).type,
  'Unknown Point': col.Unknown('Point').type,
  'Unknown Tuple with a Point member': col.Unknown('Tuple(p Point, a UInt8)').type,
  'Unknown JSON(a UInt8)': col.Unknown('JSON(a UInt8)').type,
  'Unknown Nested': col.Unknown('Nested(a UInt8)').type,
  "Unknown Object('json')": col.Unknown("Object('json')").type,
  'Unknown BFloat16': col.Unknown('BFloat16').type,
  'Array(Tuple)': col.Array(col.Tuple({ a: col.UInt8 })).type,
  UInt8: col.UInt8.type,
  'SimpleAggregateFunction over UInt8': col.SimpleAggregateFunction('max', col.UInt8).type,
};

describe('the column-derived form', () => {
  it.each(Object.keys(wrapped))('wraps %s on both emitters', name => {
    for (const text of both(read(wrapped[name]!).ir)) expect(text).toContain(form('`q`.`h`'));
  });

  it.each(Object.keys(unwrapped))('leaves %s alone', name => {
    for (const text of both(read(unwrapped[name]!).ir)) expect(text).not.toContain('ifNull');
  });

  it('puts no descriptor text in the SQL, whatever the names and labels hold', () => {
    const hostile = col.Tuple({
      "it's": col.UInt8,
      'a`b': col.Enum8({ "'); DROP TABLE x; --": 1, 'x\\y': 2 }),
      z: col.DateTime("Asia/Tok'yo"),
    }).type;

    for (const text of both(read(hostile).ir)) {
      expect(text).toContain(form('`q`.`h`'));
      expect(text).not.toContain('DROP');
      expect(text).not.toContain('Tok');
      expect(text).not.toMatch(/defaultValueOfTypeName\('/);
    }
  });

  it('follows the null-extended input of each kind, never ON or an inner join', () => {
    const r = table('r', { k: col.UInt8, ts: col.UInt32, tup: col.Tuple({ a: col.UInt8 }) }, opts);

    const lt = table(
      'lt',
      { k: col.UInt8, ts: col.UInt32, tup: col.Tuple({ a: col.UInt8 }) },
      opts,
    );

    const cases = {
      leftJoin: [leftJoin({ t: from(lt) }, { q: from(r) }), ['q']],
      rightJoin: [rightJoin({ t: from(lt) }, { q: from(r) }), ['t']],
      fullJoin: [fullJoin({ t: from(lt) }, { q: from(r) }), ['q', 't']],
    } as const;

    for (const [name, [builder, expected]] of Object.entries(cases)) {
      const q = (builder as any)
        .on((x: any) => x.t.k.eq(x.q.k))
        .map((x: any) => ({ a: x.t.tup, b: x.q.tup }));

      for (const text of both(q.ir)) {
        const aliases = [...text.matchAll(/CAST\(ifNull\(`(\w+)`\.`tup`/g)].map(m => m[1]);
        expect(aliases.sort(), name).toEqual([...expected]);
      }
    }

    const on = asofLeftJoin({ t: from(lt) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.tup.element('a')))
      .asof(x => x.t.ts.ge(x.q.ts))
      .map(x => ({ k: x.t.k }));

    for (const text of both(on.ir))
      expect(text).toMatch(/ON \(?`t`\.`k` = tupleElement\(`q`\.`tup`, \{p0:String\}\)/);

    const inner = join({ t: from(lt), q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ tup: x.q.tup }));

    for (const text of both(inner.ir)) expect(text).not.toContain('ifNull');
  });
});
