import { describe, expect, it } from 'vitest';
import {
  col,
  count,
  from,
  join,
  leftJoin,
  outputLeaves,
  relNode,
  renderSettings,
  scalar,
  settingsIssue,
  sql,
  sumMerge,
  table,
  unionAll,
  val,
  type QuerySettings,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';

/** D6 Tester. No server: builder and compiler behaviour under hostile input. */
const t = table(
  't',
  { id: col.UInt64, cat: col.String, tags: col.Array(col.String) },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const u = table(
  'u',
  { id: col.UInt64, name: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const rollup = table(
  'rollup',
  { day: col.String, total: col.AggregateFunction('sum', col.UInt64) },
  { engine: 'AggregatingMergeTree', sortingKey: ['day'], partitionKey: [] },
);

const q = from(t);

const others = from(u);

const emitters = [
  ['compile', compile],
  ['emitNaive', emitNaive],
] as const;

const failure = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof ValidationError ? `${error.code} at ${error.path}` : String(error);
  }

  return undefined;
};

const tail = (query: { readonly ir: Rel }) => {
  const { sql: text } = compile(query.ir);
  return text.slice(text.lastIndexOf(' SETTINGS ') + 10);
};

const settled = q.settings({ max_threads: 1 });

/** A hand-built node that bypasses relNode's snapshot, as a caller of `compile` could. */
const node = (input: Rel, settings: unknown = { max_threads: 1 }, output: unknown = input.output) =>
  ({ kind: 'Settings', id: 1, input, settings, output }) as unknown as Rel;

describe('keys', () => {
  it.each([
    ['__proto__ from JSON.parse', () => JSON.parse('{"__proto__":{"limit":1}}'), 'unknown_setting'],
    ['constructor from JSON.parse', () => JSON.parse('{"constructor":1}'), 'unknown_setting'],
    ['toString', () => JSON.parse('{"toString":1}'), 'unknown_setting'],
    ['hasOwnProperty', () => JSON.parse('{"hasOwnProperty":1}'), 'unknown_setting'],
    ['a key with SQL', () => ({ 'max_threads = 1, limit': 1 }), 'unknown_setting'],
    ['a key with case changed', () => ({ MAX_THREADS: 1 }), 'unknown_setting'],
    ['a key with a space', () => ({ 'max_threads ': 1 }), 'unknown_setting'],
    ['an empty key', () => ({ '': 1 }), 'unknown_setting'],
    ['a symbol key', () => ({ [Symbol('x')]: 1 }), 'invalid_settings'],
    [
      'a symbol key beside a good one',
      () => ({ max_threads: 1, [Symbol('x')]: 1 }),
      'invalid_settings',
    ],
    [
      'an accessor',
      () => ({
        get max_threads() {
          return 1;
        },
      }),
      'invalid_settings',
    ],
    [
      'a class instance',
      () =>
        new (class {
          max_threads = 1;
        })(),
      'invalid_settings',
    ],
    [
      'an object inheriting a good key',
      () => Object.create({ max_threads: 1 }),
      'invalid_settings',
    ],
    ['an inherited limit', () => Object.create({ limit: 1 }), 'invalid_settings'],
    ['a Map', () => new Map([['max_threads', 1]]), 'invalid_settings'],
    ['a Date', () => new Date(), 'invalid_settings'],
    ['a function', () => () => 1, 'invalid_settings'],
    ['an array', () => [1], 'invalid_settings'],
    ['an array with a good key', () => Object.assign([], { max_threads: 1 }), 'invalid_settings'],
    ['null', () => null, 'invalid_settings'],
    ['a string', () => 'max_threads = 1', 'invalid_settings'],
    [
      'a hidden unknown key',
      () => Object.defineProperty({}, 'limit', { value: 1 }),
      'unknown_setting',
    ],
    [
      'a hidden bad value',
      () => Object.defineProperty({}, 'max_threads', { value: '1' }),
      'invalid_setting_value',
    ],
  ])('%s is refused in the builder and on a forged node', (_name, make, code) => {
    expect(() => q.settings(make() as QuerySettings)).toThrow(code);

    for (const [, emit] of emitters)
      expect(
        failure(() =>
          emit({
            kind: 'Settings',
            id: 1,
            input: q.ir,
            settings: make(),
            output: q.ir.output,
          } as unknown as Rel),
        ),
      ).toMatch(new RegExp(`^${code} at root\\.settings`));
  });

  it('a non-enumerable allowed key is refused, and so is the client-owned exception setting', () => {
    const hidden = () => Object.defineProperty({}, 'max_threads', { value: 1 });
    expect(() => q.settings(hidden())).toThrow('invalid_settings at settings.max_threads');

    expect(() =>
      q.settings(JSON.parse('{"http_write_exception_in_output_format":1}') as QuerySettings),
    ).toThrow('compiler_owned_setting at settings.http_write_exception_in_output_format');

    for (const [, emit] of emitters) {
      expect(failure(() => emit(node(q.ir, hidden())))).toBe(
        'invalid_settings at root.settings.max_threads',
      );

      expect(failure(() => emit(node(q.ir, { http_write_exception_in_output_format: 1 })))).toBe(
        'compiler_owned_setting at root.settings.http_write_exception_in_output_format',
      );
    }
  });

  it('null-prototype and frozen objects are accepted', () => {
    const bare = Object.assign(Object.create(null) as object, { max_threads: 1 });
    expect(tail(q.settings(bare))).toBe('max_threads = 1');
    expect(tail(q.settings(Object.freeze({ max_threads: 1 })))).toBe('max_threads = 1');
  });

  it('compiler-owned keys beat the unknown-key message, also nested in JSON', () => {
    expect(() => q.settings(JSON.parse('{"join_use_nulls":0}') as QuerySettings)).toThrow(
      'compiler_owned_setting at settings.join_use_nulls',
    );
  });
});

describe('the snapshot is what compiles', () => {
  it('mutating the caller object after settings() changes nothing', () => {
    const input: Record<string, unknown> = { max_threads: 1 };
    const result = q.settings(input);
    input.max_threads = '1, limit = 2';
    input.limit = 1;
    delete input.max_threads;
    expect(tail(result)).toBe('max_threads = 1');
  });

  it('the node, its settings and the result are frozen', () => {
    expect(Object.isFrozen(settled)).toBe(true);
    expect(Object.isFrozen(settled.ir)).toBe(true);
    expect(Object.isFrozen(settled.ir.settings)).toBe(true);
    expect(settled.ir.settings).toEqual({ max_threads: 1 });
  });

  it('a Proxy whose value changes between reads never reaches the SQL from the builder', () => {
    let reads = 0;

    const lying = new Proxy(
      { max_threads: 1 },
      {
        get: (target, key) =>
          key === 'max_threads' ? (reads++ === 0 ? 1 : '1, limit = 2') : Reflect.get(target, key),
      },
    );

    let error: unknown;

    try {
      q.settings(lying).toSQL();
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toMatch(/invalid_setting_value|compiler_not_registered/);

    reads = 0;

    expect(failure(() => compile(q.settings(lying).ir))).toBe(
      'invalid_setting_value at root.settings.max_threads',
    );
  });
});

describe('values', () => {
  const integers = [
    'max_threads',
    'max_memory_usage',
    'max_rows_to_read',
    'max_bytes_to_read',
    'max_result_rows',
    'max_result_bytes',
    'max_block_size',
    'max_bytes_before_external_group_by',
    'max_bytes_before_external_sort',
    'priority',
  ] as const;

  const refusedIntegers: readonly [string, unknown][] = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['-1', -1],
    ['1.5', 1.5],
    ['2**53', 2 ** 53],
    ['1e21', 1e21],
    ['-1n', -1n],
    ['2n**64n', 2n ** 64n],
    ['a boxed number', new Number(1)],
    ['a boxed bigint', Object(1n)],
    ['a numeric string', '1'],
    ['an empty string', ''],
    ['a string with SQL', '1, limit = 2'],
    ['true', true],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['an object with valueOf', { valueOf: () => 1 }],
    ['an object with toString', { toString: () => '1, limit = 2' }],
    ['an array', [1]],
  ];

  describe.each(integers)('%s', key => {
    it.each(refusedIntegers)('refuses %s', (_name, value) => {
      expect(() => q.settings({ [key]: value } as QuerySettings)).toThrow(
        `invalid_setting_value at settings.${key}`,
      );

      for (const [, emit] of emitters)
        expect(failure(() => emit(node(q.ir, { [key]: value })))).toBe(
          `invalid_setting_value at root.settings.${key}`,
        );
    });

    it.each([
      [0, '0'],
      [-0, '0'],
      [1, '1'],
      [Number.MAX_SAFE_INTEGER, '9007199254740991'],
      [0n, '0'],
      [2n ** 53n, '9007199254740992'],
      [2n ** 64n - 1n, '18446744073709551615'],
    ])('prints %s as %s', (value, printed) => {
      expect(tail(q.settings({ [key]: value }))).toBe(`${key} = ${printed}`);
    });
  });

  describe('max_execution_time', () => {
    it.each([
      [0, '0'],
      [-0, '0'],
      [0.000001, '0.000001'],
      [0.0000011, '0.0000011'],
      [0.0000099, '0.0000099'],
      [0.1, '0.1'],
      [1.5, '1.5'],
      [1.0000001, '1.0000001'],
      [9223372036854, '9223372036854'],
      [9223372036853.5, '9223372036853.5'],
    ])('accepts %d and prints plain decimal %s', (value, printed) => {
      expect(tail(q.settings({ max_execution_time: value }))).toBe(
        `max_execution_time = ${printed}`,
      );
    });

    it.each([
      ['1e-7', 1e-7],
      ['just under the minimum', 0.0000009999999],
      ['Number.MIN_VALUE', Number.MIN_VALUE],
      ['-0.5', -0.5],
      ['-1', -1],
      ['just over the maximum', 9223372036854.002],
      ['9223372036854.775', 9223372036854.775],
      ['1e21', 1e21],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a bigint', 1n],
      ['a numeric string', '1'],
      ['a boxed number', new Number(1)],
      ['null', null],
    ])('refuses %s', (_name, value) => {
      expect(() => q.settings({ max_execution_time: value } as QuerySettings)).toThrow(
        'invalid_setting_value at settings.max_execution_time',
      );
    });

    it('no accepted value prints in exponent form, which is what the minimum guarantees', () => {
      const samples = [
        0.000001, 0.0000010000000000000002, 0.000002, 0.00001, 1, 1e12, 9223372036854,
      ];

      for (const value of samples) expect(String(value)).not.toMatch(/e/i);
    });
  });

  describe('log_comment', () => {
    it.each([
      ['a number', 1],
      ['a bigint', 1n],
      ['a boxed string', new String('x')],
      ['null', null],
      ['undefined', undefined],
      ['an array', ['x']],
      ['a lone high surrogate', '\ud83d'],
      ['a lone low surrogate', '\ude00'],
      ['a lone surrogate after a pair', '😀\ud83d'],
      ['reversed surrogates', '\ude00\ud83d'],
    ])('refuses %s', (_name, value) => {
      expect(() => q.settings({ log_comment: value } as QuerySettings)).toThrow(
        'invalid_setting_value at settings.log_comment',
      );
    });

    it('refuses a lone surrogate at either end of a long value', () => {
      expect(settingsIssue({ log_comment: `${'x'.repeat(100000)}\ud83d` })?.code).toBe(
        'invalid_setting_value',
      );
    });

    it.each([
      ["it's", "'it\\'s'"],
      ['\\', "'\\\\'"],
      ["\\'", "'\\\\\\''"],
      ['\0', "'\\0'"],
      ['\n', "'\\n'"],
      ['*/', "'*/'"],
      ['{p0:String}', "'{p0:String}'"],
      ["x', limit = 1, y = '", "'x\\', limit = 1, y = \\''"],
    ])('%j is one literal', (comment, literal) => {
      expect(renderSettings({ log_comment: comment })).toEqual([`log_comment = ${literal}`]);
    });
  });

  it('an empty object has no clause, and leaves the plain SQL', () => {
    for (const [, emit] of emitters) expect(emit(q.settings({}).ir).sql).toBe(emit(q.ir).sql);

    const outer = leftJoin({ a: q }, { b: others }).on(r => r.a.id.eq(r.b.id));

    for (const [, emit] of emitters)
      expect(emit(outer.settings({}).ir).sql).toBe(emit(outer.ir).sql);
  });

  it('keys print in caller order, before compiler keys', () => {
    const outer = leftJoin({ a: q }, { b: others }).on(r => r.a.id.eq(r.b.id));

    expect(tail(q.settings({ priority: 1, log_comment: 'x', max_threads: 2 }))).toBe(
      "priority = 1, log_comment = 'x', max_threads = 2",
    );

    expect(compile(outer.settings({ priority: 1, max_threads: 2 }).ir).sql).toMatch(
      / SETTINGS priority = 1, max_threads = 2, join_use_nulls = 1 \/\*/,
    );
  });
});

describe('a root wrapper changes nothing about the query below it', () => {
  const shared = q.where(r => r.id.gt(1n)).limit(9);

  const roots: readonly [
    string,
    () => { readonly ir: Rel; settings(s: QuerySettings): { ir: Rel } },
  ][] = [
    ['scan', () => q],
    ['top-level sort', () => q.orderBy(r => r.id)],
    ['top-level limit', () => q.limit(5, 2)],
    ['sort and limit', () => q.orderBy(r => r.id).limit(5)],
    ['pruned root columns', () => q.where(r => r.id.gt(1n)).map(r => ({ only: r.id }))],
    ['pruning through a subquery', () => q.limit(5).map(r => ({ only: r.id }))],
    [
      'parameters numbered in order',
      () =>
        q
          .where(r => r.id.gt(1n))
          .where(r => r.cat.eq('x'))
          .limit(2),
    ],
    ['final', () => q.final()],
    ['distinct', () => q.map(r => ({ cat: r.cat })).distinct()],
    ['aggregate', () => q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() }))],
    ['keyless aggregate', () => q.aggregate(() => ({ c: count() }))],
    [
      'aggregate with having and sort',
      () =>
        q
          .groupBy(r => ({ cat: r.cat }))
          .aggregate(() => ({ c: count() }))
          .where(r => r.c.gt(1n))
          .orderBy(r => r.c),
    ],
    [
      'union',
      () =>
        unionAll(
          q,
          q.where(r => r.id.gt(1n)),
        ),
    ],
    ['same subtree on two union sides', () => unionAll(shared, shared)],
    ['sorted union', () => unionAll(shared, shared).orderBy(r => r.id)],
    [
      'same subtree on two join sides',
      () =>
        join({ a: shared, b: shared })
          .on(r => r.a.id.eq(r.b.id))
          .map(r => ({ id: r.a.id })),
    ],
    ['an explicit CTE', () => unionAll(shared.cte(), shared.cte())],
    ['inner join, nested output', () => join({ a: q, b: others }).on(r => r.a.id.eq(r.b.id))],
    [
      'left join, nested output',
      () => leftJoin({ a: q }, { b: others }).on(r => r.a.id.eq(r.b.id)),
    ],
    [
      'set subquery, with its parameter',
      () => q.where(r => r.id.in(others.where(o => o.name.eq('x')).map(o => o.id))),
    ],
    ['array join', () => q.arrayJoin(r => r.tags, 'tag')],
    [
      'state to merge',
      () =>
        from(rollup)
          .groupBy(r => ({ day: r.day }))
          .aggregate(g => ({ total: sumMerge(g.total) })),
    ],
  ];

  describe.each(emitters)('%s', (_name, emit) => {
    it.each(roots)('%s', (_shape, build) => {
      const query = build();
      const plain = emit(query.ir);
      const wrapped = emit(query.settings({ max_threads: 2, log_comment: 'x' }).ir);
      const comment = plain.sql.match(/ \/\* join_use_nulls.*$/)?.[0] ?? '';
      const body = comment ? plain.sql.slice(0, -comment.length) : plain.sql;
      const added = "max_threads = 2, log_comment = 'x'";

      expect(wrapped.sql).toBe(
        body.includes(' SETTINGS ')
          ? `${body.replace(' SETTINGS ', ` SETTINGS ${added}, `)}${comment}`
          : `${body} SETTINGS ${added}${comment}`,
      );

      expect(wrapped.params).toEqual(plain.params);
      expect(wrapped.parameterTypes).toEqual(plain.parameterTypes);
      expect(wrapped.columns).toEqual(plain.columns);
      expect(wrapped.columnPaths).toEqual(plain.columnPaths);
      expect(Object.keys(wrapped.nodes)).toEqual(Object.keys(plain.nodes));
      expect(wrapped.nodes['root']).toBe(query.ir);
    });
  });
});

