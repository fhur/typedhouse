import { expect, it } from 'vitest';
import { col, from, table, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

const inventory = table('inventory', { sku: col.String, onHand: col.UInt32, reserved: col.UInt32, reorderPoint: col.Int64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });

it('folds a total computed projection over a filtered scan', () => {
  const query = from(inventory).where(r => r.onHand.minus(r.reserved).lt(r.reorderPoint))
    .map(r => ({ sku: r.sku, available: r.onHand.minus(r.reserved) }));
  const before = JSON.stringify(query.ir);
  const result = compile(query.ir);
  expect(result.sql).toBe('SELECT `sku` AS `sku`, `onHand` - `reserved` AS `available` FROM `inventory` WHERE `onHand` - `reserved` < `reorderPoint`');
  expect(result.columns).toEqual(emitNaive(query.ir).columns);
  expect(JSON.stringify(query.ir)).toBe(before);
});

it('allocates projection parameters before filter parameters', () => {
  const query = from(inventory).where(r => r.sku.eq('sku'))
    .map(r => ({ available: r.onHand.minus(val(2, col.UInt32)) }));
  const result = compile(query.ir);
  expect(result.sql).toBe('SELECT `onHand` - {p0:UInt32} AS `available` FROM `inventory` WHERE `sku` = {p1:String}');
  expect(result.params).toEqual({ p0: '2', p1: 'sku' });
});

it('retains fences for alias collisions read by the block, limits and filters above fallible outputs; fallible selections fold', () => {
  const input = from(inventory).where(r => r.onHand.gt(0));
  const queries = [
    input.map(r => ({ onHand: r.onHand.minus(r.reserved) })), // the WHERE reads `onHand`
    input.limit(1).map(r => ({ available: r.onHand.minus(r.reserved) })),
    input.map(r => ({ available: r.onHand.minus(r.reserved), ratio: r.onHand.divide(r.reserved) })).where(r => r.available.gt(0n)),
  ];
  for (const query of queries) expect(compile(query.ir).sql).toContain(') AS `__typedhouse_input`');
  // Slice 3 fix round 1: a fallible selection over a filtered scan is evaluated on the same rows in both forms, so it folds.
  expect(compile(input.map(r => ({ available: r.onHand.divide(r.reserved) })).ir).sql).toBe('SELECT `onHand` / `reserved` AS `available` FROM `inventory` WHERE `onHand` > {p0:UInt32}');
  expect(compile(input.map(r => ({ reserved: r.onHand.divide(r.reserved), low: r.reserved.lt(1) })).ir).sql).toContain(') AS `__typedhouse_input`'); // another item reads the shadowed column
  expect(compile(input.map(r => ({ reserved: r.onHand.divide(r.reserved) })).ir).sql).toBe('SELECT `onHand` / `reserved` AS `reserved` FROM `inventory` WHERE `onHand` > {p0:UInt32}'); // an item may read the column it is aliased as
});

it('pushes a filter on a total computed output below the selection and folds to one SELECT', () => {
  const query = from(inventory).where(r => r.onHand.gt(0))
    .map(r => ({ available: r.onHand.minus(r.reserved) })).where(r => r.available.gt(0n));
  const result = compile(query.ir);
  expect(result.sql.match(/SELECT /g)).toHaveLength(1);
  // The filter is emitted on the source expression, never on the output alias.
  expect(result.sql).toBe('SELECT `onHand` - `reserved` AS `available` FROM `inventory` WHERE `onHand` > {p0:UInt32} AND `onHand` - `reserved` > {p1:Int64}');
  expect(result.sql).not.toContain('`available` >');
  expect(result.columns).toEqual(emitNaive(query.ir).columns);
});

it('checks collisions against columns hidden by an earlier selection', () => {
  const query = from(inventory).where(r => r.reorderPoint.gt(0n))
    .map(r => ({ onHand: r.onHand, reserved: r.reserved }))
    .map(r => ({ reorderPoint: r.onHand.minus(r.reserved) }));
  expect(compile(query.ir).sql).toContain(') AS `__typedhouse_input`');
});
