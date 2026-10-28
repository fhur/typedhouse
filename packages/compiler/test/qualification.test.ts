import { expect, it } from 'vitest';
import { col, from, table } from '@chql/core';
import { compile, emitNaive, quoteIdentifier } from '../src/index.js';

const t = table('t', { id: col.UInt32, stock: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });

it('omits qualifiers only inside physical-table blocks', () => {
  const q = from(t).orderBy(r => r.id).limit(2).where(r => r.stock.gt(0)).orderBy(r => r.id);
  expect(compile(q.ir).sql).toBe('SELECT `__chql_input`.`id`, `__chql_input`.`stock` FROM (SELECT `id`, `stock` FROM `t` ORDER BY `id` ASC LIMIT 2) AS `__chql_input` WHERE greater(`__chql_input`.`stock`, {p0:UInt32}) ORDER BY `__chql_input`.`id` ASC');
  expect(emitNaive(from(t).where(r => r.stock.gt(0)).ir).sql).toContain('greater(`__chql_input`.`stock`, {p0:UInt32})');
});

it('retains alias scopes for renamed projections', () => {
  const q = from(t).map(r => ({ stock: r.id, id: r.stock })).where(r => r.stock.gt(0));
  expect(compile(q.ir).sql).toContain('SELECT `__chql_input`.`id` AS `stock`, `__chql_input`.`stock` AS `id`');
  expect(compile(q.ir).sql).toContain('WHERE greater(`__chql_input`.`stock`, {p0:UInt32})');
});

it('still quotes hostile column and table names without qualification', () => {
  const name = 'odd`table';
  const odd = table(name, { 'a.b': col.UInt32, 'select': col.String, '__chql_input': col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(odd).where(r => r['a.b'].gt(0)).where(r => r.select.eq('x')).orderBy(r => r.__chql_input);
  const result = compile(q.ir);
  expect(result.sql).toBe(`SELECT \`a.b\`, \`select\`, \`__chql_input\` FROM ${quoteIdentifier(name)} WHERE greater(\`a.b\`, {p0:UInt32}) AND (\`select\` = {p1:String}) ORDER BY \`__chql_input\` ASC`);
  expect(result.params).toEqual(emitNaive(q.ir).params);
});
