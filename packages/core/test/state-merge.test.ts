import { describe, expect, it } from 'vitest';
import {
  argMaxMerge,
  argMaxState,
  avgMerge,
  avgState,
  col,
  columnExpr,
  maxMerge,
  maxState,
  minMerge,
  minState,
  print,
  quantileExactMerge,
  quantileExactState,
  quantileMerge,
  quantileState,
  stateArgument,
  sumState,
  uniqExactMerge,
  uniqMerge,
  uniqState,
  uniqExactState,
  argMinMerge,
  argMinState,
  type Column,
  type NodeId,
} from '../src/index.js';

const g = <C extends Column>(c: C, name = 'x') =>
  columnExpr(c, 1 as NodeId, [name], name, 'grouped');

describe('state descriptors', () => {
  it('drop LowCardinality at every depth, as the server does', () => {
    const cases: [Column, string][] = [
      [col.LowCardinality(col.String), 'AggregateFunction(max, String)'],
      [col.LowCardinality(col.Nullable(col.String)), 'AggregateFunction(max, Nullable(String))'],
      [col.Array(col.LowCardinality(col.String)), 'AggregateFunction(max, Array(String))'],
      [
        col.Map(col.LowCardinality(col.String), col.Array(col.LowCardinality(col.UInt8))),
        'AggregateFunction(max, Map(String, Array(UInt8)))',
      ],
      [col.Tuple({ a: col.LowCardinality(col.String) }), 'AggregateFunction(max, Tuple(a String))'],
      [
        col.SimpleAggregateFunction('max', col.LowCardinality(col.String)),
        'AggregateFunction(max, String)',
      ],
      [
        col.SimpleAggregateFunction('max', col.UInt64),
        'AggregateFunction(max, SimpleAggregateFunction(max, UInt64))',
      ],
      [col.Decimal(18, 2), 'AggregateFunction(max, Decimal(18, 2))'],
      [col.DateTime('UTC'), "AggregateFunction(max, DateTime('UTC'))"],
    ];

    for (const [input, expected] of cases)
      expect(print(maxState(g(input)).ir.type!)).toBe(expected);
  });

  it('leaves an input without LowCardinality structurally unchanged', () => {
    for (const c of [col.String, col.Nullable(col.UInt32), col.Array(col.String)])
      expect(stateArgument(c.type)).toEqual(c.type);
  });

  it('name the level in parametric states, spelled as the server spells a Float64 parameter', () => {
    const f = g(col.Float64);

    expect(print(quantileState(0.9)(f).ir.type!)).toBe('AggregateFunction(quantile(0.9), Float64)');
    expect(print(quantileState(0)(f).ir.type!)).toBe('AggregateFunction(quantile(0.), Float64)');
    expect(print(quantileState(1)(f).ir.type!)).toBe('AggregateFunction(quantile(1.), Float64)');

    expect(print(quantileState(1e-7)(f).ir.type!)).toBe(
      'AggregateFunction(quantile(1e-7), Float64)',
    );

    expect(print(quantileExactState(0.25)(g(col.Nullable(col.UInt32))).ir.type!)).toBe(
      'AggregateFunction(quantileExact(0.25), Nullable(UInt32))',
    );
  });

  it('list every operand of a two-argument state', () => {
    expect(print(argMaxState(g(col.Nullable(col.String)), g(col.Date, 'v')).ir.type!)).toBe(
      'AggregateFunction(argMax, Nullable(String), Date)',
    );
  });
});

describe('merge descriptors follow the stored arguments', () => {
  it.each([
    [() => avgMerge(g(col.AggregateFunction('avg', col.UInt32))), 'Float64'],
    [
      () => avgMerge(g(col.AggregateFunction('avg', col.Nullable(col.UInt32)))),
      'Nullable(Float64)',
    ],
    [
      () => minMerge(g(col.AggregateFunction('min', col.Array(col.LowCardinality(col.String))))),
      'Array(String)',
    ],
    [() => maxMerge(g(col.AggregateFunction('max', col.LowCardinality(col.String)))), 'String'],
    [
      () => argMaxMerge(g(col.AggregateFunction('argMax', col.Nullable(col.String), col.UInt32))),
      'Nullable(String)',
    ],
    [() => argMinMerge(g(col.AggregateFunction('argMin', col.UInt32, col.Date))), 'UInt32'],
    [() => uniqMerge(g(col.AggregateFunction('uniq', col.Nullable(col.String)))), 'UInt64'],
    [() => uniqExactMerge(g(col.AggregateFunction('uniqExact', col.String))), 'UInt64'],
    [() => quantileMerge(0.5)(g(col.AggregateFunction('quantile(0.9)', col.UInt32))), 'Float64'],
    [
      () => quantileMerge(0.9)(g(col.AggregateFunction('quantile(0.9)', col.Nullable(col.UInt32)))),
      'Nullable(Float64)',
    ],
    [
      () => quantileExactMerge(0.5)(g(col.AggregateFunction('quantileExact(0.9)', col.UInt32))),
      'UInt32',
    ],
    [
      () =>
        quantileExactMerge(0.9)(
          g(col.AggregateFunction('quantileExact(0.9)', col.Nullable(col.UInt32))),
        ),
      'Nullable(UInt32)',
    ],
  ] as const)('%#', (merge, expected) => {
    expect(print(merge().ir.type!)).toBe(expected);
  });

  it('a merge carries the merge level as a parameter, not the stored one', () => {
    const { ir } = quantileMerge(0.1)(g(col.AggregateFunction('quantile(0.9)', col.Float64)));

    expect(ir).toMatchObject({
      combinators: ['Merge'],
      params: [{ kind: 'Param', value: 0.1, type: col.Float64.type }],
    });
  });

  it('a forged state with the wrong operand count does not throw in the builder', () => {
    expect(() => avgMerge(g(col.AggregateFunction('avg') as never) as never)).not.toThrow();
    expect(() => sumState(g(col.UInt32))).not.toThrow();
  });

  it('names merges from the state column', () => {
    expect(quantileMerge(0.5)(g(col.AggregateFunction('quantile', col.Float64), 'lat')).name).toBe(
      'lat',
    );

    expect(uniqState(g(col.String, 'id')).name).toBe('id');
    expect(uniqExactState(g(col.String, 'id')).name).toBe('id');
    expect(minState(g(col.String, 'id')).name).toBe('id');
    expect(avgState(g(col.UInt32, 'n')).name).toBe('n');
    expect(argMinState(g(col.String, 'v'), g(col.UInt32, 'w')).name).toBe('v');
  });
});
