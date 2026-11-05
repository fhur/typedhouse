import { describe, expect, it } from 'vitest';
import {
  aggregateDefinitions,
  argMax,
  argMaxIf,
  argMin,
  argMinIf,
  avg,
  avgIf,
  col,
  count,
  countIf,
  createKnownFunctions,
  from,
  max,
  maxIf,
  min,
  minIf,
  quantile,
  quantileExact,
  quantileExactIf,
  quantileIf,
  sum,
  sumIf,
  table,
  uniq,
  uniqExact,
  uniqExactIf,
  val,
} from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;

const t = table(
  't',
  {
    k: col.UInt8,
    v: col.UInt32,
    s: col.String,
    ok: col.Bool,
    n: col.Nullable(col.UInt32),
    nb: col.Nullable(col.Bool),
    lcs: col.LowCardinality(col.Nullable(col.String)),
  },
  meta,
);

const q = from(t);

const emitters = [
  ['compile', compile],
  ['emitNaive', emitNaive],
] as const;

const v = '`__typedhouse_input`.`v`';

const s = '`__typedhouse_input`.`s`';

const ok = '`__typedhouse_input`.`ok`';

const n = '`__typedhouse_input`.`n`';

const nb = '`__typedhouse_input`.`nb`';

const lcs = '`__typedhouse_input`.`lcs`';

/** The select list, with the naive emitter's function-form comparisons written as the optimizer's infix. */
function selectList(query: { ir: never }, emit: (typeof emitters)[number][1]): string {
  const { sql } = emit(query.ir);
  const prefix = 'SELECT ';

  expect(sql.startsWith(prefix)).toBe(true);

  const list = sql.slice(prefix.length, sql.indexOf(' FROM '));

  const infix = (text: string, name: string, operator: string) =>
    text.replace(
      new RegExp(`\\b${name}\\((\`[^\`]+\`\\.\`[^\`]+\`), (\\{[^}]+\\})\\)`, 'g'),
      `$1 ${operator} $2`,
    );

  return [
    ['less', '<'],
    ['greater', '>'],
    ['equals', '='],
  ].reduce((text, [name, operator]) => infix(text, name!, operator!), list);
}

