import { describe, expect, it, vi } from 'vitest';
import { col, count, crossJoin, from, join, max, outputLeaves, scalar, table, unionAll, val, cast, flatOutput, Query, type Rel } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
import { pruneColumns } from '../src/prune-columns.js';
const wide = from(table('wide', { id: col.String, tenant: col.String, unused: col.String, amount: col.UInt64, ids: col.Array(col.String) }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] }));
const names = (root: Rel, node: Rel) => pruneColumns(root).get(node)?.map(l => l.path);
const metadata = (r: Rel) => {
  const a = compile(r), b = emitNaive(r);
  expect(a.columns).toEqual(b.columns); expect(a.columnPaths).toEqual(b.columnPaths);
  expect(a.nodes).toEqual(b.nodes);
};
describe('physical source-ordered demand', () => {
  it('selects source order, not discovery order, retaining filter/sort dependencies and hints', () => {
    const scan = wide.final().sample(0.25);
    const q = scan.where(r => r.tenant.eq('acme')).orderBy(r => r.amount).limit(2).map(r => ({ z: r.id }));
    expect(names(q.ir, scan.ir)).toEqual([['id'], ['tenant'], ['amount']]);
    expect(compile(q.ir).sql).toContain('SELECT `id` FROM `wide` FINAL SAMPLE 0.25 WHERE');
    expect(compile(q.ir).sql).toContain('ORDER BY `amount` ASC LIMIT 2');
    metadata(q.ir);
  });
  it('prunes renamed and swapped direct projections without changing their output order', () => {
    const p = wide.map(r => ({ tenant: r.id, id: r.tenant, unused: r.unused }));
    const q = p.map(r => ({ z: r.id, a: r.tenant }));
    expect(names(q.ir, p.ir)).toEqual([['tenant'], ['id']]);
    expect(names(q.ir, wide.ir)).toEqual([['id'], ['tenant']]);
    expect(compile(q.ir).sql).not.toContain('unused');
    metadata(q.ir);
  });
  it('unions disjoint shared consumers independent of discovery order', () => {
    const shared = wide.map(r => ({ ...r }));
    for (const reverse of [false, true]) {
      const a = shared.map(r => ({ x: r.id })), b = shared.map(r => ({ x: r.tenant }));
      const q = reverse ? crossJoin({ b, a }) : crossJoin({ a, b });
      expect(names(q.ir, shared.ir)).toEqual([['id'], ['tenant']]);
      expect(names(q.ir, wide.ir)).toEqual([['id'], ['tenant']]);
      metadata(q.ir);
    }
  });
  it('does not merge structurally equal inputs or conflicting shared predicates', () => {
    const a = wide.final(), b = wide.final();
    const q = crossJoin({ a, b }).map(r => ({ x: r.a.id, y: r.b.amount }));
    expect(names(q.ir, a.ir)).toEqual([['id']]); expect(names(q.ir, b.ir)).toEqual([['amount']]);
    const shared = wide.map(r => ({ ...r }));
    const union = unionAll(shared.where(r => r.tenant.eq('a')).map(r => ({ x: r.id })), shared.where(r => r.tenant.eq('b')).map(r => ({ x: r.unused })));
    expect(names(union.ir, shared.ir)).toEqual([['id'], ['tenant'], ['unused']]);
    const distinct = { ...union.ir, all: false } as Rel;
    expect(compile(distinct).sql).toContain('UNION DISTINCT'); metadata(distinct);
  });
  it('keeps ON-only columns and stable transport ordinals across nested shared multiway joins', () => {
    const inner = join({ first: wide, second: wide }).on(r => r.first.tenant.eq(r.second.tenant));
    const outer = join({ inner, third: wide, again: inner }).on(r => [r.inner.first.id.eq(r.third.id), r.third.id.eq(r.again.second.id)]);
    const q = outer.map(r => ({ value: r.inner.second.amount, other: r.again.first.id }));
    expect(names(q.ir, wide.ir)).toEqual([['id'], ['tenant'], ['amount']]);
    expect(names(q.ir, inner.ir)).toEqual([['first', 'id'], ['second', 'id'], ['second', 'amount']]);
    const physical = pruneColumns(q.ir).get(inner.ir)!;
    expect(physical.map(l => l.name)).toEqual(['__chql_leaf_0', '__chql_leaf_5', '__chql_leaf_8']);
    expect(compile(q.ir).sql).not.toContain('unused'); metadata(q.ir);
  });
  it('retains unused cross sides and expansion multiplicity with deterministic carriers', () => {
    const expanded = wide.arrayJoin(r => r.ids, 'element');
    const q = crossJoin({ a: expanded, b: wide }).aggregate(() => ({ n: count() }));
    expect(names(q.ir, expanded.ir)).toEqual([['id']]);
    expect(names(q.ir, wide.ir)).toEqual([['id'], ['ids']]);
    const sql = compile(q.ir).sql;
    expect(sql).toContain('CROSS JOIN'); expect(sql).toContain('ARRAY JOIN');
    expect(sql).not.toContain('SELECT  FROM'); expect(sql).not.toContain('*');
    metadata(q.ir);
  });
  it('keeps computed outputs including unused fallible casts and all aggregate expressions', () => {
    const p = wide.map(r => ({ id: r.id, failure: cast(r.unused, col.UInt64), constant: val('x') }));
    const q = p.map(r => ({ id: r.id }));
    expect(names(q.ir, p.ir)).toEqual([['id'], ['failure'], ['constant']]);
    expect(names(q.ir, wide.ir)).toEqual([['id'], ['unused']]);
    expect(compile(q.ir).sql).toContain('CAST(');
    const a = wide.groupBy(r => ({ t: r.tenant })).aggregate(r => ({ n: count(), m: max(r.amount) }));
    const projected = a.map(r => ({ n: r.n }));
    expect(names(projected.ir, a.ir)).toEqual([['t'], ['n'], ['m']]);
    expect(names(projected.ir, wide.ir)).toEqual([['tenant'], ['amount']]);
    metadata(projected.ir);
  });
  it('keeps full distinct/union/materialize interfaces while pruning below', () => {
    const base = wide.map(r => ({ id: r.id, tenant: r.tenant }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const fence of [base.distinct(), unionAll(base, base), base.materialize()]) {
        const q = fence.map(r => ({ id: r.id }));
        expect(names(q.ir, fence.ir)).toEqual([['id'], ['tenant']]);
        expect(names(q.ir, wide.ir)).toEqual([['id'], ['tenant']]); metadata(q.ir);
      }
    } finally { warn.mockRestore(); }
  });
  it('isolates scalar and IN scopes and preserves Param objects and final textual names', () => {
    const inner = wide.where(r => r.tenant.eq('inner')).aggregate(r => ({ n: max(r.amount) }));
    const set = wide.map(r => ({ id: r.id }));
    const q = wide.where(r => r.id.in(set)).map(r => ({ n: scalar(inner), id: r.id, p: val('outer') }));
    const sql = compile(q.ir);
    expect(names(q.ir, inner.ir)).toEqual([['n']]);
    expect(names(q.ir, wide.ir)).toEqual([['id'], ['tenant'], ['amount']]);
    expect(sql.params).toEqual({ p0: 'inner', p1: 'outer' });
    metadata(q.ir);
    expect(compile(q.ir)).toEqual(sql);
  });
  it('preserves numeric/dotted/colliding source order from authoritative schemas', () => {
    const source = from(table('odd', { '2': col.String, '10': col.String, 'a.b': col.String, __chql_leaf_0: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const output = flatOutput([['10', col.String.type], ['2', col.String.type], ['a.b', col.String.type], ['__chql_leaf_0', col.String.type]]);
    const manual = { ...source.ir, output } as Rel;
    const q = crossJoin({ source, other: source }).map(r => ({ x: r.source['a.b'], y: r.other.__chql_leaf_0 }));
    expect(outputLeaves(manual.output).map(l => l.name)).toEqual(['10', '2', 'a.b', '__chql_leaf_0']);
    expect(pruneColumns(manual).get(manual)?.map(l => l.name)).toEqual(output.order);
    const ordered = new Query<{ '10': string; '2': string; 'a.b': string; __chql_leaf_0: string }>(manual, { live: false });
    const subset = ordered.map(r => ({ second: r['2'], first: r['10'] }));
    if (subset.ir.kind !== 'Project') throw new Error('expected project');
    expect(names(subset.ir, subset.ir.input)).toEqual([['10'], ['2']]);
    expect(compile(subset.ir).sql).toContain('SELECT `10`, `2` FROM `odd`');
    expect(compile(q.ir).sql).toContain('SELECT `source`.`a.b` AS `x`, `other`.`__chql_leaf_0` AS `y`');
    // The direct selection now bypasses transport aliases; the logical nested
    // output still reserves collision-free transport names for derived uses.
    if (q.ir.kind !== 'Project') throw new Error('shape');
    expect(outputLeaves(q.ir.input.output).map(l => l.name).every(n => n.startsWith('__chql_leaf__'))).toBe(true);
    metadata(q.ir);
  });
  it('keeps nested expansion dependencies and output aliases through sort/limit scopes', () => {
    const joined = crossJoin({ a: wide, b: wide });
    const expanded = joined.leftArrayJoin(r => r.b.ids, 'element');
    const q = expanded.orderBy(r => r.element).limit(3).map(r => ({ id: r.a.id }));
    expect(names(q.ir, wide.ir)).toEqual([['id'], ['ids']]);
    expect(names(q.ir, joined.ir)).toEqual([['a', 'id'], ['b', 'ids']]);
    expect(compile(q.ir).sql).toContain('LEFT ARRAY JOIN');
    expect(compile(q.ir).sql).toContain('ORDER BY'); metadata(q.ir);
  });
  it('keeps shared equal-valued Params distinct and repeated objects stable in final text', () => {
    const one = val('equal'), two = val('equal');
    const q = wide.where(r => r.tenant.eq(two)).map(r => ({ first: one, again: one, id: r.id }));
    const result = compile(q.ir);
    expect(result.params).toEqual({ p0: 'equal', p1: 'equal' });
    expect(result.sql.match(/\{p0:String\}/g)).toHaveLength(2);
    expect(result.sql.indexOf('{p0:String}')).toBeLessThan(result.sql.indexOf('{p1:String}'));
    expect(q.ir.kind === 'Project' && q.ir.exprs.first).toBe(one.ir);
  });
  it('revisits already processed shared nested inputs when a deeper consumer adds demand', () => {
    const shared = crossJoin({ left: wide, right: wide });
    const early = shared.map(r => ({ x: r.left.id }));
    const late = shared.map(r => ({ value: r.right.amount, ignored: r.left.unused }))
      .map(r => ({ renamed: r.value })).map(r => ({ x: r.renamed }));
    for (const root of [crossJoin({ early, late }), crossJoin({ late, early })]) {
      expect(names(root.ir, shared.ir)).toEqual([['left', 'id'], ['right', 'amount']]);
      expect(pruneColumns(root.ir).get(shared.ir)?.map(l => l.name)).toEqual(['__chql_leaf_0', '__chql_leaf_8']);
      expect(names(root.ir, wide.ir)).toEqual([['id'], ['amount']]);
      expect(compile(root.ir).sql).not.toContain('unused');
      metadata(root.ir);
    }
  });
  it('keeps own prototype-like and dotted names distinct from nested occurrence paths', () => {
    const odd = from(table('odd_names', { ['__proto__']: col.String, constructor: col.String, 'a.b': col.String, unused: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const shared = crossJoin({ ['a.b']: odd, a: odd });
    const q = shared.map(r => ({ ['__proto__']: r['a.b'].__proto__, constructor: r.a.constructor, dotted: r.a['a.b'] }));
    expect(names(q.ir, shared.ir)).toEqual([['a.b', '__proto__'], ['a', 'constructor'], ['a', 'a.b']]);
    expect(names(q.ir, odd.ir)).toEqual([['__proto__'], ['constructor'], ['a.b']]);
    expect(compile(q.ir).sql).toContain('SELECT `__proto__`, `constructor`, `a.b` FROM `odd_names`');
    expect(Object.hasOwn(compile(q.ir).columns, '__proto__')).toBe(true);
    metadata(q.ir);
  });
  it('validates malformed unused expressions before planning; leaves caller graph immutable', () => {
    const p = wide.map(r => ({ id: r.id, bad: r.unused }));
    if (p.ir.kind !== 'Project') throw new Error('expected project');
    const bad = { ...p.ir, exprs: { ...p.ir.exprs, bad: { ...p.ir.exprs.bad!, rel: -99 } } } as unknown as Rel;
    const q = p.map(r => ({ id: r.id }));
    const malformed = { ...q.ir, input: bad } as Rel;
    expect(() => compile(malformed)).toThrow('unbound_column');
    const before = JSON.stringify(q.ir);
    expect(compile(q.ir)).toEqual(compile(q.ir));
    expect(JSON.stringify(q.ir)).toBe(before);
  });
});
