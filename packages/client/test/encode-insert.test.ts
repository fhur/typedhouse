import { describe, expect, it, vi } from 'vitest';
import { parseCHType, type CHType, type TableDef } from '@typedhouse/core';
import { encodeInsert, InsertValidationError } from '../src/encode-insert.js';

function table(columns: Record<string, CHType>, extra: Partial<TableDef> = {}): TableDef {
  return {
    name: 'odd`table',
    engine: 'Memory',
    sortingKey: [],
    partitionKey: [],
    columns,
    ...extra,
  };
}

function encode(type: string, value: unknown): unknown {
  return encodeInsert({ table: table({ value: parseCHType(type) }), rows: [{ value }] }).rows[0]!
    .value;
}

function rejects(type: string, value: unknown): void {
  expect(() => encode(type, value)).toThrow(InsertValidationError);
}

describe('insert encoding', () => {
  it.each([8, 16, 32, 64, 128, 256])('checks exact signed and unsigned %i-bit bounds', bits => {
    for (const unsigned of [false, true]) {
      const type = `${unsigned ? 'U' : ''}Int${bits}`;
      const bound = 1n << BigInt(unsigned ? bits : bits - 1);
      const min = unsigned ? 0n : -bound;
      const max = bound - 1n;
      const input = (n: bigint): number | bigint => (bits <= 32 ? Number(n) : n);
      expect(encode(type, input(min))).toBe(bits <= 32 ? Number(min) : String(min));
      expect(encode(type, input(max))).toBe(bits <= 32 ? Number(max) : String(max));
      rejects(type, input(min - 1n));
      rejects(type, input(max + 1n));
      rejects(type, bits <= 32 ? 1n : 1);
      rejects(type, '1');
      rejects(type, 0.5);
    }
  });

  it('checks floats, booleans, strings and UUIDs without coercion', () => {
    expect(encode('Float32', 3.4028234663852886e38)).toBe(3.4028234663852886e38);
    rejects('Float32', 3.402823466385289e38);
    expect(encode('Float64', Number.MAX_VALUE)).toBe(Number.MAX_VALUE);

    for (const type of ['Float32', 'Float64']) {
      expect(encode(type, -0)).toBe('-0');
      expect(encode(type, 0)).toBe(0);
    }

    for (const type of ['Float32', 'Float64'])
      for (const value of [NaN, Infinity, -Infinity, '1', null]) rejects(type, value);

    expect(encode('Bool', false)).toBe(false);
    rejects('Bool', 1);
    expect(encode('String', '\0秘密')).toBe('\0秘密');
    rejects('String', new String('x'));

    expect(encode('UUID', 'FFFFFFFF-0000-1234-abcd-0123456789ab')).toBe(
      'FFFFFFFF-0000-1234-abcd-0123456789ab',
    );

    rejects('UUID', 'bad');
    expect(encode("Enum8('yes' = 1, 'no' = -1)", 'yes')).toBe('yes');
    rejects("Enum8('yes' = 1)", 1);
    rejects("Enum8('yes' = 1)", 'no');
  });

  it('checks decimal precision and scale using decimal digits, not floating arithmetic', () => {
    expect(encode('Decimal(5, 2)', '-000999.99')).toBe('-000999.99');
    expect(encode('Decimal(2, 2)', '0.99')).toBe('0.99');
    expect(encode('Decimal(76, 0)', '9'.repeat(76))).toBe('9'.repeat(76));

    for (const v of ['1000', '0.001', '1e2', '+1', '.1', '1.', ' 1', 1, NaN])
      rejects('Decimal(5, 2)', v);

    rejects('Decimal(76, 0)', '1' + '0'.repeat(76));
    rejects('Decimal(2, 2)', '1');
  });

  it('encodes UTC dates and aligned timestamps with exact ranges', () => {
    expect(encode('Date', new Date(0))).toBe('1970-01-01');
    expect(encode('Date', new Date(65535 * 86400000))).toBe('2149-06-06');
    rejects('Date', new Date(65536 * 86400000));
    rejects('Date', new Date(-86400000));
    for (const type of ['Date', 'Date32']) rejects(type, new Date(1));
    expect(encode('Date32', new Date('1900-01-01Z'))).toBe('1900-01-01');
    expect(encode('Date32', new Date('2299-12-31Z'))).toBe('2299-12-31');
    rejects('Date32', new Date('1899-12-31Z'));
    rejects('Date32', new Date('2300-01-01Z'));
    expect(encode("DateTime('Europe/Berlin')", new Date(4294967295000))).toBe(4294967295);
    for (const ms of [-1000, 1, 4294967296000]) rejects('DateTime', new Date(ms));

    for (let precision = 0; precision <= 3; precision++) {
      const type = `DateTime64(${precision})`;
      const step = 10 ** (3 - precision);
      // Ticks of 10^-precision seconds, as an exact JSON number (pre-1970 included).
      expect(encode(type, new Date(step))).toBe(1);
      expect(encode(type, new Date(-step))).toBe(-1);
      if (precision < 3) rejects(type, new Date(step + 1));
      expect(encode(type, new Date('1900-01-01Z'))).toBe(Date.UTC(1900, 0, 1) / step);

      expect(encode(type, new Date(Date.UTC(2300, 0, 1) - step))).toBe(
        (Date.UTC(2300, 0, 1) - step) / step,
      );

      rejects(type, new Date('1899-12-31Z'));
      rejects(type, new Date('2300-01-01Z'));
    }

    for (const type of ['Date', 'Date32', 'DateTime', 'DateTime64(3)']) {
      rejects(type, new Date(NaN));
      rejects(type, '1970-01-01');
      rejects(type, 0);
      rejects(type, Object.assign(new Date(), { toJSON: () => 'secret' }));
    }
  });

  it('recursively encodes named/positional tuples and wrappers', () => {
    expect(
      encode('Array(Tuple(a Nullable(Int64), b LowCardinality(String)))', [
        { a: 1n, b: 'x' },
        { a: null, b: '' },
      ]),
    ).toEqual([
      { a: '1', b: 'x' },
      { a: null, b: '' },
    ]);

    expect(encode('Tuple(Int8, Array(UInt64))', [1, [2n]])).toEqual([1, ['2']]);
    expect(encode('Tuple()', [])).toEqual([]);
    rejects('Tuple(a Int8)', { a: 1, b: 2 });
    rejects('Tuple(a Int8)', {});
    rejects('Tuple(Int8)', []);
    rejects('Tuple(Int8)', [1, 2]);
    rejects('Tuple(Int8)', { 0: 1 });
    rejects('Tuple(a Int8, String)', { a: 1 });
    rejects('Tuple(a Int8, a Int8)', { a: 1 });
    rejects('Nullable(Int8)', undefined);
  });

  it.each([
    'FixedString(3)',
    'IPv4',
    'IPv6',
    'Map(String, String)',
    'JSON',
    'Dynamic',
    'Variant(String, UInt8)',
    'AggregateFunction(sum, UInt8)',
    'SimpleAggregateFunction(sum, UInt8)',
    'Nothing',
    'Unrecognized',
    'DateTime64(4)',
    'DateTime64(9)',
    'Decimal(0, 0)',
    'Decimal(2, 3)',
  ])('rejects unsupported %s even behind null/empty wrappers', type => {
    rejects(type, null);
    rejects(`Nullable(${type})`, null);
    rejects(`Array(${type})`, []);
    rejects(`Tuple(x Array(${type}))`, { x: [] });

    const target = table(
      { x: parseCHType(type) },
      { columnMetadata: { x: { defaultKind: 'DEFAULT' } } },
    );

    expect(encodeInsert({ table: target, rows: [{}] }).rows).toEqual([{}]);

    expect(() => encodeInsert({ table: target, rows: [{ x: null }] })).toThrow(
      InsertValidationError,
    );

    expect(encodeInsert({ table: target, rows: [] }).rows).toEqual([]);
  });

  it('retains deterministic writable columns and heterogeneous default omissions', () => {
    const target = table(
      {
        z: parseCHType('Int8'),
        a: parseCHType('Nullable(String)'),
        m: parseCHType('String'),
        alias: parseCHType('String'),
        hidden: parseCHType('String'),
      },
      {
        columnMetadata: {
          a: { defaultKind: 'DEFAULT' },
          m: { defaultKind: 'MATERIALIZED' },
          alias: { defaultKind: 'ALIAS' },
        },
        hiddenColumns: ['hidden'],
      },
    );

    expect(
      encodeInsert({ table: target, rows: [{ z: 1 }, { a: null, z: 2 }, { z: 3, a: 'explicit' }] }),
    ).toEqual({
      table: 'odd`table',
      columns: ['z', 'a'],
      rows: [{ z: 1 }, { z: 2, a: null }, { z: 3, a: 'explicit' }],
    });

    for (const row of [
      {},
      { z: 1, a: undefined },
      { z: 1, m: 'x' },
      { z: 1, alias: 'x' },
      { z: 1, hidden: 'x' },
      { z: 1, extra: true },
    ])
      expect(() => encodeInsert({ table: target, rows: [row] })).toThrow(InsertValidationError);

    rejects('Nullable(String)', undefined);
    expect(() => encodeInsert({ table: table({}), rows: [{}] })).toThrow(InsertValidationError);
    expect(encodeInsert({ table: table({}), rows: [] }).rows).toEqual([]);
  });

  it('uses safe records for special keys and exact tuple membership', () => {
    const columns = JSON.parse(
      '{"__proto__":{"kind":"scalar","name":"String"},"constructor":{"kind":"scalar","name":"String"}}',
    ) as Record<string, CHType>;

    const row = JSON.parse('{"__proto__":"safe","constructor":"also safe"}') as Record<
      string,
      unknown
    >;

    const result = encodeInsert({ table: table(columns), rows: [row] });
    expect(JSON.stringify(result.rows)).toBe('[{"__proto__":"safe","constructor":"also safe"}]');

    expect(encode('Tuple(`__proto__` String)', JSON.parse('{"__proto__":"safe"}'))).toEqual(
      JSON.parse('{"__proto__":"safe"}'),
    );

    rejects('Tuple(toString String)', {});

    expect(
      encodeInsert({
        table: table({ x: parseCHType('String') }),
        rows: [Object.assign(Object.create(null), { x: 'safe' })],
      }).rows,
    ).toEqual([{ x: 'safe' }]);
  });

  it('never invokes getters or toJSON and rejects cycles, sparse arrays, symbols and custom instances', () => {
    const getter = vi.fn(() => 'secret');
    const row = Object.defineProperty({}, 'value', { enumerable: true, get: getter });

    expect(() =>
      encodeInsert({ table: table({ value: parseCHType('String') }), rows: [row] }),
    ).toThrow(InsertValidationError);

    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => 'secret');
    rejects('Tuple(x Int8)', { x: 1, toJSON });
    expect(toJSON).not.toHaveBeenCalled();
    rejects('Array(Int8)', new Array(1));
    rejects('Array(Int8)', Object.assign([1], { extra: true }));
    rejects('Array(Int8)', Object.defineProperty([1], '0', { get: getter }));
    rejects('Tuple(x Int8)', { x: 1, [Symbol('x')]: 2 });
    rejects('Tuple(x Int8)', Object.defineProperty({ x: 1 }, 'hidden', { value: 2 }));

    class Custom {
      x = 1;
    }

    rejects('Tuple(x Int8)', new Custom());
    const cycle: unknown[] = [];
    cycle.push(cycle);
    rejects('Array(Array(Int8))', cycle);
    const shared = [1];
    expect(encode('Array(Array(Int8))', [shared, shared])).toEqual([[1], [1]]);
  });

  it('snapshots values and validates the entire batch with private location errors', () => {
    const date = new Date(0);
    const values = [1n];
    const target = table({ values: parseCHType('Array(Int64)'), date: parseCHType('DateTime') });
    const rows = [{ values, date }];
    const result = encodeInsert({ table: target, rows });
    values.push(2n);
    date.setTime(1000);
    rows.push({ values: [], date });
    expect(result.rows).toEqual([{ values: ['1'], date: 0 }]);
    expect(() => JSON.stringify(result)).not.toThrow();

    try {
      encodeInsert({
        table: table({ value: parseCHType('Array(Int8)') }),
        rows: [{ value: [1] }, { value: ['secret payload'] }],
      });

      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InsertValidationError);

      expect(error).toMatchObject({
        code: 'INVALID_VALUE',
        table: 'odd`table',
        row: 1,
        path: 'value[0]',
      });

      expect(JSON.stringify(error)).not.toContain('secret payload');
      expect(String(error)).not.toContain('secret payload');
    }
  });
});
