import { expect, it } from 'vitest';
import { cast, col, table, from, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

const products = table('products', { id: col.UInt64, category: col.String, stock: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const selects = (sql: string) => sql.match(/SELECT /g)?.length;

it('folds scan/filter/sort/limit without changing metadata, parameters or IR', () => {
  const q = from(products).where(r => r.category.eq('books')).orderBy(r => r.stock.desc()).limit(10);
  const before = JSON.stringify(q.ir);
  const result = compile(q.ir);
  expect(result.sql).toBe('SELECT `id`, `category`, `stock` FROM `products` WHERE `category` = {p0:String} ORDER BY `stock` DESC LIMIT 10');
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
  expect(compile(cases[1]!.ir).sql).toContain('LIMIT 2) AS `__typedhouse_input` ORDER BY');
  expect(compile(cases[3]!.ir).sql).toContain('LIMIT 4 OFFSET 1) AS `__typedhouse_input` LIMIT 2 OFFSET 1');
});

it('folds above but not through projection and distinct fences', () => {
  // DISTINCT folds over the computed selection; the filter after it opens a new block (WHERE precedes DISTINCT).
  const q = from(products).map(r => ({ next: r.stock.plus(1n) })).distinct()
    .where(r => r.next.eq(2n)).orderBy(r => r.next).limit(1);
  expect(selects(compile(q.ir).sql)).toBe(2);
  expect(compile(q.ir).sql).toBe('SELECT `__typedhouse_input`.`next` FROM (SELECT DISTINCT `stock` + {p0:UInt64} AS `next` FROM `products`) AS `__typedhouse_input` WHERE `__typedhouse_input`.`next` = {p1:UInt64} ORDER BY `__typedhouse_input`.`next` ASC LIMIT 1');
  // A computed alias shadowing a physical column that nothing else in its block reads folds (slice 3); the filter
  // after DISTINCT still opens the second block, which reads the alias from the derived table.
  const shadowed = from(products).map(r => ({ stock: r.stock.plus(1n) })).distinct()
    .where(r => r.stock.eq(2n)).orderBy(r => r.stock).limit(1);
  expect(selects(compile(shadowed.ir).sql)).toBe(2);
  expect(compile(shadowed.ir).sql).toContain('FROM (SELECT DISTINCT `stock` + {p0:UInt64} AS `stock` FROM `products`) AS `__typedhouse_input` WHERE');
  expect(selects(compile(from(products).where(r => r.stock.gt(1n)).map(r => ({ stock: r.stock.plus(1n) })).ir).sql)).toBe(2); // the WHERE reads `stock`
  // Reversed: DISTINCT after ORDER BY still fences, and no DISTINCT is emitted where the IR has none.
  const reversed = from(products).where(r => r.stock.gt(1n)).orderBy(r => r.stock).distinct();
  expect(selects(compile(reversed.ir).sql)).toBe(2);
  expect(compile(reversed.ir).sql).toBe('SELECT DISTINCT `__typedhouse_input`.`id`, `__typedhouse_input`.`category`, `__typedhouse_input`.`stock` FROM (SELECT `id`, `category`, `stock` FROM `products` WHERE `stock` > {p0:UInt64} ORDER BY `stock` ASC) AS `__typedhouse_input`');
  expect(compile(from(products).where(r => r.stock.gt(1n)).orderBy(r => r.stock).ir).sql).not.toContain('DISTINCT');
  // (viii) A whole-row selection after DISTINCT folds, so distinct().map(identity).orderBy() is one SELECT; a narrower one keeps two.
  const whole = from(products).distinct().map(r => ({ id: r.id, category: r.category, stock: r.stock })).orderBy(r => r.id);
  expect(selects(compile(whole.ir).sql)).toBe(1);
  expect(compile(whole.ir).sql).toBe('SELECT DISTINCT `id`, `category`, `stock` FROM `products` ORDER BY `id` ASC');
  // A narrower selection is still naive-emitted over the DISTINCT block, and the sort above it opens its own block.
  expect(selects(compile(from(products).distinct().map(r => ({ id: r.id })).orderBy(r => r.id).ir).sql)).toBe(3);
});

it('isolates a filter outside the total fragment from earlier filters (slice 3b)', () => {
  // The cast must only ever see the rows the category filter passes: it keeps its own SELECT above that WHERE instead of
  // being AND-ed into it (the server would evaluate the conjuncts in its own order); sort and limit fold above it.
  const q = from(products).where(r => r.category.eq('books')).where(r => cast(r.category, col.UInt64).gt(1n)).orderBy(r => r.stock.desc()).limit(10);
  expect(selects(compile(q.ir).sql)).toBe(2);
  expect(compile(q.ir).sql).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`category`, `__typedhouse_input`.`stock` FROM (SELECT `id`, `category`, `stock` FROM `products` WHERE `category` = {p0:String}) AS `__typedhouse_input` WHERE CAST(`__typedhouse_input`.`category` AS UInt64) > {p1:UInt64} ORDER BY `__typedhouse_input`.`stock` DESC LIMIT 10');
  expect(compile(q.ir).params).toEqual(emitNaive(q.ir).params);
  // Reversed, the total filter is not AND-ed into the fallible WHERE either; a fallible filter alone is the block's first WHERE.
  expect(compile(from(products).where(r => cast(r.category, col.UInt64).gt(1n)).where(r => r.category.eq('books')).ir).sql).toContain('WHERE CAST(`category` AS UInt64) > {p0:UInt64}) AS `__typedhouse_input` WHERE `__typedhouse_input`.`category` = {p1:String}');
  expect(selects(compile(from(products).where(r => cast(r.category, col.UInt64).gt(1n)).ir).sql)).toBe(1);
});

it('preserves shared parameter identity and textual allocation order', () => {
  const shared = val(2n, col.UInt64);
  const q = from(products).where(r => r.stock.eq(shared)).orderBy(r => r.id.plus(shared)).thenBy(r => r.stock.plus(3n)).limit(0);
  expect(compile(q.ir).params).toEqual({ p0: '2', p1: '3' });
  expect(compile(q.ir).parameterTypes).toEqual(emitNaive(q.ir).parameterTypes);
});

it('preserves scan hints and rejects foreign references and invalid limits', () => {
  const q = from(products).final().sample(0.5).limit(1);
  expect(compile(q.ir).sql).toContain('FROM `products` FINAL SAMPLE 0.5 LIMIT 1');
  expect(() => compile(from(products).where(() => from(products).row.stock.eq(1n)).ir)).toThrow(/unbound_column/);
  expect(() => compile(from(products).limit(-1).ir)).toThrow(/invalid_limit/);
});
