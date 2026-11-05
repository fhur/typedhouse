import { describe, expect, it } from 'vitest';
import {
  col,
  from,
  getInsertCommandData,
  InsertCommand,
  table,
  type CHType,
  type TableDef,
} from '../src/index.js';

const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] };

const target = table(
  't',
  {
    id: col.UInt64,
    value: col.Nullable(col.String),
    d: col.String,
    alias: col.String,
    hidden: col.String,
  },
  {
    ...meta,
    columnMetadata: { d: { defaultKind: 'DEFAULT' }, alias: { defaultKind: 'ALIAS' } },
    hiddenColumns: ['hidden'],
  },
);

const build = (rows: unknown) => InsertCommand.create(target, rows as Record<string, unknown>[]);

describe('insert commands', () => {
  it('is distinct from queries and only available directly from a table', () => {
    const q = from(target);
    expect(Object.isFrozen(q)).toBe(true);
    expect('insertMany' in q.final()).toBe(false);
    expect('insertMany' in q.sample(0.5)).toBe(false);
    expect('insertMany' in q.where(r => r.id.eq(1n))).toBe(false);

    const command = q.insertMany([
      { id: 1n, value: null },
      { id: 2n, value: 'x', d: 'given' },
    ]);

    expect(command).toBeInstanceOf(InsertCommand);
    expect('ir' in command).toBe(false);
    expect(getInsertCommandData(command).rows).toHaveLength(2);
    expect(() => getInsertCommandData({} as InsertCommand)).toThrow('invalid_insert_command');
  });

  it.each([
    [{}],
    [{ id: 1n }],
    [{ id: 1n, value: null, extra: 1 }],
    [{ id: 1n, value: null, alias: 'x' }],
    [{ id: 1n, value: null, hidden: 'x' }],
    [{ id: 1n, value: undefined }],
    [new Map()],
    [new Date()],
    new Array(1),
  ])('rejects invalid row structure %#', rows => {
    expect(() => build(rows)).toThrow();
  });

  it('rejects accessors, symbols, cycles, sparse arrays and serialization hooks without calling them', () => {
    let calls = 0;

    const getter = Object.defineProperty({}, 'id', {
      get() {
        calls++;
        return 1n;
      },
    });

    const cycle: unknown[] = [];
    cycle.push(cycle);

    for (const value of [
      getter,
      { [Symbol()]: 1 },
      cycle,
      new Array(2),
      {
        toJSON() {
          calls++;
          return 'x';
        },
      },
    ]) {
      expect(() => build([{ id: 1n, value }])).toThrow();
    }

    expect(calls).toBe(0);
  });

  it('snapshots tables, rows and dates and never exposes authoritative copies', () => {
    const descriptor: CHType = { kind: 'DateTime64', precision: 3 };
    const t: TableDef = { ...meta, name: 'original', columns: { v: descriptor } };
    const date = new Date(1000);
    const rows = [{ v: [date, { inner: ['x'] }] }];
    const command = InsertCommand.create(t, rows);
    date.setTime(2000);
    rows[0]!.v.push('new' as never);
    descriptor.precision = 9;
    const first = getInsertCommandData(command);
    (first.rows[0]!['v'] as Date[])[0]!.setTime(3000);
    (first.table.columns['v'] as { precision: number }).precision = 8;
    const second = getInsertCommandData(command);
    expect((second.rows[0]!['v'] as Date[])[0]!.getTime()).toBe(1000);
    expect(second.table.columns['v']).toEqual({ kind: 'DateTime64', precision: 3 });
    expect(second.rows[0]!['v']).toHaveLength(2);
  });

  it.each<CHType>([
    { kind: 'FixedString', n: 2 },
    { kind: 'scalar', name: 'IPv4' },
    { kind: 'scalar', name: 'IPv6' },
    { kind: 'scalar', name: 'JSON' },
    { kind: 'scalar', name: 'Nothing' },
    { kind: 'Dynamic' },
    { kind: 'Unknown', raw: 'x' },
    { kind: 'Variant', items: [] },
    { kind: 'AggregateFunction', fn: 'sum', args: [] },
    { kind: 'SimpleAggregateFunction', fn: 'sum', inner: col.UInt64.type },
    { kind: 'Map', key: col.String.type, value: col.String.type },
    { kind: 'DateTime64', precision: 4 },
  ])('rejects unsupported descriptors even under empty containers: %j', type => {
    for (const descriptor of [
      type,
      { kind: 'Nullable', inner: type },
      { kind: 'Array', inner: type },
    ] as CHType[]) {
      const t: TableDef = {
        ...meta,
        name: 'unsupported',
        columns: { v: descriptor },
        columnMetadata: { v: { defaultKind: 'DEFAULT' } },
      };

      expect(() => InsertCommand.create(t, [])).not.toThrow();
      expect(() => InsertCommand.create(t, [{}])).not.toThrow();

      for (const v of [null, []])
        expect(() => InsertCommand.create(t, [{ v }])).toThrow('unsupported_insert_type');

      expect(() => InsertCommand.create({ ...t, columnMetadata: {} }, [{}])).toThrow(
        'missing_insert_column',
      );
    }
  });
});
