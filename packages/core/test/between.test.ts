import { expect, it } from 'vitest';
import { col, columnExpr, val, type NodeId } from '../src/index.js';
it('keeps receiver root/mode, nullable twins and distinct unresolved bounds', () => {
  for (const mode of ['row', 'grouped', 'agg'] as const) {
    const x = columnExpr(col.Nullable(col.UInt64), 1 as NodeId, ['x'], 'x', mode);
    const result = x.between(1n, 1n);
    expect(result.name).toBe('x'); expect(result.mode).toBe(mode);
    expect(result.ir.type).toEqual(col.Nullable(col.Bool).type);
    if (result.ir.kind !== 'Call') throw new Error('Call expected');
    expect(result.ir.args[0]).toBe(x.ir);
    expect(result.ir.args.slice(1)).toEqual([expect.objectContaining({ kind: 'Param', type: null, value: 1n }), expect.objectContaining({ kind: 'Param', type: null, value: 1n })]);
    expect(result.ir.args[1]).not.toBe(result.ir.args[2]);
  }
});
it('keeps constants unnamed and captures Dates rather than mutating bounds', () => {
  const x = columnExpr(col.DateTime64(3), 1 as NodeId, ['at'], 'at', 'row');
  const date = new Date(123);
  const result = x.between(date, date); date.setTime(999);
  if (result.ir.kind !== 'Call') throw new Error('Call expected');
  expect(result.ir.args[1]).toMatchObject({ value: new Date(123), type: null });
  expect(val(new Date(0)).between(x, x).name).toBeUndefined();
  expect(x.between(null, x).ir.type).toEqual(col.Nullable(col.Bool).type);
});
