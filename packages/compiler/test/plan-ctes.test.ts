import { describe, expect, it, vi } from 'vitest';
import { cast, col, count, crossJoin, from, join, max, scalar, scalarDescriptor, sum, table, unionAll, val } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';
import { planCtes } from '../src/plan-ctes.js';
import { planSelects } from '../src/plan-selects.js';
import { pruneColumns } from '../src/prune-columns.js';
const source = from(table('items', { id: col.String, version: col.UInt32, amount: col.UInt64, ids: col.Array(col.String), unused: col.String }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] }));
const definitions = (sql: string) => [...sql.matchAll(/`(t\d+)` AS \(/g)].map(m => m[1]);

describe('identity CTE planning', () => {
  it('counts repeated slots directly, not multiplied descendant visits', () => {
    const a = source.limit(2), b = unionAll(a, a), q = unionAll(b, b, b);
    const p = planCtes(q.ir);
    expect(p.uses.get(b.ir)).toBe(3); expect(p.uses.get(a.ir)).toBe(2); expect(p.uses.get(source.ir)).toBe(1);
    expect(p.definitions).toEqual([a.ir, b.ir]);
    expect(definitions(compile(q.ir).sql)).toEqual(['t0', 't1']);
    expect(compile(q.ir).sql.match(/FROM `items`/g)).toHaveLength(1);
    expect(emitNaive(q.ir).sql.match(/FROM `items`/g)).toHaveLength(6);
  });
  it('does not share distinct equal-shaped Rel objects', () => {
    const a = source.final(), b = source.final();
    const q = crossJoin({ a, b });
    expect(planCtes(q.ir).definitions).toEqual([]);
    expect(compile(q.ir).sql).not.toContain('WITH');
  });
  it('counts repeated scalar and IN expression edges without multiplying descendants', () => {
    const total = source.aggregate(g => sum(g.amount));
    const set = source.map(r => r.id);
    const s = scalar(total);
    const q = source.map(r => ({ a: s, b: s, c: r.id.in(set), d: r.id.in(set) }));
    const p = planCtes(q.ir);
    expect(p.uses.get(total.ir)).toBe(2); expect(p.uses.get(set.ir)).toBe(2); expect(p.uses.get(source.ir)).toBe(3);
    expect(p.definitions).toEqual([source.ir, total.ir, set.ir]);
    expect(definitions(compile(q.ir).sql)).toEqual(['t0', 't1', 't2']);
    expect(total.ir.kind).toBe('Aggregate');
    expect(compile(q.ir).columns).toEqual(emitNaive(q.ir).columns);
  });
  it('stops select-block folding at references and retains unioned physical interfaces', () => {
    const shared = source.where(r => r.id.eq('a'));
    const q = crossJoin({ a: shared.map(r => ({ id: r.id })), b: shared.map(r => ({ amount: r.amount })) });
    const ctes = planCtes(q.ir), columns = pruneColumns(q.ir);
    const plan = planSelects(q.ir, columns.keys(), columns, ctes);
    expect(columns.get(shared.ir)?.map(l => l.name)).toEqual(['id', 'amount']);
    expect(plan.blocks.get(q.ir.kind === 'Join' ? q.ir.inputs[0]![1] : q.ir)?.source).toEqual({ kind: 'cte', rel: shared.ir });
    const sql = compile(q.ir).sql;
    expect(sql).toContain('WITH `t0` AS (SELECT `id`, `amount` FROM `items` WHERE `id` = {p0:String})');
    expect(sql.match(/FROM `t0`/g)).toHaveLength(2);
    expect(sql).not.toContain('unused');
  });
  it('schedules nested diamonds, joins and expansions dependency first with stable transport names', () => {
    const expanded = source.leftArrayJoin(r => r.ids, 'element');
    const inner = join({ a: expanded, b: expanded }).on(r => r.a.id.eq(r.b.id));
    const q = crossJoin({ first: inner, second: inner }).map(r => ({ id: r.first.a.id, amount: r.second.b.amount }));
    expect(planCtes(q.ir).definitions).toEqual([expanded.ir, inner.ir]);
    const compiled = compile(q.ir);
    expect(definitions(compiled.sql)).toEqual(['t0', 't1']);
    expect(compiled.sql.match(/LEFT ARRAY JOIN/g)).toHaveLength(1);
    expect(compiled.sql).toContain('`__chql_leaf_8`');
    expect(compiled.columns).toEqual(emitNaive(q.ir).columns);
  });
  it('reserves physical tables, output names and internals and renames logical join aliases only physically', () => {
    const s = from(table('t0', { id: col.String, __chql_input: col.String, t1: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const q = join({ t2: s, __chql_input: s, t0: s }).on(r => [r.t2.id.eq(r.__chql_input.id), r.t2.id.eq(r.t0.id)]);
    const p = planCtes(q.ir), before = JSON.stringify(q.ir);
    expect([...p.names.values()]).toEqual(['t2']);
    expect(p.aliases.get(q.ir)?.get('t2')).toBe('t2_');
    expect(p.aliases.get(q.ir)?.get('t0')).toBe('t0_');
    const out = compile(q.ir);
    expect(out.sql).toContain('`t2_`.`id` = `__chql_input_`.`id`');
    expect(out.sql).toContain('FROM `t0`');
    expect(out.sql).toContain('AS `t0_`');
    expect(JSON.stringify(q.ir)).toBe(before);
    expect(compile(q.ir)).toEqual(out);
    expect(out.columnPaths).toEqual(emitNaive(q.ir).columnPaths);
  });
  it('allocates definitions before body, retaining shared Params and distinct equal-valued Params', () => {
    const same = val('x');
    const shared = source.where(r => r.id.eq(same));
    const total = shared.aggregate(() => ({ n: count() }));
    const q = shared.map(r => ({ first: val('x'), id: r.id, n: scalar(total), again: same }));
    const out = compile(q.ir);
    expect(out.params).toEqual({ p0: 'x', p1: 'x' });
    expect([...out.sql.matchAll(/\{(p\d+):/g)].map(m => m[1])).toEqual(['p0', 'p1', 'p0']);
    expect(out.nodes).toEqual(emitNaive(q.ir).nodes);
    expect(compile(q.ir)).toEqual(out);
  });
  it('unifies nested explicit hints, retaining full interfaces without warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const hint = source.cte(), outer = unionAll(hint, hint).cte();
      const q = crossJoin({ a: outer, b: outer }).map(r => r.a.id);
      const out = compile(q.ir);
      expect(definitions(out.sql)).toEqual(['t0', 't1']);
      expect(warn).not.toHaveBeenCalled();
      expect(out.sql).toContain('`unused`');
      expect(out.sql.match(/WITH/g)).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });
  it('retains fallible unused expressions, comparison fences, carriers and hints', () => {
    const shared = source.final().sample(0.1).map(r => ({ id: r.id, bad: cast(r.unused, col.UInt64) })).distinct().limit(3);
    const q = crossJoin({ a: shared, b: shared }).aggregate(() => count());
    const sql = compile(q.ir).sql;
    expect(sql).toContain('CAST('); expect(sql).toContain('SELECT DISTINCT'); expect(sql).toContain('LIMIT 3');
    expect(sql).toContain('FINAL SAMPLE 0.1'); expect(sql).toContain('CROSS JOIN'); expect(sql).not.toContain('SELECT  FROM');
  });
  it('preserves original malformed-node provenance before extraction and rejects scalar broadening', () => {
    const bad = source.map(() => source.final().row.id);
    expect(() => compile(crossJoin({ a: bad, b: bad }).ir)).toThrow(/unbound_column.*root.inputs\[0\].exprs.id/);
    const total = source.aggregate(g => sum(g.amount));
    expect(() => scalarDescriptor(total.cte().ir)).toThrow();
  });
  it('keeps settings from shared definitions and ignores unattached Params', () => {
    const dates = from(table('dates', { at: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    const unused = val('not in graph');
    const shared = dates.map(r => ({ week: r.at.toStartOfWeek(), member: r.at.in([new Date('2026-01-01')]) }));
    const q = unionAll(shared, shared);
    const out = compile(q.ir);
    expect(definitions(out.sql)).toEqual(['t0']);
    expect(out.sql).toContain('SETTINGS enable_extended_results_for_datetime_functions = 1, transform_null_in = 0');
    expect(Object.values(out.params)).not.toContain(unused.ir.kind === 'Param' ? unused.ir.value : undefined);
    expect(Object.keys(out.params)).toEqual(['p0']);
    expect(out.sql.match(/\{p0:/g)).toHaveLength(1);
    expect(out.columns).toEqual(emitNaive(q.ir).columns);
  });
  it('preserves correlated-capture errors in shared scalar scopes without partial hint warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const hinted = source.cte();
      const captured = source.where(() => hinted.row.id.eq('a')).aggregate(() => count());
      const s = scalar(captured);
      const q = hinted.map(() => ({ first: s, second: s }));
      for (const emit of [compile, emitNaive]) {
        try { emit(q.ir); throw new Error('expected validation failure'); }
        catch (error) {
          expect(error).toMatchObject({ code: 'unbound_column', node: captured.ir.kind === 'Aggregate' && captured.ir.input.kind === 'Filter' && captured.ir.input.pred.kind === 'Call' ? captured.ir.input.pred.args[0] : undefined });
        }
      }
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
  it('records exact supported latest-shaped and scalar-total-shaped SQL', () => {
    const q = source.where(r => r.id.eq('a'));
    const newest = q.groupBy(r => ({ id: r.id })).aggregate(g => ({ version: max(g.version) }));
    const latest = join({ m: q, v: newest }).on(r => [r.m.id.eq(r.v.id), r.m.version.eq(r.v.version)]).map(r => ({ id: r.m.id }));
    const sql = compile(latest.ir).sql;
    expect(sql).toBe('WITH `t0` AS (SELECT `id`, `version` FROM `items` WHERE `id` = {p0:String})\nSELECT `m`.`id` AS `id`\nFROM `t0` AS `m`\nINNER ALL JOIN (SELECT `id`, max(`version`) AS `version` FROM `t0` GROUP BY `id`) AS `v` ON `m`.`id` = `v`.`id` AND `m`.`version` = `v`.`version`');
    const total = q.aggregate(g => ({ n: sum(g.amount) }));
    expect(compile(q.map(r => ({ id: r.id, n: scalar(total) })).ir).sql).toBe('WITH `t0` AS (SELECT `id`, `amount` FROM `items` WHERE `id` = {p0:String}) SELECT `__chql_input`.`id` AS `id`, (SELECT sum(`amount`) AS `n` FROM `t0`) AS `n` FROM (SELECT `t0`.`id`, `t0`.`amount` FROM `t0`) AS `__chql_input`');
  });
});
