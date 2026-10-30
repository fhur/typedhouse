import { describe, expect, it } from 'vitest';
import { col, count, defineFunction, defineAggregate, deterministic, Expr, from, numeric, print, stringLike, table, val, type ExprNode, type Rel } from '@chql/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import { safePredicate } from '../src/rewrite-expressions.js';
const source = from(table('parts', { mpn: col.String, nullable: col.Nullable(col.String), n: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const distance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
const repeat = defineFunction({ name: 'repeat', args: [col.String, col.UInt64], returns: col.String, deterministic: true });
const identity = defineFunction({ name: 'identity', args: [col.String], returns: col.String, deterministic: true });
const call = distance(source.row.mpn, 'abc').ir as Extract<ExprNode, { kind: 'Call' }>;
function project(e: unknown): Rel {
  const q = source.map(r => ({ distance: distance(r.mpn, 'abc') })).ir as Extract<Rel, { kind: 'Project' }>;
  return { ...q, exprs: { distance: e } } as Rel;
}
function reject(e: unknown, code: string) {
  for (const emit of [compile, emitNaive]) {
    try { emit(project(e)); throw new Error('accepted invalid graph'); }
    catch (error) { expect(error).toBeInstanceOf(ValidationError); expect(String(error)).toContain(code); expect(String(error)).toContain('root'); }
  }
}
describe('owned, registration-free user contracts', () => {
  it('emits the exact example with concrete UInt64 output and no CAST', () => {
    const q = source.map(p => ({ mpn: p.mpn, distance: distance(p.mpn, 'GRM155R61A104KA01D') }));
    for (const emit of [compile, emitNaive]) {
      const plan = emit(q.ir);
      expect(plan.columns).toEqual({ mpn: col.String.type, distance: col.UInt64.type });
      expect(plan.params).toEqual({ p0: 'GRM155R61A104KA01D' });
      expect(plan.sql).toContain('editDistance('); expect(plan.sql).not.toContain('CAST');
    }
  });
  it('owns frozen plain evidence without callbacks and captures mutable descriptors at definition', () => {
    const returns = { type: { kind: 'scalar' as const, name: 'UInt64' as const } };
    const fn = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns, deterministic: true });
    const before = fn('a', 'b').ir;
    Object.assign(returns.type, { name: 'String' });
    expect(fn('a', 'b').ir.type).toEqual(col.UInt64.type);
    function plain(v: unknown) {
      expect(typeof v).not.toBe('function');
      if (!v || typeof v !== 'object') return;
      expect(Object.isFrozen(v)).toBe(true);
      expect(Object.getPrototypeOf(v)).toBe(Array.isArray(v) ? Array.prototype : Object.prototype);
      Object.values(v).forEach(plain);
    }
    if (before.kind !== 'Call') throw new Error('expected call');
    plain(before.fn.user);
    expect(before.fn.user).toEqual({ version: 1, classification: 'scalar', name: 'editDistance', args: [{ kind: 'stringLike' }, { kind: 'stringLike' }], returns: col.UInt64.type, nullable: 'propagate', deterministic: true });
  });
  it('uses per-position contracts and first-appearance parameter identity, including nested calls', () => {
    const shared = val('x', col.String);
    const q = source.map(r => ({ a: repeat(identity(r.mpn), 3n), b: distance(shared, shared) }));
    for (const emit of [compile, emitNaive]) {
      const plan = emit(q.ir);
      expect(plan.params).toEqual({ p0: '3', p1: 'x' });
      expect(plan.parameterTypes).toEqual({ p0: col.UInt64.type, p1: col.String.type });
      expect(plan.sql.match(/\{p1:String\}/g)).toHaveLength(2);
      expect(plan.sql).toContain('repeat(identity(');
    }
  });
  it('propagates Nullable(String) and constants, keeps name/mode, and never adds capabilities', () => {
    expect(distance(source.row.nullable, 'a').ir.type).toEqual(col.Nullable(col.UInt64).type);
    expect(distance(val(null), 'a').ir.type).toEqual(col.Nullable(col.UInt64).type);
    expect(distance('a', 'b').name).toBe('editDistance');
    expect(distance(val('a'), source.row.mpn).name).toBe('mpn');
    expect(source.map(r => distance(r.mpn, 'a')).caps.live).toBe(false);
    const volatile = defineFunction({ name: 'randomString', args: [], returns: col.String, deterministic: false });
    expect(deterministic(distance(volatile(), 'a').ir)).toBe(false);
    expect(deterministic(call)).toBe(true);
    expect(safePredicate(defineFunction({ name: 'customPredicate', args: [col.String], returns: col.Bool, deterministic: true })(source.row.mpn).ir)).toBe(false);
    for (const emit of [compile, emitNaive]) expect(emit(source.map(r => distance(r.nullable, 'a')).ir).columns.nullable).toEqual(col.Nullable(col.UInt64).type);
  });
  it('does not reserve every known server function, and emits safe explicit SQL names as ordinary calls', () => {
    const f = defineFunction({ name: 'applicationDistance', sqlName: 'editDistance', args: [col.String, col.String], returns: col.UInt64, deterministic: true });
    expect(compile(source.map(r => f(r.mpn, 'a')).ir).sql).toContain('editDistance(');
    const version = defineFunction({ name: 'version', args: [], returns: col.String, deterministic: true });
    expect(compile(source.map(() => version()).ir).sql).toContain('version()');
  });
  it('retains callback, arg0 and custom matcher construction but refuses execution', () => {
    for (const fn of [
      defineFunction({ name: 'custom', args: [stringLike], returns: () => col.UInt64.type, tsReturns: 'bigint', deterministic: true }),
      defineFunction({ name: 'custom', args: [stringLike], returns: 'arg0', deterministic: true }),
      defineFunction({ name: 'custom', args: [{ ...stringLike, kind: 'stringLike' }], returns: col.UInt64, deterministic: true }),
      defineFunction({ name: 'custom', args: [numeric], returns: col.UInt64, deterministic: true }),
      defineFunction({ name: 'custom', args: [{ match: () => true, type: col.String.type }], returns: col.UInt64, deterministic: true }),
    ]) {
      const e = (fn as (...args: unknown[]) => Expr<unknown, string>)('x');
      expect(e).toBeInstanceOf(Expr);
      const q = source.map(() => ({ value: e }));
      for (const emit of [compile, emitNaive]) expect(() => emit(q.ir)).toThrow('unsupported_user_function');
    }
  });
  it.each([col.FixedString(3), col.Enum8({ abc: 1 }), col.LowCardinality(col.String), col.LowCardinality(col.Nullable(col.String)), col.Nullable(col.LowCardinality(col.String))])('rejects unsupported stringLike descriptors %j', descriptor => {
    const s = from(table('unsupported', { x: descriptor }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
    for (const emit of [compile, emitNaive]) expect(() => emit(s.map(r => distance(r.x, 'abc')).ir)).toThrow('unsupported_user_argument');
  });
  it.each(['editDistance);DROP', 'a.b', 'a b', '`editDistance`', 'a\0b'])('rejects hostile SQL names %s', name => {
    reject({ ...call, fn: { ...call.fn, name, user: { ...call.fn.user, name } } }, 'invalid_function_name');
    reject({ ...call, fn: { ...call.fn, sqlName: name, user: { ...call.fn.user, sqlName: name } } }, 'invalid_function_name');
  });
  it.each(['eq', 'equals', 'sum', 'sumIf', 'countIf', 'dateDiff', 'greatest'])('rejects actual typed names/SQL aliases %s', name => {
    reject({ ...call, fn: { ...call.fn, name, user: { ...call.fn.user, name } } }, 'duplicate_function');
  });
  it('rejects missing/malformed/mixed evidence, false result and metadata claims', () => {
    const { user: _user, ...fn } = call.fn;
    reject({ ...call, fn }, 'unsupported_user_function');
    for (const user of [null, {}, { ...call.fn.user, args: null }, { ...call.fn.user, version: 2 }, { ...call.fn.user, nullable: 'sometimes' }, { ...call.fn.user, returns: { kind: 'Nullable' } }]) reject({ ...call, fn: { ...call.fn, user } }, 'invalid_structure');
    reject({ ...call, fn: { ...call.fn, deterministic: false } }, 'invalid_user_contract');
    reject({ ...call, fn: { ...call.fn, user: { ...call.fn.user, name: 'other' } } }, 'invalid_user_contract');
    reject({ ...call, fn: { ...call.fn, known: { name: 'editDistance', catalog: {} } } }, 'invalid_function_metadata');
    reject({ ...call, fn: { ...call.fn, origin: 'typed' } }, 'invalid_function_metadata');
    reject({ ...call, fn: { ...call.fn, origin: 'known' } }, 'invalid_function_metadata');
    reject({ ...call, fn: { ...call.fn, argumentPolicies: [] } }, 'invalid_function_metadata');
    reject({ ...call, fn: { ...call.fn, user: { ...call.fn.user, returns: col.String.type } } }, 'invalid_expression_type');
    reject({ ...call, fn: { ...call.fn, user: { ...call.fn.user, returns: col.LowCardinality(col.UInt64).type } } }, 'unsupported_user_result');
    reject({ ...call, args: call.args.slice(0, 1) }, 'invalid_argument_arity');
    reject({ ...call, args: [...call.args, call.args[0]] }, 'invalid_argument_arity');
    reject({ ...call, args: [source.row.n.ir, call.args[1]] }, 'unsupported_user_argument');
    reject({ ...call, args: [source.row.nullable.ir, call.args[1]] }, 'invalid_expression_type');
    reject({ ...call, args: [{ ...call.args[0], rel: 1234567 }, call.args[1]] }, 'unbound_column');
    reject({ ...call, args: [{ ...call.args[0], mode: 'grouped' }, call.args[1]] }, 'invalid_expression_mode');
  });
  it('allows constants before aggregate calls without permitting grouped escapes', () => {
    const q = source.aggregate(() => repeat('x', count()));
    for (const emit of [compile, emitNaive]) expect(emit(q.ir).sql).toContain('repeat({p0:String}, count())');
  });
  it('refuses unsupported concrete contracts, forged contract callbacks and wrong numeric parameters', () => {
    const f = defineFunction({ name: 'identity', args: [col.LowCardinality(col.String)], returns: col.String, deterministic: true });
    expect(() => compile(source.map(r => f(r.mpn)).ir)).toThrow('unsupported_user_function');
    const e = repeat(source.row.mpn, 2n).ir as Extract<ExprNode, { kind: 'Call' }>;
    const q = source.map(r => ({ x: repeat(r.mpn, 2n) })).ir as Extract<Rel, { kind: 'Project' }>;
    for (const emit of [compile, emitNaive]) expect(() => emit({ ...q, exprs: { x: { ...e, args: [e.args[0]!, { ...e.args[1]!, value: 2 } as ExprNode] } } })).toThrow('param_incompatible');
    reject({ ...call, fn: { ...call.fn, user: { ...call.fn.user, match: () => true } } }, 'invalid_structure');
    reject({ ...call, fn: { ...call.fn, user: { ...call.fn.user, args: [{ kind: 'stringLike', match: () => true }, { kind: 'stringLike' }] } } }, 'invalid_structure');
    reject({ ...call, fn: { ...call.fn, user: { ...call.fn.user, args: [{ kind: 'column', type: col.LowCardinality(col.String).type }, { kind: 'stringLike' }] } } }, 'unsupported_user_argument');
  });
  it('rejects user aggregates without relying on their claimed result', () => {
    const agg = defineAggregate({ name: 'customAggregate', args: [stringLike], returns: col.UInt64, deterministic: true, linear: false });
    expect(() => compile(source.aggregate(g => agg(g.mpn)).ir)).toThrow('unsupported_user_aggregate');
  });
  it('retains ordinary SQL nullability evidence for nullable returns and never propagation', () => {
    const f = defineFunction({ name: 'custom', args: [stringLike], returns: col.Nullable(col.UInt64), nullable: 'never', deterministic: true });
    expect(print(f(source.row.mpn).ir.type!)).toBe('Nullable(UInt64)');
    const never = defineFunction({ name: 'custom', args: [stringLike], returns: col.UInt64, nullable: 'never', deterministic: true });
    expect(compile(source.map(r => never(r.nullable)).ir).columns.nullable).toEqual(col.UInt64.type);
  });
});
