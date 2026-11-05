import { describe, expect, it } from 'vitest';
import { Query, registerCompiler, cast, col, count, exprNode, flatOutput, from, join, leftJoin, max, now, relNode, scalar, sql as rawSql, sum, table, unionAll, val, type ExprNode, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';
import { pruneColumns } from '../src/prune-columns.js';
import { rewriteRel } from '../src/rewrite-rel.js';

/** Track C4 Tester probes for the IR, passes and SQL text of LIMIT BY. Native behaviour is in limit-by-adversarial.integration.ts. */
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const t = table('t', { id: col.UInt32, cat: col.String, v: col.UInt32, s: col.String, n: col.Nullable(col.UInt32), tags: col.Array(col.String) }, meta);
const u = table('u', { id: col.UInt32, w: col.String }, meta);
const q = from(t);
const hand = (input: Rel, keys: readonly ExprNode[], n: number = 1, offset?: unknown) => relNode({ kind: 'LimitBy', input, n, ...(offset === undefined ? {} : { offset: offset as number }), keys, output: input.output });
const code = (build: () => unknown): string => {
  try { build(); } catch (error) { return (error as { code?: string; message: string }).code ?? (error as Error).message; }
  return 'accepted';
};
const every = [['compile', compile], ['emitNaive', emitNaive], ['validateRel', validateRel]] as const;
const scan = q.ir;
const literal = exprNode({ kind: 'Literal', type: col.UInt32.type, value: 2 });
const param = val(2, col.UInt32).ir;
const castOf = (expr: ExprNode) => { const { id: _id, ...rest } = cast(val(2, col.UInt32), col.UInt64).ir; return exprNode({ ...rest, expr } as Parameters<typeof exprNode>[0]); };
const scalarSub = exprNode({ kind: 'Subquery', usage: 'scalar', type: col.UInt32.type, rel: q.map(r => r.id).limit(1).ir });

describe('key rule on hand-built IR', () => {
  const columnFree: readonly (readonly [string, ExprNode])[] = [
    ['Literal 2 (positional on the server)', literal],
    ['Param', param],
    ['Cast of a Literal', castOf(literal)],
    ['Cast of a Param', castOf(param)],
    ['Call over Params', val(2, col.UInt32).plus(3).ir],
    ['Raw, no args', exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['2'], args: [] })],
    ['Raw over a Param only', exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['', ''], args: [param] })],
    ['scalar Subquery (its columns are another scope)', scalarSub],
    ['Cast of a scalar Subquery', castOf(scalarSub)],
    ['Call over a scalar Subquery', exprNode({ kind: 'Call', fn: { name: 'plus', deterministic: true, origin: 'typed' }, args: [scalarSub, param], type: col.UInt64.type })],
    ['Case over Params', whenThen()],
    ['now()', now().ir],
  ];
  function whenThen(): ExprNode {
    return exprNode({ kind: 'Case', branches: [{ when: val(true, col.Bool).ir, then: literal }], otherwise: param, type: col.UInt32.type });
  }
  for (const [path, emit] of every) {
    it.each(columnFree)(`${path} rejects %s`, (_name, key) => {
      expect(code(() => emit(hand(scan, [key])))).toBe('invalid_limit_by_key');
      expect(code(() => emit(hand(scan, [q.row.cat.ir, key])))).toBe('invalid_limit_by_key');
      expect(code(() => emit(hand(scan, [key, q.row.cat.ir])))).toBe('invalid_limit_by_key');
    });
    it(`${path} rejects aggregate keys, reading a column or not`, () => {
      const agg = max(exprNodeGrouped()).ir;
      expect(code(() => emit(hand(scan, [agg])))).not.toBe('accepted');
      expect(code(() => emit(hand(scan, [count().ir])))).not.toBe('accepted');
      const over = q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() }));
      expect(code(() => emit(hand(over.ir, [max(exprNodeGrouped(over.ir)).ir])))).not.toBe('accepted');
    });
    it(`${path} rejects an empty key list on every input shape, deep in the graph`, () => {
      const inputs = [scan, q.map(r => ({ id: r.id })).ir, q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).ir, join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).ir];
      for (const input of inputs) expect(code(() => emit(hand(input, [])))).toBe('invalid_limit_by_key');
      const bad = hand(scan, [literal]);
      expect(code(() => emit(relNode({ kind: 'Filter', input: bad, pred: val(true, col.Bool).ir, output: bad.output })))).toBe('invalid_limit_by_key');
      expect(code(() => emit(relNode({ kind: 'Union', inputs: [scan, bad], all: true, output: scan.output })))).toBe('invalid_limit_by_key');
    });
  }
  function exprNodeGrouped(rel: Rel = scan) {
    const v = exprNode({ kind: 'ColumnRef', rel: rel.id, path: [rel === scan ? 'v' : 'c'], type: col.UInt32.type, mode: 'grouped' });
    return wrap(v);
  }
  function wrap(ir: ExprNode) { return { ir, mode: 'grouped' } as never; }

  it('the compiler and the builder agree on what reads a column', () => {
    const reads: readonly ExprNode[] = [q.row.v.plus(1).ir, cast(q.row.s, col.UInt32).ir, q.row.v.in(from(u).map(r => r.id)).ir];
    for (const key of reads) {
      expect(code(() => compile(hand(scan, [key])))).toBe('accepted');
      expect(code(() => emitNaive(hand(scan, [key])))).toBe('accepted');
    }
  });
});

