import { describe, expect, it } from 'vitest';
import {
  argMaxMerge,
  argMaxState,
  avgMerge,
  col,
  count,
  countMerge,
  createKnownFunctions,
  exprNode,
  from,
  join,
  leftJoin,
  max,
  maxMerge,
  maxState,
  minMerge,
  uniqExactMerge,
  print,
  quantileExactMerge,
  quantileExactState,
  quantileMerge,
  quantileState,
  relNode,
  scalar,
  sql,
  sum,
  sumMerge,
  sumState,
  table,
  uniqMerge,
  unionAll,
  containsAggregateState,
  parseCHType,
  type CHType,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D3 Tester attacks, independent of the Worker's state-merge.test.ts. Every case runs on both emitters. */
const meta = { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const sumOf = () => col.AggregateFunction('sum', col.UInt64);

const rollup = table(
  'r',
  {
    k: col.String,
    n: col.UInt32,
    tags: col.Array(col.String),
    total: sumOf(),
    ids: col.AggregateFunction('uniq', col.String),
    p: col.AggregateFunction('quantile(0.9)', col.Float64),
    np: col.AggregateFunction('quantile(0.9)', col.Nullable(col.Float64)),
    one: col.AggregateFunction('quantile(1.)', col.Nullable(col.Float64)),
    zero: col.AggregateFunction('quantile(0.)', col.Nullable(col.Float64)),
    dt: col.AggregateFunction('quantile(0.5)', col.DateTime('UTC')),
    d: col.AggregateFunction('quantile(0.5)', col.Date),
    dec: col.AggregateFunction('quantile(0.5)', col.Decimal(18, 2)),
    avgDec: col.AggregateFunction('avg', col.Decimal(18, 2)),
    last: col.AggregateFunction('argMax', col.String, col.DateTime('UTC')),
    simple: col.SimpleAggregateFunction('max', col.UInt64),
  },
  meta,
);

const other = table('o', { k: col.String, v: col.UInt32 }, meta);

const forged = table(
  'f',
  {
    k: col.String,
    nullable: col.Nullable(sumOf()) as never,
    low: col.LowCardinality(sumOf() as never) as never,
    lowNullable: col.LowCardinality(col.Nullable(sumOf()) as never) as never,
  } as never,
  meta,
) as never as typeof rollup & { row: never };

/** One table per wrapper: a shared table would let the first invalid descriptor mask the others. */
const nestedTypes = {
  array: col.Array(sumOf()),
  tuple: col.Tuple([sumOf(), col.UInt8]),
  named: col.NamedTuple([['s', sumOf()]]),
  map: col.Map(col.String, sumOf()),
  nullableArray: col.Array(col.Nullable(sumOf()) as never),
  arrayArray: col.Array(col.Array(sumOf())),
  simple: col.SimpleAggregateFunction('max', sumOf() as never),
  variant: col.Variant(sumOf(), col.String),
  mapKey: col.Map(sumOf() as never, col.String),
  mapOfArray: col.Map(col.String, col.Array(sumOf())),
  variantOfMap: col.Variant(col.Map(col.String, sumOf())),
  nullableMap: col.Nullable(col.Map(col.String, sumOf()) as never),
  lowCardinalityArray: col.LowCardinality(col.Array(sumOf()) as never),
  lowNullableMap: col.LowCardinality(col.Nullable(col.Map(col.String, sumOf()) as never) as never),
  simpleOfMap: col.SimpleAggregateFunction('max', col.Map(col.String, sumOf()) as never),
  deep: col.Array(
    col.Map(
      col.String,
      col.NamedTuple([['v', col.Array(col.Variant(col.String, col.Array(sumOf())))]]),
    ),
  ),
} as const;

const nestedTable = (column: keyof typeof nestedTypes) =>
  table('n', { k: col.String, x: nestedTypes[column] } as never, meta) as any;

const emitters = [
  ['naive', emitNaive],
  ['optimized', compile],
] as const;

const rejects = (name: string, build: () => Rel, error: RegExp) => {
  it(`${name} raises ${error.source}`, () => {
    for (const [mode, emit] of emitters) expect(() => emit(build()), mode).toThrow(error);
  });
};

const compiles = (name: string, build: () => Rel, ...contains: string[]) => {
  it(`${name} compiles`, () => {
    for (const [, emit] of emitters) {
      const text = emit(build()).sql;
      for (const c of contains) expect(text).toContain(c);
    }
  });
};

const q = from(rollup) as any;

const SELECTION = /aggregate_state_selection/;

const OPERAND = /aggregate_state_operand/;

const MERGE = /invalid_merge_state/;

describe('a raw state stays out of the result, whichever node is at the root', () => {
  const cases: [string, () => Rel][] = [
    ['raw from', () => q.ir],
    ['where', () => q.where((r: any) => r.k.eq('a')).ir],
    ['prewhere', () => q.prewhere((r: any) => r.k.eq('a')).ir],
    ['final', () => q.final().ir],
    ['limit', () => q.limit(1).ir],
    ['sort', () => q.orderBy((r: any) => r.k).ir],
    ['limit by', () => q.limitBy((r: any) => r.k).take(1).ir],
    ['array join', () => q.arrayJoin((r: any) => r.tags, 'tag').ir],
    ['rename through map', () => q.map((r: any) => ({ x: r.total })).ir],
    ['rename twice', () => q.map((r: any) => ({ x: r.total })).map((r: any) => ({ y: r.x })).ir],
    ['cte', () => q.cte().ir],
    ['cte mapped', () => q.cte().map((r: any) => ({ s: r.total })).ir],
    ['union all', () => unionAll(q, from(rollup) as any).ir],
    ['root sumState', () => q.aggregate((g: any) => ({ s: sumState(g.n) })).ir],
    [
      'grouped sumState',
      () => q.groupBy((r: any) => r.k).aggregate((g: any) => ({ s: sumState(g.n) })).ir,
    ],
    ['single-expression state', () => q.aggregate((g: any) => sumState(g.n)).ir],
    ['join nesting', () => join({ a: q, b: from(other) }).on((r: any) => r.a.k.eq(r.b.k)).ir],
    [
      'join through map',
      () =>
        (join({ a: q, b: from(other) }) as any)
          .on((r: any) => r.a.k.eq(r.b.k))
          .map((r: any) => ({ s: r.a.total })).ir,
    ],
    [
      'left join null-extended side',
      () => leftJoin({ b: from(other) }, { a: q }).on((r: any) => r.a.k.eq(r.b.k)).ir,
    ],
    ['forged Nullable state', () => from(forged).ir],
    ['forged LowCardinality state', () => (from(forged) as any).map((r: any) => ({ s: r.low })).ir],
    [
      'forged LowCardinality(Nullable) state',
      () => (from(forged) as any).map((r: any) => ({ s: r.lowNullable })).ir,
    ],
  ];

  for (const [name, build] of cases) rejects(name, build, SELECTION);
});

describe('a state nested in a container stays out of the result', () => {
  for (const column of Object.keys(nestedTypes) as (keyof typeof nestedTypes)[]) {
    rejects(`${column}: raw from`, () => from(nestedTable(column)).ir, SELECTION);

    rejects(
      `${column}: selected through map`,
      () => (from(nestedTable(column)) as any).map((r: any) => ({ y: r.x })).ir,
      SELECTION,
    );

    rejects(
      `${column}: order by`,
      () =>
        (from(nestedTable(column)) as any).orderBy((r: any) => r.x).map((r: any) => ({ k: r.k }))
          .ir,
      OPERAND,
    );

    rejects(
      `${column}: distinct`,
      () => (from(nestedTable(column)) as any).distinct().map((r: any) => ({ k: r.k })).ir,
      OPERAND,
    );
  }
});

describe('arrayJoin over an array of states', () => {
  const t = () => from(nestedTable('array')) as any;

  rejects(
    'arrayJoin',
    () =>
      t()
        .arrayJoin((r: any) => r.x, 'item')
        .map((r: any) => ({ k: r.k })).ir,
    OPERAND,
  );

  rejects(
    'leftArrayJoin',
    () =>
      t()
        .leftArrayJoin((r: any) => r.x, 'item')
        .map((r: any) => ({ k: r.k })).ir,
    OPERAND,
  );

  rejects(
    'arrayJoin over Array(Array(state))',
    () =>
      (from(nestedTable('arrayArray')) as any)
        .arrayJoin((r: any) => r.x, 'item')
        .map((r: any) => ({ k: r.k })).ir,
    OPERAND,
  );

  rejects(
    'arrayJoin, then count: nothing later reads the element',
    () =>
      t()
        .arrayJoin((r: any) => r.x, 'item')
        .count().ir,
    OPERAND,
  );
});

describe('recursion edges', () => {
  const nest = (depth: number, inner: CHType): CHType => {
    let type = inner;
    for (let i = 0; i < depth; i++) type = { kind: 'Array', inner: type };
    return type;
  };

  it('truth table', () => {
    const state = sumOf().type;

    for (const type of [
      state,
      nest(200, state),
      { kind: 'Map', key: state, value: col.String.type },
      { kind: 'Variant', items: [col.String.type, state] },
      { kind: 'Tuple', items: [{ type: col.String.type }, { name: 'b', type: state }] },
    ] as CHType[])
      expect(containsAggregateState(type), print(type)).toBe(true);

    for (const type of [
      col.String.type,
      nest(200, col.UInt8.type),
      col.Map(col.String, col.UInt64).type,
      col.Variant(col.String, col.UInt64).type,
      col.Dynamic.type,
      col.JSON.type,
      col.SimpleAggregateFunction('max', col.UInt64).type,
      col.Unknown('Foo').type,
      col.Unknown('SimpleAggregateFunction(max, Foo)').type,
      parseCHType("Enum8('AggregateFunction(sum, UInt64)' = 1)"),
      col.Nothing.type,
    ] as CHType[])
      expect(containsAggregateState(type), print(type)).toBe(false);
  });

  const single = (type: CHType) =>
    table('n', { k: col.String, x: { type } as never } as never, meta) as any;

  rejects(
    'Array 100 deep around a state',
    () => from(single(nest(100, sumOf().type))).ir,
    SELECTION,
  );

  it('an absurdly deep or cyclic state descriptor raises instead of emitting SQL or hanging', () => {
    const cyclic: any = { kind: 'Array' };
    cyclic.inner = cyclic;

    for (const type of [nest(50000, sumOf().type), cyclic])
      for (const [mode, emit] of emitters)
        expect(() => emit(from(single(type)).ir), mode).toThrow();

    expect(() => containsAggregateState(cyclic)).toThrow();
  });

  it('a deep state-free column stays selectable', () => {
    for (const [, emit] of emitters)
      expect(emit(from(single(nest(100, col.UInt8.type))).ir).sql).toContain('`x`');
  });
});

describe('an Unknown type that holds a state', () => {
  // Real server text: the first needs flatten_nested = 0, the second a Geo domain the parser does not model.
  for (const text of [
    'Nested(a AggregateFunction(uniq, String))',
    'AggregateFunction(uniq, Point)',
    'AggregateFunction(sum, UInt64)',
    'Tuple(a Nested(b AggregateFunction(sum, UInt64)))',
  ]) {
    rejects(
      `parsed ${text} selected raw`,
      () => from(table('n', { k: col.String, x: { type: parseCHType(text) } } as never, meta)).ir,
      SELECTION,
    );

    rejects(
      `col.Unknown ${text} selected raw`,
      () => from(table('n', { k: col.String, x: col.Unknown(text) }, meta)).ir,
      SELECTION,
    );
  }

  compiles(
    'a state-free Unknown',
    () => from(table('n', { k: col.String, x: col.Unknown('Foo(Bar)') }, meta)).ir,
    '`x`',
  );

  compiles(
    'SimpleAggregateFunction text in an Unknown',
    () =>
      from(table('n', { k: col.String, x: col.Unknown('SimpleAggregateFunction(max, Foo)') }, meta))
        .ir,
    '`x`',
  );

  compiles(
    'a known Enum whose label reads like a state',
    () =>
      from(
        table(
          'n',
          {
            k: col.String,
            x: { type: parseCHType("Enum8('AggregateFunction(sum, UInt64)' = 1)") },
          } as never,
          meta,
        ),
      ).ir,
    '`x`',
  );
});

describe('the Unknown text scanner', () => {
  const held = (raw: string) => containsAggregateState(col.Unknown(raw).type);

  it.each([
    // A quoted type name is the type, which the server accepts.
    ['"AggregateFunction"(sum, UInt64)'],
    ['`AggregateFunction`(sum, UInt64)'],
    ['Array("AggregateFunction"(sum, UInt64))'],
    // Whitespace before the parenthesis.
    ['AggregateFunction (sum, UInt64)'],
    ['AggregateFunction\n(sum, UInt64)'],
    ['AggregateFunction\t(sum, UInt64)'],
    ['`AggregateFunction`\n (sum, UInt64)'],
    // An unterminated quote fails closed.
    ["Foo('a, AggregateFunction(x)"],
    ['Foo(`a, AggregateFunction(x)'],
    ['Foo("a, AggregateFunction(x)'],
    ["Foo('a\\', AggregateFunction(x)"],
    // A state after a quoted segment.
    ["Foo('x', AggregateFunction(y))"],
    ['Foo(`x` AggregateFunction(y))'],
    ['Foo("x" AggregateFunction(y))'],
    // Escapes that end, or do not end, the quoted segment before it.
    ["Foo('it\\'s', AggregateFunction(y))"],
    ["Foo('a\\\\', AggregateFunction(y))"],
    ["Foo('a''b', AggregateFunction(y))"],
    ['Foo(`a\\`b` AggregateFunction(y))'],
    ['Foo(`a\\\\` AggregateFunction(y))'],
    ['Foo(`a``b` AggregateFunction(y))'],
  ])('%s holds a state', raw => {
    expect(held(raw)).toBe(true);

    for (const [mode, emit] of emitters)
      expect(
        () => emit(from(table('n', { k: col.String, x: col.Unknown(raw) }, meta)).ir),
        mode,
      ).toThrow(SELECTION);
  });

  it.each([
    ["Foo('AggregateFunction(x)')"],
    ["Foo('AggregateFunction'(x))"],
    ["Foo('it\\'s AggregateFunction(x)')"],
    ["Foo('a\\\\''AggregateFunction(x)')"],
    ["Foo('a''AggregateFunction(x)')"],
    ['Foo(`AggregateFunction(x)` String)'],
    ['Foo(`a\\`AggregateFunction(x)` String)'],
    ['Foo(`a\\\\``AggregateFunction(x)` String)'],
    ['Foo(`a``AggregateFunction(x)` String)'],
    ['Foo("AggregateFunction(x)" String)'],
    ['Foo("a\\"AggregateFunction(x)" String)'],
    ['Nested(`AggregateFunction` String)'],
    ['Nested(AggregateFunction String)'],
    ['Nested(a String, b UInt32)'],
    ['SimpleAggregateFunction(max, Foo)'],
    ['NotAggregateFunction(x)'],
    ['Point'],
    ['Array(Point)'],
  ])('%s holds no state', raw => {
    expect(held(raw)).toBe(false);

    for (const [, emit] of emitters)
      expect(emit(from(table('n', { k: col.String, x: col.Unknown(raw) }, meta)).ir).sql).toContain(
        '`x`',
      );
  });

  it('reading such a column raises aggregate_state_operand', () => {
    const t = from(
      table('n', { k: col.String, x: col.Unknown('AggregateFunction(uniq, Point)') }, meta),
    ) as any;

    for (const [, emit] of emitters) {
      expect(() => emit(t.orderBy((r: any) => r.x).count().ir)).toThrow(OPERAND);
      expect(() => emit(t.distinct().count().ir)).toThrow(OPERAND);
    }
  });

  describe('a merge of such a type', () => {
    const operands = (): Record<string, any> => ({
      unknown: col.Unknown('AggregateFunction(uniq, Point)'),
      nested: col.Unknown('Nested(a AggregateFunction(sum, UInt64))'),
      map: col.Map(col.String, sumOf()),
      array: col.Array(sumOf()),
      variant: col.Variant(sumOf(), col.String),
    });

    const merges: [string, (x: any) => unknown][] = [
      ['maxMerge', x => maxMerge(x)],
      ['minMerge', x => minMerge(x)],
      ['argMaxMerge', x => argMaxMerge(x)],
      ['sumMerge', x => sumMerge(x)],
      ['avgMerge', x => avgMerge(x)],
      ['countMerge', x => countMerge(x)],
      ['uniqMerge', x => uniqMerge(x)],
      ['uniqExactMerge', x => uniqExactMerge(x)],
      ['quantileMerge', x => quantileMerge(0.5)(x)],
      ['quantileExactMerge', x => quantileExactMerge(0.5)(x)],
    ];

    for (const name of Object.keys(operands()))
      for (const [fn, merge] of merges)
        rejects(
          `${fn} over ${name}`,
          () =>
            (from(table('n', { k: col.String, x: operands()[name] }, meta)) as any).aggregate(
              (g: any) => ({
                y: merge(g.x),
              }),
            ).ir,
          MERGE,
        );
  });
});

describe('the recursion does not reject what must keep working', () => {
  const mixed = table(
    'mixed',
    {
      k: col.String,
      total: sumOf(),
      a: col.Array(sumOf()),
      m: col.Map(col.String, sumOf()),
      v: col.Variant(sumOf(), col.String),
    },
    meta,
  );

  const base = from(mixed) as any;

  const known = createKnownFunctions({
    length: { name: 'length', isAggregate: false, deterministic: true, aliasTo: '' },
    sumMergeForEach: {
      name: 'sumMergeForEach',
      isAggregate: true,
      deterministic: true,
      aliasTo: '',
    },
  } as never) as any;

  const merge = (x: any, column = 'total') =>
    x.aggregate((g: any) => ({ t: sumMerge(g[column]) })).ir;

  const cases: [string, () => Rel][] = [
    ['count with containers unread', () => base.count().ir],
    ['plain map', () => base.map((r: any) => ({ k: r.k })).ir],
    ['merge of a direct state', () => merge(base)],
    [
      'grouped merge',
      () => base.groupBy((r: any) => r.k).aggregate((g: any) => ({ t: sumMerge(g.total) })).ir,
    ],
    ['merge after a filter', () => merge(base.where((r: any) => r.k.eq('a')))],
    [
      'merge after a rename',
      () =>
        merge(
          base.map((r: any) => ({ s: r.total })),
          's',
        ),
    ],
    [
      'a container carried, then a plain map',
      () => base.map((r: any) => ({ k: r.k, c: r.m })).map((r: any) => ({ k: r.k })).ir,
    ],
    [
      'a container carried, then count',
      () => base.map((r: any) => ({ c: r.a, d: r.v })).count().ir,
    ],
    [
      'a container through limit',
      () =>
        base
          .orderBy((r: any) => r.k)
          .limit(1)
          .count().ir,
    ],
    ['a container through union all', () => unionAll(base, from(mixed) as any).count().ir],
    ['a container through a cte', () => base.cte().count().ir],
    [
      'a container through a join input',
      () =>
        (join({ a: base, b: from(other) }) as any)
          .on((r: any) => r.a.k.eq(r.b.k))
          .map((r: any) => ({ k: r.b.k, c: r.a.m }))
          .count().ir,
    ],
    [
      'merge through a join input',
      () =>
        merge(
          (join({ a: base, b: from(other) }) as any)
            .on((r: any) => r.a.k.eq(r.b.k))
            .map((r: any) => ({ s: r.a.total })),
          's',
        ),
    ],
    [
      'known call over a container',
      () => base.map((r: any) => ({ n: known.fn.length(r.a).as(col.UInt64) })).ir,
    ],
    [
      'trusted snippet over a container',
      () => base.map((r: any) => ({ n: sql`length(${r.a})`.as(col.UInt64) })).ir,
    ],
    [
      'known -Merge over a container',
      () =>
        base.aggregate((g: any) => ({
          n: known.agg.sumMergeForEach(g.a).as(col.Array(col.UInt64)),
        })).ir,
    ],
  ];

  for (const [name, build] of cases) compiles(name, build);

  it('a -Merge of a container is not a -Merge of a state', () => {
    for (const column of ['a', 'm', 'v'])
      for (const [, emit] of emitters) expect(() => emit(merge(base, column))).toThrow(MERGE);
  });

  rejects(
    'a typed call over an Array of states',
    () => base.map((r: any) => ({ n: r.a.length() })).ir,
    OPERAND,
  );

  rejects(
    'a group key over a Map of states',
    () =>
      base
        .groupBy((r: any) => r.m)
        .aggregate(() => ({ n: count() }))
        .count().ir,
    OPERAND,
  );

  rejects(
    'a filter on a Variant of states',
    () => base.where((r: any) => r.v.isNull()).count().ir,
    OPERAND,
  );

  rejects(
    'a limitBy key over an Array of states',
    () =>
      base
        .limitBy((r: any) => r.a)
        .take(1)
        .count().ir,
    OPERAND,
  );

  rejects(
    'union distinct over a Map of states',
    () => {
      const { id: _id, ...counted } = base.count().ir;

      const distinct = relNode({
        kind: 'Union',
        inputs: [base.ir, (from(mixed) as any).ir],
        all: false,
        output: base.ir.output,
      });

      return relNode({ ...counted, input: distinct } as never) as Rel;
    },
    OPERAND,
  );

  rejects(
    'a scalar subquery returning a Map of states, forged',
    () => {
      const inner = base.map((r: any) => ({ s: r.m }));
      const type = col.Map(col.String, sumOf()).type;
      const { id: _b, ...project } = (from(other) as any).map((r: any) => ({ s: r.v })).ir;

      return relNode({
        ...project,
        exprs: { s: exprNode({ kind: 'Subquery', usage: 'scalar', rel: inner.ir, type }) },
        columns: { s: type },
        output: { shape: 'flat', columns: { s: type }, order: ['s'] },
      } as never) as Rel;
    },
    SELECTION,
  );
});

describe('level spelling on quantile and quantileExact', () => {
  const level = (fn: string, inner: () => any) =>
    from(
      table('l', { k: col.String, s: col.AggregateFunction(fn, inner()) } as never, meta),
    ) as any;

  const nullable = () => col.Nullable(col.Float64);

  for (const [fn, merge] of [
    ['quantile', quantileMerge as any],
    ['quantileExact', quantileExactMerge as any],
  ] as const) {
    for (const stored of ['1', '0', ' 1 ', '01'])
      for (const at of [1, 0, 0.5])
        rejects(
          `nullable ${fn}(${stored}) merged at ${at}`,
          () =>
            level(`${fn}(${stored})`, nullable).aggregate((g: any) => ({ x: merge(at)(g.s) })).ir,
          MERGE,
        );

    for (const [stored, at] of [
      ['1.', 1],
      ['0.', 0],
      ['1.0', 1],
      ['0.0', 0],
      ['0.90', 0.9],
      ['0.9', 0.9],
      ['1e0', 1],
      ['5e-1', 0.5],
    ] as const)
      compiles(
        `nullable ${fn}(${stored}) merged at ${at}`,
        () => level(`${fn}(${stored})`, nullable).aggregate((g: any) => ({ x: merge(at)(g.s) })).ir,
        `${fn}Merge`,
      );

    for (const stored of ['1', '0', '1.', '0.9'])
      for (const at of [1, 0, 0.5])
        compiles(
          `non-nullable ${fn}(${stored}) merged at ${at}`,
          () =>
            level(`${fn}(${stored})`, () => col.Float64).aggregate((g: any) => ({
              x: merge(at)(g.s),
            })).ir,
          `${fn}Merge`,
        );
  }
});

describe('state read rejected in every clause', () => {
  rejects(
    'scalar subquery, forged',
    () => {
      const states = q.aggregate((g: any) => sumState(g.n));
      const type = col.AggregateFunction('sum', col.UInt32).type;
      const base = (from(other) as any).map((r: any) => ({ s: r.v }));
      const { id: _b, ...project } = base.ir;

      return relNode({
        ...project,
        exprs: { s: exprNode({ kind: 'Subquery', usage: 'scalar', rel: states.ir, type }) },
        columns: { s: type },
        output: { shape: 'flat', columns: { s: type }, order: ['s'] },
      } as never) as Rel;
    },
    SELECTION,
  );

  rejects(
    'in subquery, forged, inside a where',
    () => {
      const states = q.map((r: any) => ({ s: r.total }));
      const base = (from(other) as any).where((r: any) => r.v.gt(0));
      const { id: _b, ...filter } = base.ir;
      const type = col.Bool.type;

      return relNode({
        ...filter,
        pred: exprNode({ kind: 'Subquery', usage: 'in', rel: states.ir, type }),
      } as never) as Rel;
    },
    SELECTION,
  );

  const read = (name: string, build: () => Rel) => rejects(name, build, OPERAND);
  const k = (x: any) => x.map((r: any) => ({ k: r.k })).ir;

  read('where on a state', () => k(q.where((r: any) => r.total.eq(r.total))));
  read('where isNull on a state', () => k(q.where((r: any) => r.total.isNull())));
  read('prewhere on a state', () => k(q.prewhere((r: any) => r.total.isNull())));
  read('order by a state', () => k(q.orderBy((r: any) => r.total)));
  read('thenBy a state', () => k(q.orderBy((r: any) => r.k).thenBy((r: any) => r.total)));
  read('limit by a state', () => k(q.limitBy((r: any) => r.total).take(1)));
  read('limit by a state among keys', () => k(q.limitBy((r: any) => [r.k, r.total]).take(1)));

  read(
    'group by a state',
    () =>
      q
        .groupBy((r: any) => r.total)
        .aggregate(() => ({ n: count() }))
        .count().ir,
  );

  read(
    'group by a renamed state',
    () =>
      q
        .map((r: any) => ({ s: r.total }))
        .groupBy((r: any) => r.s)
        .aggregate(() => ({ n: count() }))
        .count().ir,
  );

  read('distinct over a state', () => k(q.distinct()));

  read(
    'distinct over a renamed state',
    () =>
      q
        .map((r: any) => ({ k: r.k, s: r.total }))
        .distinct()
        .count().ir,
  );

  read(
    'join condition',
    () =>
      (join({ a: q, b: from(rollup) }) as any)
        .on((r: any) => r.a.total.eq(r.b.total))
        .map((r: any) => ({ k: r.a.k })).ir,
  );

  read('max over a state', () => q.aggregate((g: any) => ({ x: max(g.total) })).count().ir);
  read('sum over a state', () => q.aggregate((g: any) => ({ x: sum(g.total) })).ir);
  read('state of a state', () => q.aggregate((g: any) => ({ x: maxState(g.total) })).count().ir);

  read(
    'predicate reading a state in a merge sibling',
    () => q.where((r: any) => r.k.eq('a').and(r.total.isNull())).count().ir,
  );

  read(
    'unread computation over a state, pruned by the optimizer',
    () => q.map((r: any) => ({ k: r.k, x: r.total.isNull() })).map((r: any) => ({ k: r.k })).ir,
  );

  read(
    'unread filter over a renamed state',
    () =>
      q
        .map((r: any) => ({ k: r.k, s: r.total }))
        .where((r: any) => r.s.isNull())
        .map((r: any) => ({ k: r.k })).ir,
  );

  read(
    'scalar subquery counting a state read',
    () =>
      (from(other) as any).map(() => ({ x: scalar(q.where((r: any) => r.total.isNull()).count()) }))
        .ir,
  );

  read(
    'forged Nullable state in max',
    () => (from(forged) as any).aggregate((g: any) => ({ x: max(g.nullable) })).count().ir,
  );

  read(
    'forged LowCardinality state in where',
    () => (from(forged) as any).where((r: any) => r.low.isNull()).count().ir,
  );

  read('union distinct', () => {
    const { id: _id, ...counted } = q.count().ir;

    const distinct = relNode({
      kind: 'Union',
      inputs: [q.ir, (from(rollup) as any).ir],
      all: false,
      output: q.ir.output,
    });

    return relNode({ ...counted, input: distinct } as never) as Rel;
  });
});

describe('-Merge matching', () => {
  const merge = (name: string, build: (g: any) => unknown, error = MERGE) =>
    rejects(name, () => q.aggregate((g: any) => ({ x: build(g) })).ir, error);

  merge('wrong function', g => maxMerge(g.total));
  merge('sum merge of a uniq state', g => sumMerge(g.ids));
  merge('non-state column', g => sumMerge(g.n));
  merge('Array column', g => sumMerge(g.tags));
  merge('SimpleAggregateFunction', g => maxMerge(g.simple));
  merge('quantile state through quantileExact', g => quantileExactMerge(0.9)(g.p));
  merge('quantile merge of argMax', g => quantileMerge(0.5)(g.last));
  merge('avg over Decimal', g => avgMerge(g.avgDec));
  merge('quantile temporal: DateTime', g => quantileMerge(0.5)(g.dt));
  merge('quantile temporal: Date', g => quantileMerge(0.5)(g.d));
  merge('nullable state at another level', g => quantileMerge(0.5)(g.np));
  merge('nullable state stored at 1. merged at 0.5', g => quantileMerge(0.5)(g.one));
  merge('nullable state stored at 0. merged at 0.5', g => quantileMerge(0.5)(g.zero));

  rejects(
    'forged Nullable wrapper around a state',
    () => (from(forged) as any).aggregate((g: any) => ({ x: sumMerge(g.nullable) })).ir,
    MERGE,
  );

  rejects(
    'forged LowCardinality wrapper around a state',
    () => (from(forged) as any).aggregate((g: any) => ({ x: sumMerge(g.low) })).ir,
    MERGE,
  );

  compiles(
    'a nullable state at its stored boundary levels',
    () =>
      q.aggregate((g: any) => ({
        a: quantileMerge(1)(g.one),
        b: quantileMerge(0)(g.zero),
        c: quantileMerge(0.9)(g.np),
      })).ir,
    'quantileMerge',
  );

  it('types the merged results from the stored state', () => {
    const compiled = compile(
      q.aggregate((g: any) => ({
        a: sumMerge(g.total),
        b: uniqMerge(g.ids),
        c: quantileMerge(0.5)(g.p),
        d: quantileMerge(0.9)(g.np),
        e: argMaxMerge(g.last),
      })).ir,
    ) as never as { columns: Record<string, Parameters<typeof print>[0]> };

    expect(
      Object.fromEntries(Object.entries(compiled.columns).map(([k, t]) => [k, print(t)])),
    ).toEqual({
      a: 'UInt64',
      b: 'UInt64',
      c: 'Float64',
      d: 'Nullable(Float64)',
      e: 'String',
    });
  });
});

describe('level input validation', () => {
  const bad: unknown[] = [
    Number.NaN,
    -0.0001,
    1.0001,
    Infinity,
    -Infinity,
    '0.5',
    null,
    undefined,
    {},
    [],
    5n,
    true,
  ];

  for (const level of bad) {
    const label = typeof level === 'bigint' ? `${level}n` : String(level);

    for (const [name, f] of [
      [
        'quantileMerge',
        () => q.aggregate((g: any) => ({ x: (quantileMerge as any)(level)(g.p) })).ir,
      ],
      [
        'quantileExactMerge',
        () => q.aggregate((g: any) => ({ x: (quantileExactMerge as any)(level)(g.p) })).ir,
      ],
      [
        'quantileState',
        () => q.aggregate((g: any) => ({ x: (quantileState as any)(level)(g.n) })).count().ir,
      ],
      [
        'quantileExactState',
        () => q.aggregate((g: any) => ({ x: (quantileExactState as any)(level)(g.n) })).count().ir,
      ],
    ] as const)
      rejects(`${name}(${label})`, f as () => Rel, /invalid_quantile_level/);
  }
});

describe('the known tier stays declared', () => {
  const known = createKnownFunctions({
    sumMerge: { name: 'sumMerge', isAggregate: true, deterministic: true, aliasTo: '' },
    identity: { name: 'identity', isAggregate: false, deterministic: true, aliasTo: '' },
  } as never) as any;

  compiles(
    'known sumMerge',
    () => q.aggregate((g: any) => ({ x: known.agg.sumMerge(g.total).as(col.UInt64) })).ir,
    'sumMerge(',
  );

  rejects(
    'typed merge of a known call that returns a state',
    () => q.aggregate((g: any) => ({ x: sumMerge(known.fn.identity(g.total).as(sumOf())) })).ir,
    OPERAND,
  );

  rejects(
    'typed merge of a trusted snippet that returns a state',
    () => q.aggregate((g: any) => ({ x: sumMerge((sql`${g.total}` as any).as(sumOf())) })).ir,
    /invalid_expression_mode|aggregate_state_operand/,
  );

  rejects(
    'a known call declared as a state is still not a result',
    () => q.map((r: any) => ({ x: known.fn.identity(r.total).as(sumOf()) })).ir,
    /aggregate_state/,
  );

  it('two-level nesting: sumState of a merged value', () => {
    for (const [, emit] of emitters) {
      const text = emit(
        q
          .groupBy((r: any) => r.k)
          .aggregate((g: any) => ({ merged: sumMerge(g.total) }))
          .aggregate((g: any) => ({ state: sumState(g.merged) }))
          .aggregate((g: any) => ({ final: sumMerge(g.state) })).ir,
      ).sql;

      expect(text).toContain('sumState');
    }
  });

  rejects(
    'merge inside a map is a placement error',
    () => q.map((r: any) => ({ x: sumMerge(r.total) })).ir,
    /invalid_expression_mode|invalid_aggregate_placement|nested_projection/,
  );

  rejects(
    'merge over a sibling state in one aggregate',
    () => q.aggregate((g: any) => ({ x: sumMerge(sumState(g.n) as never) })).ir,
    /aggregate_state_operand|invalid_aggregate_placement/,
  );

  rejects(
    'countMerge with two operands',
    () => q.aggregate((g: any) => ({ x: (countMerge as any)(g.total, g.total) })).ir,
    /invalid_argument_arity/,
  );

  rejects(
    'argMaxState with one operand',
    () => q.aggregate((g: any) => ({ x: (argMaxState as any)(g.k) })).count().ir,
    /invalid_argument_arity/,
  );
});
