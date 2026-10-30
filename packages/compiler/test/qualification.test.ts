import { expect, it } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { compile, emitNaive, quoteIdentifier } from '../src/index.js';

const t = table('t', { id: col.UInt32, stock: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });

it('omits qualifiers only inside physical-table blocks', () => {
  const q = from(t).orderBy(r => r.id).limit(2).where(r => r.stock.gt(0)).orderBy(r => r.id);
  expect(compile(q.ir).sql).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`stock` FROM (SELECT `id`, `stock` FROM `t` ORDER BY `id` ASC LIMIT 2) AS `__typedhouse_input` WHERE `__typedhouse_input`.`stock` > {p0:UInt32} ORDER BY `__typedhouse_input`.`id` ASC');
  expect(emitNaive(from(t).where(r => r.stock.gt(0)).ir).sql).toContain('greater(`__typedhouse_input`.`stock`, {p0:UInt32})');
});

it('retains alias scopes for renamed projections', () => {
  const q = from(t).map(r => ({ stock: r.id, id: r.stock })).where(r => r.stock.gt(0));
  expect(compile(q.ir).sql).toContain('SELECT `__typedhouse_input`.`id` AS `stock`, `__typedhouse_input`.`stock` AS `id`');
  expect(compile(q.ir).sql).toContain('FROM (SELECT `id`, `stock` FROM `t` WHERE `id` > {p0:UInt32}) AS `__typedhouse_input`');
  expect(emitNaive(q.ir).sql).toContain('WHERE greater(`__typedhouse_input`.`stock`, {p0:UInt32})');
});

it('still quotes hostile column and table names without qualification', () => {
  const name = 'odd`table';
  const odd = table(name, { 'a.b': col.UInt32, 'select': col.String, '__typedhouse_input': col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
  const q = from(odd).where(r => r['a.b'].gt(0)).where(r => r.select.eq('x')).orderBy(r => r.__typedhouse_input);
  const result = compile(q.ir);
  expect(result.sql).toBe(`SELECT \`a.b\`, \`select\`, \`__typedhouse_input\` FROM ${quoteIdentifier(name)} WHERE \`a.b\` > {p0:UInt32} AND \`select\` = {p1:String} ORDER BY \`__typedhouse_input\` ASC`);
  expect(result.params).toEqual(emitNaive(q.ir).params);
});
