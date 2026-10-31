import { expect, it } from 'vitest';
import { col, from, sql, table } from '@typedhouse/core';
import { dataflow } from '../src/index.js';

const source = from(table('offers', { tenant: col.String, price: col.Nullable(col.Float64), time: col.DateTime64(3) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));

it('formats nullable checks, quoted values, dates and compound conditions', () => {
  const q = source.where(r => r.price.isNotNull().and(r.tenant.eq("o'hare")))
    .where(r => r.time.ge(new Date('2026-01-01T00:00:00.000Z')));
  expect(dataflow(q.ir).nodes.filter(n => n.kind === 'Filter').map(n => n.label)).toEqual([
    "Filter (time >= '2026-01-01T00:00:00.000Z')",
    "Filter ((price IS NOT NULL) AND (tenant = 'o''hare'))",
  ]);
});

it('marks truncated values and avoids exposing raw SQL text', () => {
  const q = source.where(r => r.tenant.eq('x'.repeat(200)));
  expect(dataflow(q.ir).nodes[0]!.label).toContain('…');
  expect(dataflow(source.where(() => sql`secret_function()`.as(col.Bool)).ir).nodes[0]!.label)
    .toBe('Filter [raw expression]');
});
