import { describe, expect, it } from 'vitest';
import {
  asofLeftJoin,
  col,
  from,
  fullJoin,
  join,
  leftJoin,
  rightJoin,
  sql,
  table,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D21 Worker. The emitted form of a null-extended Tuple or JSON read, and where it must not appear. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const l = table('l', { k: col.UInt8, ts: col.UInt32, tup: col.Tuple({ a: col.UInt8 }) }, opts);

const r = table(
  'r',
  {
    k: col.UInt8,
    ts: col.UInt32,
    tup: col.Tuple({
      e: col.Enum8({ "it's": 1 }),
      t: col.DateTime('Asia/Tokyo'),
      'x`y': col.UInt8,
    }),
    js: col.JSON,
    nt: col.Nullable(col.UInt8),
    arr: col.Array(col.UInt8),
  },
  opts,
);

const printed = "Tuple(e Enum8('it\\'s' = 1), t DateTime('Asia/Tokyo'), `x\\`y` UInt8)";

/** The column's own type without the join's Nullable: the second D21 form, byte for byte. */
const physical = (alias: string, column: string) =>
  `replaceRegexpOne(toTypeName(\`${alias}\`.\`${column}\`), ` +
  String.raw`'(?s)^Nullable\\((.*)\\)$', '\\1')`;

const wrapped = (alias: string, column: string) =>
  `CAST(ifNull(\`${alias}\`.\`${column}\`, defaultValueOfTypeName(${physical(alias, column)})), ${physical(alias, column)})`;

const both = (ir: unknown) => [compile(ir as never).sql, emitNaive(ir as never).sql];

const left = () => leftJoin({ t: from(l) }, { q: from(r) }).on(x => x.t.k.eq(x.q.k));

describe('null-extended Tuple and JSON reads', () => {
  it('wrap a whole Tuple with its own type, on both emitters, and never the descriptor text', () => {
    for (const text of both(left().map(x => ({ tup: x.q.tup })).ir)) {
      expect(text).toContain(wrapped('q', 'tup'));
      expect(text).not.toContain(printed);
      expect(text).not.toContain("defaultValueOfTypeName('");
      expect(text).not.toMatch(/\{p\d+:/);
    }
  });

  it('wrap JSON', () => {
    for (const text of both(left().map(x => ({ js: x.q.js })).ir))
      expect(text).toContain(wrapped('q', 'js'));
  });

  it('wrap under element, where, orderBy, groupBy and raw sql in a folded join block', () => {
    const q = left()
      .where(x => x.q.tup.element('x`y').eq(0))
      .orderBy(x => x.q.tup.element('x`y'))
      .map(x => ({ v: x.q.tup.element('x`y'), s: sql`toString(${x.q.tup})`.as(col.String) }));

    const text = compile(q.ir).sql;
    // The computed select list nests over the join block and reads its one wrapped leaf.
    expect(text.match(/defaultValueOfTypeName/g)!.length).toBe(3);
    expect(text).toContain(`SELECT ${wrapped('q', 'tup')} AS \`__typedhouse_leaf_`);
    expect(text).toMatch(/WHERE .*CAST\(ifNull\(`q`\.`tup`/);
    expect(text).toMatch(/ORDER BY .*CAST\(ifNull\(`q`\.`tup`/);
  });

  it('extend only the null-extended input, per kind', () => {
    const kinds = {
      leftJoin: leftJoin({ t: from(l) }, { q: from(r) }),
      rightJoin: rightJoin({ t: from(l) }, { q: from(r) }),
      fullJoin: fullJoin({ t: from(l) }, { q: from(r) }),
    };

    const expected = { leftJoin: ['q'], rightJoin: ['t'], fullJoin: ['t', 'q'] };

    for (const [name, builder] of Object.entries(kinds)) {
      const q = (builder as any)
        .on((x: any) => x.t.k.eq(x.q.k))
        .map((x: any) => ({ a: x.t.tup, b: x.q.tup }));

      for (const text of both(q.ir)) {
        const aliases = [...text.matchAll(/ifNull\(`(\w+)`\.`tup`/g)].map(m => m[1]);
        expect(aliases.sort(), name).toEqual(expected[name as keyof typeof expected].sort());
      }
    }

    const asof = asofLeftJoin({ t: from(l) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .asof(x => x.t.ts.ge(x.q.ts))
      .map(x => ({ a: x.t.tup, b: x.q.tup }));

    for (const text of both(asof.ir)) expect(text.match(/ifNull\(`q`\.`tup`/g)).toHaveLength(1);
  });

  it('leave inner joins, ON conditions, other kinds and Nullable members alone', () => {
    const inner = join({ t: from(l), q: from(r) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ tup: x.q.tup, js: x.q.js }));

    for (const text of both(inner.ir)) expect(text).not.toContain('ifNull');

    const on = asofLeftJoin({ t: from(l) }, { q: from(r) })
      .on(x => x.t.k.eq(x.q.tup.element('x`y')))
      .asof(x => x.t.ts.ge(x.q.ts))
      .map(x => ({ k: x.t.k }));

    for (const text of both(on.ir))
      expect(text).toMatch(/ON \(?`t`\.`k` = tupleElement\(`q`\.`tup`, \{p0:String\}\)/);

    const others = left().map(x => ({ nt: x.q.nt, arr: x.q.arr }));
    for (const text of both(others.ir)) expect(text).not.toMatch(/ifNull\(`q`\.`(nt|arr|k|ts)`/);
  });

  it('leave a declared Nullable(Tuple) unwrapped', () => {
    const n = table(
      'n',
      { k: col.UInt8, nt: col.Nullable(col.Tuple({ a: col.UInt8 }) as never) },
      opts,
    );

    const q = leftJoin({ t: from(l) }, { q: from(n) })
      .on(x => x.t.k.eq(x.q.k))
      .map(x => ({ nt: (x.q as any).nt }));

    for (const text of both(q.ir)) expect(text).not.toContain('ifNull');
  });
});
