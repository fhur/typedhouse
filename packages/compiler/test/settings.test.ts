import { describe, expect, it } from 'vitest';
import {
  col,
  from,
  join,
  leftJoin,
  outputLeaves,
  registerCompiler,
  relNode,
  scalar,
  settingsIssue,
  sumMerge,
  table,
  unionAll,
  val,
  type QuerySettings,
  type Rel,
} from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '@typedhouse/compiler';
import { createClientFromBackend, type Backend, type Plan } from '@typedhouse/client';

const t = table(
  't',
  { id: col.UInt64, cat: col.String },
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

const emitters = [
  ['compile', compile],
  ['emitNaive', emitNaive],
] as const;

const forge = (fields: Record<string, unknown>) => fields as unknown as Rel;

function settingsNode(input: Rel, settings: unknown, output: unknown = input.output) {
  return relNode({
    kind: 'Settings',
    input,
    settings: settings as QuerySettings,
    output: output as Rel['output'],
  });
}

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof ValidationError ? `${error.code} at ${error.path}` : String(error);
  }

  return undefined;
}

describe('every allowed key', () => {
  const cases: readonly [keyof QuerySettings, QuerySettings[keyof QuerySettings], string][] = [
    ['max_threads', 2, 'max_threads = 2'],
    ['max_execution_time', 1.5, 'max_execution_time = 1.5'],
    ['max_memory_usage', 1000000, 'max_memory_usage = 1000000'],
    ['max_rows_to_read', 10, 'max_rows_to_read = 10'],
    ['max_bytes_to_read', 2n ** 40n, 'max_bytes_to_read = 1099511627776'],
    ['max_result_rows', 5, 'max_result_rows = 5'],
    ['max_result_bytes', 5n, 'max_result_bytes = 5'],
    ['max_block_size', 1024, 'max_block_size = 1024'],
    ['max_bytes_before_external_group_by', 7, 'max_bytes_before_external_group_by = 7'],
    ['max_bytes_before_external_sort', 8, 'max_bytes_before_external_sort = 8'],
    ['priority', 0, 'priority = 0'],
    ['log_comment', 'report', "log_comment = 'report'"],
  ];

  for (const [emitterName, emit] of emitters)
    it.each(cases)(`${emitterName}: %s`, (key, value, text) => {
      const { sql } = emit(q.settings({ [key]: value }).ir);
      expect(sql.endsWith(` SETTINGS ${text}`)).toBe(true);
    });

  it('covers the owner-approved allowlist exactly', () => {
    expect(cases.map(([key]) => key).sort()).toEqual([
      'log_comment',
      'max_block_size',
      'max_bytes_before_external_group_by',
      'max_bytes_before_external_sort',
      'max_bytes_to_read',
      'max_execution_time',
      'max_memory_usage',
      'max_result_bytes',
      'max_result_rows',
      'max_rows_to_read',
      'max_threads',
      'priority',
    ]);
  });
});

