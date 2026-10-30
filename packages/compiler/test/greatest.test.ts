import { expect, it } from 'vitest';
import { col, from, greatest, max, table, val, type ExprNode } from '@chql/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import { componentsLatest } from './fixtures/corpus/components-latest.js';
const q = from(table('dates', { a: col.DateTime64(1, 'Europe/Amsterdam'), b: col.DateTime64(3, 'Europe/Amsterdam'), c: col.DateTime64(2, 'Europe/Amsterdam') }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
it('retains names, precision, deterministic metadata, same modes and composition', () => {
  for (const emit of [compile, emitNaive]) {
    expect(emit(q.map(r => greatest(r.a, r.b, r.c)).ir).columns).toEqual({ a: col.DateTime64(3, 'Europe/Amsterdam').type });
    expect(emit(q.aggregate(g => ({ a: greatest(max(g.a), max(g.b)), b: max(greatest(g.a, g.b)) })).ir).columns).toEqual({ a: col.DateTime64(3, 'Europe/Amsterdam').type, b: col.DateTime64(3, 'Europe/Amsterdam').type });
    const compiled = emit(componentsLatest.map(r => ({ ...r })).where(r => r.asOf.gt(new Date('2026-01-01'))).orderBy(r => r.asOf).ir);
    expect(compiled.columns).toEqual({ entityId: col.String.type, category: col.Nullable(col.String).type, stockTotal: col.Float64.type, stockP50: col.Float64.type, leadDays: col.Float64.type, stockIndex: col.Float64.type, asOf: col.DateTime64(3).type });
  }
});
it('restores parameter descriptor after parsing UTC while retaining identity and precision', () => {
  const shared = val(new Date('2026-03-29T01:00:00.123Z'), col.DateTime64(3, 'Europe/Amsterdam'));
  for (const emit of [compile, emitNaive]) {
    const compiled = emit(q.map(r => ({ at: greatest(r.a, shared, shared) })).ir);
    expect(compiled.sql.match(/CAST\(\{p0:DateTime64\(3, 'UTC'\)\} AS DateTime64\(3, 'Europe\/Amsterdam'\)\)/g)).toHaveLength(2);
    expect(compiled.params).toEqual({ p0: '2026-03-29 01:00:00.123' });
    expect(compiled.parameterTypes).toEqual({ p0: col.DateTime64(3, 'UTC').type });
  }
});
it('rejects every forged operand and metadata/arity failure with a node path', () => {
  const query = q.map(r => ({ at: greatest(r.a, r.b, r.c) }));
  if (query.ir.kind !== 'Project' || query.ir.exprs.at?.kind !== 'Call') throw new Error('expected call');
  const rel = query.ir, call = query.ir.exprs.at;
  const { repeatedArgs: _policy, ...withoutPolicy } = call.fn;
  const param = (type: ExprNode['type']): ExprNode => ({ id: call.id, kind: 'Param', value: new Date(), type });
  const cases: [ExprNode, string][] = [
    [{ ...call, args: [] }, 'invalid_argument_arity'],
    [{ ...call, args: call.args.slice(0, 1) }, 'invalid_argument_arity'],
    [{ ...call, args: [...call.args, param(col.String.type)] }, 'incompatible_operands'],
    [{ ...call, args: [...call.args, param(col.Float64.type)] }, 'incompatible_operands'],
    [{ ...call, args: [...call.args, param(col.Nullable(col.DateTime64(3)).type)] }, 'incompatible_operands'],
    [{ ...call, args: [...call.args, param(col.DateTime64(9).type)] }, 'incompatible_operands'],
    [{ ...call, args: [...call.args, param(null)] }, 'incompatible_operands'],
    [{ ...call, args: [...call.args, param(col.DateTime64(3, 'UTC').type)] }, 'unsupported_mixed_timezones'],
    [{ ...call, fn: { ...call.fn, deterministic: false } }, 'invalid_function_metadata'],
    [{ ...call, fn: { ...call.fn, origin: 'user' } }, 'duplicate_function'],
    [{ ...call, fn: withoutPolicy }, 'invalid_function_metadata'],
    [{ ...call, fn: { ...call.fn, argumentPolicies: ['sibling'] } }, 'invalid_function_metadata'],
    [{ ...call, type: col.DateTime64(1, 'Europe/Amsterdam').type }, 'invalid_expression_type'],
    [{ ...call, type: col.DateTime64(3, 'UTC').type }, 'invalid_expression_type'],
    [{ ...call, args: call.args.map((arg, i) => i === 2 && arg.kind === 'ColumnRef' ? { ...arg, mode: 'grouped' } : arg) }, 'invalid_expression_mode'],
    [{ ...call, args: call.args.map((arg, i) => i === 2 && arg.kind === 'ColumnRef' ? { ...arg, rel: call.id } : arg) }, 'unbound_column'],
  ];
  for (const emit of [compile, emitNaive]) for (const [expr, code] of cases) {
    try { const columns = { at: expr.type ?? call.type }; emit({ ...rel, columns, output: { ...rel.output, columns }, exprs: { at: expr } }); throw new Error('accepted forged call'); }
    catch (error) { expect(error).toBeInstanceOf(ValidationError); expect(String(error)).toContain(code); expect(String(error)).toContain('exprs.at'); }
  }
});
it('does not grant variadic permission to unrelated catalog entries', () => {
  const query = q.map(r => ({ a: r.a.eq(r.b) }));
  if (query.ir.kind !== 'Project' || query.ir.exprs.a?.kind !== 'Call') throw new Error('expected call');
  const rel = query.ir, call = query.ir.exprs.a;
  for (const emit of [compile, emitNaive]) expect(() => emit({ ...rel, exprs: { a: { ...call, fn: { ...call.fn, repeatedArgs: 'temporalGreatest' }, args: [...call.args, call.args[0]!] } } })).toThrow('invalid_function_metadata');
});
