import { afterEach, expect, it, vi } from 'vitest';
import { col, from, table } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';

const events = table('events', { id: col.UInt32, tenant: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
afterEach(() => vi.restoreAllMocks());

it('selects columns directly from a CTE without wrapping its reference', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const input = from(events).where(r => r.tenant.eq('acme')).materialize();
  const query = input.map(r => ({ id: r.id }));
  const result = compile(query.ir);
  expect(result.sql).toBe('WITH `t0` AS (SELECT `id`, `tenant` FROM `events` WHERE `tenant` = {p0:String}) SELECT `t0`.`id` FROM `t0`');
  expect(result.params).toEqual(emitNaive(query.ir).params);
  expect(result.columns).toEqual({ id: col.UInt32.type });
});

it('folds subsequent clauses and repeated selections while retaining the CTE boundary', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const input = from(events).limit(10).materialize();
  const query = input.map(r => ({ id: r.id })).map(r => ({ id: r.id }))
    .where(r => r.id.gt(2)).orderBy(r => r.id.desc()).limit(3);
  const result = compile(query.ir);
  expect(result.sql).toContain('SELECT `t0`.`id` FROM `t0` WHERE `t0`.`id` > {p0:UInt32} ORDER BY `t0`.`id` DESC LIMIT 3');
  expect(result.sql.match(/SELECT /g)).toHaveLength(2);
  expect(result.sql).toContain('LIMIT 10)');
});

it('keeps renamed and computed projections in explicit scopes', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const input = from(events).materialize();
  for (const query of [input.map(r => ({ renamed: r.id })), input.map(r => ({ id: r.id.plus(1) }))]) {
    expect(compile(query.ir).sql).toContain(') AS `__chql_input`');
  }
});
