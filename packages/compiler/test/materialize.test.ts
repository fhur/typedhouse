import { afterEach, expect, it, vi } from 'vitest';
import { col, from, table, val, unionAll, scalar, sum, relNode, flatOutput, type Rel } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
const source = from(table('t0', { id: col.UInt64, ['__proto__']: col.String, 'a.b': col.Nullable(col.String), __chql_input: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
afterEach(() => vi.restoreAllMocks());
it('emits explicit deterministic collision-safe CTEs without obsolete materialization warnings', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const hint = source.orderBy(r => r.id).limit(2).distinct().cte();
  const query = unionAll(hint, hint).cte();
  const plan = emitNaive(query.ir);
  expect(plan.sql).toMatch(/^WITH `t3` AS/);
  expect(plan.sql).toContain('WITH `t1` AS');
  expect(plan.sql).toContain('WITH `t2` AS');
  expect(plan.sql).toContain('SELECT `t1`.`id`, `t1`.`__proto__`, `t1`.`a.b`, `t1`.`__chql_input` FROM `t1`');
  expect(plan.sql).toContain('ORDER BY');
  expect(plan.sql).toContain('LIMIT 2');
  expect(plan.sql).toContain('SELECT DISTINCT');
  expect(warn).not.toHaveBeenCalled();
  const optimized = compile(query.ir);
  expect({ ...optimized, sql: '' }).toEqual({ ...plan, sql: '' });
  // Planned hints are scheduled once by identity, rather than repeated local WITHs.
  expect(optimized.sql).toMatch(/^WITH `t1` AS/);
  expect([...optimized.sql.matchAll(/`t\d+` AS \(/g)].map(m => m[0])).toEqual(['`t1` AS (', '`t2` AS (']);
  expect(optimized.sql).not.toContain('`t3`');
  expect(optimized.sql).toContain('ORDER BY `id` ASC LIMIT 2');
  expect(warn).not.toHaveBeenCalled();
});
it('retains shared/equal Params and first textual numbering across nested sets and scalar inputs', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const shared = val(3n, col.UInt64);
  const input = source.where(r => r.id.eq(shared)).cte();
  const set = unionAll(input.map(r => r.id), input.map(() => ({ id: val(3n, col.UInt64) }))).cte();
  const query = input.map(r => ({ member: r.id.in(set), total: scalar(input.aggregate(g => sum(g.id))), same: shared }));
  const plan = emitNaive(query.ir);
  expect(plan.params).toEqual({ p0: '3', p1: '3' });
  expect([...plan.sql.matchAll(/\{(p\d+):/g)].map(m => m[1])).toEqual(['p0', 'p1', 'p0', 'p0', 'p0', 'p0']);
  expect(shared.ir).toMatchObject({ kind: 'Param', value: 3n });
});
it('rejects captured pre-fence and sibling refs, including hidden set/scalar scopes, without partial warnings', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fenced = source.cte();
  expect(() => emitNaive(fenced.where(() => source.row.id.eq(1n)).ir)).toThrow(/unbound_column.*root.pred/);
  const sibling = source.cte();
  expect(() => emitNaive(fenced.map(() => sibling.row.id).ir)).toThrow(/unbound_column.*root.exprs.id/);
  const badSet = source.map(() => fenced.row.id).cte();
  expect(() => emitNaive(fenced.where(r => r.id.in(badSet)).ir)).toThrow(/unbound_column.*rel.input.exprs.id/);
  const badTotal = source.where(() => fenced.row.id.eq(1n)).cte().aggregate(g => sum(g.id));
  expect(() => emitNaive(fenced.map(() => ({ n: scalar(badTotal) })).ir)).toThrow(/unbound_column.*pred/);
  // A valid first UNION branch must not issue a warning before a later branch fails.
  expect(() => emitNaive(unionAll(fenced, source.limit(-1).cte()).ir)).toThrow(/invalid_limit.*inputs\[1\].input/);
  expect(warn).not.toHaveBeenCalled();
});
it('validates output, inner scopes, limits and cycles with paths', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const other = from(table('other', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  expect(() => emitNaive(source.where(() => other.row.id.eq(1n)).cte().ir)).toThrow(/unbound_column.*root.input.pred/);
  expect(() => emitNaive(source.limit(-1).cte().ir)).toThrow(/invalid_limit.*root.input/);
  expect(() => emitNaive(relNode({ kind: 'Materialize', input: source.ir, output: flatOutput([['id', col.String.type]]) }))).toThrow(/invalid_output.*root/);
  const cycle = { ...source.cte().ir } as Extract<Rel, { kind: 'Materialize' }>;
  Object.assign(cycle, { input: cycle });
  expect(() => emitNaive(cycle)).toThrow(/cyclic_ir.*root.input/);
  expect(warn).not.toHaveBeenCalled();
});
