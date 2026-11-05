import { expect, it } from 'vitest';
import { col, from, leftJoin, print, table, val, type CHType, type Column } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { resolveCall } from '../src/resolve.js';
import { safePredicate, totalExpression, totalPredicate } from '../src/rewrite-expressions.js';

/** Slice 4e: `ifNull` over LowCardinality(Nullable(T)). 24.8 probe (TODO.md slice 4e): a constant fallback keeps the
 * LowCardinality wrapper (`ifNull(lc, {p:T})` is LowCardinality(T)), a non-constant one materializes it, so the emitter
 * pins the catalog's LowCardinality result with an idempotent toLowCardinality for every non-Param fallback. */
const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] };

const lcn = <T, D extends CHType>(c: Column<T, boolean, D>) => col.LowCardinality(col.Nullable(c));

const t = from(
  table(
    't',
    {
      id: col.UInt32,
      s: col.String,
      ns: col.Nullable(col.String),
      u64: col.UInt64,
      fs2: col.FixedString(2),
      ls: lcn(col.String),
      lfs: lcn(col.FixedString(2)),
      lu8: lcn(col.UInt8),
      lu32: lcn(col.UInt32),
      lu64: lcn(col.UInt64),
      ld: lcn(col.Date),
      ldt: lcn(col.DateTime('UTC')),
      dt: col.DateTime('UTC'),
      lf: lcn(col.Float64),
      li: lcn(col.Int32),
      lc: col.LowCardinality(col.String),
    },
    meta,
  ),
);

const both = (ir: Parameters<typeof compile>[0]) => [compile(ir), emitNaive(ir)] as const;

const typeOf = (ir: Parameters<typeof compile>[0]) => Object.values(compile(ir).columns).map(print);

it('a JS fallback over LowCardinality(Nullable(T)) resolves to LowCardinality(T) on both emitters, for every probed T', () => {
  const cases: [string, unknown, string, string][] = [
    ['ls', 'z', 'LowCardinality(String)', 'String'],
    ['lfs', 'zz', 'LowCardinality(FixedString(2))', 'FixedString(2)'],
    ['lu8', 3, 'LowCardinality(UInt8)', 'UInt8'],
    ['lu32', 3, 'LowCardinality(UInt32)', 'UInt32'],
    ['lu64', 3n, 'LowCardinality(UInt64)', 'UInt64'],
    ['ld', new Date(Date.UTC(2020, 0, 2)), 'LowCardinality(Date)', 'Date'],
    ['lf', 1.5, 'LowCardinality(Float64)', 'Float64'],
    ['li', -1, 'LowCardinality(Int32)', 'Int32'],
  ];

  for (const [k, value, result, wire] of cases) {
    const q = t.map(r => ({ x: (r as any)[k].ifNull(value) }));
    expect(print((q.ir as any).exprs.x.type), k).toBe(result);

    for (const c of both(q.ir)) {
      expect(print(c.columns.x!), k).toBe(result);
      expect(c.sql, k).toContain(`ifNull(`);
      expect(c.sql, k).not.toContain('toLowCardinality');
      expect(c.sql, k).toContain(`{p0:${wire}}`);
    }
  }

  const [planned, naive] = both(t.map(r => ({ x: r.ls.ifNull('z') })).ir);
  expect(planned.sql).toBe('SELECT ifNull(`ls`, {p0:String}) AS `x` FROM `t`');

  expect(naive.sql).toBe(
    'SELECT ifNull(`__typedhouse_input`.`ls`, {p0:String}) AS `x` FROM (SELECT `id`, `s`, `ns`, `u64`, `fs2`, `ls`, `lfs`, `lu8`, `lu32`, `lu64`, `ld`, `ldt`, `dt`, `lf`, `li`, `lc` FROM `t`) AS `__typedhouse_input`',
  );
});

