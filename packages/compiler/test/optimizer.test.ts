import { expect, it } from 'vitest';
import { col, table, from, val } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';

const products = table('products', { id: col.UInt64, category: col.String, stock: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const selects = (sql: string) => sql.match(/SELECT /g)?.length;

it('folds scan/filter/sort/limit without changing metadata, parameters or IR', () => {
  const q = from(products).where(r => r.category.eq('books')).orderBy(r => r.stock.desc()).limit(10);
  const before = JSON.stringify(q.ir);
  const result = compile(q.ir);
  expect(result.sql).toBe('SELECT `__chql_input`.`id`, `__chql_input`.`category`, `__chql_input`.`stock` FROM `products` AS `__chql_input` WHERE (`__chql_input`.`category` = {p0:String}) ORDER BY `__chql_input`.`stock` DESC LIMIT 10');
  const naive = emitNaive(q.ir);
  expect(selects(naive.sql)).toBe(4);
  expect({ ...result, sql: '' }).toEqual({ ...naive, sql: '' });
  expect(JSON.stringify(q.ir)).toBe(before);
});

it('keeps reversed and repeated clause boundaries', () => {
  const q = from(products);
  const cases = [
    q.limit(2).where(r => r.stock.eq(1n)),
    q.limit(2).orderBy(r => r.stock),
    q.orderBy(r => r.stock).where(r => r.stock.eq(1n)),
    q.limit(4, 1).limit(2, 1),
  ];
  for (const query of cases) expect(selects(compile(query.ir).sql)).toBe(2);
  expect(compile(cases[1]!.ir).sql).toContain('LIMIT 2) AS `__chql_input` ORDER BY');
  expect(compile(cases[3]!.ir).sql).toContain('LIMIT 4 OFFSET 1) AS `__chql_input` LIMIT 2 OFFSET 1');
});

it('folds above but not through projection and distinct fences', () => {
  const q = from(products).map(r => ({ stock: r.stock.plus(1n) })).distinct()
    .where(r => r.stock.eq(2n)).orderBy(r => r.stock).limit(1);
  expect(selects(compile(q.ir).sql)).toBe(4);
  expect(compile(q.ir).sql).toContain('SELECT DISTINCT');
});

it('preserves shared parameter identity and textual allocation order', () => {
  const shared = val(2n, col.UInt64);
  const q = from(products).where(r => r.stock.eq(shared)).orderBy(r => r.id.plus(shared)).thenBy(r => r.stock.plus(3n)).limit(0);
  expect(compile(q.ir).params).toEqual({ p0: '2', p1: '3' });
  expect(compile(q.ir).parameterTypes).toEqual(emitNaive(q.ir).parameterTypes);
});

it('preserves scan hints and rejects foreign references and invalid limits', () => {
  const q = from(products).final().sample(0.5).limit(1);
  expect(compile(q.ir).sql).toContain('FROM `products` AS `__chql_input` FINAL SAMPLE 0.5 LIMIT 1');
  expect(() => compile(from(products).where(() => from(products).row.stock.eq(1n)).ir)).toThrow(/unbound_column/);
  expect(() => compile(from(products).limit(-1).ir)).toThrow(/invalid_limit/);
});