describe.each(emitters)('export correctness through %s', (_name, emit) => {
  // A wrong `derived[n]` compiles silently because the exports are cast, so every export pins its SQL name.
  it.each([
    ['count', () => q.aggregate(() => ({ x: count() })), 'count() AS `x`'],
    ['countIf', () => q.aggregate(g => ({ x: countIf(g.ok) })), `countIf(${ok}) AS \`x\``],
    ['sum', () => q.aggregate(g => ({ x: sum(g.v) })), `sum(${v}) AS \`x\``],
    ['sumIf', () => q.aggregate(g => ({ x: sumIf(g.v, g.ok) })), `sumIf(${v}, ${ok}) AS \`x\``],
    ['max', () => q.aggregate(g => ({ x: max(g.v) })), `max(${v}) AS \`x\``],
    ['maxIf', () => q.aggregate(g => ({ x: maxIf(g.v, g.ok) })), `maxIf(${v}, ${ok}) AS \`x\``],
    ['min', () => q.aggregate(g => ({ x: min(g.v) })), `min(${v}) AS \`x\``],
    ['minIf', () => q.aggregate(g => ({ x: minIf(g.v, g.ok) })), `minIf(${v}, ${ok}) AS \`x\``],
    ['argMax', () => q.aggregate(g => ({ x: argMax(g.s, g.v) })), `argMax(${s}, ${v}) AS \`x\``],
    [
      'argMaxIf',
      () => q.aggregate(g => ({ x: argMaxIf(g.s, g.v, g.ok) })),
      `argMaxIf(${s}, ${v}, ${ok}) AS \`x\``,
    ],
    ['argMin', () => q.aggregate(g => ({ x: argMin(g.s, g.v) })), `argMin(${s}, ${v}) AS \`x\``],
    [
      'argMinIf',
      () => q.aggregate(g => ({ x: argMinIf(g.s, g.v, g.ok) })),
      `argMinIf(${s}, ${v}, ${ok}) AS \`x\``,
    ],
    ['avg', () => q.aggregate(g => ({ x: avg(g.v) })), `avg(${v}) AS \`x\``],
    ['avgIf', () => q.aggregate(g => ({ x: avgIf(g.v, g.ok) })), `avgIf(${v}, ${ok}) AS \`x\``],
    [
      'quantile',
      () => q.aggregate(g => ({ x: quantile(0.5)(g.v) })),
      `quantile({p0:Float64})(${v}) AS \`x\``,
    ],
    [
      'quantileIf',
      () => q.aggregate(g => ({ x: quantileIf(0.5)(g.v, g.ok) })),
      `quantileIf({p0:Float64})(${v}, ${ok}) AS \`x\``,
    ],
    [
      'quantileExact',
      () => q.aggregate(g => ({ x: quantileExact(0.5)(g.v) })),
      `quantileExact({p0:Float64})(${v}) AS \`x\``,
    ],
    [
      'quantileExactIf',
      () => q.aggregate(g => ({ x: quantileExactIf(0.5)(g.v, g.ok) })),
      `quantileExactIf({p0:Float64})(${v}, ${ok}) AS \`x\``,
    ],
    ['uniqExact', () => q.aggregate(g => ({ x: uniqExact(g.s) })), `uniqExact(${s}) AS \`x\``],
    [
      'uniqExactIf',
      () => q.aggregate(g => ({ x: uniqExactIf(g.s, g.ok) })),
      `uniqExactIf(${s}, ${ok}) AS \`x\``,
    ],
    ['uniq', () => q.aggregate(g => ({ x: uniq(g.s) })), `uniq(${s}) AS \`x\``],
  ])('%s emits exactly its own function', (_label, build, expected) => {
    expect(selectList(build() as never, emit)).toBe(expected);
  });

  it('keeps the level a bound Float64 parameter, for both bounds', () => {
    for (const level of [0, 1, 0.25]) {
      const { sql, params } = emit(
        q.aggregate(g => ({ a: quantileExact(level)(g.v), b: quantileExactIf(level)(g.v, g.ok) }))
          .ir,
      );

      expect(sql).not.toContain(`(${level})`);
      expect(sql).toContain('quantileExact({p0:Float64})(');
      expect(sql).toContain('quantileExactIf({p1:Float64})(');
      expect(params).toEqual({ p0: String(level), p1: String(level) });
    }
  });

  it.each([-1, 1.0000001, NaN, Infinity, -Infinity])('rejects level %s', level => {
    expect(() => emit(q.aggregate(g => ({ x: quantileExact(level)(g.v) })).ir)).toThrow(
      /invalid_quantile_level/,
    );

    expect(() => emit(q.aggregate(g => ({ x: quantileExactIf(level)(g.v, g.ok) })).ir)).toThrow(
      /invalid_quantile_level/,
    );
  });

  it('wraps exactly the nullable predicates of minIf and maxIf', () => {
    const lt = (name: string) => `${n} < {${name}:UInt32}`;

    expect(selectList(q.aggregate(g => ({ x: maxIf(g.v, g.n.lt(10)) })) as never, emit)).toBe(
      `maxIf(${v}, ifNull(${lt('p0')}, false)) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: minIf(g.v, g.n.lt(10)) })) as never, emit)).toBe(
      `minIf(${v}, ifNull(${lt('p0')}, false)) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: maxIf(g.v, g.nb) })) as never, emit)).toBe(
      `maxIf(${v}, ifNull(${nb}, false)) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: minIf(g.v, g.nb.not()) })) as never, emit)).toBe(
      `minIf(${v}, ifNull(not(${nb}), false)) AS \`x\``,
    );

    expect(
      selectList(q.aggregate(g => ({ x: maxIf(g.v, g.lcs.eq('a')) })) as never, emit).replace(
        `(${lcs} = {p0:String})`,
        `${lcs} = {p0:String}`,
      ),
    ).toBe(`maxIf(${v}, ifNull(${lcs} = {p0:String}, false)) AS \`x\``);

    expect(selectList(q.aggregate(g => ({ x: maxIf(g.n, g.n.gt(1)) })) as never, emit)).toBe(
      `maxIf(${n}, ifNull(${n} > {p0:UInt32}, false)) AS \`x\``,
    );

    expect(
      selectList(
        q.aggregate(g => ({ x: maxIf(g.v, val(null, col.Nullable(col.Bool))) })) as never,
        emit,
      ),
    ).toBe(`maxIf(${v}, ifNull(CAST(NULL AS Nullable(Bool)), false)) AS \`x\``);
  });

  it('does not change the SQL of a non-nullable predicate', () => {
    expect(selectList(q.aggregate(g => ({ x: maxIf(g.v, g.ok) })) as never, emit)).toBe(
      `maxIf(${v}, ${ok}) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: minIf(g.v, g.v.gt(1)) })) as never, emit)).toBe(
      `minIf(${v}, ${v} > {p0:UInt32}) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: maxIf(g.v, g.n.isNull()) })) as never, emit)).toBe(
      `maxIf(${v}, isNull(${n})) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: maxIf(g.n, g.ok) })) as never, emit)).toBe(
      `maxIf(${n}, ${ok}) AS \`x\``,
    );

    expect(
      selectList(q.aggregate(g => ({ x: minIf(g.v, g.n.ifNull(99).lt(10)) })) as never, emit),
    ).not.toContain('false)');
  });

  it('leaves the SQL of every other conditional aggregate unwrapped for a nullable predicate', () => {
    const lt = (name: string) => `${n} < {${name}:UInt32}`;

    expect(selectList(q.aggregate(g => ({ x: sumIf(g.v, g.n.lt(10)) })) as never, emit)).toBe(
      `sumIf(${v}, ${lt('p0')}) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: avgIf(g.v, g.n.lt(10)) })) as never, emit)).toBe(
      `avgIf(${v}, ${lt('p0')}) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: countIf(g.n.lt(10)) })) as never, emit)).toBe(
      `countIf(${lt('p0')}) AS \`x\``,
    );

    expect(
      selectList(q.aggregate(g => ({ x: argMaxIf(g.s, g.v, g.n.lt(10)) })) as never, emit),
    ).toBe(`argMaxIf(${s}, ${v}, ${lt('p0')}) AS \`x\``);

    expect(
      selectList(q.aggregate(g => ({ x: argMinIf(g.s, g.v, g.n.lt(10)) })) as never, emit),
    ).toBe(`argMinIf(${s}, ${v}, ${lt('p0')}) AS \`x\``);

    expect(
      selectList(q.aggregate(g => ({ x: quantileIf(0.5)(g.v, g.n.lt(10)) })) as never, emit),
    ).toBe(`quantileIf({p0:Float64})(${v}, ${lt('p1')}) AS \`x\``);

    expect(
      selectList(q.aggregate(g => ({ x: quantileExactIf(0.5)(g.v, g.n.lt(10)) })) as never, emit),
    ).toBe(`quantileExactIf({p0:Float64})(${v}, ${lt('p1')}) AS \`x\``);

    expect(selectList(q.aggregate(g => ({ x: uniqExactIf(g.s, g.n.lt(10)) })) as never, emit)).toBe(
      `uniqExactIf(${s}, ${lt('p0')}) AS \`x\``,
    );
  });

  it('does not wrap non-predicate operands that are nullable', () => {
    expect(selectList(q.aggregate(g => ({ x: max(g.n) })) as never, emit)).toBe(
      `max(${n}) AS \`x\``,
    );

    expect(selectList(q.aggregate(g => ({ x: min(g.n) })) as never, emit)).toBe(
      `min(${n}) AS \`x\``,
    );
  });

  it('rejects a forged If combinator on a known max', () => {
    const { agg } = createKnownFunctions({
      max: { isAggregate: true, deterministic: true, aliasTo: '' },
    });

    const known = q.aggregate(g => ({ x: agg.max(g.v).as(col.UInt32) }));

    if (known.ir.kind !== 'Aggregate' || known.ir.aggs.x?.kind !== 'Agg')
      throw new Error('expected a known aggregate');

    const forged = { ...known.ir, aggs: { x: { ...known.ir.aggs.x, combinators: ['If'] } } };

    expect(() => emit(forged as never)).toThrow(/unsupported_known_aggregate/);
  });
});

describe('catalog positions', () => {
  it('keeps every positional aggregate definition where the exports expect it', () => {
    expect(aggregateDefinitions.map(d => d.name)).toEqual([
      'count',
      'sum',
      'max',
      'argMax',
      'avg',
      'quantile',
      'uniqExact',
      'uniq',
      'min',
      'argMin',
      'quantileExact',
    ]);
  });
});
