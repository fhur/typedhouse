import { expect, it } from 'vitest';
import { col, greatest, val } from '../src/index.js';

it('review regression: a possibly empty variadic tail must not promise its precision', () => {
  const low = val(new Date(0), col.DateTime64(0));
  const high = val(new Date(123), col.DateTime64(3));
  const operands: [typeof low, typeof low, ...typeof high[]] = [low, low];
  // Original bug: this call promised precision 3 from the absent tail but returned 0.
  // The repaired contract rejects uncertain tuples; runtime still computes the actual maximum.
  // @ts-expect-error a possibly empty tail is not exact maximum evidence
  greatest(...operands);
  const fixed = greatest(low, low);
  const promisedPrecision: typeof fixed.ir.type.precision = 0;
  expect(fixed.ir.type.precision).toBe(promisedPrecision);
  const present = greatest(low, low, high);
  const presentPrecision: typeof present.ir.type.precision = 3;
  expect(present.ir.type.precision).toBe(presentPrecision);
});

it('pattern zone types fail closed while runtime still validates actual zones', () => {
  function patternedZones(first: `Etc/GMT+${number}`, second: `Etc/GMT+${number}`) {
    // @ts-expect-error identical pattern types are not singleton timezone evidence
    return greatest(val(new Date(0), col.DateTime64(3, first)), val(new Date(0), col.DateTime64(3, second)));
  }
  expect(() => patternedZones('Etc/GMT+1', 'Etc/GMT+2')).toThrow('unsupported_mixed_timezones');
  expect(patternedZones('Etc/GMT+1', 'Etc/GMT+1').ir.type).toEqual({ kind: 'DateTime64', precision: 3, tz: 'Etc/GMT+1' });
  const first = val(new Date(0), col.DateTime64(1, 'Etc/GMT+1'));
  const second = val(new Date(0), col.DateTime64(3, 'Etc/GMT+1'));
  const result = greatest(first, second);
  const zone: typeof result.ir.type.tz = 'Etc/GMT+1';
  expect(result.ir.type).toEqual({ kind: 'DateTime64', precision: 3, tz: zone });
});

it('explicit precision generics preserve actual optional timezone metadata', () => {
  const explicit = col.DateTime64<3>(3, 'UTC');
  const omitted = col.DateTime64<3>(3);
  const optional = (zone?: string) => col.DateTime64<3>(3, zone);
  expect(explicit.type).toEqual({ kind: 'DateTime64', precision: 3, tz: 'UTC' });
  expect(omitted.type).toEqual({ kind: 'DateTime64', precision: 3 });
  expect(optional().type).toEqual(omitted.type);
  expect(optional('Europe/Amsterdam').type).toEqual({ kind: 'DateTime64', precision: 3, tz: 'Europe/Amsterdam' });
});
