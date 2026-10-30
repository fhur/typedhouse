import { expect, it } from 'vitest';
import { col, columnExpr, dateDiff, deterministic, from, functionCatalog, multiIf, now, table, val, type NodeId } from '../src/index.js';
const id = 1 as NodeId;
it('owns standalone definitions without adding generated methods and preserves root names', () => {
  expect(functionCatalog.filter(f => ['now', 'dateDiff', 'multiIf'].includes(f.name))).toHaveLength(3);
  expect(deterministic(now().ir)).toBe(false);
  const condition = columnExpr(col.Nullable(col.Bool), id, ['ok'], 'ok', 'grouped');
  const text = columnExpr(col.String, id, ['text'], 'text', 'grouped');
  const result = multiIf([condition, text], 'else');
  expect(result.name).toBe('ok');
  expect(result.mode).toBe('grouped');
  expect(result.ir.type).toEqual(col.String.type);
  const withConstant = multiIf([val(false, col.Bool), 'no'], [condition, text], 'else');
  expect(withConstant.name).toBeUndefined();
  expect(withConstant.mode).toBe('grouped');
  const start = columnExpr(col.DateTime64(3), id, ['at'], 'at', 'agg');
  const end = columnExpr(col.DateTime(), id, ['end'], 'end', 'agg');
  expect(dateDiff('day', start, end).name).toBe('at');
  expect(dateDiff('day', start, end).mode).toBe('agg');
});
it('server clock removes runtime live capability from an otherwise live source', () => {
  const source = from(table('events', { id: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [], source: { kind: 'append' } }));
  expect(source.caps.live).toBe(true);
  expect(source.map(r => ({ ...r, clock: now() })).caps.live).toBe(false);
});
