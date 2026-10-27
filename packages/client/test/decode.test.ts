import { expect, it } from 'vitest';
import { col } from '@chql/core';
import { decoder, rowDecoder } from '../src/index.js';
it('decodes nullable strings, unsigned bigint boundaries and ISO dates strictly', () => {
  const decode = rowDecoder({ id: col.UInt64.type, category: col.Nullable(col.String).type, updatedAt: col.DateTime64(3).type });
  expect(decode({ id: '18446744073709551615', category: null, updatedAt: '2026-10-27T12:00:00.123Z' })).toEqual({ id: 18446744073709551615n, category: null, updatedAt: new Date('2026-10-27T12:00:00.123Z') });
  expect(decoder(col.UInt64.type)('0')).toBe(0n);
  for (const value of [-1, 1, '-1', '18446744073709551616', '1.0', null]) expect(() => decoder(col.UInt64.type)(value)).toThrow(/decode_invalid/);
  for (const value of ['bad', '2026-10-27 12:00:00', null]) expect(() => decoder(col.DateTime64(3).type)(value)).toThrow(/decode_invalid/);
  expect(() => decoder(col.String.type)(null)).toThrow(/decode_invalid/);
  expect(() => decode({ id: '0' })).toThrow(/decode_missing_column/);
  expect(() => decoder(col.Array(col.String).type)).toThrow(/decode_unsupported/);
});