describe('rules that compare against the query root still see the input as root', () => {
  const rolled = from(rollup);

  const roots: readonly [
    string,
    () => { readonly ir: Rel; settings(s: QuerySettings): { ir: Rel } },
    string,
  ][] = [
    ['a scan', () => rolled, 'aggregate_state_selection at root'],
    ['a sort', () => rolled.orderBy(r => r.day), 'aggregate_state_selection at root'],
    ['a limit', () => rolled.limit(1), 'aggregate_state_selection at root'],
    ['a filter', () => rolled.where(r => r.day.eq('x')), 'aggregate_state_selection at root'],
    ['a map', () => rolled.map(r => ({ t: r.total })), 'aggregate_state_selection at root'],
    ['a union', () => unionAll(rolled, rolled), 'aggregate_state_selection at root'],
    ['a final scan', () => rolled.final(), 'aggregate_state_selection at root'],
  ];

  it.each(roots)('%s over a state', (_name, build, expected) => {
    for (const [, emit] of emitters) {
      expect(failure(() => emit(build().ir))).toBe(expected);
      expect(failure(() => emit(build().settings({ max_threads: 1 }).ir))).toBe(expected);
    }
  });

  it('a state read by a merge below a Settings root still compiles', () => {
    const merged = rolled
      .groupBy(r => ({ day: r.day }))
      .aggregate(g => ({ total: sumMerge(g.total) }));

    for (const [, emit] of emitters)
      expect(emit(merged.settings({ priority: 1 }).ir).sql).toContain('sumMerge');
  });

  it('any other input error is the same with and without the wrapper', () => {
    const scan = q.ir;

    const cases: readonly Rel[] = [
      { ...scan, table: 1 } as unknown as Rel,
      relNode({ kind: 'Limit', input: scan, n: -1, output: scan.output }),
      relNode({ kind: 'Limit', input: scan, n: 1.5, output: scan.output }),
      relNode({
        kind: 'Filter',
        input: scan,
        pred: val(1, col.UInt8).ir,
        output: q.limit(1).map(r => ({ x: r.id })).ir.output,
      }),
    ];

    for (const [, emit] of emitters)
      for (const input of cases) {
        const plain = failure(() => emit(input));
        expect(plain).toBeDefined();

        const wrapped = failure(() =>
          emit({
            kind: 'Settings',
            id: 1,
            input,
            settings: {},
            output: input.output,
          } as unknown as Rel),
        );

        expect(wrapped).toBe(plain);
      }
  });
});

