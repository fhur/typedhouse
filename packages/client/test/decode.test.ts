import { expect, it } from 'vitest';
import { col } from '@typedhouse/core';
import { decoder, rowDecoder } from '../src/index.js';
it('converts Date and Date32 as UTC calendar days without enforcing server ranges', () => {
  for (const day of ['1900-01-01', '1970-01-01', '2000-02-29', '2024-02-29', '2149-06-06']) {
    expect(decoder(col.Date.type)(day)).toEqual(new Date(`${day}T00:00:00Z`));
    expect(decoder(col.Date32.type)(day)).toEqual(new Date(`${day}T00:00:00Z`));
  }
  for (const value of ['2100-02-29', '2023-02-29', '2024-02-30', '2024-00-01', '2024-13-01', '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z', '', null, 0, new Date()]) {
    expect(() => decoder(col.Date.type)(value)).toThrow(/decode_invalid/);
  }
  expect(decoder(col.Nullable(col.Date).type)(null)).toBeNull();
  expect(decoder(col.Array(col.Date).type)(['2024-02-29'])).toEqual([new Date('2024-02-29T00:00:00Z')]);
});
it('decodes structural fields, booleans and numerical boundaries strictly', () => {
  expect(decoder({ kind: 'Tuple', items: [] })([])).toEqual([]);
  const type = col.Array(col.Tuple({ ['__proto__']: col.Int64, 'a.b': col.Array(col.Nullable(col.Bool)), '0': col.Float64 })).type;
  expect(decoder(type)([{ ['__proto__']: '-7', 'a.b': [0, 1, null, false, true], '0': 'nan' }])).toEqual([{ ['__proto__']: -7n, 'a.b': [false, true, null, false, true], '0': NaN }]);
  expect(decoder({ kind: 'Tuple', items: [{ type: col.Int8.type }, { type: col.FixedString(2).type }] })([-128, 'x\0'])).toEqual([-128, 'x\0']);
  for (const v of [2, 'true', '1', null]) expect(() => decoder(col.Bool.type)(v)).toThrow(/decode_invalid/);
  // Small integers and strings are driver-owned, not client-validated.
  expect(decoder(col.Int8.type)(128)).toBe(128);
  expect(decoder(col.Int256.type)((-(1n << 255n)).toString())).toBe(-(1n << 255n));
  expect(() => decoder(col.Int64.type)('9223372036854775808')).toThrow(/decode_invalid/);
  expect(decoder(col.Float32.type)('inf')).toBe(Infinity);
  expect(decoder(col.Float64.type)('-inf')).toBe(-Infinity);
  expect(decoder(col.Float64.type)('nan')).toBeNaN();
  expect(decoder(col.Float64.type)('-nan')).toBeNaN(); // x86_64 ClickHouse spelling of 0/0
  expect(decoder(col.Float32.type)('-nan')).toBeNaN();
  expect(() => decoder(col.Float64.type)('+nan')).toThrow('decode_invalid');
  expect(() => decoder(col.Float64.type)('NaN')).toThrow('decode_invalid');
  for (const v of [null, '3.2', {}, Infinity]) expect(() => decoder(col.Float64.type)(v)).toThrow(/decode_invalid/);
  for (const v of [{}, [null], [{ ['__proto__']: '1', 'a.b': [], '0': 0, extra: 1 }]]) expect(() => decoder(type)(v)).toThrow(/decode_invalid/);
});
it('decodes nullable strings, unsigned bigint boundaries and ISO dates strictly', () => {
  const decode = rowDecoder({ id: col.UInt64.type, category: col.Nullable(col.String).type, updatedAt: col.DateTime64(3).type });
  expect(decode({ id: '18446744073709551615', category: null, updatedAt: '2026-10-27T12:00:00.123Z' })).toEqual({ id: 18446744073709551615n, category: null, updatedAt: new Date('2026-10-27T12:00:00.123Z') });
  expect(decoder(col.UInt64.type)('0')).toBe(0n);
  expect(decoder(col.DateTime64(3).type)('1969-12-31T23:59:59.123Z')).toEqual(new Date(-877));
  expect(decoder(col.DateTime64(3).type)('2024-01-02T03:04:05.123+05:30')).toEqual(new Date('2024-01-01T21:34:05.123Z'));
  expect(decoder(col.DateTime().type)('2024-01-02T03:04:05-04:00')).toEqual(new Date('2024-01-02T07:04:05Z'));
  for (const value of [-1, 1, '-1', '18446744073709551616', '1.0', null]) expect(() => decoder(col.UInt64.type)(value)).toThrow(/decode_invalid/);
  for (const value of ['bad', '2026-10-27 12:00:00', null]) expect(() => decoder(col.DateTime64(3).type)(value)).toThrow(/decode_invalid/);
  expect(decoder(col.String.type)(null)).toBeNull();
  expect(() => decode({ id: '0' })).toThrow(/decode_missing_column/);
  const map = { x: '7' };
  expect(decoder(col.Array(col.Map(col.String, col.Int64)).type)([map])).toEqual([map]);
  expect(decoder(col.Map(col.String, col.Int64).type)(map)).toBe(map);
  expect(() => decoder(col.AggregateFunction('sum', col.UInt64).type)).toThrow(/decode_unsupported/);
  expect(decoder(col.Array(col.String).type)(['x'])).toEqual(['x']);
});
it('passes driver-owned families through by identity, including Maps inside converting containers', () => {
  const wire = JSON.parse('{"__proto__":{"safe":true},"42":"7","date":"2024-01-01","nested":["8"]}') as Record<string, unknown>;
  for (const type of [col.Map(col.UInt64, col.Int64), col.JSON, col.Variant(col.String, col.Int64), col.Dynamic, col.Unknown('Future')]) expect(decoder(type.type)(wire)).toBe(wire);
  const map = col.Map(col.String, col.Int64);
  const tuple = col.Tuple({ map, n: col.Int64, at: col.DateTime64(3) });
  expect(decoder(col.Array(tuple).type)([{ map: wire, n: '7', at: '2024-01-01T00:00:00Z' }])).toEqual([{ map: wire, n: 7n, at: new Date('2024-01-01') }]);
  expect((decoder(tuple.type)({ map: wire, n: '7', at: '2024-01-01T00:00:00Z' }) as { map: unknown }).map).toBe(wire);
  for (const type of [col.Decimal(38, 9), col.UUID, col.IPv4, col.IPv6, col.Enum8({ ok: 1 }), col.DateTime64(9)]) expect(decoder(type.type)('driver value')).toBe('driver value');
  expect(decoder(col.SimpleAggregateFunction('sum', col.UInt64).type)('7')).toBe(7n);
  expect(Object.getPrototypeOf(wire)).toBe(Object.prototype);
  expect(Object.hasOwn(wire, '__proto__')).toBe(true);
});
