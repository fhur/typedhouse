import { expect, it } from 'vitest';
import { col, dateDiff, multiIf, now, val, type ExprNode } from '@chql/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import { components } from './fixtures/corpus/low-stock.js';
import { projectionEnrichment } from './fixtures/corpus/projection-enrichment.js';

it('compiles the complete projection with closed heterogeneous parameters and volatile clock', () => {
  expect(projectionEnrichment.caps.live).toBe(false);
  expect(now().ir).toMatchObject({ kind: 'Call', type: { kind: 'DateTime' }, fn: { deterministic: false, origin: 'typed' }, args: [] });
  for (const emit of [compile, emitNaive]) {
    const plan = emit(projectionEnrichment.ir);
    expect(plan.columns).toMatchObject({ age: col.Int64.type, matched: col.UInt64.type, category: col.String.type, tier: col.String.type, source: col.String.type, firstDesc: col.Nullable(col.String).type, mpns: col.Array(col.Nullable(col.String)).type });
    expect(plan.sql.match(/now\(\)/g)).toHaveLength(1);
    expect(plan.sql).toMatch(/dateDiff\(\{p\d+:String\}, .*now\(\), \{p\d+:String\}\)/);
    expect(Object.values(plan.params)).toEqual(expect.arrayContaining(['day', 'UTC', 'none', 'few', 'many']));
    expect(plan.sql).toContain('multiIf(');
    // Filtering a computed volatile field must retain a boundary, not duplicate now().
    const filtered = emit(projectionEnrichment.where(r => r.age.gt(0n)).ir);
    expect(filtered.sql.match(/now\(\)/g)).toHaveLength(1);
  }
});

it('checks authoritative arity, unit, timezone, branches, metadata, bindings and output', () => {
  const q = components.map(c => ({ age: dateDiff('day', c.updatedAt, now()), tier: multiIf([c.countOfParts.eq(0n), 'none'], 'many') }));
  if (q.ir.kind !== 'Project' || q.ir.exprs.age?.kind !== 'Call' || q.ir.exprs.tier?.kind !== 'Call') throw new Error('expected calls');
  const rel = q.ir, age = q.ir.exprs.age, tier = q.ir.exprs.tier;
  const replace = (args: readonly ExprNode[], i: number, node: ExprNode) => args.map((a, j) => j === i ? node : a);
  const cases: [string, ExprNode, string][] = [
    ['age', { ...age, args: age.args.slice(0, 3) }, 'invalid_argument_arity'],
    ['age', { ...age, args: replace(age.args, 0, val('hour').ir) }, 'incompatible_operands'],
    ['age', { ...age, args: replace(age.args, 3, val('America/Los_Angeles').ir) }, 'incompatible_operands'],
    ['age', { ...age, args: replace(age.args, 1, val('not date').ir) }, 'incompatible_operands'],
    ['age', { ...age, type: col.Float64.type }, 'invalid_expression_type'],
    ['age', { ...age, fn: { ...age.fn, deterministic: false } }, 'invalid_function_metadata'],
    ['age', { ...age, fn: { ...age.fn, origin: 'user' } }, 'unsupported_expression'],
    ['age', { ...age, fn: { ...age.fn, argumentPolicies: ['sibling'] } }, 'invalid_function_metadata'],
    ['tier', { ...tier, args: tier.args.slice(0, 2) }, 'invalid_argument_arity'],
    ['tier', { ...tier, args: replace(tier.args, 1, val(1n).ir) }, 'incompatible_operands'],
    ['tier', { ...tier, args: replace(tier.args, 2, val(null, col.Nullable(col.String)).ir) }, 'incompatible_operands'],
    ['tier', { ...tier, args: replace(tier.args, 0, val('true').ir) }, 'incompatible_operands'],
    ['tier', { ...tier, fn: { ...tier.fn, repeatedArgs: 'temporalGreatest' } }, 'invalid_function_metadata'],
  ];
  const start = age.args[1]!;
  if (start.kind !== 'ColumnRef') throw new Error('expected column');
  cases.push(['age', { ...age, args: replace(age.args, 1, { ...start, rel: age.id }) }, 'unbound_column']);
  cases.push(['age', { ...age, args: replace(age.args, 1, { ...start, mode: 'grouped' }) }, 'invalid_expression_mode']);
  for (const emit of [compile, emitNaive]) for (const [key, expr, code] of cases) {
    const columns = { ...rel.columns, [key]: expr.type! };
    try { emit({ ...rel, columns, output: { ...rel.output, columns }, exprs: { ...rel.exprs, [key]: expr } }); throw new Error('accepted forgery'); }
    catch (e) { expect(e).toBeInstanceOf(ValidationError); expect(String(e)).toContain(code); expect(String(e)).toContain(`exprs.${key}`); }
  }
});

it('leaves DateTime parameters unsupported and existing UTC wire conversion intact', () => {
  for (const emit of [compile, emitNaive]) {
    expect(() => emit(components.map(() => ({ at: val(new Date(0), col.DateTime()) })).ir)).toThrow('param_incompatible');
    const query = components.map(() => ({ age: dateDiff('day', val(new Date(0), col.DateTime64(3, 'Europe/Amsterdam')), now()) }));
    expect(emit(query.ir).sql).toContain("CAST({p1:DateTime64(3, 'UTC')} AS DateTime64(3, 'Europe/Amsterdam'))");
  }
});
