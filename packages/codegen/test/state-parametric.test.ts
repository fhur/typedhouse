import { expect, it } from 'vitest';
import { col, parseCHType, print, quantileMerge, from, table } from '@typedhouse/core';
import { compile } from '@typedhouse/compiler';
import { renderColumn } from '../src/render.js';

it.each([
  [
    'AggregateFunction(quantile(0.9), Float64)',
    'col.AggregateFunction("quantile(0.9)", col.Float64)',
  ],
  [
    'AggregateFunction(quantile(1.), Float64)',
    'col.AggregateFunction("quantile(1.)", col.Float64)',
  ],
  ['AggregateFunction(quantile, Float64)', 'col.AggregateFunction("quantile", col.Float64)'],
  [
    'AggregateFunction(quantileExact(0.5), Nullable(UInt64))',
    'col.AggregateFunction("quantileExact(0.5)", col.Nullable(col.UInt64))',
  ],
  ['AggregateFunction(count)', 'col.AggregateFunction("count")'],
  [
    'AggregateFunction(argMax, String, UInt64)',
    'col.AggregateFunction("argMax", col.String, col.UInt64)',
  ],
])('renders %s, and the text round-trips', (type, rendered) => {
  expect(renderColumn(parseCHType(type))).toBe(rendered);
  expect(print(parseCHType(type))).toBe(type);
});

it('the rendered parametric column feeds quantileMerge', () => {
  // Exactly what `renderColumn` writes above; test/types/state-merge.ts pins the same descriptor in types.
  const rollup = table(
    'rollup',
    { k: col.String, latency: col.AggregateFunction('quantile(0.9)', col.Float64) },
    { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] },
  );

  const { sql, params, columns } = compile(
    from(rollup)
      .groupBy(r => r.k)
      .aggregate(g => ({ p90: quantileMerge(0.9)(g.latency) })).ir,
  );

  expect(sql).toContain('quantileMerge({p0:Float64})(');
  expect(params).toEqual({ p0: '0.9' });
  expect(print(columns.p90!)).toBe('Float64');
});
