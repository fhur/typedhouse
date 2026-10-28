import { expect, it } from 'vitest';
import { expectTypeOf } from 'expect-type';
import { col, from, crossJoin, join, table, val, relNode, type Infer } from '@chql/core';
import { emitNaive } from '../src/index.js';

const source = from(table('t', { id: col.UInt64, xs: col.Array(col.Nullable(col.String)), pair: col.Tuple({ n: col.UInt32 }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const product = crossJoin({ a: source, b: source });
expectTypeOf<Infer<typeof product>>().toEqualTypeOf<{ a: Infer<typeof source>; b: Infer<typeof source> }>();
expectTypeOf<Infer<typeof product>>().not.toBeAny();
expectTypeOf(product.row.b.xs).toEqualTypeOf(source.row.xs);
expectTypeOf<keyof typeof product>().not.toMatchTypeOf<'on'>();
const spread = product.map(r => ({ ...r.a })).map(r => r.pair.element('n'));
expectTypeOf<Infer<typeof spread>>().toEqualTypeOf<{ pair: number }>();

it('preserves occurrences, capabilities, descriptors and input identities', () => {
  expect(Object.isFrozen(product)).toBe(true);
  expect(Object.isFrozen(product.row.a)).toBe(true);
  expect(product.row.a.id.ir).toMatchObject({ rel: product.ir.id, path: ['a', 'id'] });
  expect(product.row.b.id.ir).toMatchObject({ rel: product.ir.id, path: ['b', 'id'] });
  expect(product.row.a.xs.ir.type).toEqual(source.row.xs.ir.type);
  expect(product.caps.live).toBe(false);
  if (product.ir.kind !== 'Join') throw new Error('expected join');
  expect(product.ir.inputs.map(([, r]) => r)).toEqual([source.ir, source.ir]);
  expect(product.ir.inputs[0]![1]).toBe(product.ir.inputs[1]![1]);
  const before = JSON.stringify(product.ir);
  const plan = emitNaive(product.ir);
  expect(plan.sql).toContain(' CROSS JOIN ');
  expect(plan.sql).not.toMatch(/\b(?:ON|ALL|SETTINGS)\b/);
  expect(JSON.stringify(product.ir)).toBe(before);
  const live = from(table('live', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [], source: { kind: 'test' } }));
  expect(crossJoin({ a: live, b: live }).caps.live).toBe(true);
  expect(crossJoin({ a: live, b: source }).caps.live).toBe(false);
});
it('keeps shared versus equal Params and hostile aliases in SQL order', () => {
  const shared = val(7n, col.UInt64);
  const q = crossJoin({ ['__proto__']: source.where(r => r.id.eq(shared)), 'b.`': source.where(r => r.id.eq(val(7n, col.UInt64))), c: source.where(r => r.id.eq(shared)) });
  const plan = emitNaive(q.ir);
  expect(plan.params).toEqual({ p0: '7', p1: '7' });
  expect(plan.sql.match(/\{p0:UInt64\}/g)).toHaveLength(2);
  expect(plan.sql.match(/CROSS JOIN/g)).toHaveLength(2);
  expect(plan.columnPaths?.[Object.keys(plan.columns)[0]!]).toEqual(['__proto__', 'id']);
});
it('rejects ON conditions, wrong schemas and insufficient inputs authoritatively', () => {
  const inner = join({ a: source, b: source }).on(r => r.a.id.eq(r.b.id)).ir;
  if (inner.kind !== 'Join' || product.ir.kind !== 'Join') throw new Error('expected join');
  const { id: _id, ...fields } = inner;
  expect(() => emitNaive(relNode({ ...fields, joinKind: 'cross' }))).toThrow('join_condition_arity at root.on');
  const { id: _crossId, ...cross } = product.ir;
  expect(() => emitNaive(relNode({ ...cross, inputs: cross.inputs.slice(0, 1) }))).toThrow('join_input_count at root.inputs');
  expect(() => emitNaive(relNode({ ...cross, output: { shape: 'nested', inputs: [['a', source.ir.output]] } }))).toThrow('invalid_output at root');
});
it('rejects captured same-shaped occurrence refs and preserves Params through nested composition', () => {
  const other = crossJoin({ a: source, b: source });
  expect(() => emitNaive(product.where(() => other.row.a.id.eq(1n)).ir)).toThrow('unbound_column at root.pred.args[0]');
  expect(() => emitNaive(product.where(() => source.row.id.eq(1n)).ir)).toThrow('unbound_column at root.pred.args[0]');
  const shared = val(9n, col.UInt64);
  const filtered = crossJoin({ a: source.where(r => r.id.eq(shared)), b: source });
  const composed = crossJoin({ nested: filtered, c: source }).map(r => ({ id: r.nested.a.id, p: shared })).where(r => r.p.eq(val(9n, col.UInt64)));
  const plan = emitNaive(composed.ir);
  expect(plan.params).toEqual({ p0: '9', p1: '9' });
  expect(plan.sql.match(/\{p0:UInt64\}/g)).toHaveLength(2);
  expect(plan.sql.match(/\{p1:UInt64\}/g)).toHaveLength(1);
});
it('demonstrates why structural record types cannot identify a preserved first/last side', () => {
  const ab = { a: source, b: source };
  const ba: typeof ab = { b: source, a: source };
  expectTypeOf(ab).toEqualTypeOf(ba);
  expect(Object.keys(ab)).toEqual(['a', 'b']);
  expect(Object.keys(ba)).toEqual(['b', 'a']);
  // The same accepted static type has opposite outer-join preserved sides.
  expect(crossJoin(ab).ir.output).not.toEqual(crossJoin(ba).ir.output);
});
