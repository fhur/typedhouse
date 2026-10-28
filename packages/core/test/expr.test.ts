import { describe, expect, it } from 'vitest';
import { Expr, cast, col, columnExpr, sum, sumIf, maxIf, sumMerge, exprNode, val, type Column, type Mode, type NodeId } from '../src/index.js';
function ref<T, N extends string, M extends Mode>(descriptor: Column<T>, name: N, mode: M) {
  return new Expr<T, N, M>(exprNode({ kind: 'ColumnRef', rel: 1 as NodeId, path: [name], type: descriptor.type }), name, mode);
}
describe('expression wrapper', () => {
  it('composes resolved aggregate and nullable-common descriptors without replacing graph edges', () => {
    const small = columnExpr(col.Nullable(col.UInt8), 1 as NodeId, ['small'], 'small', 'grouped');
    const wide = columnExpr(col.Nullable(col.UInt32), 1 as NodeId, ['wide'], 'wide', 'grouped');
    const common = small.ifNull(wide);
    expect(common.ir.type).toEqual(col.Nullable(col.UInt32).type);
    expect(common.plus(1).ir.type).toEqual(col.Nullable(col.UInt64).type);
    expect(maxIf(common, val(true)).plus(1).ir.type).toEqual(col.Nullable(col.UInt64).type);
    const state = columnExpr(col.AggregateFunction('sum', col.Float64), 1 as NodeId, ['state'], 'state', 'grouped');
    const merged = sumMerge(state);
    const arithmetic = merged.plus(1);
    expect(arithmetic.ir.type).toEqual(col.Float64.type);
    if (arithmetic.ir.kind !== 'Call' || common.ir.kind !== 'Call') throw new Error('Call expected');
    expect(arithmetic.ir.args[0]).toBe(merged.ir);
    expect(common.ir.args).toEqual([small.ir, wide.ir]);
    expect(Object.isFrozen(arithmetic.ir.type)).toBe(true);
  });
  it('retains descriptor-backed references and exact sum runtime twins without changing decoded values', () => {
    const path = ['side', '__proto__'];
    for (const [input, output] of [[col.Float64, col.Float64], [col.UInt32, col.UInt64], [col.Nullable(col.Float64), col.Nullable(col.Float64)]] as const) {
      const value = columnExpr(input, 1 as NodeId, path, '__proto__', 'grouped');
      expect(value.ir.type).toEqual(input.type);
      expect(sum(value).ir.type).toEqual(output.type);
      expect(sumIf(value, val(true)).ir.type).toEqual(output.type);
      expect(Object.isFrozen(value)).toBe(true);
      const result = sum(value);
      if (result.ir.kind !== 'Agg') throw new Error('Agg expected');
      expect(result.ir.args[0]).toBe(value.ir);
      expect(result.name).toBe('__proto__');
    }
    const value = columnExpr(col.UInt32, 1 as NodeId, path, '__proto__', 'grouped');
    path[0] = 'mutated';
    expect(value.ir).toMatchObject({ kind: 'ColumnRef', path: ['side', '__proto__'] });
    expect(sum(value.as(col.Float64)).ir.type).toEqual(col.Float64.type);
    expect(sum(cast(value, col.Float64)).ir.type).toEqual(col.Float64.type);
  });
  it('preserves hostile names, immutable identity, modes and unresolved sibling parameters', () => {
    const x = ref(col.UInt64, '__proto__', 'grouped');
    const a = x.gt(3n); const b = x.gt(3n);
    expect(Object.isFrozen(x)).toBe(true);
    expect(a.name).toBe('__proto__'); expect(a.mode).toBe('grouped');
    expect(a.ir.kind).toBe('Call');
    if (a.ir.kind !== 'Call' || b.ir.kind !== 'Call') throw new Error('Call expected');
    expect(a.ir.args[0]).toBe(x.ir);
    expect(a.ir.args[1]).toMatchObject({ kind: 'Param', type: null, value: 3n });
    expect(a.ir.args[1]).not.toBe(b.ir.args[1]);
    expect(a.ir.fn).toEqual({ name: 'gt', sqlName: 'greater', deterministic: true, origin: 'typed' });
    expect(Object.isFrozen(a.ir.args)).toBe(true);
  });
  it('defaults primitives and keeps unresolved values explicit', () => {
    expect(val('hello').ir.type).toEqual(col.String.type);
    expect(val(true).ir.type).toEqual(col.Bool.type);
    expect(val(1).ir.type).toEqual(col.Float64.type);
    expect(val(1n).ir.type).toEqual(col.Int64.type);
    expect(val(new Date(0)).ir.type).toEqual(col.DateTime64(3).type);
    expect(val([1n]).ir.type).toEqual(col.Array(col.Int64).type);
    for (const value of [null, [], {}]) expect(val(value).ir).toMatchObject({ kind: 'Param', type: null });
    expect(val(1, col.UInt8).ir.type).toEqual(col.UInt8.type);
  });
  it('declares without a Cast, casts explicitly, preserves root and mode', () => {
    const x = ref(col.String, 'a.b', 'agg');
    expect(x.as(col.UInt64)).toMatchObject({ name: 'a.b', mode: 'agg', ir: { kind: 'ColumnRef', type: col.UInt64.type } });
    const casted = cast(x, col.UInt64);
    expect(casted.ir).toMatchObject({ kind: 'Cast', type: col.UInt64.type, to: col.UInt64.type });
    if (casted.ir.kind === 'Cast') expect(casted.ir.expr).toBe(x.ir);
    expect(x.ir.type).toEqual(col.String.type);
  });
  it('casts retain shared Param identity, frozen descriptors and each original mode', () => {
    const shared = val('7', col.String);
    for (const descriptor of [col.Float64, col.UInt64, col.Nullable(col.String)]) {
      const value = cast(shared, descriptor);
      expect(value.ir.kind).toBe('Cast');
      if (value.ir.kind !== 'Cast') throw new Error('Cast expected');
      expect(value.ir.expr).toBe(shared.ir);
      expect(value.ir.to).toEqual(descriptor.type);
      expect(value.ir.type).toEqual(descriptor.type);
      expect(Object.isFrozen(value.ir.to)).toBe(true);
      expect(value.mode).toBe('row');
      expect(value.name).toBeUndefined();
    }
    const grouped = columnExpr(col.UInt32, 1 as NodeId, ['n'], 'n', 'grouped');
    expect(cast(grouped, col.Float64)).toMatchObject({ mode: 'grouped', name: 'n' });
    expect(cast(sum(grouped), col.Float64)).toMatchObject({ mode: 'agg', name: 'n' });
  });
  it('keeps repeated constant declarations as owned Params, never Casts', () => {
    const original = val(new Date(0));
    const declared = original.as(col.DateTime64(3)).as(col.DateTime());
    expect(declared).toMatchObject({ mode: 'row', name: undefined, ir: { kind: 'Param', type: col.DateTime().type } });
    expect(declared.ir).not.toBe(original.ir);
    if (declared.ir.kind !== 'Param') throw new Error('Param expected');
    (declared.ir.value as Date).setTime(100);
    expect((declared.ir.value as Date).getTime()).toBe(0);
    expect(original.ir.type).toEqual(col.DateTime64(3).type);
  });
  it('owns nested Dates even in unresolved parameters', () => {
    const date = new Date(0); const value = { nested: [date] };
    const expr = val(value); date.setTime(100);
    if (expr.ir.kind !== 'Param') throw new Error('Param expected');
    const captured = expr.ir.value as typeof value;
    captured.nested[0]!.setTime(200);
    expect(captured.nested[0]!.getTime()).toBe(0);
  });
  it('propagates nullable comparisons and removes null only with a non-null fallback', () => {
    const x = ref(col.Nullable(col.String), 'name', 'row');
    expect(x.eq('x').ir.type).toEqual(col.Nullable(col.Bool).type);
    expect(x.isNull().ir.type).toEqual(col.Bool.type);
    expect(x.isNotNull().ir.type).toEqual(col.Bool.type);
    expect(x.ifNull('fallback').ir.type).toEqual(col.String.type);
    expect(x.ifNull(null).ir.type).toEqual(col.Nullable(col.String).type);
    expect(x.ifNull(val(null, col.Nullable(col.String))).ir.type).toEqual(col.Nullable(col.String).type);
  });
  it('retains promotion at each composed arithmetic edge', () => {
    const x = columnExpr(col.UInt8, 1 as NodeId, ['x'], 'x', 'grouped');
    const a = x.plus(1);
    const b = a.multiply(2);
    const c = b.plus(3);
    expect([a.ir.type, b.ir.type, c.ir.type]).toEqual([col.UInt16.type, col.UInt32.type, col.UInt64.type]);
    expect(sum(c).ir.type).toEqual(col.UInt64.type);
    if (c.ir.kind !== 'Call' || b.ir.kind !== 'Call') throw new Error('Call expected');
    expect(c.ir.args[0]).toBe(b.ir);
    expect(b.ir.args[0]).toBe(a.ir);
    expect(c.ir.args[1]).toMatchObject({ kind: 'Param', type: null, value: 3 });
    expect(Object.isFrozen(c.ir.type)).toBe(true);
  });
  it('uses CH promotion, not a universal Float64 fallback', () => {
    expect(ref(col.UInt8, 'x', 'row').plus(1).ir.type).toEqual(col.UInt16.type);
    expect(ref(col.UInt32, 'x', 'row').plus(1).ir.type).toEqual(col.UInt64.type);
    expect(ref(col.UInt64, 'x', 'row').minus(1n).ir.type).toEqual(col.Int64.type);
    expect(ref(col.Float32, 'x', 'row').multiply(2).ir.type).toEqual(col.Float64.type);
    expect(ref(col.UInt64, 'x', 'row').divide(2n).ir.type).toEqual(col.Float64.type);
  });
});
