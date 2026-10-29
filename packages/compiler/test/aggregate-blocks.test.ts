import { expect, it } from 'vitest';
import { col, count, from, max, sum, table, val, crossJoin, unionAll } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';
const q = from(table('rollup', { k: col.String, v: col.UInt64, nullable: col.Nullable(col.String) }, { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] }));
it('emits source WHERE, repeated keys, HAVING aliases and ordered window in one SELECT', () => {
  const query = q.where(r => r.v.gt(1n)).groupBy(r => ({ key: r.k })).aggregate(g => ({ n: count(), total: sum(g.v), highest: max(g.v) }))
    .where(r => r.key.eq('a').and(r.n.gt(1n))).orderBy(r => r.total.desc()).limit(2, 1);
  expect(rewriteRel(query.ir).hits.PushFilterAggKey).toBe(1);
  const compiled = compile(query.ir);
  expect(compiled.sql).toBe('SELECT `__chql_input`.`k` AS `key`, count() AS `n`, sum(`__chql_input`.`v`) AS `total`, max(`__chql_input`.`v`) AS `highest` FROM `rollup` AS `__chql_input` WHERE `__chql_input`.`v` > {p0:UInt64} AND `__chql_input`.`k` = {p1:String} GROUP BY `__chql_input`.`k` HAVING `n` > {p2:UInt64} ORDER BY `total` DESC LIMIT 2 OFFSET 1');
  expect(compiled.params).toEqual({ p0: '1', p1: 'a', p2: '1' });
  expect((emitNaive(query.ir).sql.match(/SELECT/g) ?? []).length).toBe(6);
});
it('repeats computed key Params without renumbering and preserves FINAL SAMPLE', () => {
  const p = val('empty');
  const query = q.final().sample(0.1).where(r => r.v.gt(2n)).groupBy(r => ({ key: r.nullable.ifNull(p) })).aggregate(() => ({ n: count() })).where(r => r.n.gt(0n));
  const a = compile(query.ir);
  expect(a.sql).toContain('AS `__chql_input` FINAL SAMPLE 0.1');
  expect(a.sql.match(/ifNull\(`__chql_input`.`nullable`, \{p0:String\}\)/g)).toHaveLength(2);
  expect(a.params).toEqual({ p0: 'empty', p1: '2', p2: '0' });
});
it('folds direct join sources while retaining derived Union sources', () => {
  const joined = crossJoin({ a: q, b: q });
  const query = joined.groupBy(r => ({ key: r.a.k })).aggregate(g => ({ total: sum(g.b.v) })).where(r => r.total.gt(1n));
  expect(compile(query.ir).sql).toContain('HAVING `total` >');
  expect(compile(query.ir).sql).toContain('CROSS JOIN');
  const union = unionAll(q, q).groupBy(r => ({ key: r.k })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n));
  expect(compile(union.ir).sql).toContain('UNION ALL');
  expect(compile(union.ir).sql).toContain('HAVING `n` >');
});
it('keeps computed aggregate ordering outside HAVING while preserving alias types', () => {
  const a = q.groupBy(r => ({ key: r.k })).aggregate(g => ({ n: sum(g.v) }));
  const query = a.where(r => r.n.gt(2n)).orderBy(r => r.n.plus(1n));
  const result = compile(query.ir);
  expect(result.sql).toBe('SELECT `__chql_input`.`key`, `__chql_input`.`n` FROM (SELECT `__chql_input`.`k` AS `key`, sum(`__chql_input`.`v`) AS `n` FROM `rollup` AS `__chql_input` GROUP BY `__chql_input`.`k` HAVING `n` > {p0:UInt64}) AS `__chql_input` ORDER BY `__chql_input`.`n` + {p1:UInt64} ASC');
  expect(result.params).toEqual({ p0: '2', p1: '1' });
  expect(result.columns).toEqual({ key: col.String.type, n: col.UInt64.type });
});
it('keeps collisions, clause reversals and global empty constants scoped', () => {
  const collision = q.groupBy(r => ({ key: r.k })).aggregate(g => ({ v: max(g.v) })).where(r => r.v.gt(1n));
  expect(compile(collision.ir).sql).not.toContain('HAVING');
  const a = q.groupBy(r => ({ key: r.k })).aggregate(() => ({ n: count() }));
  expect(compile(a.orderBy(r => r.n).where(r => r.n.gt(1n)).ir).sql).not.toContain('HAVING');
  const global = q.limit(0).aggregate(() => ({ n: count() })).where(() => val(false));
  expect(rewriteRel(global.ir).hits.PushFilterAggKey).toBe(0);
  expect(compile(global.ir).sql).toContain('LIMIT 0');
  expect(compile(global.ir).sql).toContain('HAVING {p0:Bool}');
});