describe('values', () => {
  const integers = ['max_threads', 'max_memory_usage', 'priority'] as const;

  it.each([
    [1.5],
    [-1],
    [1e21],
    [Number.MAX_SAFE_INTEGER + 1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [-1n],
    [2n ** 64n],
    ['1'],
    [null],
    [undefined],
    [true],
    [{}],
    [[1]],
    [new Number(1)],
    [new Date(0)],
  ])('integer keys refuse %s', value => {
    for (const key of integers) {
      expect(() => q.settings({ [key]: value } as QuerySettings)).toThrow(
        `invalid_setting_value at settings.${key}`,
      );
    }
  });

  it('integer keys take zero, the largest safe integer and the largest UInt64', () => {
    expect(q.settings({ max_memory_usage: 0 }).toSQL).toBeTypeOf('function');
    const large = (v: number | bigint) => compile(q.settings({ max_memory_usage: v }).ir).sql;
    expect(large(0)).toMatch(/max_memory_usage = 0$/);
    expect(large(-0)).toMatch(/max_memory_usage = 0$/);
    expect(large(Number.MAX_SAFE_INTEGER)).toMatch(/max_memory_usage = 9007199254740991$/);
    expect(large(2n ** 64n - 1n)).toMatch(/max_memory_usage = 18446744073709551615$/);
  });

  it.each([
    [-1],
    [-0.5],
    [1e-7],
    [0.0000009],
    [9223372036855],
    [1e21],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [1n],
    ['1'],
  ])('max_execution_time refuses %s', value => {
    expect(() => q.settings({ max_execution_time: value } as QuerySettings)).toThrow(
      'invalid_setting_value at settings.max_execution_time',
    );
  });

  it.each([
    [0, '0'],
    [1e-6, '0.000001'],
    [0.5, '0.5'],
    [1.5, '1.5'],
    [9223372036854, '9223372036854'],
  ])('max_execution_time keeps %s', (value, text) => {
    expect(compile(q.settings({ max_execution_time: value }).ir).sql).toMatch(
      new RegExp(`max_execution_time = ${text.replace('.', '\\.')}$`),
    );
  });

  it.each([[1], [null], [undefined], [1n], [{}], ['\ud800'], ['a\udc00b']])(
    'log_comment refuses %s',
    value => {
      expect(() => q.settings({ log_comment: value } as QuerySettings)).toThrow(
        'invalid_setting_value at settings.log_comment',
      );
    },
  );

  it('log_comment keeps a surrogate pair', () => {
    expect(compile(q.settings({ log_comment: '🙂' }).ir).sql).toContain("log_comment = '🙂'");
  });
});

describe('keys', () => {
  it.each([
    ['join_algorithm'],
    ['limit'],
    ['offset'],
    ['final'],
    ['readonly'],
    ['max_threads '],
    ['MAX_THREADS'],
    ['aggregate_functions_null_for_empty'],
    ['group_by_use_nulls'],
    ['result_overflow_mode'],
    ['read_overflow_mode'],
    ['timeout_overflow_mode'],
    ['max_threads = 1, limit'],
    ['constructor'],
    ['toString'],
    ['__proto__'],
  ])('refuses unknown key %s', key => {
    const settings = Object.defineProperty({}, key, { enumerable: true, value: 1 });
    expect(() => q.settings(settings)).toThrow(`unknown_setting at settings.${key}`);
  });

  it.each([
    ['join_use_nulls'],
    ['transform_null_in'],
    ['enable_extended_results_for_datetime_functions'],
    ['date_time_output_format'],
    ['output_format_json_quote_64bit_integers'],
    ['output_format_json_quote_decimals'],
    ['output_format_json_quote_denormals'],
  ])('refuses compiler-owned key %s', key => {
    expect(() => q.settings({ [key]: 1 })).toThrow(`compiler_owned_setting at settings.${key}`);
  });

  it('refuses hidden keys and non-plain containers', () => {
    const hidden = Object.defineProperty({}, 'limit', { enumerable: false, value: 1 });
    expect(() => q.settings(hidden)).toThrow('unknown_setting at settings.limit');
    const symbol = { [Symbol('x')]: 1 };
    expect(() => q.settings(symbol)).toThrow('invalid_settings at settings');

    const accessor = Object.defineProperty({}, 'max_threads', {
      enumerable: true,
      get: () => 1,
    });

    expect(() => q.settings(accessor)).toThrow('invalid_settings at settings');

    class Custom {}

    expect(() => q.settings(new Custom())).toThrow('invalid_settings at settings');
    expect(() => q.settings([] as QuerySettings)).toThrow('invalid_settings at settings');
    expect(() => q.settings(null as unknown as QuerySettings)).toThrow('invalid_settings');
    expect(() => q.settings(undefined as unknown as QuerySettings)).toThrow('invalid_settings');
    expect(() => q.settings(1 as unknown as QuerySettings)).toThrow('invalid_settings');
    expect(settingsIssue({ max_threads: 1 })).toBeUndefined();
  });

  it('snapshots the caller object', () => {
    const input: { max_threads: number } = { max_threads: 1 };
    const settled = q.settings(input);
    input.max_threads = -1;
    expect(compile(settled.ir).sql).toMatch(/max_threads = 1$/);
  });
});

describe('emission', () => {
  it('keeps the caller order and has no clause for no settings', () => {
    const { sql } = compile(q.settings({ priority: 1, max_threads: 2 }).ir);
    expect(sql.endsWith(' SETTINGS priority = 1, max_threads = 2')).toBe(true);
    expect(compile(q.settings({}).ir).sql).toBe(compile(q.ir).sql);
    expect(emitNaive(q.settings({}).ir).sql).toBe(emitNaive(q.ir).sql);
  });

  it('leaves the same query text before the tail', () => {
    const base = q.where(r => r.id.gt(1n)).limit(5);
    const tail = ' SETTINGS max_threads = 2';

    for (const [, emit] of emitters) {
      const with_ = emit(base.settings({ max_threads: 2 }).ir);
      const without = emit(base.ir);
      expect(with_.sql).toBe(without.sql + tail);
      expect(with_.params).toEqual(without.params);
      expect(with_.parameterTypes).toEqual(without.parameterTypes);
    }
  });

  it('merges with compiler-owned settings, before the trailing comment', () => {
    const outer = leftJoin({ a: q }, { b: from(u) })
      .on(({ a, b }) => a.id.eq(b.id))
      .settings({ max_threads: 2, log_comment: "*/ -- it's" });

    for (const [, emit] of emitters) {
      const { sql } = emit(outer.ir);

      expect(sql).toMatch(
        /SETTINGS max_threads = 2, log_comment = '\*\/ -- it\\'s', join_use_nulls = 1 \/\* join_use_nulls = 1: unmatched outer-join columns are NULL, not type defaults \*\/$/,
      );
    }
  });

  it('applies through a CTE and a union, with one clause at the tail', () => {
    const shared = q.cte();

    for (const settled of [
      unionAll(q, q).settings({ max_threads: 2 }),
      unionAll(shared, shared).settings({ max_threads: 2 }),
      unionAll(q, q).distinct().settings({ max_threads: 2 }),
    ])
      for (const [, emit] of emitters) {
        const { sql } = emit(settled.ir);
        expect(sql.match(/SETTINGS/g)).toHaveLength(1);
        expect(sql.endsWith(' SETTINGS max_threads = 2')).toBe(true);
      }
  });

  it.each([
    ["it's", "'it\\'s'"],
    ['back\\slash', "'back\\\\slash'"],
    ['a\nb\tc\rd', "'a\\nb\\tc\\rd'"],
    ['nul\0', "'nul\\0'"],
    ["'; DROP TABLE t; --", "'\\'; DROP TABLE t; --'"],
    ['*/ -- /*', "'*/ -- /*'"],
    ['{p0:UInt8}', "'{p0:UInt8}'"],
    ['', "''"],
  ])('escapes log_comment %j', (comment, literal) => {
    for (const [, emit] of emitters)
      expect(emit(q.settings({ log_comment: comment }).ir).sql).toBe(
        `${emit(q.ir).sql} SETTINGS log_comment = ${literal}`,
      );
  });

  it('takes columns and columnPaths from the input', () => {
    const joined = join({ a: q, b: from(u) }).on(({ a, b }) => a.id.eq(b.id));

    for (const [, emit] of emitters) {
      for (const input of [q, q.map(r => ({ x: r.id })), joined]) {
        const settled = emit(input.settings({ max_threads: 1 }).ir);
        const plain = emit(input.ir);
        expect(settled.columns).toEqual(plain.columns);
        expect(settled.columnPaths).toEqual(plain.columnPaths);
        expect(Object.keys(settled.nodes)).toEqual(Object.keys(plain.nodes));
      }
    }

    expect(joined.settings({ max_threads: 1 }).ir.output).toBe(joined.ir.output);
  });

  it('toSQL uses the registered compiler', () => {
    registerCompiler(compile);
    const settled = q.settings({ max_threads: 1 });
    expect(settled.toSQL().sql).toBe(compile(settled.ir).sql);
    registerCompiler(emitNaive);
    expect(settled.toSQL().sql).toBe(emitNaive(settled.ir).sql);
    registerCompiler(compile);
  });
});

describe('placement', () => {
  it('is checked after the peel: a state at the root still fails at root', () => {
    for (const [, emit] of emitters) {
      expect(code(() => emit(from(rollup).ir))).toBe('aggregate_state_selection at root');

      expect(code(() => emit(from(rollup).settings({ max_threads: 1 }).ir))).toBe(
        'aggregate_state_selection at root',
      );

      const merged = from(rollup)
        .groupBy(r => ({ day: r.day }))
        .aggregate(g => ({
          total: sumMerge(g.total),
        }));

      expect(emit(merged.settings({ max_threads: 1 }).ir).sql).toContain('sumMerge');
    }
  });

  const settled = q.settings({ max_threads: 1 });
  const flat = settled.ir;

  const placements: readonly [string, () => Rel, string][] = [
    [
      'under Filter',
      () =>
        relNode({
          kind: 'Filter',
          input: flat,
          pred: val(true).ir,
          output: flat.output,
        }),
      'root.input',
    ],
    [
      'under Limit',
      () => relNode({ kind: 'Limit', input: flat, n: 1, output: flat.output }),
      'root.input',
    ],
    [
      'under Sort',
      () => relNode({ kind: 'Sort', input: flat, keys: [], output: flat.output }),
      'root.input',
    ],
    [
      'under Materialize',
      () => relNode({ kind: 'Materialize', input: flat, output: flat.output }),
      'root.input',
    ],
    [
      'under Distinct',
      () => relNode({ kind: 'Distinct', input: flat, output: flat.output }),
      'root.input',
    ],
    [
      'in a Union',
      () => relNode({ kind: 'Union', inputs: [q.ir, flat], all: true, output: flat.output }),
      'root.inputs[1]',
    ],
    ['under Settings', () => settingsNode(flat, { priority: 1 }), 'root'],
  ];

  for (const [, emit] of emitters)
    it.each(placements)(`${emit.name}: %s`, (_name, build, path) => {
      expect(code(() => emit(build()))).toBe(`invalid_settings_placement at ${path}`);
    });

  for (const [, emit] of emitters)
    it(`${emit.name}: a forged Settings under a Subquery`, () => {
      const set = q.map(r => r.id);

      const inSubquery = q.where(r => r.id.in(set));
      const filter = inSubquery.ir as Extract<Rel, { kind: 'Filter' }>;
      const call = filter.pred as Extract<typeof filter.pred, { kind: 'Call' }>;

      const forged = forge({
        ...filter,
        pred: {
          ...call,
          args: call.args.map(arg =>
            arg.kind === 'Subquery'
              ? { ...arg, rel: settingsNode(arg.rel, { max_threads: 1 }) }
              : arg,
          ),
        },
      });

      expect(code(() => emit(forged))).toMatch(
        /^invalid_settings_placement at root\.pred\.args\[1\]\.rel$/,
      );
    });

  it('a set or scalar subquery refuses it at build time', () => {
    const set = q.map(r => r.id).settings({ max_threads: 1 });
    expect(() => q.where(r => r.id.in(set as never))).toThrow('invalid_settings_placement');
    expect(() => scalar(q.count().settings({ max_threads: 1 }) as never)).toThrow();
  });

  it('a join or a union refuses it at build time', () => {
    expect(() => join({ a: settled as never, b: q })).toThrow('invalid_join_input');
    const union = unionAll as (...inputs: unknown[]) => unknown;
    expect(() => union(settled, q)).toThrow('invalid_union_input');
    expect(() => union(q, settled)).toThrow('invalid_union_input');
  });

  it('has only ir, caps and toSQL', () => {
    expect(Object.keys(settled).sort()).toEqual(['caps', 'ir']);
    expect(settled.caps).toEqual({ live: false });
    expect(Object.isFrozen(settled)).toBe(true);
    expect(Object.isFrozen(settled.caps)).toBe(true);

    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(settled)).sort();
    expect(methods).toEqual(['constructor', 'toSQL']);

    for (const name of ['where', 'limit', 'map', 'settings', 'row', 'orderBy', 'cte'])
      expect(name in settled).toBe(false);
  });
});

