import { expect, it } from 'vitest';
import { col, from, table, val } from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';
import { safePredicate } from '../src/rewrite-expressions.js';

const q = from(table('ranges', { n: col.Float64, s: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('rejects forged BETWEEN arity, policy and determinism before emission', () => {
  const query = q.where(r => r.n.between(1, 2));
  if (query.ir.kind !== 'Filter' || query.ir.pred.kind !== 'Call') throw new Error('expected range filter');
  const rel = query.ir, pred = query.ir.pred;
  expect(safePredicate(pred)).toBe(false);
  for (const emit of [compile, emitNaive]) {
    expect(() => emit({ ...rel, pred: { ...pred, args: pred.args.slice(0, 2) } })).toThrow('invalid_argument_arity');
    expect(() => emit({ ...rel, pred: { ...pred, fn: { ...pred.fn, deterministic: false } } })).toThrow('invalid_function_metadata');
    expect(() => emit({ ...rel, pred: { ...pred, fn: { ...pred.fn, argumentPolicies: ['sibling', 'set', 'sibling'] } } })).toThrow('invalid_function_metadata');
  }
});
it('keeps text-order parameter identity inside composed range expressions', () => {
  const shared = val(2, col.Float64);
  const query = q.map(r => ({ flag: r.n.plus(shared).between(r.n.minus(1), shared), text: r.s.between("a' OR 1=1 --", 'z') }));
  for (const emit of [compile, emitNaive]) {
    const result = emit(query.ir);
    expect(result.params).toEqual({ p0: '2', p1: '1', p2: "a' OR 1=1 --", p3: 'z' });
    expect([...result.sql.matchAll(/\{(p\d+):/g)].map(m => m[1])).toEqual(['p0', 'p1', 'p0', 'p2', 'p3']);
    expect(result.sql).not.toContain("a' OR");
    expect(result.columns).toEqual({ flag: col.Bool.type, text: col.Bool.type });
  }
});
