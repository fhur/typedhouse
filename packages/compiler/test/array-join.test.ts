import { expect, it } from 'vitest';
import { cast, col, columnExpr, count, defineFunction, from, table, relNode, flatOutput, val, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { emitPlanned, validateRel, ValidationError } from '../src/emit-naive.js';
import { planSelects } from '../src/plan-selects.js';
import { pruneColumns } from '../src/prune-columns.js';
const t = table('t`', { id: col.UInt32, a: col.Array(col.Tuple({ label: col.String })) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [], source: { kind: 'test' } });
it('retains immutable scan hints, source capabilities and exact descriptors', () => {
  const q = from(t), hinted = q.sample(0.25).final();
  expect(Object.isFrozen(hinted)).toBe(true);
  expect(hinted.caps.live).toBe(true);
  expect(hinted.row.a.ir.type).toEqual(t.columns.a);
  expect(hinted.ir.kind === 'Scan' && hinted.ir.table.source).toEqual({ kind: 'test' });
  expect(emitNaive(hinted.ir).sql).toBe('SELECT `id`, `a` FROM `t\\`` FINAL SAMPLE 0.25');
  expect(emitNaive(q.ir).sql).not.toContain('FINAL');
  expect('final' in hinted.where(r => r.id.eq(1))).toBe(false);
  expect('sample' in hinted.arrayJoin(r => r.a, 'v')).toBe(false);
  for (const sample of [0, -1, 1.01, NaN, Infinity, '0.1; DROP']) {
    expect(() => emitNaive({ ...q.ir, sample } as Rel)).toThrow(/invalid_scan_hint at root.sample/);
  }
  expect(() => emitNaive({ ...q.ir, final: 'yes' } as unknown as Rel)).toThrow(/invalid_scan_hint at root.final/);
});
it('retains child descriptors and Params through separate array join nodes', () => {
  const q = from(t), shared = val(['x'], col.Array(col.String));
  const expanded = q.map(r => ({ ...r, b: shared })).arrayJoin(() => shared, 'v').leftArrayJoin(r => r.a, 'pair');
  expect(expanded.row.pair.ir.type).toEqual(t.columns.a.inner);
  expect(expanded.ir.kind === 'ArrayJoin' && expanded.ir.input.kind).toBe('ArrayJoin');
  expect(expanded.ir.kind === 'ArrayJoin' && expanded.ir.input.kind === 'ArrayJoin' && expanded.ir.input.expr).toBe(shared.ir);
  const compiled = emitNaive(expanded.ir);
  expect(compiled.params).toEqual({ p0: "['x']" });
  expect(compiled.sql.match(/\{p0:Array\(String\)\}/g)).toHaveLength(2);
  expect(Object.isFrozen(expanded.ir)).toBe(true);
  expect(Object.keys(compiled.columns)).toEqual(['id', 'a', 'b', 'v', 'pair']);
});
it('rejects malformed array join shape, scope, mode and aliases with node paths', () => {
  const q = from(t), valid = q.arrayJoin(r => r.a, 'v').ir;
  if (valid.kind !== 'ArrayJoin') throw new Error('expected ArrayJoin');
  const { id: _id, ...fields } = valid;
  const check = (changes: object, error: RegExp) => expect(() => emitNaive({ ...valid, ...changes } as Rel)).toThrow(error);
  check({ alias: 'a' }, /duplicate_column at root.alias/);
  check({ alias: 'x\0' }, /invalid_array_join_alias at root.alias/);
  check({ left: 'yes' }, /invalid_array_join at root.left/);
  check({ expr: q.row.id.ir }, /invalid_array_join_expression at root.expr/);
  check({ expr: from(t).row.a.ir }, /unbound_column at root.expr/);
  check({ expr: columnExpr({ type: t.columns.a }, q.ir.id, ['a'], 'a', 'grouped').ir }, /invalid_expression_mode at root.expr/);
  const output = flatOutput([['id', col.UInt32.type], ['a', t.columns.a], ['v', col.String.type]]);
  expect(() => emitNaive(relNode({ ...fields, output, columns: output.columns }))).toThrow(/invalid_output at root/);
  expect(() => (q.arrayJoin as Function)(() => q.row.id, 'v')).toThrow(/invalid_array_join_expression/);
  expect(() => (q.arrayJoin as Function)(() => q.row.a, 'a')).toThrow(/duplicate_column/);
});
it('folds one ARRAY JOIN into a scan block after FINAL and SAMPLE, aliasing the element verbatim; naive emission is unchanged', () => {
  const hinted = from(t).sample(0.25).final();
  const query = hinted.arrayJoin(r => r.a, 'v').where(r => r.id.gt(1)).orderBy(r => r.id).limit(2);
  expect(compile(query.ir).sql).toBe('SELECT `id`, `a`, `v` FROM `t\\`` FINAL SAMPLE 0.25 ARRAY JOIN `a` AS `v` WHERE `id` > {p0:UInt32} ORDER BY `id` ASC LIMIT 2');
  expect(emitNaive(query.ir).sql).toBe('SELECT `id`, `a`, `v` FROM (SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`a`, `__typedhouse_input`.`v` FROM (SELECT `id`, `a`, `v` FROM (SELECT `__typedhouse_input`.`id` AS `id`, `__typedhouse_input`.`a` AS `a`, `__typedhouse_element` AS `v` FROM (SELECT `id`, `a` FROM `t\\`` FINAL SAMPLE 0.25) AS `__typedhouse_input` ARRAY JOIN `__typedhouse_input`.`a` AS `__typedhouse_element`) AS `__typedhouse_input` WHERE greater(`__typedhouse_input`.`id`, {p0:UInt32})) AS `__typedhouse_input` ORDER BY `__typedhouse_input`.`id` ASC) LIMIT 2');
  expect(compile(query.ir).params).toEqual(emitNaive(query.ir).params);
  expect(compile(query.ir).columns).toEqual(emitNaive(query.ir).columns);
  expect(compile(from(t).leftArrayJoin(r => r.a, 'v').ir).sql).toBe('SELECT `id`, `a`, `v` FROM `t\\`` LEFT ARRAY JOIN `a` AS `v`');
  // Tuple extraction is a total array expression: it expands in place, with the selector as a parameter.
  const labels = from(t).arrayJoin(r => r.a.element('label'), 'label').where(r => r.label.eq('x')).map(r => ({ id: r.id, label: r.label }));
  expect(compile(labels.ir).sql).toBe('SELECT `id`, `label` FROM `t\\`` ARRAY JOIN tupleElement(`a`, {p0:String}) AS `label` WHERE `label` = {p1:String}');
  // A Param array is a total expansion; its Param precedes the WHERE Params in text.
  const constant = from(t).arrayJoin(() => val(['x'], col.Array(col.String)), 'v').where(r => r.v.eq('y'));
  expect(compile(constant.ir).sql).toBe('SELECT `id`, `a`, `v` FROM `t\\`` ARRAY JOIN {p0:Array(String)} AS `v` WHERE `v` = {p1:String}');
  expect(compile(constant.ir).params).toEqual({ p0: "['x']", p1: 'y' });
});
it('keeps one ARRAY JOIN per block and never folds over a CTE, a derived table, an unsafe inner filter or an aggregate', () => {
  const twice = from(t).arrayJoin(r => r.a, 'v').arrayJoin(r => r.a, 'w');
  expect(compile(twice.ir).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id`, `__typedhouse_input`.`a` AS `a`, `__typedhouse_input`.`v` AS `v`, `__typedhouse_element` AS `w` FROM (SELECT `id`, `a`, `v` FROM `t\\`` ARRAY JOIN `a` AS `v`) AS `__typedhouse_input` ARRAY JOIN `__typedhouse_input`.`a` AS `__typedhouse_element`');
  const cte = from(t).cte().arrayJoin(r => r.a, 'v');
  expect(compile(cte.ir).sql).toContain('FROM (SELECT `t0`.`id`, `t0`.`a` FROM `t0`) AS `__typedhouse_input` ARRAY JOIN');
  const limited = from(t).limit(1).arrayJoin(r => r.a, 'v');
  expect(compile(limited.ir).sql).toContain('LIMIT 1) AS `__typedhouse_input` ARRAY JOIN `__typedhouse_input`.`a` AS `__typedhouse_element`');
  // An inner ARRAY JOIN drops empty-array rows before WHERE: a fallible filter below it keeps its own scope; LEFT folds.
  const unsafe = from(t).where(r => cast(r.id, col.String).ne('x'));
  expect(compile(unsafe.arrayJoin(r => r.a, 'v').ir).sql).toContain('WHERE CAST(`id` AS String) != {p0:String}) AS `__typedhouse_input` ARRAY JOIN');
  expect(compile(unsafe.leftArrayJoin(r => r.a, 'v').ir).sql).toBe('SELECT `id`, `a`, `v` FROM `t\\`` LEFT ARRAY JOIN `a` AS `v` WHERE CAST(`id` AS String) != {p0:String}');
  expect(compile(from(t).where(r => r.id.plus(1).gt(2n)).arrayJoin(r => r.a, 'v').ir).sql).toContain(') AS `__typedhouse_input` ARRAY JOIN');
  // LEFT folds only over deterministic filters: a volatile call keeps the nested emission, as the rewrite rules never move it.
  const volatile = defineFunction({ name: 'rowNumberInAllBlocks', args: [], returns: col.UInt64, deterministic: false });
  expect(compile(from(t).where(() => volatile().eq(0n)).leftArrayJoin(r => r.a, 'v').ir).sql).toContain('WHERE rowNumberInAllBlocks() = {p0:UInt64}) AS `__typedhouse_input` LEFT ARRAY JOIN `__typedhouse_input`.`a` AS `__typedhouse_element`');
  // (vii) An aggregate folds over the expanded block; the block is emitted unqualified so the alias is a plain column.
  const grouped = from(t).arrayJoin(r => r.a, 'v').groupBy(r => ({ id: r.id })).aggregate(() => ({ n: count() }));
  expect(compile(grouped.ir).sql).toBe('SELECT `id`, count() AS `n` FROM `t\\`` ARRAY JOIN `a` AS `v` GROUP BY `id`');
  const byAlias = from(t).arrayJoin(r => r.a.element('label'), 'v').where(r => r.v.ne('x')).groupBy(r => ({ v: r.v })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n));
  expect(compile(byAlias.ir).sql).toBe('SELECT `v`, count() AS `n` FROM `t\\`` ARRAY JOIN tupleElement(`a`, {p0:String}) AS `v` WHERE `v` != {p1:String} GROUP BY `v` HAVING `n` > {p2:UInt64}');
  expect(compile(byAlias.ir).params).toEqual(emitNaive(byAlias.ir).params);
  // A key alias that shadows the expansion alias with another expression keeps the explicit scope.
  expect(compile(from(t).arrayJoin(r => r.a, 'v').groupBy(r => ({ v: r.id })).aggregate(() => ({ n: count() })).ir).sql).toContain(') AS `__typedhouse_input` GROUP BY');
});
it('selects the alias as a plain column, shadow-checks it against computed aliases, and folds DISTINCT over the expansion', () => {
  const expanded = from(t).arrayJoin(r => r.a, 'v');
  expect(compile(expanded.map(r => ({ v: r.v })).ir).sql).toBe('SELECT `v` FROM `t\\`` ARRAY JOIN `a` AS `v`');
  expect(compile(expanded.map(r => ({ n: r.id.plus(1), v: r.v })).ir).sql).toBe('SELECT `id` + {p0:UInt32} AS `n`, `v` AS `v` FROM `t\\`` ARRAY JOIN `a` AS `v`');
  expect(compile(expanded.map(r => ({ v: r.id.plus(1) })).ir).sql).toBe('SELECT `__typedhouse_input`.`id` + {p0:UInt32} AS `v` FROM (SELECT `id` FROM `t\\`` ARRAY JOIN `a` AS `v`) AS `__typedhouse_input`');
  expect(compile(expanded.distinct().orderBy(r => r.id).ir).sql).toBe('SELECT DISTINCT `id`, `a`, `v` FROM `t\\`` ARRAY JOIN `a` AS `v` ORDER BY `id` ASC');
  expect(compile(expanded.distinct().where(r => r.id.gt(1)).ir).sql).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`a`, `__typedhouse_input`.`v` FROM (SELECT DISTINCT `id`, `a`, `v` FROM `t\\`` ARRAY JOIN `a` AS `v`) AS `__typedhouse_input` WHERE `__typedhouse_input`.`id` > {p0:UInt32}');
  for (const query of [expanded, expanded.distinct(), expanded.map(r => ({ v: r.v }))]) expect(compile(query.ir).columns).toEqual(emitNaive(query.ir).columns);
});
it('rejects a folded block whose select list names a column the pruned scan does not provide', () => {
  const query = from(t).arrayJoin(r => r.a, 'v').map(r => ({ id: r.id, v: r.v }));
  const validated = validateRel(query.ir);
  const columns = new Map(pruneColumns(query.ir));
  for (const [rel, leaves] of columns) if (rel.kind === 'Scan') columns.set(rel, leaves.filter(l => l.name !== 'id'));
  let error: unknown;
  try { emitPlanned(planSelects(query.ir, Object.values(validated.nodes), columns)); } catch (caught) { error = caught; }
  // Same ValidationError path and code string as the naive ArrayJoin guard.
  expect(error).toBeInstanceOf(ValidationError);
  expect((error as ValidationError).code).toBe('missing_physical_column');
  expect((error as ValidationError).path).toBe('root');
  expect(String(error)).toContain('missing_physical_column at root: id');
  expect(emitPlanned(planSelects(query.ir, Object.values(validated.nodes), pruneColumns(query.ir))).sql).toBe('SELECT `id`, `v` FROM `t\\`` ARRAY JOIN `a` AS `v`');
});
