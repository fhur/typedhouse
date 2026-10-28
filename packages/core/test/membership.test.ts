import { expect, it } from 'vitest';
import { col, table, from, countIf, unionAll, print } from '../src/index.js';
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] };
const q = from(table('membership', { id: col.String, status: col.Nullable(col.String) }, meta));
it('owns lists, retains set relation identity and receiver names/modes', () => {
  const values = ['EOL'];
  const e = q.row.status.in(values);
  values.push('NRND');
  expect(e.name).toBe('status');
  expect(e.mode).toBe('row');
  expect(print(e.ir.type!)).toBe('Nullable(Bool)');
  if (e.ir.kind !== 'Call') throw new Error('fixture');
  expect(e.ir.args[1]).toMatchObject({ kind: 'Param', type: null, value: ['EOL'] });
  const set = unionAll(q.map(r => r.id).limit(0), q.map(r => r.id).distinct());
  const member = q.row.id.notIn(set);
  if (member.ir.kind !== 'Call') throw new Error('fixture');
  expect(member.ir.args[1]).toMatchObject({ kind: 'Subquery', usage: 'in' });
  const operand = member.ir.args[1];
  if (operand?.kind !== 'Subquery') throw new Error('fixture');
  expect(operand.rel).toBe(set.ir);
  expect(Object.isFrozen(operand)).toBe(true);
  q.aggregate(g => { expect(g.status.in(['EOL']).mode).toBe('grouped'); return countIf(g.status.in(['EOL'])); });
});
it('snapshots Date lists and preserves Date UNION set identity and grouped modes', () => {
  const dates = from(table('dates', { day: col.Nullable(col.Date) }, meta));
  const day = new Date('2024-02-29T23:59:00Z');
  const list = [day];
  const member = dates.row.day.in(list);
  day.setUTCFullYear(2000); list.push(new Date());
  expect(member.ir).toMatchObject({ args: [{}, { value: [new Date('2024-02-29T23:59:00Z')] }] });
  expect(print(member.ir.type!)).toBe('Nullable(Bool)');
  const set = unionAll(dates, dates.limit(0));
  const expression = dates.row.day.notIn(set);
  if (expression.ir.kind !== 'Call' || expression.ir.args[1]?.kind !== 'Subquery') throw new Error('fixture');
  expect(expression.ir.args[1].rel).toBe(set.ir);
  expect(expression.name).toBe('day');
  dates.aggregate(g => {
    expect(g.day.in(set).mode).toBe('grouped');
    return countIf(g.day.in(set));
  });
});
it('traverses set dependencies for live capability, including UNION', () => {
  const live = from(table('live', { id: col.String }, { ...meta, source: { kind: 'test' } }));
  expect(live.where(r => r.id.in(live)).caps.live).toBe(true);
  expect(live.where(r => r.id.in(unionAll(live, q.map(r => r.id)))).caps.live).toBe(false);
});
