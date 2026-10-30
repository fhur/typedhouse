import { expect, it } from 'vitest';
import { col, type CHType } from '@chql/core';
import { decoder } from '../src/decode.js';
it('decodes scalar and structured DateTime ISO UTC/offset values recursively', () => {
  for (const type of [{ kind: 'scalar', name: 'DateTime' }, col.DateTime().type, col.DateTime('Europe/Amsterdam').type] satisfies CHType[]) {
    const decode = decoder(type);
    expect(decode('2024-03-31T03:30:00+02:00')).toEqual(new Date('2024-03-31T01:30:00Z'));
    expect(decode('2024-01-01T00:00:00Z')).toEqual(new Date('2024-01-01T00:00:00Z'));
    for (const bad of [null, 0, new Date(), '', '2024-02-30T00:00:00Z', '2024-01-01 00:00:00', '2024-01-01T24:00:00Z', '2024-01-01T00:60:00Z', '2024-01-01T00:00:60Z', '2024-01-01T00:00:00+24:00']) expect(() => decode(bad)).toThrow('decode_invalid');
    expect(decoder({ kind: 'Array', inner: { kind: 'Nullable', inner: type } })([null, '2024-01-01T00:00:00Z'])).toEqual([null, new Date('2024-01-01T00:00:00Z')]);
  }
});
