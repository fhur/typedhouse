import { expect, it } from 'vitest';
import { col, from, greatest, table, val } from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';

const q = from(table('review', { a: col.DateTime64(0), b: col.DateTime64(3) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));

it('review: restored timezone syntax escapes quotes, slashes and controls inside wrappers', () => {
  const zone = "UTC'); SELECT 42 --\\\n";
  const type = col.Array(col.Nullable(col.DateTime64(3, zone)));
  const shared = val([new Date(-877), null], type);
  for (const emit of [compile, emitNaive]) {
    const result = emit(q.map(() => ({ x: shared, y: shared })).ir);
    const expected = "CAST({p0:Array(Nullable(DateTime64(3, 'UTC')))} AS Array(Nullable(DateTime64(3, 'UTC\\'); SELECT 42 --\\\\\\n'))))";
    expect(result.sql.split(expected)).toHaveLength(3);
    expect(result.params).toEqual({ p0: "['1969-12-31 23:59:59.123',NULL]" });
    expect(result.columns.x).toEqual(type.type);
  }
});

it('review: fixed arity and SQL name authority survive the standalone variadic catalog', () => {
  const fixed = q.map(r => ({ x: r.a.eq(r.b) })).ir;
  const variable = q.map(r => ({ x: greatest(r.a, r.b) })).ir;
  if (fixed.kind !== 'Project' || variable.kind !== 'Project' || fixed.exprs.x?.kind !== 'Call' || variable.exprs.x?.kind !== 'Call') throw new Error('expected project/call');
  const call = fixed.exprs.x;
  const greatestCall = variable.exprs.x;
  for (const emit of [compile, emitNaive]) {
    for (const args of [[], [call.args[0]!], [...call.args, call.args[0]!]]) {
      expect(() => emit({ ...fixed, exprs: { x: { ...call, args } } })).toThrow('invalid_argument_arity');
    }
    try {
      emit({ ...variable, exprs: { x: { ...greatestCall, fn: { ...greatestCall.fn, sqlName: 'greatest); SELECT 42 --' } } } });
      throw new Error('accepted forged SQL name');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(String(error)).toContain('invalid_function_metadata');
      expect(String(error)).toContain('exprs.x');
    }
  }
});
