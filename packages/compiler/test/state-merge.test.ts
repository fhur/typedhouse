import { describe, expect, it } from 'vitest';
import {
  argMax,
  argMaxMerge,
  argMaxState,
  argMin,
  argMinMerge,
  argMinState,
  avg,
  avgMerge,
  avgState,
  col,
  columnExpr,
  count,
  countMerge,
  countState,
  createKnownFunctions,
  exprNode,
  from,
  join,
  max,
  maxMerge,
  maxState,
  min,
  minMerge,
  minState,
  print,
  quantile,
  quantileExact,
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
  uniq,
  uniqExact,
  uniqExactMerge,
  uniqExactState,
  uniqMerge,
  uniqState,
  unionAll,
  val,
  avgIf,
  argMaxIf,
  type ExprNode,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

const meta = { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const rollup = table(
  'rollup',
  {
    k: col.String,
    total: col.AggregateFunction('sum', col.UInt64),
    ids: col.AggregateFunction('uniq', col.String),
    p: col.AggregateFunction('quantile(0.9)', col.Float64),
    np: col.AggregateFunction('quantile(0.9)', col.Nullable(col.Float64)),
    bare: col.AggregateFunction('quantile', col.Nullable(col.Float64)),
  },
  meta,
);

const events = table(
  'events',
  {
    k: col.String,
    u: col.UInt32,
    f: col.Float64,
    s: col.String,
    ns: col.Nullable(col.String),
    lc: col.LowCardinality(col.String),
    lcn: col.LowCardinality(col.Nullable(col.String)),
    al: col.Array(col.LowCardinality(col.String)),
    at: col.DateTime('UTC'),
  },
  { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] },
);

const emitters = [
  ['naive', emitNaive],
  ['optimized', compile],
] as const;

const both = (rel: Rel) => emitters.map(([, emit]) => emit(rel).sql);

const rejects = (rel: () => Rel, error: RegExp) => {
  for (const [, emit] of emitters) expect(() => emit(rel())).toThrow(error);
};

const known = createKnownFunctions({
  uniqMerge: { name: 'uniqMerge', isAggregate: true, deterministic: true, aliasTo: '' },
  finalizeAggregation: {
    name: 'finalizeAggregation',
    isAggregate: false,
    deterministic: true,
    aliasTo: '',
  },
} as never) as never as {
  fn: { finalizeAggregation(x: unknown): { as(c: unknown): never } };
  agg: { uniqMerge(x: unknown): { as(c: unknown): never } };
};

describe('D1 acceptance: intermediate nodes carry states', () => {
  it('count, a plain map, sumMerge, known-tier uniqMerge and state-to-merge compile on both emitters', () => {
    const base = from(rollup);

    expect(both(base.count().ir)).toEqual([
      expect.stringContaining('count()'),
      expect.stringContaining('count()'),
    ]);

    for (const text of both(base.map(r => ({ k: r.k })).ir)) expect(text).toContain('`k`');

    for (const text of both(base.aggregate(g => ({ t: sumMerge(g.total) })).ir))
      expect(text).toContain('sumMerge(');

    for (const text of both(
      base.aggregate(g => ({ n: known.agg.uniqMerge(g.ids).as(col.UInt64) })).ir,
    ))
      expect(text).toContain('uniqMerge(');

    const twice = from(events)
      .groupBy(r => r.k)
      .aggregate(g => ({ state: sumState(g.u) }))
      .aggregate(g => ({ total: sumMerge(g.state) }));

    for (const text of both(twice.ir)) {
      expect(text).toContain('sumState(');
      expect(text).toContain('sumMerge(');
    }
  });

  it('states pass through map, where, union all, a join input, a CTE and a scalar subquery inner node', () => {
    const base = from(rollup);
    const passed = base.map(r => ({ k: r.k, renamed: r.total }));
    const filtered = base.where(r => r.k.eq('a'));
    const shared = base.cte();

    for (const rel of [
      passed.aggregate(g => ({ t: sumMerge(g.renamed) })).ir,
      filtered.aggregate(g => ({ t: sumMerge(g.total) })).ir,
      unionAll(
        passed,
        base.map(r => ({ k: r.k, renamed: r.total })),
      ).aggregate(g => ({ t: sumMerge(g.renamed) })).ir,
      join({ a: base, b: from(events) })
        .on(r => r.a.k.eq(r.b.k))
        .map(r => ({ state: r.a.total }))
        .aggregate(g => ({ t: sumMerge(g.state) })).ir,
      unionAll(shared, shared).aggregate(g => ({ t: sumMerge(g.total) })).ir,
    ])
      for (const text of both(rel)) expect(text).toContain('sumMerge(');

    const scalarSum = base.map(() => ({
      t: scalar(base.aggregate(g => sumMerge(g.total))),
    }));

    for (const text of both(scalarSum.ir)) expect(text).toContain('sumMerge(');
  });

  it('leaves unread states out of the optimized SELECT', () => {
    const text = compile(from(rollup).map(r => ({ k: r.k })).ir).sql;
    expect(text).not.toContain('total');
  });
});

describe('aggregate_state_selection', () => {
  it('stays on the query result', () => {
    rejects(() => from(rollup).ir, /aggregate_state_selection at root/);
    rejects(() => from(rollup).map(r => ({ s: r.total })).ir, /aggregate_state_selection at root/);

    rejects(
      () => from(events).aggregate(g => ({ s: sumState(g.u) })).ir,
      /aggregate_state_selection at root/,
    );

    rejects(() => from(rollup).where(r => r.k.eq('a')).ir, /aggregate_state_selection at root/);
  });

  it('applies to scalar and set subquery results', () => {
    const states = from(events).aggregate(g => sumState(g.u));

    // The builder refuses a state's scalar descriptor; forged IR meets the same rule in the compiler.
    expect(() => scalar(states)).toThrow(/unsupported_scalar_type/);
    const type = col.AggregateFunction('sum', col.UInt32).type;
    const projected = from(events).map(() => ({ s: val(1) }));
    const { id: _id, ...fields } = projected.ir as Extract<Rel, { kind: 'Project' }>;

    rejects(
      () =>
        relNode({
          ...fields,
          exprs: { s: exprNode({ kind: 'Subquery', usage: 'scalar', rel: states.ir, type }) },
          columns: { s: type },
          output: { shape: 'flat', columns: { s: type }, order: ['s'] },
        } as never) as Rel,
      /aggregate_state_selection/,
    );

    const set = from(rollup).map(r => ({ s: r.total }));

    rejects(
      () => from(events).where(r => (r.u as never as { in(q: unknown): never }).in(set)).ir,
      /unsupported_membership_type/,
    );
  });
});

describe('aggregate_state_operand', () => {
  const base = from(rollup);
  const total = (r: { total: unknown }) => r.total as never;

  it('rejects every non-finalizing read', () => {
    const cases: [string, () => Rel][] = [
      [
        'filter',
        () =>
          base
            .where(r => (total(r) as never as { eq(x: unknown): never }).eq(total(r)))
            .map(r => ({ k: r.k })).ir,
      ],
      ['sort', () => base.orderBy(r => total(r)).map(r => ({ k: r.k })).ir],
      [
        'limit by',
        () =>
          base
            .limitBy(r => total(r))
            .take(1)
            .map(r => ({ k: r.k })).ir,
      ],
      [
        'group key',
        () =>
          base
            .groupBy(r => total(r))
            .aggregate(() => ({ n: count() }))
            .map((r: unknown) => ({ n: (r as { n: never }).n })).ir,
      ],
      [
        'typed map',
        () => base.map(r => ({ x: (total(r) as never as { isNull(): never }).isNull() })).ir,
      ],
      ['distinct', () => base.distinct().map(r => ({ k: r.k })).ir],
      [
        'union distinct',
        () => {
          const { id: _id, ...counted } = base.count().ir as Extract<Rel, { kind: 'Aggregate' }>;

          const distinct = relNode({
            kind: 'Union',
            inputs: [base.ir, from(rollup).ir],
            all: false,
            output: base.ir.output,
          });

          return relNode({ ...counted, input: distinct } as never) as Rel;
        },
      ],
      ['typed aggregate', () => base.aggregate(g => ({ x: max(g.total as never) })).count().ir],
      ['exact aggregate', () => base.aggregate(g => ({ x: uniqExact(g.total as never) })).ir],
      [
        'state of state',
        () =>
          base
            .aggregate(g => ({ x: maxState(g.total as never) }))
            .aggregate(g => ({ y: maxMerge(g.x as never) }))
            .count().ir,
      ],
      [
        'call over state aggregate',
        () =>
          from(events).aggregate(g => ({
            x: (sumState(g.u) as never as { isNull(): never }).isNull(),
          })).ir,
      ],
      [
        'merge of computed state',
        () =>
          base.aggregate(g => ({
            x: sumMerge(
              (g.total as never as { ifNull(x: unknown): never }).ifNull(g.total) as never,
            ),
          })).ir,
      ],
    ];

    for (const [name, rel] of cases)
      for (const [mode, emit] of emitters)
        expect(() => emit(rel()), `${name} ${mode}`).toThrow(/aggregate_state_operand/);
  });

  it('exempts known-tier calls and trusted snippets, whose result is the declaration', () => {
    for (const rel of [
      base.map(r => ({ x: known.fn.finalizeAggregation(r.total).as(col.UInt64) })).ir,
      base
        .where(() => val(true))
        .map(r => ({ x: sql`finalizeAggregation(${r.total})`.as(col.UInt64) })).ir,
    ])
      for (const text of both(rel)) expect(text).toContain('finalizeAggregation(');

    // The exemption is the direct operand only: a typed read nested inside still raises.
    rejects(
      () =>
        base.map(r => ({
          x: known.fn
            .finalizeAggregation((r.total as never as { isNull(): never }).isNull())
            .as(col.UInt64),
        })).ir,
      /aggregate_state_operand/,
    );
  });
});

describe('-Merge resolution', () => {
  const sumAgg = () => {
    const q = from(rollup);

    const root = q.aggregate(g => ({ x: sumMerge(g.total) })).ir as Extract<
      Rel,
      { kind: 'Aggregate' }
    >;

    const { id: _id, ...agg } = root.aggs.x as Extract<ExprNode, { kind: 'Agg' }>;
    return { root, agg };
  };

  it('rejects the wrong function, a non-state operand and a forged result', () => {
    const q = from(rollup);

    rejects(
      () => q.aggregate(g => ({ x: maxMerge(g.total as never) })).ir,
      /invalid_merge_state at root\.aggs\.x/,
    );

    rejects(() => q.aggregate(g => ({ x: uniqMerge(g.total as never) })).ir, /invalid_merge_state/);
    rejects(() => q.aggregate(g => ({ x: sumMerge(g.ids as never) })).ir, /invalid_merge_state/);
    rejects(() => q.aggregate(g => ({ x: sumMerge(g.k as never) })).ir, /invalid_merge_state/);

    rejects(
      () => q.aggregate(g => ({ x: quantileMerge(0.5)(g.total as never) })).ir,
      /invalid_merge_state/,
    );

    // The prefix of a parametric name is not a match.
    rejects(
      () => q.aggregate(g => ({ x: quantileExactMerge(0.5)(g.p as never) })).ir,
      /invalid_merge_state/,
    );

    const { root, agg } = sumAgg();
    const { id: _rootId, ...fields } = root;

    rejects(
      () =>
        relNode({
          ...fields,
          aggs: { x: exprNode({ ...agg, type: col.Float64.type }) },
        } as never) as Rel,
      /invalid_output|invalid_expression_type/,
    );
  });

  it('rejects a forged state whose stored arguments the catalog does not accept', () => {
    const bad = table(
      'bad',
      {
        a: col.AggregateFunction('sum', col.String),
        b: col.AggregateFunction('sum', col.UInt64, col.UInt64),
        c: col.AggregateFunction('sum'),
        d: col.AggregateFunction('sum(0.5)', col.UInt64),
        e: col.AggregateFunction('quantile(1.5)', col.Float64),
        f: col.AggregateFunction('quantile(0.1, 0.2)', col.Float64),
        g: col.AggregateFunction('quantile(', col.Float64),
      },
      meta,
    );

    const q = from(bad);
    rejects(() => q.aggregate(g => ({ x: sumMerge(g.a as never) })).ir, /invalid_merge_state/);
    rejects(() => q.aggregate(g => ({ x: sumMerge(g.b as never) })).ir, /invalid_merge_state/);
    rejects(() => q.aggregate(g => ({ x: sumMerge(g.c as never) })).ir, /invalid_merge_state/);
    rejects(() => q.aggregate(g => ({ x: sumMerge(g.d as never) })).ir, /invalid_merge_state/);

    for (const c of ['e', 'f', 'g'] as const)
      rejects(
        () => q.aggregate(g => ({ x: quantileMerge(0.5)(g[c] as never) })).ir,
        /invalid_merge_state/,
      );
  });

  it('count, uniq and uniqExact read any stored arguments the server allows, as UInt64', () => {
    const stored = [
      col.UInt64,
      col.Float64,
      col.String,
      col.Nullable(col.UInt64),
      col.LowCardinality(col.String),
      col.LowCardinality(col.Nullable(col.String)),
      col.Decimal(18, 2),
      col.Date,
      col.Array(col.String),
      col.Tuple([col.String, col.UInt8]),
      col.NamedTuple([['a', col.String]]),
    ];

    const merges = [
      ['count', countMerge, [[], ...stored.map(c => [c])]],
      [
        'uniq',
        uniqMerge,
        [
          ...stored.map(c => [c]),
          [col.String, col.UInt64],
          [col.Nullable(col.UInt8), col.Date, col.String],
        ],
      ],
      [
        'uniqExact',
        uniqExactMerge,
        [
          ...stored.map(c => [c]),
          [col.String, col.UInt64],
          [col.Nullable(col.UInt8), col.Date, col.String],
        ],
      ],
    ] as const;

    for (const [name, merge, forms] of merges)
      for (const args of forms) {
        const t = table('t', { s: col.AggregateFunction(name, ...(args as never as [])) }, meta);

        const rel = from(t).aggregate(g => ({
          x: (merge as unknown as (s: never) => never)(g.s as never),
        })).ir;

        for (const [mode, emit] of emitters) {
          const compiled = emit(rel);
          expect(print(compiled.columns.x!), `${name} ${mode}`).toBe('UInt64');
          expect(compiled.sql).toContain(`${name}Merge(`);
        }
      }
  });

  it('keeps rejecting what the relaxation does not cover', () => {
    const q = from(
      table(
        't',
        {
          count2: col.AggregateFunction('count', col.String, col.UInt64),
          uniq0: col.AggregateFunction('uniq'),
          exact0: col.AggregateFunction('uniqExact'),
          uniqLeveled: col.AggregateFunction('uniq(0.5)', col.UInt64),
          uniqU: col.AggregateFunction('uniq', col.UInt64),
          avgDecimal: col.AggregateFunction('avg', col.Decimal(18, 2)),
          sumTwo: col.AggregateFunction('sum', col.UInt64, col.UInt64),
          maxTwo: col.AggregateFunction('max', col.UInt64, col.UInt64),
          argMaxOne: col.AggregateFunction('argMax', col.String),
          avgString: col.AggregateFunction('avg', col.String),
        },
        meta,
      ),
    );

    const cases: [(g: any) => unknown, RegExp][] = [
      // The server refuses these types outright (code 42).
      [g => countMerge(g.count2), /invalid_merge_state/],
      [g => uniqMerge(g.uniq0), /invalid_merge_state/],
      [g => uniqExactMerge(g.exact0), /invalid_merge_state/],
      [g => uniqMerge(g.uniqLeveled), /invalid_merge_state/],
      // A wrong function stays wrong, whichever side is relaxed.
      [g => uniqExactMerge(g.uniqU), /invalid_merge_state/],
      [g => countMerge(g.uniqU), /invalid_merge_state/],
      [g => uniqMerge(g.count2), /invalid_merge_state/],
      [g => sumMerge(g.uniqU), /invalid_merge_state/],
      // Every other function still requires arguments its base function accepts.
      [g => avgMerge(g.avgDecimal), /invalid_merge_state/],
      [g => avgMerge(g.avgString), /invalid_merge_state/],
      [g => sumMerge(g.sumTwo), /invalid_merge_state/],
      [g => maxMerge(g.maxTwo), /invalid_merge_state/],
      [g => argMaxMerge(g.argMaxOne), /invalid_merge_state/],
    ];

    for (const [merge, error] of cases)
      rejects(() => q.aggregate(g => ({ x: merge(g) as never })).ir, error);
  });

  it('validates levels on state and merge', () => {
    const q = from(rollup);

    for (const level of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejects(
        () => q.aggregate(g => ({ x: quantileMerge(level)(g.p) })).ir,
        /invalid_quantile_level/,
      );

      rejects(
        () =>
          from(events)
            .aggregate(g => ({ s: quantileState(level)(g.f) }))
            .aggregate(g => ({ x: quantileMerge(0.5)(g.s as never) })).ir,
        /invalid_quantile_level|invalid_merge_state/,
      );
    }
  });

  it('a non-nullable state merges at any level; a nullable one only at its stored level', () => {
    const q = from(rollup);

    for (const level of [0.1, 0.9, 1])
      for (const text of both(q.aggregate(g => ({ x: quantileMerge(level)(g.p) })).ir))
        expect(text).toContain('quantileMerge(');

    for (const text of both(q.aggregate(g => ({ x: quantileMerge(0.9)(g.np) })).ir))
      expect(text).toContain('quantileMerge(');

    rejects(() => q.aggregate(g => ({ x: quantileMerge(0.5)(g.np) })).ir, /invalid_merge_state/);
    rejects(() => q.aggregate(g => ({ x: quantileMerge(0.5)(g.bare) })).ir, /invalid_merge_state/);
  });

  it('rejects a constant standing in for a state', () => {
    rejects(
      () =>
        from(rollup).aggregate(() => ({
          x: sumMerge(
            val({ __aggregateState: 'sum' }, col.AggregateFunction('sum', col.UInt64)) as never,
          ),
        })).ir,
      /param_incompatible|aggregate_state_operand/,
    );
  });
});

describe('-State resolution', () => {
  it('rejects a state descriptor that does not match the arguments and level', () => {
    const q = from(events);

    const root = q
      .aggregate(g => ({ x: quantileState(0.9)(g.f) }))
      .aggregate(g => ({ y: quantileMerge(0.9)(g.x) })).ir as never as {
      input: Extract<Rel, { kind: 'Aggregate' }>;
    };

    const inner = root.input;
    const { id: _countId, ...countFields } = count().ir;
    const { id: _id, ...agg } = inner.aggs.x as Extract<ExprNode, { kind: 'Agg' }>;
    expect(print(agg.type!)).toBe('AggregateFunction(quantile(0.9), Float64)');
    const { id: _innerId, ...fields } = inner;

    for (const type of [
      col.AggregateFunction('quantile(0.5)', col.Float64).type,
      col.AggregateFunction('quantile', col.Float64).type,
      col.AggregateFunction('quantile(0.9)', col.Float64, col.Float64).type,
      col.AggregateFunction('sum', col.Float64).type,
      col.Float64.type,
    ]) {
      const rel = relNode({
        ...fields,
        aggs: { x: exprNode({ ...agg, type }) },
        columns: { x: type },
        output: { shape: 'flat', columns: { x: type }, order: ['x'] },
      } as never) as Rel;

      const outer = relNode({
        kind: 'Aggregate',
        input: rel,
        keys: {},
        aggs: { n: exprNode(countFields as never) },
        columns: { n: col.UInt64.type },
        output: { shape: 'flat', columns: { n: col.UInt64.type }, order: ['n'] },
      } as never) as Rel;

      for (const [, emit] of emitters) expect(() => emit(outer)).toThrow(/invalid_expression_type/);
    }
  });

  it('keeps unknown and double combinators closed', () => {
    const q = from(events);
    const root = q.aggregate(g => ({ x: sum(g.u) })).ir as Extract<Rel, { kind: 'Aggregate' }>;
    const { id: _id, ...agg } = root.aggs.x as Extract<ExprNode, { kind: 'Agg' }>;
    const { id: _r, ...fields } = root;

    for (const combinators of [
      ['If', 'If'],
      ['State', 'Merge'],
      ['Merge', 'State'],
      ['State', 'If'],
      ['Distinct'],
    ])
      rejects(
        () =>
          relNode({ ...fields, aggs: { x: exprNode({ ...agg, combinators } as never) } }) as Rel,
        /unsupported_aggregate_combinator at root\.aggs\.x/,
      );
  });
});

describe('Approved D3 outcomes (TODO.md Decisions, rows 1 to 6)', () => {
  const forge = (build: (r: never) => unknown) => {
    const root = from(events).aggregate(g => ({ x: build(g as never) as never })).ir as Extract<
      Rel,
      { kind: 'Aggregate' }
    >;

    const { id: _id, ...agg } = root.aggs.x as Extract<ExprNode, { kind: 'Agg' }>;
    const { id: _r, ...fields } = root;

    return (combinators: readonly string[]) =>
      relNode({ ...fields, aggs: { x: exprNode({ ...agg, combinators } as never) } }) as Rel;
  };

  const g = (f: (group: { u: never; f: never; s: never; at: never }) => unknown) =>
    forge(f as never);

  it.each([
    [
      'avgIf State',
      g(r => avgIf(r.f, val(true))),
      ['State'],
      /invalid_argument_arity at root\.aggs\.x/,
    ],
    [
      'avgIf Merge',
      g(r => avgIf(r.f, val(true))),
      ['Merge'],
      /invalid_argument_arity at root\.aggs\.x/,
    ],
    [
      'argMaxIf State',
      g(r => argMaxIf(r.s, r.u, val(true))),
      ['State'],
      /invalid_argument_arity at root\.aggs\.x/,
    ],
    [
      'argMax Merge',
      g(r => argMax(r.s, r.u)),
      ['Merge'],
      /invalid_argument_arity at root\.aggs\.x/,
    ],
    [
      'argMax State',
      g(r => argMax(r.s, r.u)),
      ['State'],
      /invalid_expression_type at root\.aggs\.x/,
    ],
    [
      'uniqExact State',
      g(r => uniqExact(r.s)),
      ['State'],
      /invalid_expression_type at root\.aggs\.x/,
    ],
    ['uniqExact Merge', g(r => uniqExact(r.s)), ['Merge'], /invalid_merge_state at root\.aggs\.x/],
    [
      'quantile State',
      g(r => quantile(0.5)(r.f)),
      ['State'],
      /invalid_expression_type at root\.aggs\.x/,
    ],
    [
      'quantile Merge',
      g(r => quantile(0.5)(r.f)),
      ['Merge'],
      /invalid_merge_state at root\.aggs\.x/,
    ],
    [
      'quantileExact State',
      g(r => quantileExact(0.5)(r.f)),
      ['State'],
      /invalid_expression_type at root\.aggs\.x/,
    ],
  ] as const)('%s', (_name, build, combinators, error) => {
    rejects(() => build(combinators), error);
  });
});

describe('every catalog aggregate', () => {
  const pairs: [string, (g: never) => unknown, (s: never) => unknown, string, string][] = [
    ['count', () => countState(), s => countMerge(s), 'AggregateFunction(count)', 'UInt64'],
    [
      'sum',
      g => sumState((g as { u: never }).u),
      s => sumMerge(s),
      'AggregateFunction(sum, UInt32)',
      'UInt64',
    ],
    [
      'max',
      g => maxState((g as { lc: never }).lc),
      s => maxMerge(s),
      'AggregateFunction(max, String)',
      'String',
    ],
    [
      'min',
      g => minState((g as { lcn: never }).lcn),
      s => minMerge(s),
      'AggregateFunction(min, Nullable(String))',
      'Nullable(String)',
    ],
    [
      'min array',
      g => minState((g as { al: never }).al),
      s => minMerge(s),
      'AggregateFunction(min, Array(String))',
      'Array(String)',
    ],
    [
      'argMax',
      g => argMaxState((g as { ns: never }).ns, (g as { at: never }).at),
      s => argMaxMerge(s),
      "AggregateFunction(argMax, Nullable(String), DateTime('UTC'))",
      'Nullable(String)',
    ],
    [
      'argMin',
      g => argMinState((g as { u: never }).u, (g as { f: never }).f),
      s => argMinMerge(s),
      'AggregateFunction(argMin, UInt32, Float64)',
      'UInt32',
    ],
    [
      'avg',
      g => avgState((g as { u: never }).u),
      s => avgMerge(s),
      'AggregateFunction(avg, UInt32)',
      'Float64',
    ],
    [
      'quantile',
      g => quantileState(0.9)((g as { f: never }).f),
      s => quantileMerge(0.5)(s),
      'AggregateFunction(quantile(0.9), Float64)',
      'Float64',
    ],
    [
      'quantile at 1',
      g => quantileState(1)((g as { f: never }).f),
      s => quantileMerge(1)(s),
      'AggregateFunction(quantile(1.), Float64)',
      'Float64',
    ],
    [
      'quantileExact',
      g => quantileExactState(0.9)((g as { u: never }).u),
      s => quantileExactMerge(0.5)(s),
      'AggregateFunction(quantileExact(0.9), UInt32)',
      'UInt32',
    ],
    [
      'uniq',
      g => uniqState((g as { s: never }).s),
      s => uniqMerge(s),
      'AggregateFunction(uniq, String)',
      'UInt64',
    ],
    [
      'uniqExact',
      g => uniqExactState((g as { ns: never }).ns),
      s => uniqExactMerge(s),
      'AggregateFunction(uniqExact, Nullable(String))',
      'UInt64',
    ],
  ];

  it.each(pairs)('%s state then merge', (name, state, merge, stateType, resultType) => {
    const states = from(events).aggregate(g => ({ s: state(g as never) as never }));
    const merged = states.aggregate(g => ({ m: merge(g.s as never) as never }));
    const fn = name.split(' ')[0]!;

    expect(print((states.ir as Extract<Rel, { kind: 'Aggregate' }>).columns.s!)).toBe(stateType);
    expect(print((merged.ir as Extract<Rel, { kind: 'Aggregate' }>).columns.m!)).toBe(resultType);

    for (const [, emit] of emitters) {
      const compiled = emit(merged.ir);
      expect(compiled.sql).toContain(`${fn}State`);
      expect(compiled.sql).toContain(`${fn}Merge`);
      expect(print(compiled.columns.m!)).toBe(resultType);
    }
  });

  it('keeps base aggregates unchanged', () => {
    for (const text of both(
      from(events).aggregate(g => ({
        a: count(),
        b: sum(g.u),
        c: max(g.u),
        d: min(g.u),
        e: avg(g.u),
        f: uniq(g.s),
        h: argMin(g.s, g.u),
      })).ir,
    ))
      expect(text).not.toMatch(/State|Merge/);
  });

  it('forged field access through columnExpr keeps the same rules', () => {
    const q = from(rollup);

    const foreign = columnExpr(
      col.AggregateFunction('sum', col.UInt64),
      99 as never,
      ['total'],
      'total',
      'grouped',
    );

    rejects(() => q.aggregate(() => ({ x: sumMerge(foreign) })).ir, /unbound_column/);
  });
});
