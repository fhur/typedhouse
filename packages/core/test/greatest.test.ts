import { expect, it } from 'vitest';
import { col, columnExpr, functionCatalog, greatest, val, type NodeId } from '../src/index.js';
const id = 1 as NodeId;
const a = columnExpr(col.DateTime64(1), id, ['a'], 'a', 'row');
const b = columnExpr(col.DateTime64(3), id, ['b'], 'b', 'row');
it('catalog owns a standalone deterministic repeated-argument function', () => {
  const definition = functionCatalog.find(d => d.name === 'greatest');
  expect(definition).toMatchObject({ repeatedArgs: 'temporalGreatest', deterministic: true, origin: 'typed', nullable: 'never' });
  expect(greatest(a, b, a)).toMatchObject({ name: 'a', mode: 'row', ir: { type: col.DateTime64(3).type } });
  expect(greatest(val(new Date(), col.DateTime64(0)), b).name).toBeUndefined();
});
it('rejects invalid JavaScript arity, descriptors, zones and modes', () => {
  const grouped = columnExpr(col.DateTime64(3), id, ['b'], 'b', 'grouped');
  for (const args of [[], [a], [a, new Date()], [a, val(1)], [a, val('x')], [a, val(null, col.Nullable(col.DateTime64(3)))], [a, columnExpr(col.DateTime64(9), id, ['b'], 'b', 'row')], [a, grouped], [a, columnExpr(col.DateTime64(3, 'UTC'), id, ['b'], 'b', 'row')]]) expect(() => Reflect.apply(greatest, undefined, args)).toThrow();
});
