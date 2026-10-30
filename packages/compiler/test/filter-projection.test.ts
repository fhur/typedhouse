import { expect, it } from 'vitest';
import { col, from, table, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { planSelects } from '../src/plan-selects.js';

const products = table('products', { id: col.UInt32, category: col.String, stock: col.UInt32 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const countSelects = (sql: string) => sql.match(/SELECT /g)?.length;

it('folds the available-products example into one SELECT', () => {
  const available = from(products).where(p => p.stock.gt(0));
  const query = available.where(p => p.category.eq('electronics'))
    .map(p => ({ id: p.id, stock: p.stock })).orderBy(p => p.stock.desc()).limit(10);
  const before = JSON.stringify(query.ir);
  const naive = emitNaive(query.ir);
  const result = compile(query.ir);
  expect(result.sql).toBe('SELECT `id`, `stock` FROM `products` WHERE `stock` > {p0:UInt32} AND `category` = {p1:String} ORDER BY `stock` DESC LIMIT 10');
  expect({ ...result, sql: '' }).toEqual({ ...naive, sql: '' });
  expect(JSON.stringify(query.ir)).toBe(before);
  expect(countSelects(compile(available.ir).sql)).toBe(1);
  const plan = planSelects(query.ir, Object.values(naive.nodes));
  expect(plan.blocks.get(query.ir)?.clauses.map(node => node.kind)).toEqual(['Filter', 'Filter', 'Sort', 'Limit']);
});

it('folds repeated selections and filters while keeping parameter identities', () => {
  const shared = val(2, col.UInt32);
  const query = from(products).where(r => r.stock.gt(shared).or(r.id.eq(0)))
    .map(r => ({ stock: r.stock, id: r.id })).where(r => r.stock.lt(10))
    .map(r => ({ id: r.id })).where(r => r.id.eq(shared)).orderBy(r => r.id).limit(0);
  const plan = compile(query.ir);
  expect(countSelects(plan.sql)).toBe(1);
  expect(plan.sql).toContain('WHERE (`stock` > {p0:UInt32} OR `id` = {p1:UInt32}) AND `stock` < {p2:UInt32} AND `id` = {p0:UInt32}');
  expect(plan.params).toEqual(emitNaive(query.ir).params);
  expect(Object.values(plan.params)).toEqual(['2', '0', '10']);
  expect(plan.columns).toEqual({ id: col.UInt32.type });
});

it('pushes renames while keeping computed columns and sort/limit as fences', () => {
  const q = from(products);
  const cases = [
    q.map(r => ({ stock: r.id, id: r.stock })).where(r => r.id.gt(0)),
    q.map(r => ({ stock: r.stock.plus(1) })).where(r => r.stock.gt(0n)),
    q.orderBy(r => r.stock).map(r => ({ id: r.id })).limit(1),
    q.limit(1).map(r => ({ id: r.id })).where(r => r.id.gt(0)),
  ];
  expect(cases.map(query => countSelects(compile(query.ir).sql))).toEqual([2, 3, 3, 2]);
  expect(compile(cases[0]!.ir).sql).toContain('WHERE `stock` > {p0:UInt32}');
  expect(compile(cases[3]!.ir).sql).toContain('LIMIT 1) AS `__typedhouse_input` WHERE `__typedhouse_input`.`id` > {p0:UInt32}');
});

it('folds inside set subqueries and retains the outer scope', () => {
  const inner = from(products).where(r => r.stock.gt(0)).where(r => r.category.eq('electronics')).map(r => ({ id: r.id }));
  const query = from(products).where(r => r.id.in(inner)).map(r => ({ id: r.id }));
  expect(countSelects(compile(query.ir).sql)).toBe(2);
  expect(compile(query.ir).params).toEqual(emitNaive(query.ir).params);
});
