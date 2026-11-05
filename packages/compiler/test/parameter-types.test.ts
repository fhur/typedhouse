import { expect, it } from 'vitest';
import { col, from, table, type Decimal, type UUID } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { serializeParameter } from '../src/parameters.js';

// Every value the builder's types accept for a column must be usable as a parameter for it.
// These types were readable and insertable but threw param_incompatible when filtered on
// (found by the round-trip property in packages/client/test/roundtrip.integration.ts).
const metadata = { engine: 'Memory', sortingKey: [], partitionKey: [] };

const reject = (value: unknown, type: Parameters<typeof serializeParameter>[1]) =>
  expect(() => serializeParameter(value, type)).toThrow(/param_incompatible/);

it('sends UUID parameters in canonical form only', () => {
  const type = col.UUID.type;

  expect(serializeParameter('00000000-0000-1000-8000-000000000000', type)).toBe(
    '00000000-0000-1000-8000-000000000000',
  );

  expect(serializeParameter('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', type)).toBe(
    'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
  );

  for (const value of [
    'a0eebc999c0b4ef8bb6d6bb9bd380a11',
    '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' OR 1=1 --",
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1',
    '',
    42,
    null,
  ])
    reject(value, type);

  expect(
    serializeParameter(['00000000-0000-1000-8000-000000000000'], col.Array(col.UUID).type),
  ).toBe("['00000000-0000-1000-8000-000000000000']");
});

it('sends Date32 parameters as the UTC calendar day across the Date32 range', () => {
  const type = col.Date32.type;
  expect(serializeParameter(new Date('1900-01-01T00:00:00Z'), type)).toBe('1900-01-01');
  expect(serializeParameter(new Date('2299-12-31T23:59:59.999Z'), type)).toBe('2299-12-31');
  expect(serializeParameter(new Date('1969-07-20T20:17:00Z'), type)).toBe('1969-07-20');

  for (const value of [
    new Date('1899-12-31T23:59:59.999Z'),
    new Date('2300-01-01T00:00:00Z'),
    new Date(NaN),
    '1969-07-20',
  ])
    reject(value, type);

  expect(
    serializeParameter([new Date('1950-05-05'), null], col.Array(col.Nullable(col.Date32)).type),
  ).toBe("['1950-05-05',NULL]");
});

it('sends Decimal parameters as exact text that fits the declared precision and scale', () => {
  const type = col.Decimal(18, 4).type;

  for (const value of [
    '0',
    '-0',
    '1.5',
    '-1.5000',
    '00012.3400',
    '99999999999999.9999',
    '-99999999999999.9999',
  ])
    expect(serializeParameter(value, type)).toBe(value);

  // Never rounded or overflowed by the server: too many fraction or integer digits is an error.
  for (const value of [
    '1.23456',
    '100000000000000',
    '1e3',
    '1.',
    '.5',
    '+1',
    ' 1',
    '1,5',
    'NaN',
    '',
    1.5,
    15n,
    null,
  ])
    reject(value, type);

  expect(serializeParameter('12', col.Decimal(2, 0).type)).toBe('12');
  reject('123', col.Decimal(2, 0).type);
  expect(serializeParameter(['1.5', '-2'], col.Array(col.Decimal(9, 2)).type)).toBe('[1.5,-2]');
});

it('sends Enum parameters by declared name only', () => {
  const type = col.Enum8({ draft: 1, paid: 2, "it's": -3 }).type;
  expect(serializeParameter('paid', type)).toBe('paid');
  expect(serializeParameter("it's", type)).toBe("it's");
  for (const value of ['PAID', 'unknown', '2', 2, '', null]) reject(value, type);

  expect(
    serializeParameter(
      ["it's", 'draft'],
      col.Array(col.Enum8({ draft: 1, paid: 2, "it's": -3 })).type,
    ),
  ).toBe("['it\\'s','draft']");
});

it('emits typed placeholders for each newly supported parameter type in both emitters', () => {
  const t = table(
    't',
    { u: col.UUID, d32: col.Date32, dec: col.Decimal(18, 4), e: col.Enum8({ draft: 1, paid: 2 }) },
    metadata,
  );

  const query = from(t)
    .where(r => r.u.eq('00000000-0000-1000-8000-000000000000' as UUID))
    .where(r => r.d32.ge(new Date('1901-01-01')))
    .where(r => r.dec.eq('1.5' as Decimal<18, 4>))
    .where(r => r.e.eq('paid'));

  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);

    for (const placeholder of [
      '{p0:UUID}',
      '{p1:Date32}',
      '{p2:Decimal(18, 4)}',
      "{p3:Enum8('draft' = 1, 'paid' = 2)}",
    ])
      expect(plan.sql).toContain(placeholder);

    expect(plan.params).toEqual({
      p0: '00000000-0000-1000-8000-000000000000',
      p1: '1901-01-01',
      p2: '1.5',
      p3: 'paid',
    });
  }
});

it('keeps LowCardinality parameters over the newly supported types rejected, as before', () => {
  reject(null, col.LowCardinality(col.Nullable(col.UUID)).type);
  reject(null, col.LowCardinality(col.Nullable(col.Date32)).type);
  reject(null, col.LowCardinality(col.Nullable(col.Decimal(10, 2))).type);
  reject(null, col.LowCardinality(col.Nullable(col.Enum8({ a: 1 }))).type);
  reject('00000000-0000-1000-8000-000000000000', col.LowCardinality(col.UUID).type);
  reject('a', col.LowCardinality(col.Enum8({ a: 1 })).type);
  reject(['1.5'], col.Array(col.LowCardinality(col.Decimal(10, 2))).type);
});
