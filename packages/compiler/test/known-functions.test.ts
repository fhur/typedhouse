import { expect, it } from 'vitest';
import { col, createKnownFunctions, from, table, val, type ExprNode, type Rel } from '@chql/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
const catalog = {
  cityHash64: { isAggregate: false, deterministic: true, aliasTo: '' },
  uniqExact: { isAggregate: true, deterministic: null, aliasTo: '' },
  plus: { isAggregate: false, deterministic: true, aliasTo: 'add' },
  toStartOfWeek: { isAggregate: false, deterministic: null, aliasTo: '' },
  between: { isAggregate: false, deterministic: true, aliasTo: '' },
  in: { isAggregate: false, deterministic: true, aliasTo: '' },
} as const;
const { fn, agg } = createKnownFunctions(catalog);
const q = from(table('items', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('emits ordinary declared scalar and aggregate calls without CAST', () => {
  for (const emit of [compile, emitNaive]) {
    const scalar = emit(q.map(r => ({ h: fn.cityHash64(r.id).as(col.UInt64) })).ir);
    expect(scalar.sql).toContain('cityHash64(');
    expect(scalar.sql).not.toContain('CAST');
    expect(scalar.columns).toEqual({ h: col.UInt64.type });
    const aggregate = emit(q.aggregate(g => ({ h: fn.cityHash64(agg.uniqExact(g.id).as(col.UInt64)).as(col.UInt64) })).ir);
    expect(aggregate.sql).toContain('cityHash64(uniqExact(');
    expect(aggregate.sql).not.toContain('CAST');
    const calls = emit(q.map(() => ({ n: fn.plus(val(1n), val(2n)).as(col.Int64), w: fn.toStartOfWeek().as(col.Date), b: fn.between().as(col.Bool), i: fn.in().as(col.Bool) })).ir);
    expect(calls.sql).toContain('plus(');
    expect(calls.sql).toContain('toStartOfWeek()');
    expect(calls.sql).toContain('between()');
    expect(calls.sql).toContain('in()');
    expect(calls.sql).not.toContain('add(');
    expect(calls.sql).not.toContain('throwIf');
  }
});
it('requires explicit declarations even when result type is forged', () => {
  const undeclared = q.map(r => ({ h: fn.cityHash64(r.id) }));
  for (const emit of [compile, emitNaive]) expect(() => emit(undeclared.ir)).toThrow('known_result_undeclared');
  const query = q.map(r => ({ h: fn.cityHash64(r.id).as(col.UInt64) }));
  if (query.ir.kind !== 'Project' || query.ir.exprs.h?.kind !== 'Call') throw new Error('expected call');
  const rel = query.ir, call = query.ir.exprs.h;
  const cases: ExprNode[] = [
    { ...call, fn: { ...call.fn, name: 'absent' } },
    { ...call, fn: { ...call.fn, origin: 'typed' } },
    { ...call, fn: { ...call.fn, deterministic: false } },
    { ...call, fn: { ...call.fn, sqlName: 'evil' } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known!, declaration: { origin: 'as', type: col.String.type } } } },
    { ...call, fn: { ...call.fn, known: { catalog, name: 'cityHash64' } } },
  ];
  for (const emit of [compile, emitNaive]) for (const expr of cases) {
    try { emit({ ...rel, exprs: { h: expr } }); throw new Error('accepted forgery'); }
    catch (error) { expect(error).toBeInstanceOf(ValidationError); expect(String(error)).toContain('root.exprs.h'); }
  }
});
it('rejects malformed evidence, mode/binding violations and nested aggregates with node paths', () => {
  const query = q.map(r => ({ h: fn.cityHash64(r.id).as(col.UInt64) }));
  if (query.ir.kind !== 'Project' || query.ir.exprs.h?.kind !== 'Call') throw new Error('expected call');
  const call = query.ir.exprs.h;
  const invalid: unknown[] = [
    { ...call, fn: { ...call.fn, known: undefined } },
    { ...call, fn: { ...call.fn, known: { catalog: {}, name: 'cityHash64' } } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known, catalog: null } } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known, catalog: { cityHash64: null } } } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known, catalog: { cityHash64: { isAggregate: 'false', deterministic: true, aliasTo: '' } } } } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known, catalog: { cityHash64: { isAggregate: true, deterministic: true, aliasTo: '' } } } } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known, catalog: { cityHash64: { isAggregate: false, deterministic: true, aliasTo: 'bad()' } } } } },
    { ...call, fn: { ...call.fn, known: { ...call.fn.known, declaration: { origin: 'as', type: null } } } },
    { ...call, args: [{ ...call.args[0], mode: 'grouped' }] },
    { ...call, args: [{ ...call.args[0], rel: -1 }] },
    { ...call, args: [agg.uniqExact().as(col.UInt64).ir] },
  ];
  const aggregate = q.aggregate(g => ({ n: agg.uniqExact(g.id).as(col.UInt64) })).ir;
  const node = aggregate.aggs.n;
  if (node?.kind !== 'Agg') throw new Error('expected aggregate');
  const rels = invalid.map(h => ({ ...query.ir, exprs: { h } } as Rel));
  rels.push({ ...aggregate, aggs: { n: { ...node, args: [node] } } });
  rels.push({ ...aggregate, aggs: { n: { ...node, fn: { ...node.fn, linear: true } } } });
  rels.push({ ...aggregate, aggs: { n: { ...node, combinators: ['State'] } } });
  for (const emit of [compile, emitNaive]) for (const rel of rels) {
    try { emit(rel); throw new Error('accepted malformed IR'); }
    catch (error) { expect(error).toBeInstanceOf(ValidationError); expect(String(error)).toMatch(/root\.(exprs\.h|aggs\.n)/); }
  }
});
it('snapshots catalog evidence and treats null determinism conservatively', () => {
  const source = { hash: { isAggregate: false as const, deterministic: null, aliasTo: '' } };
  const generated = createKnownFunctions(source);
  source.hash.aliasTo = 'changed';
  const expr = generated.fn.hash(val('x'));
  if (expr.ir.kind !== 'Call') throw new Error('expected call');
  expect(expr.ir.fn.deterministic).toBe(false);
  expect(expr.ir.fn.known?.catalog.hash?.aliasTo).toBe('');
  expect(Object.isFrozen(expr.ir.fn.known?.catalog.hash)).toBe(true);
});
it('rejects unsafe names independently of JavaScript property safety and unsupported results', () => {
  const hostile = createKnownFunctions({ ['bad); SELECT 1']: { isAggregate: false, deterministic: true, aliasTo: '' } });
  for (const emit of [compile, emitNaive]) {
    expect(() => emit(q.map(() => ({ h: hostile.fn['bad); SELECT 1']().as(col.UInt64) })).ir)).toThrow('invalid_function_name');
    // Deliberately bypass the public descriptor gate to exercise compiler validation.
    expect(() => emit(q.map(r => ({ h: (fn.cityHash64(r.id) as import('@chql/core').Expr<unknown, 'id'>).as(col.JSON) })).ir)).toThrow('unsupported_known_result');
  }
});
