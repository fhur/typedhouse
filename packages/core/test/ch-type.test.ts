import { describe, expect, it } from 'vitest';
import { parseCHType, print, scalarNames } from '../src/index.js';
describe('CH type grammar', () => {
  const canonical = [...scalarNames, 'FixedString(12)', "DateTime('Europe/Amsterdam')", "DateTime64(9, 'UTC')", 'Decimal(18, 4)', "Enum8('a b' = -1, 'comma,(quote\\\'slash\\\\)' = 2)", 'Enum16(\'x\' = -300)', 'Array(Nullable(UInt64))', 'LowCardinality(Nullable(String))', 'Map(String, Array(UInt8))', 'Tuple(a String, b UInt8)', 'Tuple(String, UInt8)', 'Tuple(`a.b` String, `back\\`tick` UInt8)', 'Tuple()', 'Variant(String, UInt64)', 'Dynamic', 'AggregateFunction(sum, UInt64)', 'AggregateFunction(quantiles(0.5, 0.9), UInt64)', 'AggregateFunction(count)', 'SimpleAggregateFunction(sum, UInt64)'];
  it.each(canonical)('round trips canonical %s', s => { const t = parseCHType(s); expect(t.kind).not.toBe('Unknown'); expect(print(t)).toBe(s); expect(parseCHType(print(t))).toEqual(t); });
  it.each([[" Decimal64 ( 4 ) ", 'Decimal(18, 4)'], ['Decimal32(2)', 'Decimal(9, 2)'], ['Decimal128(7)', 'Decimal(38, 7)'], ['Decimal256(9)', 'Decimal(76, 9)'], ["Enum8('it''s' = 1)", "Enum8('it\\'s' = 1)"]])('normalizes %s', (input, output) => expect(print(parseCHType(input!))).toBe(output));
  it.each(['', 'UInt8 junk', 'Array(String', 'Array(String))', 'Map(String)', 'FutureType(String)', 'Tuple(a String,)', "Enum8('x = 1)", 'FixedString(99999999999999999999)', 'Array('.repeat(300) + 'String' + ')'.repeat(300)])('preserves invalid/unsupported input', raw => expect(parseCHType(raw)).toEqual({ kind: 'Unknown', raw }));
  it.each([
    [String.raw`\x41`, 'A'], [String.raw`\q`, String.raw`\q`],
    [String.raw`\a`, '\x07'], [String.raw`\v`, '\v'],
    [String.raw`\b`, '\b'], [String.raw`\f`, '\f'],
    [String.raw`\xC3\xA9`, 'é'], [String.raw`\xE2\x82\xAC`, '€'],
    [String.raw`\xF0\x9F\x98\x80`, '😀'], [String.raw`😀\xC3\xA9é`, '😀éé'],
    [String.raw`\xEF\xBB\xBF`, '\uFEFF'],
    [String.raw`\xC3\xA9\n\xE2\x82\xAC`, 'é\n€'],
  ])('decodes ClickHouse escape %s independently of printing', (escape, decoded) => {
    expect(parseCHType(`Enum8('${escape}' = 1)`)).toEqual({ kind: 'Enum', bits: 8, values: [{ name: decoded, value: 1 }] });
  });
  it('prints canonical backspace and form feed escapes', () => {
    expect(print({ kind: 'Enum', bits: 8, values: [{ name: '\b\f', value: 1 }] })).toBe(String.raw`Enum8('\b\f' = 1)`);
  });
  it.each([
    ['\n', String.raw`\n`], ['\t', String.raw`\t`], ['\b', String.raw`\b`],
    ['\r', String.raw`\r`], ['\f', String.raw`\f`], ['\0', String.raw`\0`],
    ['\x07', '\x07'], ['\v', '\v'], ["'", "'"], ['`', String.raw`\``], ['\\', String.raw`\\`],
  ])('canonically prints tuple identifier character %j', (character, escaped) => {
    const type = { kind: 'Tuple' as const, items: [{ name: `a${character}b`, type: { kind: 'scalar' as const, name: 'String' as const } }] };
    const canonical = 'Tuple(`a' + escaped + 'b` String)';
    expect(print(type)).toBe(canonical);
    expect(parseCHType(canonical)).toEqual(type);
  });
  it('uses DateTime node for bare DateTime', () => expect(parseCHType('DateTime')).toEqual({ kind: 'DateTime' }));
});
