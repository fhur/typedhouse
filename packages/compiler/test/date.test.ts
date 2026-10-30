import { expect, it } from 'vitest';
import { col, table, from, val, Expr, exprNode, type CHType } from '@typedhouse/core';
import { emitNaive } from '../src/index.js';
import { serializeParameter } from '../src/parameters.js';

const metadata = { engine: 'Memory', sortingKey: [], partitionKey: [] };
const source = from(table('dates', { at: col.DateTime64(3), day: col.Date }, metadata));
it('transports Date calendar days and array elements without server overflow', () => {
  const date = new Date('2024-02-29T23:59:59Z');
  expect(serializeParameter(date, col.Date.type)).toBe('2024-02-29');
  expect(serializeParameter([date, null], col.Array(col.Nullable(col.Date)).type)).toBe("['2024-02-29',NULL]");
  for (const value of [new Date('1969-12-31'), new Date('2149-06-07'), new Date(NaN), '2024-02-29', 0]) expect(() => serializeParameter(value, col.Date.type)).toThrow(/param_incompatible/);
  const q = source.map(r => ({ week: r.at.toStartOfWeek() })).where(r => r.week.ge(date));
  const compiled = emitNaive(q.ir);
  expect(compiled.params).toEqual({ p0: '2024-02-29' });
  expect(compiled.sql).toContain('{p0:Date}');
  expect(compiled.sql).toContain('typedhouse_date_out_of_range');
  expect(compiled.sql).toContain('SETTINGS enable_extended_results_for_datetime_functions = 1');
  expect(emitNaive(source.ir).sql).not.toContain('SETTINGS');
});
it('rejects hostile Date text and invalid nested Date parameters before transport', () => {
  for (const payload of ["2024-01-01' OR 1=1 --", '2024-01-01\n', '2024-01-01\0', new Date('2149-06-07'), new Date(NaN)]) {
    expect(() => serializeParameter([[payload]], col.Array(col.Array(col.Nullable(col.Date))).type)).toThrow(/param_incompatible/);
  }
  const first = val(new Date('2024-01-07T23:59:59Z'), col.Date);
  const second = val(new Date('2024-01-07T23:59:59Z'), col.Date);
  const query = source.map(() => ({ a: first.toStartOfWeek(), b: first.toStartOfWeek(), c: second.toStartOfWeek() }));
  expect(emitNaive(query.ir).params).toEqual({ p0: '2024-01-07', p1: '2024-01-07' });
  expect(emitNaive(query.ir).parameterTypes).toEqual({ p0: col.Date.type, p1: col.Date.type });
});
it('validates weekly metadata, arity, descriptors and original reference scope', () => {
  const call = source.row.at.toStartOfWeek().ir;
  if (call.kind !== 'Call') throw new Error('expected Call');
  const { id: _id, ...fields } = call;
  for (const altered of [
    { ...fields, fn: { ...call.fn, deterministic: false } },
    { ...fields, args: [] },
    { ...fields, type: col.Date32.type },
  ]) expect(() => emitNaive(source.map(() => ({ week: new Expr(exprNode(altered), 'week', 'row') })).ir)).toThrow(/invalid_function_metadata|invalid_argument_arity|invalid_expression_type/);
  const unsupported: CHType[] = [col.Date32.type, col.DateTime().type, col.DateTime64(4).type, col.LowCardinality(col.Date).type, col.String.type];
  for (const type of unsupported) {
    const forged = exprNode({ ...fields, args: [exprNode({ kind: 'Param', type, value: new Date('2024-03-03') })] });
    expect(() => emitNaive(source.map(() => ({ week: new Expr(forged, 'week', 'row') })).ir)).toThrow(/incompatible_operands/);
  }
  const foreign = from(table('foreign_dates', { at: col.DateTime64(3) }, metadata));
  expect(() => emitNaive(source.map(() => foreign.row.at.toStartOfWeek()).ir)).toThrow(/unbound_column/);
  expect(emitNaive(source.map(() => ({ day: val(new Date('2024-02-29'), col.Date) })).ir).params).toEqual({ p0: '2024-02-29' });
});
