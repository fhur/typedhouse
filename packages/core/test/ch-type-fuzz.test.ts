import fc from 'fast-check';
import { expect, it } from 'vitest';
import { parseCHType, print, scalarNames, type CHType } from '../src/index.js';

const options = { seed: 20261027, numRuns: 2000 };

it('never throws on arbitrary strings; Unknown preserves bytes', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string({ maxLength: 3000 }),
        // Grammar-shaped strings reach parser states that uniform text rarely does.
        fc.tuple(types(2), fc.nat(), fc.string({ maxLength: 20 })).map(([type, cut, suffix]) => {
          const raw = print(type);
          return raw.slice(0, cut % (raw.length + 1)) + suffix;
        }),
        fc
          .tuple(
            fc.constantFrom('FixedString', 'Decimal', 'DateTime64', 'Enum8'),
            fc.oneof(fc.string({ maxLength: 30 }), fc.bigInt().map(String)),
          )
          .map(([name, argument]) => `${name}(${argument})`),
      ),
      s => {
        const t = parseCHType(s);

        if (t.kind === 'Unknown') expect(print(t)).toBe(s);
        else expect(parseCHType(print(t))).toEqual(t);
      },
    ),
    { ...options, numRuns: 10000 },
  );
});

function types(depth: number): fc.Arbitrary<CHType> {
  const leaf: fc.Arbitrary<CHType> = fc.oneof(
    fc
      .constantFrom(...scalarNames.filter(n => n !== 'DateTime'))
      .map(name => ({ kind: 'scalar' as const, name })),
    fc.string().map(tz => ({ kind: 'DateTime' as const, tz })),
    fc
      .record({
        precision: fc.integer({ min: 0, max: 9 }),
        tz: fc.option(fc.string(), { nil: undefined }),
      })
      .map(({ precision, tz }) => ({
        kind: 'DateTime64' as const,
        precision,
        ...(tz === undefined ? {} : { tz }),
      })),
    fc.integer({ min: 1, max: 1000 }).map(n => ({ kind: 'FixedString' as const, n })),
    fc.constantFrom(8 as const, 16 as const).chain(bits =>
      fc
        .array(
          fc.record({
            name: fc.string(),
            value: fc.integer(bits === 8 ? { min: -128, max: 127 } : { min: -32768, max: 32767 }),
          }),
          { maxLength: 5 },
        )
        .map(values => ({ kind: 'Enum' as const, bits, values })),
    ),
    fc
      .integer({ min: 1, max: 76 })
      .chain(precision =>
        fc
          .integer({ min: 0, max: precision })
          .map(scale => ({ kind: 'Decimal' as const, precision, scale })),
      ),
    fc.constant({ kind: 'Dynamic' as const }),
  );

  if (!depth) return leaf;
  const child = types(depth - 1);

  const fn = fc.oneof(
    fc.constantFrom('sum', 'uniq', 'groupArray', 'argMax'),
    fc.integer({ min: 1, max: 100 }).map(n => `uniqUpTo(${n})`),
    fc
      .tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }))
      .map(([a, b]) => `quantiles(${a}, ${b})`),
    fc.constant("sequenceMatch('(?1).*(?2)')"),
  );

  return fc.oneof(
    leaf,
    fc
      .tuple(
        fc.constantFrom('Array' as const, 'Nullable' as const, 'LowCardinality' as const),
        child,
      )
      .map(([kind, inner]) => ({ kind, inner })),
    fc.tuple(child, child).map(([key, value]) => ({ kind: 'Map' as const, key, value })),
    fc.array(child, { maxLength: 3 }).map(items => ({ kind: 'Variant' as const, items })),
    fc
      .array(child, { maxLength: 3 })
      .map(items => ({ kind: 'Tuple' as const, items: items.map(type => ({ type })) })),
    fc
      .array(fc.record({ name: fc.string(), type: child }), { maxLength: 3 })
      .map(items => ({ kind: 'Tuple' as const, items })),
    fc
      .tuple(fn, fc.array(child, { maxLength: 3 }))
      .map(([fn, args]) => ({ kind: 'AggregateFunction' as const, fn, args })),
    fc
      .tuple(fn, child)
      .map(([fn, inner]) => ({ kind: 'SimpleAggregateFunction' as const, fn, inner })),
  );
}

it('recursive valid ASTs survive print/parse, including arbitrary quoted punctuation', () => {
  fc.assert(
    fc.property(types(4), t => {
      expect(parseCHType(print(t))).toEqual(t);
    }),
    options,
  );
});

it('preserves arbitrary ASCII controls and delimiters in nested tuple identifiers', () => {
  const characters = [
    ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)),
    '`',
    '\\',
    "'",
    ',',
    ')',
    'é',
    '😀',
  ];

  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...characters), { minLength: 1, maxLength: 40 }),
      parts => {
        const type: CHType = {
          kind: 'Array',
          inner: {
            kind: 'Tuple',
            items: [{ name: parts.join(''), type: { kind: 'scalar', name: 'UInt64' } }],
          },
        };

        expect(parseCHType(print(type))).toEqual(type);
      },
    ),
    options,
  );
});

it.each([
  'Tuple(`unfinished\\',
  'Tuple(`unfinished String)',
  'Tuple(`ok` String) trailing',
  'Tuple(`ok` String, Future(1))',
])('preserves malformed identifier/type input %s', raw => {
  expect(parseCHType(raw)).toEqual({ kind: 'Unknown', raw });
});

it('valid type prefixes followed by garbage are not partially accepted', () => {
  fc.assert(
    fc.property(types(2), t => {
      const raw = print(t) + ' trailing!';
      expect(parseCHType(raw)).toEqual({ kind: 'Unknown', raw });
    }),
    options,
  );
});