it('fallback kinds: typed constant, NULL, nullable constant, column, nullable column, LC column, across families', () => {
  expect(typeOf(t.map(r => ({ x: r.ls.ifNull(val('q')) })).ir)).toEqual(['LowCardinality(String)']);

  expect(typeOf(t.map(r => ({ x: r.lu32.ifNull(val(1.5)) })).ir)).toEqual([
    'LowCardinality(Float64)',
  ]);

  expect(
    typeOf(t.map(r => ({ x: r.lu32.ifNull(val(null, col.Nullable(col.UInt32))) })).ir),
  ).toEqual(['LowCardinality(Nullable(UInt32))']);

  const nul = t.map(r => ({ x: r.ls.ifNull(null) }));

  for (const c of both(nul.ir)) {
    expect(print(c.columns.x!)).toBe('LowCardinality(Nullable(String))');
    expect(c.sql).toContain('CAST(NULL AS Nullable(String))');
    expect(c.sql).not.toContain('toLowCardinality');
  }

  for (const [q, result] of [
    [t.map(r => ({ x: r.ls.ifNull(r.s) })), 'LowCardinality(String)'],
    [t.map(r => ({ x: r.ls.ifNull(r.ns) })), 'LowCardinality(Nullable(String))'],
    [t.map(r => ({ x: r.ls.ifNull(r.lc) })), 'LowCardinality(String)'],
    [t.map(r => ({ x: r.lu32.ifNull(r.u64 as never) })), 'LowCardinality(UInt64)'],
    // DateTime(tz) has no JS parameter path (pre-existing: param_incompatible for Nullable(DateTime) too); a column fallback.
    [t.map(r => ({ x: r.ldt.ifNull(r.dt) })), "LowCardinality(DateTime('UTC'))"],
    [t.map(r => ({ x: r.ls.ifNull(r.ls.ifNull('a')) })), 'LowCardinality(String)'],
  ] as const) {
    for (const c of both(q.ir)) {
      expect(print(c.columns.x!)).toBe(result);
      expect(c.sql).toMatch(/toLowCardinality\(ifNull\(/);
    }
  }

  const [planned] = both(t.map(r => ({ x: r.ls.ifNull(r.s) })).ir);
  expect(planned.sql).toBe('SELECT toLowCardinality(ifNull(`ls`, `s`)) AS `x` FROM `t`');

  // Across families the common type is Unknown: rejected, never LowCardinality(Unknown).
  expect(() => compile(t.map(r => ({ x: r.ls.ifNull(r.fs2 as never) })).ir)).toThrow(
    /invalid_expression_type|incompatible/,
  );

  expect(() => compile(t.map(r => ({ x: r.ls.ifNull(val(1n, col.Int64) as never) })).ir)).toThrow(
    /invalid_expression_type|incompatible/,
  );
});

it('unchanged neighbours: Nullable(T) and plain LowCardinality(T) receivers keep their result and SQL', () => {
  for (const c of both(
    t.map(r => ({
      x: r.ns.ifNull('z'),
      y: r.ns.ifNull(r.s),
      z: r.lc.ifNull('z'),
      w: r.lc.ifNull(r.s),
    })).ir,
  )) {
    expect(Object.values(c.columns).map(print)).toEqual([
      'String',
      'String',
      'LowCardinality(String)',
      'LowCardinality(String)',
    ]);

    expect(c.sql).not.toContain('toLowCardinality');
  }
});

it('isNull, isNotNull and comparisons over LowCardinality(Nullable(T)) resolve as their Nullable twins; resolveCall agrees with the builder', () => {
  const q = t.map(r => ({
    a: r.ls.isNull(),
    b: r.ls.isNotNull(),
    c: r.ls.eq('a'),
    d: r.ls.ne('a'),
    e: r.lu32.lt(3),
    f: r.lu32.le(3),
    g: r.lu32.gt(r.id),
    h: r.ls.ge(r.s),
    i: r.ls.ifNull('z').eq('a'),
  }));

  for (const c of both(q.ir))
    expect(Object.values(c.columns).map(print)).toEqual([
      'Bool',
      'Bool',
      'Nullable(Bool)',
      'Nullable(Bool)',
      'Nullable(Bool)',
      'Nullable(Bool)',
      'Nullable(Bool)',
      'Nullable(Bool)',
      'Bool',
    ]);

  // The builder's JS operand type mirrors the compiler's unwrap(sibling), so IR and resolver agree on every arm.
  const resolve = (e: any): CHType =>
    e.kind === 'Call'
      ? resolveCall(e, resolve).result
      : (e.type ?? { kind: 'scalar', name: 'String' });

  for (const e of Object.values((q.ir as any).exprs) as any[])
    expect(
      print(
        resolveCall(e, (x, want) => (x.kind === 'Param' && x.type === null ? want! : resolve(x)))
          .result,
      ),
    ).toBe(print(e.type));
});

it('total fragment: same-family ifNull over LowCardinality(Nullable) is total (like its Nullable twin), never safePredicate; cross-family is not', () => {
  const r = t.row;

  for (const e of [r.ls.ifNull('x'), r.ls.ifNull(r.s), r.lu32.ifNull(1), r.ls.ifNull(null)])
    expect(totalExpression(e.ir)).toBe(true);

  expect(totalPredicate(r.ls.ifNull('x').eq('y').ir)).toBe(
    totalPredicate(r.ns.ifNull('x').eq('y').ir),
  );

  expect(totalPredicate(r.ls.ifNull('x').eq('y').ir)).toBe(true);
  expect(safePredicate(r.ls.ifNull('x').eq('y').ir)).toBe(false);
  // Float and Date families stay outside the wide fragment exactly as for Nullable receivers.
  expect(totalExpression(r.lf.ifNull(1.5).ir)).toBe(false);
  expect(totalExpression(r.ld.ifNull('2020-01-01' as never).ir)).toBe(false);
  expect(totalExpression(r.lu32.ifNull(r.u64 as never).ir)).toBe(false);
});

it('through leftJoin: LC(String) and SAF(max, LC(String)) become LC(Nullable(String)) and ifNull gives LowCardinality(String) on both emitters', () => {
  const a = from(table('ja', { id: col.UInt32 }, meta));

  const b = from(
    table(
      'jb',
      {
        id: col.UInt32,
        lc: col.LowCardinality(col.String),
        saf: col.SimpleAggregateFunction('max', col.LowCardinality(col.String)),
        n: col.UInt32,
      },
      meta,
    ),
  );

  const j = leftJoin({ a }, { b }).on(r => r.a.id.eq(r.b.id));
  expect(print(j.row.b.lc.ir.type)).toBe('LowCardinality(Nullable(String))');
  expect(print(j.row.b.saf.ir.type!)).toBe('LowCardinality(Nullable(String))');

  const q = j.map(r => ({
    id: r.a.id,
    lc: r.b.lc.ifNull('none'),
    saf: r.b.saf.ifNull('none' as never),
    lcs: r.b.lc.ifNull(r.b.saf),
    w: r.b.lc.isNull(),
  }));

  for (const c of both(q.ir)) {
    expect(Object.values(c.columns).map(print)).toEqual([
      'UInt32',
      'LowCardinality(String)',
      'LowCardinality(String)',
      'LowCardinality(Nullable(String))',
      'Bool',
    ]);

    expect(c.sql).toContain('join_use_nulls = 1');
    expect(c.sql).toMatch(/toLowCardinality\(ifNull\(/);
  }

  // A WHERE over the LC(Nullable) ifNull is total but not null-rejecting: the join stays LEFT.
  const w = j.where(r => r.b.lc.ifNull('none').ne('x')).map(r => ({ id: r.a.id }));
  expect(compile(w.ir).sql).toContain('LEFT ALL JOIN');
});
