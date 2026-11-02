import { expect, it } from 'vitest';
import { col, count, from, join, max, scalar, sum, table, unionAll, type Rel } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { validateRel } from '../src/emit-naive.js';

// Slice 4f (4c Tester Finding 1): `hiddenColumns` is shadow-only descriptor metadata naming real columns the server
// resolves by name (ALIAS/MATERIALIZED) that the descriptor omits. The alias guards count them; nothing selects them.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;
const columns = { id: col.UInt32, v: col.String };
const hiddenTable = table('xm', columns, { ...meta, hiddenColumns: ['hidden', 'mat'] });
const XM = from(hiddenTable);
const plain = from(table('xm', columns, meta));
const A = from(table('xa', { id: col.UInt32, s: col.String }, meta));

it('table() copies and freezes hiddenColumns, and leaves descriptors without it unchanged', () => {
  const names = ['hidden'];
  const descriptor = table('xm', columns, { ...meta, hiddenColumns: names });
  names.push('later');
  expect(descriptor.hiddenColumns).toEqual(['hidden']);
  expect(Object.isFrozen(descriptor.hiddenColumns)).toBe(true);
  expect(Object.keys(descriptor.columns)).toEqual(['id', 'v']);
  expect('hiddenColumns' in table('xm', columns, meta)).toBe(false);
});

it('hidden names are never selected, never output columns and never row fields, in either emitter', () => {
  for (const root of [XM.ir, XM.where(r => r.v.ne('x')).ir, XM.groupBy(r => ({ id: r.id })).aggregate(g => ({ n: count(), top: max(g.v) })).ir]) {
    for (const emitted of [compile(root), emitNaive(root)]) {
      expect(emitted.sql).not.toMatch(/`hidden`|`mat`/);
      expect(Object.keys(emitted.columns)).not.toContain('hidden');
      expect(Object.keys(emitted.columns)).not.toContain('mat');
    }
  }
  expect(Object.keys(XM.ir.output.shape === 'flat' ? XM.ir.output.columns : {})).toEqual(['id', 'v']);
});

it('the Aggregate guard: an output alias equal to a hidden column keeps the aggregate out of the scan block', () => {
  const having = (q: typeof XM) => q.groupBy(r => ({ id: r.id })).aggregate(g => ({ hidden: count(), top: max(g.v) })).where(r => r.hidden.gt(1n)).ir;
  // Without the metadata the HAVING binds xm.hidden under prefer_column_name_to_alias = 1 (code 215; native pin).
  expect(compile(having(plain)).sql).toBe('SELECT `__typedhouse_input`.`id` AS `id`, count() AS `hidden`, max(`__typedhouse_input`.`v`) AS `top` FROM `xm` AS `__typedhouse_input` GROUP BY `__typedhouse_input`.`id` HAVING `hidden` > {p0:UInt64}');
  expect(compile(having(XM)).sql).toBe('SELECT `__typedhouse_input`.`id`, `__typedhouse_input`.`hidden`, `__typedhouse_input`.`top` FROM (SELECT `__typedhouse_input`.`id` AS `id`, count() AS `hidden`, max(`__typedhouse_input`.`v`) AS `top` FROM (SELECT `id`, `v` FROM `xm`) AS `__typedhouse_input` GROUP BY `__typedhouse_input`.`id`) AS `__typedhouse_input` WHERE `__typedhouse_input`.`hidden` > {p0:UInt64}');
  // A non-colliding alias still folds into one SELECT.
  expect(compile(XM.groupBy(r => ({ id: r.id })).aggregate(() => ({ n: count() })).where(r => r.n.gt(1n)).ir).sql.match(/SELECT /g)).toHaveLength(1);
});

it('over a CTE the hidden columns are not resolvable (the CTE exposes only its select list): the aggregate folds onto t0', () => {
  const shared = XM.where(r => r.v.ne('x'));
  const agg = () => shared.groupBy(r => ({ id: r.id })).aggregate(() => ({ hidden: count() })).where(r => r.hidden.gt(1n));
  const sql = compile(unionAll(agg(), agg()).ir).sql;
  expect(sql).toMatch(/^WITH `t0` AS \(SELECT `id` FROM `xm` WHERE `v` != \{p0:String\}\)/);
  expect(sql.match(/SELECT `id`, count\(\) AS `hidden` FROM `t0` GROUP BY `id` HAVING `hidden` > \{p\d:UInt64\}/g)).toHaveLength(2);
});