describe('forged placement', () => {
  const flat = settled.ir;
  const predicate = val(true).ir;

  const subqueryExpr = {
    kind: 'Subquery',
    id: 999_001,
    rel: q.map(r => r.id).settings({ max_threads: 1 }).ir,
    usage: 'in',
    type: col.UInt64.type,
  };

  const placements: readonly [string, () => unknown, RegExp][] = [
    [
      'Filter',
      () => ({ kind: 'Filter', id: 2, input: flat, pred: predicate, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Prewhere',
      () => ({ kind: 'Prewhere', id: 2, input: flat, pred: predicate, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Project',
      () => ({ kind: 'Project', id: 2, input: flat, exprs: {}, columns: {}, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Aggregate',
      () => ({
        kind: 'Aggregate',
        id: 2,
        input: flat,
        keys: {},
        aggs: {},
        columns: {},
        output: flat.output,
      }),
      /at root\.input$/,
    ],
    [
      'Sort',
      () => ({ kind: 'Sort', id: 2, input: flat, keys: [], output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Limit',
      () => ({ kind: 'Limit', id: 2, input: flat, n: 1, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'LimitBy',
      () => ({ kind: 'LimitBy', id: 2, input: flat, by: [], n: 1, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Distinct',
      () => ({ kind: 'Distinct', id: 2, input: flat, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Materialize',
      () => ({ kind: 'Materialize', id: 2, input: flat, output: flat.output }),
      /at root\.input$/,
    ],
    [
      'ArrayJoin',
      () => ({ kind: 'ArrayJoin', id: 2, input: flat, items: [], output: flat.output }),
      /at root\.input$/,
    ],
    [
      'Union first',
      () => ({ kind: 'Union', id: 2, inputs: [flat, q.ir], all: true, output: flat.output }),
      /at root\.inputs\[0\]$/,
    ],
    [
      'Union last',
      () => ({ kind: 'Union', id: 2, inputs: [q.ir, flat], all: true, output: flat.output }),
      /at root\.inputs\[1\]$/,
    ],
    [
      'Union distinct',
      () => ({ kind: 'Union', id: 2, inputs: [q.ir, flat], all: false, output: flat.output }),
      /at root\.inputs\[1\]$/,
    ],
    [
      'both Union sides, one node',
      () => ({ kind: 'Union', id: 2, inputs: [flat, flat], all: true, output: flat.output }),
      /at root\.inputs\[0\]$/,
    ],
  ];

  describe.each(emitters)('%s', (_name, emit) => {
    it.each(placements)('under %s', (_shape, build, path) => {
      expect(failure(() => emit(build() as Rel))).toMatch(/^invalid_settings_placement at /);
      expect(failure(() => emit(build() as Rel))).toMatch(path);
    });

    it('under a Join input', () => {
      const real = join({ a: q, b: others }).on(r => r.a.id.eq(r.b.id)).ir as Extract<
        Rel,
        { kind: 'Join' }
      >;

      const settledOthers = others.settings({ max_threads: 1 }).ir;

      for (const inputs of [
        real.inputs.map((input, i) => (i === 0 ? [input[0], flat] : input)),
        real.inputs.map((input, i) => (i === 1 ? [input[0], settledOthers] : input)),
      ])
        expect(failure(() => emit({ ...real, inputs } as unknown as Rel))).toMatch(
          /^invalid_settings_placement at root\.inputs/,
        );
    });

    it('in a Subquery expression of a Filter', () => {
      const real = q.where(r => r.id.in(q.map(i => i.id))).ir as unknown as {
        pred: { args: [unknown, Record<string, unknown>] };
      };

      const [receiver, set] = real.pred.args;

      const forged = {
        ...real,
        pred: { ...real.pred, args: [receiver, { ...set, rel: subqueryExpr.rel }] },
      };

      expect(failure(() => emit(forged as unknown as Rel))).toMatch(/^invalid_settings_placement/);
    });

    it('in a Subquery expression of a Project', () => {
      const forged = {
        kind: 'Project',
        id: 2,
        input: q.ir,
        exprs: { x: subqueryExpr },
        columns: { x: col.UInt64.type },
        output: { shape: 'flat', columns: { x: col.UInt64.type }, order: ['x'] },
      };

      expect(failure(() => emit(forged as unknown as Rel))).toMatch(/^invalid_settings_placement/);
    });

    it('double-wrapped is refused at root, in either nesting', () => {
      expect(failure(() => emit(node(flat)))).toBe('invalid_settings_placement at root');
      expect(failure(() => emit(node(node(flat))))).toBe('invalid_settings_placement at root');
    });

    it('a bad id', () => {
      for (const id of ['1', undefined, null, {}])
        expect(
          failure(() =>
            emit({
              kind: 'Settings',
              id,
              input: q.ir,
              settings: {},
              output: q.ir.output,
            } as unknown as Rel),
          ),
        ).toBe('invalid_structure at root.id');
    });

    it('a missing or foreign input', () => {
      const bad = (input: unknown) =>
        failure(() =>
          emit({
            kind: 'Settings',
            id: 1,
            input,
            settings: {},
            output: q.ir.output,
          } as unknown as Rel),
        );

      expect(bad(undefined)).toMatch(/^invalid_structure/);
      expect(bad(null)).toMatch(/^invalid_structure/);
      expect(bad(1)).toMatch(/^invalid_structure/);
      expect(bad({ kind: 'Nope', id: 2 })).toMatch(/^invalid_structure/);
    });

    it.each([
      [
        'a dropped column',
        () => ({ shape: 'flat', columns: { id: col.UInt64.type }, order: ['id'] }),
      ],
      [
        'a changed type',
        () => ({
          ...q.ir.output,
          columns: {
            ...(q.ir.output as unknown as { columns: object }).columns,
            id: col.String.type,
          },
        }),
      ],
      [
        'an extra column',
        () => ({
          shape: 'flat',
          columns: {
            ...(q.ir.output as unknown as { columns: object }).columns,
            x: col.UInt8.type,
          },
          order: [...(q.ir.output as unknown as { order: string[] }).order, 'x'],
        }),
      ],
      [
        'reordered columns',
        () => ({
          ...q.ir.output,
          order: [...(q.ir.output as unknown as { order: string[] }).order].reverse(),
        }),
      ],
      ['no output', () => undefined],
      ['a string', () => 'flat'],
    ])('output mismatch, %s', (_name, output) => {
      expect(
        failure(() =>
          emit({
            kind: 'Settings',
            id: 1,
            input: q.ir,
            settings: {},
            output: output(),
          } as unknown as Rel),
        ),
      ).toBe('invalid_output at root');
    });

    it('settings invalid on a forged node never reach the SQL', () => {
      for (const settings of [
        { max_threads: '1, limit = 2' },
        { max_threads: 1e21 },
        { log_comment: 1 },
        { limit: 1 },
        { join_use_nulls: 0 },
        { 'max_threads = 1, limit': 2 },
        null,
        [],
      ])
        expect(failure(() => emit(node(q.ir, settings)))).toMatch(
          /^(invalid_setting_value|unknown_setting|compiler_owned_setting|invalid_settings) at root\.settings/,
        );
    });
  });
});

describe('the result is terminal at runtime', () => {
  const ids = q.map(r => r.id).settings({ max_threads: 1 });
  const counted = q.aggregate(() => ({ c: count() })).settings({ max_threads: 1 });
  const any = settled as unknown as Parameters<typeof unionAll>[0];

  it.each([
    'where',
    'map',
    'limit',
    'orderBy',
    'groupBy',
    'aggregate',
    'distinct',
    'cte',
    'settings',
    'row',
    'count',
    'limitBy',
    'then',
  ])('has no %s', method => {
    expect((settled as unknown as Record<string, unknown>)[method]).toBeUndefined();
  });

  it('refuses every way of becoming an input', () => {
    expect(() => unionAll(any, q as never)).toThrow('invalid_union_input');
    expect(() => unionAll(q as never, any as never)).toThrow('invalid_union_input');
    expect(() => join({ a: any as never, b: q })).toThrow('invalid_join_input');
    expect(() => leftJoin({ a: q }, { b: any as never })).toThrow('invalid_join_input');
    expect(() => q.where(r => r.id.in(ids as never))).toThrow('invalid_settings_placement');

    expect(() => q.where(r => r.id.in({ ir: ids.ir } as never))).toThrow(
      'invalid_settings_placement',
    );

    expect(() => scalar(counted as never)).toThrow();

    expect(() => q.map(() => ({ x: sql`${settled as never}`.as(col.UInt8) }))).toThrow(
      'invalid_sql_operand',
    );

    expect(() => q.map(() => ({ x: sql`${settled.ir as never}`.as(col.UInt8) }))).toThrow(
      'invalid_sql_operand',
    );
  });
});

describe('independence and stability', () => {
  it('settings() neither mutates nor shares the parent', () => {
    const parent = q.limit(1);
    const before = JSON.stringify(parent.ir);
    const sql0 = compile(parent.ir).sql;
    const first = parent.settings({ max_threads: 1 });
    const second = parent.settings({ max_threads: 2 });

    expect(first.ir).not.toBe(second.ir);
    expect(first.ir.input).toBe(parent.ir);
    expect(second.ir.input).toBe(parent.ir);
    expect(tail(first)).toBe('max_threads = 1');
    expect(tail(second)).toBe('max_threads = 2');
    expect(JSON.stringify(parent.ir)).toBe(before);
    expect(compile(parent.ir).sql).toBe(sql0);
    expect(parent.where).toBeTypeOf('function');
  });

  it('the same node compiles to the same result, on both emitters and repeatedly', () => {
    const query = unionAll(q.limit(1), q.limit(1)).settings({ log_comment: 'x' });

    for (const [, emit] of emitters) {
      const a = emit(query.ir);
      const b = emit(query.ir);
      expect(b.sql).toBe(a.sql);
      expect(b.params).toEqual(a.params);
      expect(b.columns).toEqual(a.columns);
    }
  });

  it('the settings node is not in compiled.nodes', () => {
    const { nodes } = compile(settled.ir);
    expect(Object.values(nodes).some(rel => rel.kind === 'Settings')).toBe(false);
    expect(nodes['root']).toBe(q.ir);
  });

  it('output leaves are shared from the input', () => {
    expect(outputLeaves(settled.ir.output)).toEqual(outputLeaves(q.ir.output));
  });
});
