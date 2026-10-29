import { expect, it } from 'vitest';
import { cast, col, count, crossJoin, from, join, scalar, sum, table, val } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] };
const a = from(table('left_table', { id: col.String, n: col.UInt32, extra: col.String }, meta));
const b = from(table('right_table', { id: col.String, n: col.UInt32 }, meta));
it('selects and spreads direct leaves, preserving bare versus pruned scans and unchanged naive SQL', () => {
  const q = join({ a, b }).on(r => r.a.id.eq(r.b.id)).map(r => ({ ...r.a, right: r.b.n }));
  const original = JSON.stringify(q.ir);
  expect(compile(q.ir).sql).toBe('SELECT `a`.`id` AS `id`, `a`.`n` AS `n`, `a`.`extra` AS `extra`, `b`.`n` AS `right`\nFROM `left_table` AS `a`\nINNER ALL JOIN `right_table` AS `b` ON `a`.`id` = `b`.`id`');
  expect(emitNaive(q.ir).sql).toContain('ON (`a`.`id` = `b`.`id`)');
  expect(emitNaive(q.ir).sql.match(/SELECT/g)).toHaveLength(4);
  const narrow = join({ a, b }).on(r => r.a.id.eq(r.b.id)).map(r => ({ id: r.a.id }));
  expect(compile(narrow.ir).sql).toContain('FROM (SELECT `id` FROM `left_table`) AS `a`');
  expect(compile(narrow.ir).sql).toContain('INNER ALL JOIN (SELECT `id` FROM `right_table`) AS `b`');
  expect(JSON.stringify(q.ir)).toBe(original);
});
it('places three-way conditions at the earliest valid occurrence and keeps nested paths', () => {
  const nested = crossJoin({ x: a, y: b });
  const q = join({ a: nested, b, c: a }).on(r => [r.a.x.id.eq(r.b.id), r.a.y.id.eq(r.c.id), r.b.id.eq(r.c.id)])
    .map(r => ({ left: r.a.x.n, right: r.a.y.n, end: r.c.n }));
  const compiled = compile(q.ir);
  expect(compiled.sql).toContain('`a`.`__chql_leaf_1` AS `left`, `a`.`__chql_leaf_4` AS `right`, `c`.`n` AS `end`');
  expect(compiled.sql).toContain('AS `b` ON `a`.`__chql_leaf_0` = `b`.`id`');
  expect(compiled.sql).toContain('AS `c` ON `a`.`__chql_leaf_3` = `c`.`id` AND `b`.`id` = `c`.`id`');
  expect(compiled.columns).toEqual(emitNaive(q.ir).columns);
});
it('keeps computed, materialized and clause-reversal boundaries, residual predicates and shared demands', () => {
  const shared = a.where(r => r.id.eq('x')).materialize();
  const q = join({ a: shared, b: shared }).on(r => [r.a.id.eq(r.b.id), r.a.n.lt(r.b.n)]).map(r => ({ n: r.a.n }));
  const compiled = compile(q.ir);
  expect(compiled.sql).toContain('WITH ');
  expect(compiled.sql).toContain('`a`.`n` < `b`.`n`');
  expect(compiled.params).toEqual({ p0: 'x' });
  const computed = crossJoin({ a: a.map(r => ({ id: r.id, bad: cast(r.extra, col.UInt32) })), b }).aggregate(() => ({ n: count() }));
  expect(compile(computed.ir).sql).toContain('CAST('); // unused fallible evaluation is not removed
  const limited = crossJoin({ a: a.limit(1), b }).orderBy(r => r.a.id).where(r => r.b.n.gt(0));
  expect(compile(limited.ir).sql).toContain('LIMIT 1');
  expect(compile(limited.ir).sql).toContain(') AS `__chql_input` WHERE');
});
it('renders precedence from the tree, keeps distinct equal Params and isolated scalar/IN scopes', () => {
  const one = val(1, col.Float64), another = val(1, col.Float64);
  const numbers = from(table('numbers', { n: col.Float64 }, meta));
  const q = crossJoin({ a: numbers, b: numbers }).map(r => ({
    n: r.a.n.divide(r.b.n.plus(one)),
    difference: r.a.n.minus(r.a.n.minus(another)),
    total: scalar(b.aggregate(g => ({ total: sum(g.n) }))),
  }));
  const c = compile(q.ir);
  expect(c.sql).toContain(' / (');
  expect(c.sql).toContain(' - (');
  expect(c.params).toEqual({ p0: '1', p1: '1' });
  const membership = crossJoin({ a, b }).where(r => r.a.id.in(b.map(r => r.id))).map(r => ({ id: r.a.id }));
  expect(compile(membership.ir).columns).toEqual(emitNaive(membership.ir).columns);
});
it('rejects unused invalid expressions before physical planning', () => {
  const foreign = b.row.id;
  const invalid = a.map(r => ({ id: r.id, unused: foreign }));
  const q = crossJoin({ a: invalid, b }).map(r => ({ id: r.a.id }));
  for (const emitter of [compile, emitNaive]) expect(() => emitter(q.ir)).toThrow('unbound_column');
});