describe('a forged root node', () => {
  for (const [, emit] of emitters) {
    const name = emit.name;

    it(`${name}: revalidates settings`, () => {
      expect(code(() => emit(settingsNode(q.ir, { limit: 1 })))).toBe(
        'unknown_setting at root.settings.limit',
      );

      expect(code(() => emit(settingsNode(q.ir, { join_use_nulls: 0 })))).toBe(
        'compiler_owned_setting at root.settings.join_use_nulls',
      );

      expect(code(() => emit(settingsNode(q.ir, { max_threads: '1, limit = 2' })))).toBe(
        'invalid_setting_value at root.settings.max_threads',
      );

      expect(code(() => emit(settingsNode(q.ir, { max_threads: 1e21 })))).toBe(
        'invalid_setting_value at root.settings.max_threads',
      );

      expect(code(() => emit(settingsNode(q.ir, null)))).toBe('invalid_settings at root.settings');
    });

    it(`${name}: refuses a different output`, () => {
      const other = q.map(r => ({ x: r.id })).ir.output;
      expect(code(() => emit(settingsNode(q.ir, {}, other)))).toBe('invalid_output at root');

      expect(code(() => emit(settingsNode(q.ir, {}, { shape: 'flat' })))).toBe(
        'invalid_output at root',
      );
    });

    it(`${name}: refuses a malformed input and an accessor`, () => {
      expect(
        code(() => emit(forge({ kind: 'Settings', id: 1, settings: {}, output: q.ir.output }))),
      ).toMatch(/^invalid_structure at root/);

      expect(
        code(() =>
          emit(forge({ kind: 'Settings', settings: {}, input: q.ir, output: q.ir.output })),
        ),
      ).toBe('invalid_structure at root.id');

      const accessor = Object.defineProperty({}, 'kind', {
        get: () => 'Settings',
        enumerable: true,
      });

      expect(code(() => emit(accessor as Rel))).toMatch(/^invalid_structure at root/);
      expect(code(() => emit(null as unknown as Rel))).toMatch(/^invalid_structure at root/);
    });
  }

  it('a hand-built node with an identical output compiles', () => {
    const output = JSON.parse(JSON.stringify(q.ir.output)) as Rel['output'];
    expect(outputLeaves(output)).toHaveLength(2);
    expect(compile(settingsNode(q.ir, { priority: 1 }, output)).sql).toMatch(/priority = 1$/);
  });
});

describe('plan caching', () => {
  it('keeps working by node identity', async () => {
    const compiled: Rel[] = [];

    const backend: Backend = {
      name: 'counting',
      compile(rel) {
        compiled.push(rel);
        return { compiled: compile(rel) };
      },
      run: async function* (_plan: Plan) {
        yield [];
      },
    };

    const client = createClientFromBackend(backend);
    const settled = q.settings({ max_threads: 1 });
    const other = q.settings({ max_threads: 1 });
    await client.run(settled);
    await client.run(settled);
    for await (const row of client.stream(settled)) void row;
    expect(compiled).toEqual([settled.ir]);
    await client.run(other);
    expect(compiled).toEqual([settled.ir, other.ir]);
    await client.run(q);
    expect(compiled[2]).toBe(q.ir);
  });
});
