import { describe, expect, it } from 'vitest';
import { argMaxIf, argMin, argMinIf, avgIf, col, count, countIf, exprNode, flatOutput, from, leftJoin, max, maxIf, min, minIf, quantileExact, quantileExactIf, quantileIf, relNode, sum, sumIf, table, uniqExactIf, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { rewriteRel } from '../src/rewrite-rel.js';
import { safeAggregate } from '../src/rewrite-expressions.js';

const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] } as const;
const t = table('t', { k: col.String, n: col.UInt32, big: col.UInt64, f: col.Float64, nn: col.Nullable(col.UInt32), s: col.String, d: col.Date, flag: col.Bool, nflag: col.Nullable(col.Bool), lc: col.LowCardinality(col.UInt32) }, meta);
const q = from(t);
const emitters = [compile, emitNaive] as const;

describe('SQL and parameters', () => {
  it('emits min, minIf, argMin and argMinIf by name', () => {
    const query = q.aggregate(g => ({ a: min(g.n), b: minIf(g.n, g.flag), c: argMin(g.s, g.n), e: argMinIf(g.s, g.n, g.flag) }));
    for (const emit of emitters) {
      const { sql } = emit(query.ir);
      expect(sql).toMatch(/\bmin\(`[^`]+`\.`n`\) AS `a`/);
      expect(sql).toMatch(/\bminIf\(`[^`]+`\.`n`, `[^`]+`\.`flag`\) AS `b`/);
      expect(sql).toMatch(/\bargMin\(`[^`]+`\.`s`, `[^`]+`\.`n`\) AS `c`/);
      expect(sql).toMatch(/\bargMinIf\(`[^`]+`\.`s`, `[^`]+`\.`n`, `[^`]+`\.`flag`\) AS `e`/);
    }
  });

  it('binds the quantileExact level as a Float64 parameter, numbered before its operands', () => {
    const query = q.aggregate(g => ({ a: quantileExact(0.5)(g.n), b: quantileExactIf(0.9)(val(8), g.flag), c: quantileExactIf(0)(g.big, g.n.gt(1)) }));
    for (const emit of emitters) {
      const { sql, params } = emit(query.ir);
      expect(sql).toMatch(/quantileExact\(\{p0:Float64\}\)\(`[^`]+`\.`n`\) AS `a`/);
      expect(sql).toMatch(/quantileExactIf\(\{p1:Float64\}\)\(\{p2:Float64\}, `[^`]+`\.`flag`\) AS `b`/);
      expect(sql).toMatch(/quantileExactIf\(\{p3:Float64\}\)\(`[^`]+`\.`big`, (?:greater\(`[^`]+`\.`n`, \{p4:UInt32\}\)|`[^`]+`\.`n` > \{p4:UInt32\})\) AS `c`/);
      expect(params).toEqual({ p0: '0.5', p1: '0.9', p2: '8', p3: '0', p4: '1' });
    }
  });

  it('reports the result descriptors in compiled columns', () => {
    const query = q.aggregate(g => ({ a: quantileExact(0.5)(g.big), b: quantileExact(0.5)(g.nn), c: min(g.lc), e: argMin(g.nn, g.d) }));
    for (const emit of emitters) expect(emit(query.ir).columns).toEqual({ a: col.UInt64.type, b: col.Nullable(col.UInt32).type, c: col.UInt32.type, e: col.Nullable(col.UInt32).type });
  });
});

describe('quantileExact resolution', () => {
  const root = q.aggregate(g => ({ x: quantileExact(0.5)(g.n) })).ir;
  const { id: _root, ...fields } = root;
  if (root.kind !== 'Aggregate' || root.aggs.x?.kind !== 'Agg') throw new Error('expected Aggregate');
  const { id: _agg, ...agg } = root.aggs.x;
  const check = (changes: Partial<typeof agg>, error: RegExp) => {
    const output = flatOutput([['x', changes.type ?? agg.type]]);
    for (const emit of emitters) expect(() => emit(relNode({ ...fields, output, columns: output.columns, aggs: { x: exprNode({ ...agg, ...changes }) } } as never))).toThrow(error);
  };

  it('rejects invalid levels in both emitters and accepts the bounds', () => {
    for (const level of [-1, 1.01, NaN, Infinity, -Infinity]) {
      for (const make of [(g: { n: never }) => quantileExact(level)(g.n), (g: { n: never; flag: never }) => quantileExactIf(level)(g.n, g.flag)]) {
        for (const emit of emitters) expect(() => emit(q.aggregate(make as never).ir)).toThrow(/invalid_quantile_level at root\.aggs/);
      }
    }
    for (const level of [0, 1]) for (const emit of emitters) expect(emit(q.aggregate(g => quantileExact(level)(g.n)).ir).params).toEqual({ p0: String(level) });
  });

  it('rejects forged parameters, arity, metadata, combinators and result types', () => {
    for (const params of [[], [val(0.5).ir, val(0.5).ir]]) check({ params }, /invalid_aggregate_parameters at root\.aggs\.x/);
    for (const level of [val('0.5').ir, val(0, col.UInt8).ir, q.row.n.ir]) check({ params: [level] }, /invalid_aggregate_parameter_type at root\.aggs\.x/);
    check({ args: [] }, /invalid_argument_arity at root\.aggs\.x/);
    check({ fn: { ...agg.fn, deterministic: false } }, /invalid_function_metadata at root\.aggs\.x/);
    check({ fn: { ...agg.fn, linear: true } }, /invalid_function_metadata at root\.aggs\.x/);
    check({ combinators: ['State'] }, /unsupported_aggregate_combinator at root\.aggs\.x/);
    check({ combinators: ['If', 'If'] }, /unsupported_aggregate_combinator at root\.aggs\.x/);
    check({ type: col.Float64.type }, /invalid_expression_type at root\.aggs\.x/);
    check({ args: [q.row.s.ir] }, /incompatible_operands at root\.aggs\.x/);
    check({ args: [q.row.lc.ir] }, /incompatible_operands at root\.aggs\.x/);
  });
});

describe('argMin resolution', () => {
  it('accepts the argMax version family and rejects the rest', () => {
    const versions = table('versions', { v: col.String, d: col.Date, d32: col.Date32, dt: col.DateTime(), dtz: col.DateTime('UTC'), ms: col.DateTime64(3), nanos: col.DateTime64(9), nd: col.Nullable(col.Date), num: col.Int64 }, meta);
    const source = from(versions);
    for (const emit of emitters) {
      expect(emit(source.aggregate(g => ({ a: argMin(g.v, g.d), b: argMin(g.v, g.d32), c: argMin(g.v, g.dt), e: argMin(g.v, g.dtz), f: argMin(g.v, g.ms), h: argMin(g.v, g.num) })).ir).sql).toContain('argMin(');
      expect(() => emit(source.aggregate(g => argMin(g.v, g.nanos as unknown as typeof g.num)).ir)).toThrow(/incompatible_operands/);
      expect(() => emit(source.aggregate(g => argMin(g.v, g.nd as unknown as typeof g.num)).ir)).toThrow(/incompatible_operands/);
      expect(() => emit(source.aggregate(g => argMin(g.d as unknown as typeof g.v, g.num)).ir)).toThrow(/incompatible_operands/);
    }
  });
});

describe('min in safeAggregate (A3)', () => {
  const shape = (query: { readonly ir: Parameters<typeof rewriteRel>[0] }) => compile(query.ir).sql;
  const rollup = from(table('rollup', { k: col.String, v: col.UInt64, nullable: col.Nullable(col.String), f: col.Float64 }, { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] }));

  it('pushes a key filter below min exactly as it does below max', () => {
    const build = (fn: typeof max) => rollup.groupBy(r => ({ key: r.k })).aggregate(g => ({ low: fn(g.v) })).where(r => r.key.eq('a'));
    const withMin = build(min as unknown as typeof max), withMax = build(max);
    expect(rewriteRel(withMin.ir).hits.PushFilterAggKey).toBe(1);
    expect(rewriteRel(withMax.ir).hits.PushFilterAggKey).toBe(1);
    expect(shape(withMin).replace('min(', 'max(')).toBe(shape(withMax));
    expect(emitNaive(withMin.ir).sql.replace('min(', 'max(')).toBe(emitNaive(withMax.ir).sql);
  });

  it('treats min operands like max operands', () => {
    const safe = (query: { readonly ir: unknown }) => safeAggregate(query.ir as never);
    const direct = rollup.groupBy(r => ({ key: r.k }));
    expect(safe(direct.aggregate(g => ({ low: min(g.v) })))).toBe(true);
    expect(safe(direct.aggregate(g => ({ low: min(g.k) })))).toBe(true);
    expect(safe(direct.aggregate(g => ({ low: min(g.nullable) })))).toBe(safe(direct.aggregate(g => ({ low: max(g.nullable) }))));
    expect(safe(direct.aggregate(g => ({ low: min(g.f) })))).toBe(safe(direct.aggregate(g => ({ low: max(g.f) }))));
    expect(safe(direct.aggregate(g => ({ low: min(g.v.plus(1n)) })))).toBe(safe(direct.aggregate(g => ({ low: max(g.v.plus(1n)) }))));
    expect(safe(direct.aggregate(g => ({ low: minIf(g.v, g.k.eq('a')) })))).toBe(false);
  });

  it('keeps argMin, quantileExact and the If forms out, like argMax and quantile', () => {
    const direct = rollup.groupBy(r => ({ key: r.k }));
    for (const query of [direct.aggregate(g => ({ x: argMin(g.k, g.v) })), direct.aggregate(g => ({ x: quantileExact(0.5)(g.v) })), direct.aggregate(g => ({ x: quantileExactIf(0.5)(g.v, g.k.eq('a')) }))]) {
      expect(safeAggregate(query.ir as never)).toBe(false);
      expect(rewriteRel(query.where(r => r.key.eq('a')).ir).hits.PushFilterAggKey ?? 0).toBe(0);
    }
  });
});

describe('nullable minIf/maxIf predicates (A4)', () => {
  const less = (param: string) => `(?:less\\(\`[^\`]+\`\\.\`nn\`, \\{${param}:UInt32\\}\\)|\`[^\`]+\`\\.\`nn\` < \\{${param}:UInt32\\})`;
  const wrapped = (name: string, operand: string, predicate: string) => new RegExp(`\\b${name}\\(\`[^\`]+\`\\.\`${operand}\`, ifNull\\(${predicate}, false\\)\\)`);

  it('wraps a computed nullable predicate in both emitters', () => {
    const query = q.aggregate(g => ({ a: maxIf(g.n, g.nn.lt(10)), b: minIf(g.n, g.nn.lt(10)) }));
    for (const emit of emitters) {
      const { sql, params } = emit(query.ir);
      expect(sql).toMatch(wrapped('maxIf', 'n', less('p0')));
      expect(sql).toMatch(wrapped('minIf', 'n', less('p1')));
      expect(params).toEqual({ p0: '10', p1: '10' });
    }
  });

  it('wraps stored nullable predicates, nullable parameters and null-extended join columns', () => {
    const right = from(table('r', { id: col.UInt32, ok: col.Bool }, meta));
    const joined = leftJoin({ a: q }, { b: right }).on(r => r.a.n.eq(r.b.id));
    for (const emit of emitters) {
      expect(emit(q.aggregate(g => maxIf(g.n, g.nflag)).ir).sql).toMatch(wrapped('maxIf', 'n', '`[^`]+`\\.`nflag`'));
      expect(emit(q.aggregate(g => minIf(g.n, val(null, col.Nullable(col.Bool)))).ir).sql).toContain('ifNull(CAST(NULL AS Nullable(Bool)), false)');
      expect(emit(joined.aggregate(g => ({ x: maxIf(g.a.n, g.b.ok) })).ir).sql).toMatch(/maxIf\(`[^`]+`\.`[^`]+`, ifNull\(`[^`]+`\.`[^`]+`, false\)\) AS `x`/);
    }
  });

  it('wraps only the predicate of a nullable value', () => {
    for (const emit of emitters) {
      expect(emit(q.aggregate(g => minIf(g.nn, g.nn.lt(10))).ir).sql).toMatch(wrapped('minIf', 'nn', less('p0')));
      expect(emit(q.aggregate(g => minIf(g.nn, g.flag)).ir).sql).not.toContain('ifNull');
    }
  });

  it('keeps the exact SQL of non-nullable predicates', () => {
    for (const emit of emitters) {
      for (const query of [q.aggregate(g => maxIf(g.n, g.flag)), q.aggregate(g => minIf(g.n, g.n.lt(10))), q.aggregate(g => minIf(g.n, val(true)))]) expect(emit(query.ir).sql).not.toContain('ifNull');
    }
  });

  it('leaves every other conditional aggregate unchanged', () => {
    const query = q.aggregate(g => ({ a: countIf(g.nflag), b: sumIf(g.n, g.nflag), c: avgIf(g.n, g.nflag), e: argMaxIf(g.n, g.n, g.nflag), f: argMinIf(g.n, g.n, g.nflag), h: quantileIf(0.5)(g.n, g.nflag), i: quantileExactIf(0.5)(g.n, g.nflag), j: uniqExactIf(g.s, g.nflag), total: sum(g.n), rows: count() }));
    for (const emit of emitters) expect(emit(query.ir).sql).not.toContain('ifNull');
  });
});
