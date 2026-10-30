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

it('retains fences for alias collisions, fallible expressions and limits', () => {
  const input = from(inventory).where(r => r.onHand.gt(0));
  const queries = [
    input.map(r => ({ onHand: r.onHand.minus(r.reserved) })),
    input.map(r => ({ available: r.onHand.divide(r.reserved) })),
    input.limit(1).map(r => ({ available: r.onHand.minus(r.reserved) })),
    input.map(r => ({ available: r.onHand.minus(r.reserved) })).where(r => r.available.gt(0n)),
  ];
  for (const query of queries) expect(compile(query.ir).sql).toContain(') AS `__typedhouse_input`');
});

it('checks collisions against columns hidden by an earlier selection', () => {
  const query = from(inventory).where(r => r.reorderPoint.gt(0n))
    .map(r => ({ onHand: r.onHand, reserved: r.reserved }))
    .map(r => ({ reorderPoint: r.onHand.minus(r.reserved) }));
  expect(compile(query.ir).sql).toContain(') AS `__typedhouse_input`');
});