describe('key rule through the builder', () => {
  it.each([
    ['val', () => q.limitBy(() => val(2, col.UInt32))],
    ['val + val', () => q.limitBy(() => val(2, col.UInt32).plus(1))],
    ['cast of val', () => q.limitBy(() => cast(val(2, col.UInt32), col.UInt64))],
    ['sql without a column', () => q.limitBy(() => rawSql`2`.as(col.UInt32))],
    ['sql with a parameter only', () => q.limitBy(() => rawSql`${val(2, col.UInt32)}`.as(col.UInt32))],
    ['deferred sql', () => q.limitBy(() => rawSql`2` as never)],
    ['now()', () => q.limitBy(() => now())],
    ['scalar subquery reading a column of another scope', () => q.limitBy(() => scalar(q.aggregate(() => ({ c: count() }))))],
    ['empty array', () => q.limitBy(() => [])],
    ['nested array', () => q.limitBy(r => [[r.cat]] as never)],
    ['sparse array', () => q.limitBy(r => [, r.cat] as never)],
    ['ordering', () => q.limitBy(r => r.cat.desc() as never)],
    ['ordering in an array', () => q.limitBy(r => [r.cat, r.v.asc()] as never)],
    ['aggregate', () => q.limitBy(r => sum(r.v as never) as never)],
    ['the row itself', () => q.limitBy(r => r as never)],
    ['a join side', () => join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).limitBy(r => r.a as never)],
    ['a callback returning null', () => q.limitBy(() => null as never)],
  ])('%s is rejected', (_name, build) => {
    expect(code(build)).toMatch(/invalid_limit_by_key/);
  });

  it('a column of a different relation passes the builder only if the compiler then rejects it', () => {
    const foreign = q.limitBy(() => from(u).row.id).take(1);
    expect(code(() => compile(foreign.ir))).toBe('unbound_column');
    expect(code(() => emitNaive(foreign.ir))).toBe('unbound_column');
    const stale = q.limitBy(r => r.cat).take(1);
    expect(code(() => compile(stale.limitBy(() => q.row.cat).take(1).ir))).toBe('unbound_column');
  });

  it('a key reads the row in sql, and it stays parenthesized', () => {
    const query = q.limitBy(r => rawSql`${r.v} % 2`.as(col.UInt32)).take(1);
    expect(compile(query.ir).sql).toContain('LIMIT 1 BY');
    expect(emitNaive(query.ir).sql).toContain('LIMIT 1 BY');
  });
});