it('the 4c join guard: a side whose descriptor hides a column contributes it to N', () => {
  const q = (m: typeof XM) => join({ a: A, m }).on(r => r.a.id.eq(r.m.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ hidden: count(), top: max(g.m.v) })).where(r => r.hidden.gt(1n)).ir;
  expect(compile(q(plain)).sql).toBe('SELECT `a`.`id` AS `id`, count() AS `hidden`, max(`m`.`v`) AS `top`\nFROM (SELECT `id` FROM `xa`) AS `a`\nINNER ALL JOIN `xm` AS `m` ON `a`.`id` = `m`.`id`\nGROUP BY `a`.`id`\nHAVING `hidden` > {p0:UInt64}');
  expect(compile(q(XM)).sql).toBe('SELECT `__typedhouse_input`.`__typedhouse_leaf_0` AS `id`, count() AS `hidden`, max(`__typedhouse_input`.`__typedhouse_leaf_3`) AS `top` FROM (SELECT `a`.`id` AS `__typedhouse_leaf_0`, `m`.`v` AS `__typedhouse_leaf_3` FROM (SELECT `id` FROM `xa`) AS `a` INNER ALL JOIN `xm` AS `m` ON `a`.`id` = `m`.`id`) AS `__typedhouse_input` GROUP BY `__typedhouse_input`.`__typedhouse_leaf_0` HAVING `hidden` > {p0:UInt64}');
});

it('the slice 1/3 computed-selection guard: a hidden alias read by another item (a subquery reads every name) keeps its scope', () => {
  const total = scalar(A.aggregate(g => ({ s: sum(g.id) })));
  const shape = (q: typeof XM) => q.where(r => r.v.ne('x')).map(r => ({ hidden: r.id.plus(1), s: total })).ir;
  const sub = '(SELECT sum(`__typedhouse_input`.`id`) AS `s` FROM (SELECT `id` FROM `xa`) AS `__typedhouse_input`) AS `s`';
  // Without the metadata the selection folds over the filtered scan; with it, it keeps a derived table.
  expect(compile(shape(plain)).sql).toBe(`SELECT \`id\` + {p0:UInt32} AS \`hidden\`, ${sub} FROM \`xm\` WHERE \`v\` != {p1:String}`);
  expect(compile(shape(XM)).sql).toBe(`SELECT \`__typedhouse_input\`.\`id\` + {p0:UInt32} AS \`hidden\`, ${sub} FROM (SELECT \`id\` FROM \`xm\` WHERE \`v\` != {p1:String}) AS \`__typedhouse_input\``);
  // Unread, the hidden alias folds: nothing else in the block can resolve the name.
  expect(compile(XM.where(r => r.v.ne('x')).map(r => ({ hidden: r.id.plus(1), v: r.v })).ir).sql).toBe('SELECT `id` + {p0:UInt32} AS `hidden`, `v` AS `v` FROM `xm` WHERE `v` != {p1:String}');
});

it('an empty hiddenColumns list plans exactly like a descriptor without it', () => {
  const empty = from(table('xm', columns, { ...meta, hiddenColumns: [] }));
  const shapes = (q: typeof XM): Rel[] => [
    q.groupBy(r => ({ id: r.id })).aggregate(g => ({ hidden: count(), top: max(g.v) })).where(r => r.hidden.gt(1n)).ir,
    q.where(r => r.v.ne('x')).map(r => ({ id: r.id.plus(1), v: r.v })).ir,
    join({ a: A, m: q }).on(r => r.a.id.eq(r.m.id)).groupBy(r => ({ id: r.a.id })).aggregate(g => ({ hidden: count(), top: max(g.m.v) })).ir,
  ];
  const [a, b] = [shapes(plain), shapes(empty)];
  for (const [i, root] of a.entries()) expect(compile(b[i]!).sql).toBe(compile(root).sql);
});

it('the validator rejects a malformed hiddenColumns list', () => {
  const bad = { ...hiddenTable, hiddenColumns: 'hidden' } as unknown as typeof hiddenTable;
  const root = from(bad).ir;
  expect(() => validateRel(root)).toThrow(/hiddenColumns/);
  const badItem = { ...hiddenTable, hiddenColumns: [1] } as unknown as typeof hiddenTable;
  expect(() => validateRel(from(badItem).ir)).toThrow(/hiddenColumns/);
});
