import { expect, it } from 'vitest';
import { col, from, table, val } from '@chql/core';
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
  expect(result.sql).toBe('SELECT `__chql_input`.`id`, `__chql_input`.`stock` FROM `products` AS `__chql_input` WHERE (greater(`__chql_input`.`stock`, {p0:UInt32})) AND ((`__chql_input`.`category` = {p1:String})) ORDER BY `__chql_input`.`stock` DESC LIMIT 10');
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
  expect(plan.params).toEqual(emitNaive(query.ir).params);
  expect(Object.values(plan.params)).toEqual(['2', '0', '10']);
  expect(plan.columns).toEqual({ id: col.UInt32.type });
});

it('keeps renames, computed columns, and projection after sort/limit as fences', () => {
  const q = from(products);
  const cases = [
    q.map(r => ({ stock: r.id, id: r.stock })).where(r => r.id.gt(0)),
    q.map(r => ({ stock: r.stock.plus(1) })).where(r => r.stock.gt(0n)),
    q.orderBy(r => r.stock).map(r => ({ id: r.id })).limit(1),
    q.limit(1).map(r => ({ id: r.id })).where(r => r.id.gt(0)),
  ];
  for (const query of cases) expect(countSelects(compile(query.ir).sql)).toBe(3);
});

it('folds inside set subqueries and retains the outer scope', () => {
  const inner = from(products).where(r => r.stock.gt(0)).where(r => r.category.eq('electronics')).map(r => ({ id: r.id }));
  const query = from(products).where(r => r.id.in(inner)).map(r => ({ id: r.id }));
  expect(countSelects(compile(query.ir).sql)).toBe(2);
  expect(compile(query.ir).params).toEqual(emitNaive(query.ir).params);
});