describe('n and offset', () => {
  const bad: readonly unknown[] = [-1, -0.5, 1.5, NaN, Infinity, -Infinity, 2 ** 53, 1e21, 5n, '1', null, undefined, true, {}, []];
  it.each(bad.map(value => [typeof value === 'bigint' ? `${value}n` : JSON.stringify(value) ?? String(value), value] as const))('builder rejects %s', (_name, value) => {
    expect(code(() => q.limitBy(r => r.cat).take(value as number))).toMatch(/invalid_limit/);
    expect(code(() => q.limitBy(r => r.cat).take(1).offset(value as number))).toMatch(/invalid_limit/);
  });
  for (const [path, emit] of every) {
    it(`${path} rejects them on hand-built IR`, () => {
      for (const value of bad) {
        if (value === undefined) continue;
        expect(code(() => emit(hand(scan, [q.row.cat.ir], value as number))), `n ${String(value)}`).toBe('invalid_limit');
        expect(code(() => emit(hand(scan, [q.row.cat.ir], 1, value))), `offset ${String(value)}`).toBe('invalid_limit');
      }
    });
  }
  it('the safe bounds print exactly and never in exponent form', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const query = q.limitBy(r => r.cat).take(max).offset(max);
    for (const emitted of [compile(query.ir), emitNaive(query.ir)]) expect(emitted.sql).toContain(`LIMIT ${max} OFFSET ${max} BY`);
    expect(compile(q.limitBy(r => r.cat).take(-0).offset(-0).ir).sql).toMatch(/LIMIT 0 OFFSET 0 BY/);
    expect(emitNaive(q.limitBy(r => r.cat).take(-0).offset(-0).ir).sql).toMatch(/LIMIT 0 OFFSET 0 BY/);
  });
  it('counts are inlined text, never parameters; key values are parameters, never inlined', () => {
    const compiled = compile(q.limitBy(r => r.v.plus(987654)).take(12).offset(34).ir);
    expect(compiled.sql).toContain('LIMIT 12 OFFSET 34 BY');
    expect(compiled.sql).not.toContain('987654');
    expect(Object.values(compiled.params)).toEqual(['987654']);
  });
  it('a hand-built offset of zero is kept, not treated as absent', () => {
    expect(compile(hand(scan, [q.row.cat.ir], 1, 0)).sql).toContain('LIMIT 1 OFFSET 0 BY');
    expect(emitNaive(hand(scan, [q.row.cat.ir], 1, 0)).sql).toContain('LIMIT 1 OFFSET 0 BY');
  });
});

/** Counts Filter conjunct-carrying nodes strictly below each LimitBy occurrence, relationally only. */
function filtersBelowLimitBys(root: Rel): number[] {
  const out: number[] = [];
  const children = (r: Rel): readonly Rel[] => 'input' in r ? [r.input] : r.kind === 'Join' ? r.inputs.map(([, i]) => i) : r.kind === 'Union' ? r.inputs : [];
  const filters = (r: Rel): number => (r.kind === 'Filter' ? 1 : 0) + children(r).reduce((n, c) => n + filters(c), 0);
  const walk = (r: Rel): void => { if (r.kind === 'LimitBy') out.push(filters(r.input)); children(r).forEach(walk); };
  walk(root);
  return out;
}

