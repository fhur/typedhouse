import { expect, it } from 'vitest';
import { col } from '@chql/core';
import { decoder, rowDecoder } from '../src/index.js';
it('decodes structural fields, booleans and numerical boundaries strictly', () => {
  expect(decoder({ kind: 'Tuple', items: [] })([])).toEqual([]);
  const type = col.Array(col.Tuple({ ['__proto__']: col.Int64, 'a.b': col.Array(col.Nullable(col.Bool)), '0': col.Float64 })).type;
  expect(decoder(type)([{ ['__proto__']: '-7', 'a.b': [0, 1, null, false, true], '0': 'nan' }])).toEqual([{ ['__proto__']: -7n, 'a.b': [false, true, null, false, true], '0': NaN }]);
  expect(decoder({ kind: 'Tuple', items: [{ type: col.Int8.type }, { type: col.FixedString(2).type }] })([-128, 'x\0'])).toEqual([-128, 'x\0']);
  for (const v of [2, 'true', '1', null]) expect(() => decoder(col.Bool.type)(v)).toThrow(/decode_invalid/);
  for (const v of [-129, 128, 1.5, '1']) expect(() => decoder(col.Int8.type)(v)).toThrow(/decode_invalid/);
  expect(decoder(col.Int256.type)((-(1n << 255n)).toString())).toBe(-(1n << 255n));
  expect(() => decoder(col.Int64.type)('9223372036854775808')).toThrow(/decode_invalid/);
  expect(decoder(col.Float32.type)('inf')).toBe(Infinity);
  expect(decoder(col.Float64.type)('-inf')).toBe(-Infinity);
  for (const v of [null, '3.2', {}, Infinity]) expect(() => decoder(col.Float64.type)(v)).toThrow(/decode_invalid/);
  for (const v of [{}, [null], [{ ['__proto__']: '1', 'a.b': [], '0': 0, extra: 1 }]]) expect(() => decoder(type)(v)).toThrow(/decode_invalid/);
});
it('decodes nullable strings, unsigned bigint boundaries and ISO dates strictly', () => {
  const decode = rowDecoder({ id: col.UInt64.type, category: col.Nullable(col.String).type, updatedAt: col.DateTime64(3).type });
  expect(decode({ id: '18446744073709551615', category: null, updatedAt: '2026-10-27T12:00:00.123Z' })).toEqual({ id: 18446744073709551615n, category: null, updatedAt: new Date('2026-10-27T12:00:00.123Z') });
  expect(decoder(col.UInt64.type)('0')).toBe(0n);
  for (const value of [-1, 1, '-1', '18446744073709551616', '1.0', null]) expect(() => decoder(col.UInt64.type)(value)).toThrow(/decode_invalid/);
  for (const value of ['bad', '2026-10-27 12:00:00', null]) expect(() => decoder(col.DateTime64(3).type)(value)).toThrow(/decode_invalid/);
  expect(() => decoder(col.String.type)(null)).toThrow(/decode_invalid/);
  expect(() => decode({ id: '0' })).toThrow(/decode_missing_column/);
  expect(() => decoder(col.Array(col.Map(col.String, col.String)).type)).toThrow(/decode_unsupported/);
  expect(decoder(col.Array(col.String).type)(['x'])).toEqual(['x']);
});
