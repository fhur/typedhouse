import { describe, expect, it } from 'vitest';
import { aggregateDefinitions, argMax, argMin, argMinIf, avg, col, Expr, exprNode, max, maxIf, min, minIf, quantile, quantileExact, quantileExactIf, uniq, val, type Column, type NodeId } from '../src/index.js';

function grouped<T>(column: Column<T>) {
  return new Expr<T, 'value', 'grouped'>(exprNode({ kind: 'ColumnRef', rel: 1 as NodeId, path: ['value'], type: column.type }), 'value', 'grouped');
}

describe('min, argMin and quantileExact catalog entries', () => {
  it('appends new definitions and leaves every existing position in place', () => {
    expect(aggregateDefinitions.map(d => d.name)).toEqual(['count', 'sum', 'max', 'argMax', 'avg', 'quantile', 'uniqExact', 'uniq', 'min', 'argMin', 'quantileExact']);
  });

  it('routes each export to its own definition', () => {
    const n = grouped(col.UInt32), s = grouped(col.String), flag = grouped(col.Bool);
    const fn = (e: Expr<unknown, string, 'agg'>) => e.ir.kind === 'Agg' ? e.ir.fn.name : undefined;
    const pairs: [Expr<unknown, string, 'agg'>, string][] = [
      [min(n), 'min'], [minIf(n, flag), 'min'], [argMin(s, n), 'argMin'], [argMinIf(s, n, flag), 'argMin'],
      [quantileExact(0.5)(n), 'quantileExact'], [quantileExactIf(0.5)(n, flag), 'quantileExact'],
      [max(n), 'max'], [argMax(s, n), 'argMax'], [avg(n), 'avg'], [quantile(0.5)(n), 'quantile'], [uniq(s), 'uniq'],
    ];
    for (const [expression, name] of pairs) expect(fn(expression)).toBe(name);
  });

  it('marks every new aggregate deterministic and non-linear', () => {
    for (const expression of [min(grouped(col.UInt32)), argMin(grouped(col.UInt32), grouped(col.UInt32)), quantileExact(0.5)(grouped(col.UInt32))]) {
      expect(expression.ir).toMatchObject({ fn: { deterministic: true, linear: false, origin: 'typed' } });
    }
  });

  it('gives min the max descriptor: input type, minus LowCardinality, keeping nullability', () => {
    expect(min(grouped(col.UInt32)).ir.type).toEqual(col.UInt32.type);
    expect(min(grouped(col.Nullable(col.UInt32))).ir.type).toEqual(col.Nullable(col.UInt32).type);
    expect(min(grouped(col.LowCardinality(col.String))).ir.type).toEqual(col.String.type);
    expect(min(grouped(col.LowCardinality(col.Nullable(col.String)))).ir.type).toEqual(col.Nullable(col.String).type);
    expect(minIf(grouped(col.Date), grouped(col.Nullable(col.Bool))).ir.type).toEqual(col.Date.type);
    expect(min(grouped(col.LowCardinality(col.Nullable(col.String)))).ir.type).toEqual(max(grouped(col.LowCardinality(col.Nullable(col.String)))).ir.type);
  });

  it('returns the input type from quantileExact, not Float64', () => {
    for (const column of [col.UInt32, col.UInt64, col.Int128, col.Float32, col.Float64, col.Nullable(col.UInt32), col.Nullable(col.UInt64)] as Column<number | bigint | null>[]) {
      expect(quantileExact(0.5)(grouped(column)).ir.type).toEqual(column.type);
      expect(quantileExactIf(0.5)(grouped(column), grouped(col.Bool)).ir.type).toEqual(column.type);
    }
    expect(quantileExactIf(0.5)(grouped(col.UInt32), grouped(col.Nullable(col.Bool))).ir.type).toEqual(col.UInt32.type);
  });

  it('keeps the value type from argMin and argMinIf and ignores version and predicate nullability', () => {
    const value = grouped(col.Nullable(col.Float32)), version = grouped(col.Date32);
    const result = argMin(value, version);
    expect(result.ir).toMatchObject({ type: value.ir.type, combinators: [] });
    if (result.ir.kind !== 'Agg') throw new Error('expected Agg');
    expect(result.ir.args[0]).toBe(value.ir);
    expect(result.ir.args[1]).toBe(version.ir);
    expect(argMinIf(value, version, val(false)).ir).toMatchObject({ combinators: ['If'], type: value.ir.type });
    expect(argMinIf(grouped(col.String), version, grouped(col.Nullable(col.Bool))).ir.type).toEqual(col.String.type);
  });

  it('names a constant value after the aggregate on the first-operand root list, as argMax does', () => {
    const version = grouped(col.UInt32), flag = grouped(col.Bool);
    expect(argMin(val('constant'), version).name).toBe('argMin');
    expect(argMinIf(val('constant'), version, flag).name).toBe('argMin');
    expect(argMin(grouped(col.String), version).name).toBe('value');
    expect(quantileExact(0.5)(val(1)).name).toBe('quantileExact');
    expect(quantileExactIf(0.5)(val(1), flag).name).toBe('quantileExact');
    expect(quantileExact(0.5)(grouped(col.UInt32)).name).toBe('value');
  });

  it('keeps min off the first-operand list: a constant value takes the next operand name, as max does', () => {
    const flag = new Expr<boolean, 'flag', 'grouped'>(exprNode({ kind: 'ColumnRef', rel: 1 as NodeId, path: ['flag'], type: col.Bool.type }), 'flag', 'grouped');
    expect(min(val(1)).name).toBe('min');
    expect(min(grouped(col.UInt32)).name).toBe('value');
    expect(minIf(val(1), flag).name).toBe('flag');
    expect(minIf(val(1), flag).name).toBe(maxIf(val(1), flag).name);
  });

  it('creates a fresh immutable Float64 level per application of quantileExact', () => {
    const curry = quantileExact(0.5), value = grouped(col.Float64);
    const a = curry(value), b = curry(value);
    if (a.ir.kind !== 'Agg' || b.ir.kind !== 'Agg') throw new Error('expected Agg');
    expect(a.ir.params[0]).toMatchObject({ kind: 'Param', value: 0.5, type: col.Float64.type });
    expect(a.ir.params[0]).not.toBe(b.ir.params[0]);
    expect(Object.isFrozen(a.ir.params)).toBe(true);
    expect(quantileExactIf(0.25)(value, val(true)).ir).toMatchObject({ combinators: ['If'], params: [{ value: 0.25 }] });
  });
});