describe('no filter or projection crosses a LimitBy', () => {
  const top = q.orderBy(r => r.id).limitBy(r => r.cat).take(2);
  const cases: readonly (readonly [string, Rel])[] = [
    ['filter directly above', top.where(r => r.v.gt(1)).ir],
    ['filter on a key above', top.where(r => r.cat.eq('a')).ir],
    ['filter above an identity map', top.map(r => ({ id: r.id, cat: r.cat, v: r.v })).where(r => r.cat.eq('a')).ir],
    ['filter above a computed map', top.map(r => ({ id: r.id, k: r.v.plus(1) })).where(r => r.k.gt(1n)).ir],
    ['filter above a union of two', unionAll(top, q.orderBy(r => r.v).limitBy(r => r.cat).take(1)).where(r => r.v.gt(1)).ir],
    ['filter above a join input', join({ a: top, b: from(u) }).on(r => r.a.id.eq(r.b.id)).where(r => r.a.v.gt(1)).ir],
    ['null-rejecting filter above a left join', leftJoin({ a: top }, { b: top.map(r => ({ id: r.id, w: r.s })) }).on(r => r.a.id.eq(r.b.id)).where(r => r.b.w.eq('x')).ir],
    ['filter above an aggregate key', top.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).where(r => r.cat.eq('a')).ir],
    ['filter above an expansion', top.arrayJoin(r => r.tags, 'tag').where(r => r.cat.eq('a')).ir],
    ['filter above a distinct', top.distinct().where(r => r.cat.eq('a')).ir],
    ['filter above a limit', top.limit(1).where(r => r.cat.eq('a')).ir],
    ['filter above a sort', top.orderBy(r => r.v).where(r => r.cat.eq('a')).ir],
    ['filter above another LimitBy', top.limitBy(r => r.v).take(1).where(r => r.cat.eq('a')).ir],
    ['filter above a CTE', top.cte().where(r => r.cat.eq('a')).ir],
  ];
  it.each(cases)('%s', (_name, ir) => {
    const before = filtersBelowLimitBys(ir);
    expect(before.length).toBeGreaterThan(0);
    expect(filtersBelowLimitBys(rewriteRel(ir).root)).toEqual(before);
    expect(compile(ir).sql).toContain('LIMIT');
  });
  it('a filter on the rows of a retained group stays outside the LIMIT BY scope in the text', () => {
    const emitted = compile(top.where(r => r.cat.eq('a')).ir).sql;
    expect(emitted.indexOf('LIMIT 2 BY')).toBeLessThan(emitted.indexOf('WHERE'));
    expect(emitted).toContain(') AS');
  });
  it('a projection never joins the LIMIT BY select list', () => {
    const emitted = compile(top.map(r => ({ x: r.v.plus(1), cat: r.cat })).ir).sql;
    expect(emitted.match(/SELECT/g)).toHaveLength(2);
    const fallible = compile(top.map(r => ({ x: cast(r.s, col.UInt32) })).ir).sql;
    expect(fallible.match(/SELECT/g)).toHaveLength(2);
    const narrowed = compile(top.map(r => ({ id: r.id })).ir).sql;
    expect(narrowed.match(/SELECT/g)).toHaveLength(2);
  });
  it('MergeProject never merges across it', () => {
    const query = q.map(r => ({ a: r.v.plus(1), id: r.id })).limitBy(r => r.a).take(1).map(r => ({ b: r.a.plus(1n), id: r.id }));
    expect(rewriteRel(query.ir).hits.MergeProject).toBe(0);
  });
});

