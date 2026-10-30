import { expect, it } from 'vitest';
import { col, sql, val, from, table } from '@chql/core';
import { compile, emitNaive } from '../src/index.js';

it('rejects executable own Date fields before snapshotting a snippet value', () => {
  let calls = 0;
  const date = new Date(0);
  Object.defineProperty(date, 'getTime', { get() { calls++; return () => 0; } });
  expect.soft(() => sql`${date}`.as(col.DateTime64(3))).toThrow();
  expect(calls).toBe(0);
});

it('rejects getters in extra owned array fields before snapshotting a snippet value', () => {
  let calls = 0;
  const values = ['safe'];
  Object.defineProperty(values, 'extra', { value: Object.defineProperty({}, 'value', { get() { calls++; return 'executed'; } }) });
  expect.soft(() => sql`${values}`.as(col.Array(col.String))).toThrow();
  expect(calls).toBe(0);
});

it('rejects nested/accessor/auxiliary values before reading any executable fields', () => {
  let calls = 0;
  const getter = { get() { calls++; throw new Error('executed'); } };
  const invoke = (value: unknown) => (sql as (...args: unknown[]) => unknown)(['', ''], value);
  class DateSubclass extends Date { override getTime(): number { calls++; throw new Error('executed'); } }
  class Custom { get value() { calls++; throw new Error('executed'); } }
  const cycle: unknown[] = []; cycle.push(cycle);
  const invalid: unknown[] = [
    Object.defineProperty(new Date(0), 'getTime', getter),
    Object.defineProperty(new Date(0), 'getTime', { value() { calls++; throw new Error('executed'); } }),
    Object.defineProperty(new Date(0), 'constructor', getter),
    Object.defineProperty(new Date(0), Symbol('extra'), getter),
    new DateSubclass(0), Object.create(Date.prototype),
    Object.defineProperty(['safe'], '0', getter),
    [Object.defineProperty(['safe'], '0', getter)],
    Object.defineProperty(['safe'], 'extra', getter),
    Object.defineProperty(['safe'], Symbol('extra'), getter),
    Object.defineProperty(['safe'], 'extra', { value: Object.defineProperty({}, 'nested', getter) }),
    Object.defineProperty(['safe'], 'extra', { value: 'data', enumerable: true }),
    [Object.defineProperty({}, 'tuple', getter)],
    Object.defineProperty({}, 'tuple', getter),
    new String('value'), new Number(1), new Boolean(true), new Custom(),
    new Array(1), cycle, [cycle],
  ];
  for (const value of invalid) {
    expect(() => invoke(value)).toThrow(/invalid_sql_operand|invalid_data_container|cyclic_sql_value/);
    expect(calls).toBe(0);
  }
});

it('captures legitimate dates and dense arrays while retaining nominal expression identity', () => {
  const date = new Date('2024-01-02T03:04:05+02:00');
  const values = [date];
  Object.defineProperty(values, '0', { value: date, enumerable: false });
  const fragment = sql`${values}`;
  date.setTime(0);
  const captured = fragment.as(col.Array(col.DateTime64(3))).ir;
  if (captured.kind !== 'Raw' || captured.args[0]?.kind !== 'Param') throw new Error('expected parameter');
  const stored = captured.args[0].value as Date[];
  expect(stored).toHaveLength(1);
  expect(stored[0]!.toISOString()).toBe('2024-01-02T01:04:05.000Z');
  expect(Object.getOwnPropertyDescriptor(stored, '0')?.enumerable).toBe(false);
  const p = val('2024-01-02T03:04:05+02:00');
  const expression = sql`${p}`.as(col.String);
  if (expression.ir.kind !== 'Raw') throw new Error('expected raw');
  expect(expression.ir.args[0]).toBe(p.ir);
  const q = from(table('items', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  for (const emit of [compile, emitNaive]) {
    expect(Object.values(emit(q.map(() => ({ value: expression })).ir).params)).toEqual(['2024-01-02T03:04:05+02:00']);
    const result = emit(q.map(() => ({ value: sql`${new Date('2024-01-02T01:04:05Z')}`.as(col.DateTime64(3)) })).ir);
    expect(Object.keys(result.params)).toHaveLength(1);
  }
});
