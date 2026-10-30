import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { col, from, print, sum, table } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { expectedParams, expectedSql, latest, query } from './fixtures/corpus/low-stock.js';
it('emits the literal unchanged spec SQL and Params', () => {
  const spec = readFileSync(new URL('../../../spec.md', import.meta.url), 'utf8');
  expect(spec).toContain('```sql\n' + expectedSql + '\n```');
  const compiled = compile(query.ir);
  expect(compiled.sql).toBe(expectedSql);
  expect(compiled.params).toEqual(expectedParams);
  expect(Object.fromEntries(Object.entries(compiled.columns).map(([k, d]) => [k, print(d)]))).toEqual({ category: 'String', components: 'UInt64', stockIndex: 'Float64', leadTimeIndex: 'Float64', priceIndex: 'Float64', warned: 'UInt64' });
  expect(emitNaive(query.ir).columns).toEqual(compiled.columns);
  expect(compile(query.ir)).toEqual(compiled);
});
it('retains descriptors and exact runtime capabilities through latest', () => {
  const columns = { tenantId: col.String, entityId: col.String, version: col.UInt32 };
  for (const [metric, result] of [[col.Float64, 'Float64'], [col.UInt32, 'UInt64']] as const) {
    for (const source of [undefined, { kind: 'fixture' }]) {
      const q = from(table('metrics', { ...columns, metric }, { engine: 'MergeTree', sortingKey: [], partitionKey: [], ...(source ? { source } : {}) }));
      const l = latest(q);
      expect(l.caps).toEqual(q.caps);
      expect(l.row.metric.ir.type).toEqual(metric.type);
      expect(print(compile(l.aggregate(g => ({ metric: sum(g.metric) })).ir).columns.metric!)).toBe(result);
    }
  }
});