describe('column pruning with LimitBy', () => {
  const scanDemand = (root: Rel) => {
    const seen: string[][] = [];
    const rewritten = rewriteRel(root).root;
    const demand = pruneColumns(rewritten);
    const walk = (r: Rel): void => {
      if (r.kind === 'Scan') seen.push((demand.get(r) ?? []).map(l => l.name));
      else if ('input' in r) walk(r.input);
      else if (r.kind === 'Join') r.inputs.forEach(([, i]) => walk(i));
      else if (r.kind === 'Union') r.inputs.forEach(walk);
    };
    walk(rewritten);
    return seen;
  };
  it('reads a key that is not selected, and nothing else', () => {
    expect(scanDemand(q.limitBy(r => r.cat).take(1).map(r => ({ id: r.id })).ir)).toEqual([['id', 'cat']]);
  });
  it('reads every column of a computed key', () => {
    expect(scanDemand(q.limitBy(r => r.v.plus(r.n.ifNull(0))).take(1).map(r => ({ id: r.id })).ir).flat().sort()).toEqual(['id', 'n', 'v']);
  });
  it('reads through a renaming map, and prunes its unrelated items', () => {
    const query = q.map(r => ({ k: r.s, unused: r.tags, id: r.id })).limitBy(r => r.k).take(1).map(r => ({ id: r.id }));
    expect(scanDemand(query.ir).flat().sort()).toEqual(['id', 's']);
    expect(compile(query.ir).sql).not.toContain('`tags`');
  });
  it('both offset and take keep the demand after the node is replaced', () => {
    expect(scanDemand(q.limitBy(r => r.cat).take(1).offset(2).map(r => ({ id: r.id })).ir)).toEqual([['id', 'cat']]);
  });
  it('keys of two stacked LimitBy are both demanded', () => {
    const query = q.limitBy(r => r.cat).take(2).limitBy(r => r.v).take(1).map(r => ({ id: r.id }));
    expect(scanDemand(query.ir).flat().sort()).toEqual(['cat', 'id', 'v']);
  });
  it('a key on one join side is demanded from that side', () => {
    const query = join({ a: q, b: from(u) }).on(r => r.a.id.eq(r.b.id)).limitBy(r => r.a.cat).take(1).map(r => ({ w: r.b.w }));
    const [a, b] = scanDemand(query.ir);
    expect(a!.sort()).toEqual(['cat', 'id']);
    expect(b!.sort()).toEqual(['id', 'w']);
  });
  it('a sort key and a limit-by key demand separately over the same scan', () => {
    expect(scanDemand(q.orderBy(r => r.v).limitBy(r => r.cat).take(1).map(r => ({ id: r.id })).ir).flat().sort()).toEqual(['cat', 'id', 'v']);
  });
  it('the output order and types of the node are its input, whatever is pruned', () => {
    const taken = q.limitBy(r => r.cat).take(1);
    expect(compile(taken.ir).columns).toEqual(compile(q.ir).columns);
    expect(emitNaive(taken.ir).columns).toEqual(emitNaive(q.ir).columns);
  });
});

describe('planner', () => {
  const selects = (query: { ir: Rel }) => compile(query.ir).sql.match(/SELECT/g)!.length;
  it('never lets a second clause of the same rank share the block', () => {
    expect(selects(q.limitBy(r => r.cat).take(1).limitBy(r => r.v).take(1))).toBe(2);
    expect(selects(q.limit(1).limit(1))).toBe(2);
    expect(selects(q.limit(1).limitBy(r => r.cat).take(1))).toBe(2);
    expect(selects(q.limitBy(r => r.cat).take(1).orderBy(r => r.v))).toBe(2);
    expect(selects(q.limitBy(r => r.cat).take(1).where(r => r.v.gt(1)))).toBe(2);
    expect(selects(q.limitBy(r => r.cat).take(1).limit(1))).toBe(1);
    expect(selects(q.orderBy(r => r.v).limitBy(r => r.cat).take(1).limit(1))).toBe(1);
  });
  it('an aggregate, an expansion, a distinct over it open a new block', () => {
    const top = q.limitBy(r => r.cat).take(1);
    expect(selects(top.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })))).toBe(2);
    expect(selects(top.arrayJoin(r => r.tags, 'tag'))).toBe(2);
    expect(selects(top.distinct())).toBe(2);
    expect(selects(top.map(r => ({ id: r.id })))).toBe(2);
    expect(selects(top.map(r => ({ id: r.id, cat: r.cat, v: r.v, s: r.s, n: r.n, tags: r.tags })))).toBe(2);
  });
  it('the planned clause order is the only legal one for every fold', () => {
    const text = compile(q.where(r => r.v.gt(1)).distinct().orderBy(r => r.v).limitBy(r => r.cat).take(1).offset(1).limit(1, 1).ir).sql;
    expect(text.indexOf('WHERE')).toBeLessThan(text.indexOf('ORDER BY'));
    expect(text.indexOf('ORDER BY')).toBeLessThan(text.indexOf('LIMIT 1 OFFSET 1 BY'));
    expect(text.indexOf('LIMIT 1 OFFSET 1 BY')).toBeLessThan(text.lastIndexOf('LIMIT 1 OFFSET 1'));
    expect(text).toMatch(/^SELECT DISTINCT/);
  });
  it('final and sample stay on the scan under a folded LimitBy', () => {
    const r = table('r', { id: col.UInt32, cat: col.String }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] });
    expect(compile(from(r).final().limitBy(x => x.cat).take(1).ir).sql).toBe('SELECT `id`, `cat` FROM `r` FINAL LIMIT 1 BY `cat`');
    expect(compile(from(r).sample(0.5).limitBy(x => x.cat).take(1).ir).sql).toContain('SAMPLE 0.5 LIMIT 1 BY `cat`');
  });
  it('does not treat the output record type as hand-mutable', () => {
    expect(() => compile(relNode({ kind: 'LimitBy', input: scan, n: 1, keys: [q.row.cat.ir], output: flatOutput([['id', col.String.type]]) }))).toThrow();
  });
});

describe('rewrites and nesting', () => {
  it('a rebuilt LimitBy keeps an offset of zero', () => {
    const query = q.map(r => ({ id: r.id, cat: r.cat })).where(r => r.id.gt(1)).limitBy(r => r.cat).take(2).offset(0);
    expect(rewriteRel(query.ir).hits.PushFilterProject).toBe(1);
    expect(compile(query.ir).sql).toContain('LIMIT 2 OFFSET 0 BY');
  });
  for (const [path, emit] of every) {
    it(`${path} finds a bad LimitBy in a key subquery and a CTE`, () => {
      const bad = hand(from(u).map(r => ({ id: r.id })).ir, [literal]);
      const inKey = q.row.v.in(new Query(bad, { live: false }) as never).ir;
      expect(code(() => emit(hand(scan, [inKey])))).toBe('invalid_limit_by_key');
      const materialized = relNode({ kind: 'Materialize', input: bad, output: bad.output });
      expect(code(() => emit(materialized))).toBe('invalid_limit_by_key');
    });
  }
  it('a three-part key path through a nested join input', () => {
    const inner = join({ x: q, y: from(u) }).on(r => r.x.id.eq(r.y.id));
    const outer = join({ a: inner, b: from(u) }).on(r => r.a.x.id.eq(r.b.id)).limitBy(r => [r.a.y.w, r.b.w]).take(1);
    expect(code(() => compile(outer.ir))).toBe('accepted');
    expect(code(() => emitNaive(outer.ir))).toBe('accepted');
    expect(compile(outer.ir).sql).toContain('LIMIT 1 BY');
  });
  it('a LimitBy over a nested join is a join input with its nesting', () => {
    const inner = join({ x: q, y: from(u) }).on(r => r.x.id.eq(r.y.id)).limitBy(r => r.y.w).take(1);
    const outer = join({ a: inner, b: from(u) }).on(r => r.a.x.id.eq(r.b.id)).map(r => ({ id: r.a.x.id, w: r.a.y.w }));
    expect(compile(outer.ir).columns).toEqual(emitNaive(outer.ir).columns);
  });
  it('toSQL works on the take and the offset results', () => {
    registerCompiler(compile);
    const taken = q.limitBy(r => r.cat).take(1);
    expect(taken.toSQL().sql).toContain('LIMIT 1 BY');
    expect(taken.offset(2).toSQL().sql).toContain('LIMIT 1 OFFSET 2 BY');
  });
  it('a subquery over a LimitBy removes the live capability of its consumer', () => {
    const live = from(table('s', { id: col.UInt32 }, { ...meta, source: {} as never }));
    expect(live.caps.live).toBe(true);
    expect(live.where(r => r.id.in(live.limitBy(x => x.id).take(1).map(x => x.id))).caps.live).toBe(false);
  });
});
