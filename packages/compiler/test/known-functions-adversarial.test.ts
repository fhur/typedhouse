import { expect, it } from 'vitest';
import { col, createKnownFunctions, from, join, table, val, type Rel } from '@typedhouse/core';
import { decoder } from '@typedhouse/client';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import { conjuncts, safePredicate, safeAggregate } from '../src/rewrite-expressions.js';

const scalar = { isAggregate: false, deterministic: true, aliasTo: '' } as const;
const { fn, agg } = createKnownFunctions({ hash: scalar, eq: scalar, and: scalar, plus: scalar, count: { ...scalar, isAggregate: true } });
const q = from(table('items', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));

it('requires declarations on nested calls, not just the selected outer call', () => {
  const scalarQuery = q.map(r => ({ h: fn.hash(fn.hash(r.id)).as(col.UInt64) }));
  const aggregateQuery = q.aggregate(g => ({ h: fn.hash(agg.count(g.id)).as(col.UInt64) }));
  for (const emit of [compile, emitNaive]) for (const query of [scalarQuery, aggregateQuery]) {
    expect(() => emit(query.ir)).toThrow('known_result_undeclared');
  }
});

it('does not reject usable catalog members because unrelated names or aliases are unsafe', () => {
  const catalog = { ['__proto__']: scalar, constructor: scalar, okay: scalar, ['bad); SELECT 1']: { ...scalar, aliasTo: 'bad()' } };
  const known = createKnownFunctions(catalog);
  for (const emit of [compile, emitNaive]) {
    const sql = emit(q.map(() => ({ h: known.fn.okay().as(col.UInt64), p: known.fn.__proto__().as(col.UInt64), c: known.fn.constructor().as(col.UInt64) })).ir).sql;
    expect(sql).toContain('okay()');
    expect(sql).toContain('__proto__()');
    expect(sql).toContain('constructor()');
    expect(sql).not.toContain('SELECT 1');
  }
});

it('keeps typed-name collisions opaque to boolean, aggregate and join rewrites', () => {
  const pred = fn.and(fn.eq(q.row.id, val(1n)).as(col.Bool), fn.eq(q.row.id, val(2n)).as(col.Bool)).as(col.Bool);
  expect(conjuncts(pred.ir)).toEqual([pred.ir]);
  expect(safePredicate(pred.ir)).toBe(false);
  const aggregate = q.aggregate(g => ({ n: agg.count(g.id).as(col.UInt64) }));
  expect(safeAggregate(aggregate.ir)).toBe(false);
  const joined = join({ a: q, b: q }).on(r => [r.a.id.eq(r.b.id), fn.eq(r.a.id, r.b.id).as(col.Bool)]);
  expect(joined.ir.kind).toBe('Filter');
  for (const emit of [compile, emitNaive]) {
    expect(emit(joined.ir).sql).toContain('eq(');
    expect(emit(q.where(() => pred).ir).sql).toContain('and(eq(');
  }
});

it('rejects forged policies and malformed aggregate evidence as pathful ValidationError', () => {
  const query = q.aggregate(g => ({ n: agg.count(g.id).as(col.UInt64) })).ir;
  const node = query.aggs.n;
  if (node?.kind !== 'Agg') throw new Error('expected aggregate');
  const variants = [
    { ...node.fn, argumentPolicies: ['sibling'] },
    { ...node.fn, repeatedArgs: 'temporalGreatest' },
    { ...node.fn, js: 'forbidden' },
    { ...node.fn, known: { ...node.fn.known, declaration: { origin: 'inferred', type: col.UInt64.type } } },
    { ...node.fn, known: { ...node.fn.known, catalog: { count: { ...scalar, isAggregate: true, deterministic: undefined } } } },
  ];
  for (const emit of [compile, emitNaive]) for (const metadata of variants) {
    const rel = { ...query, aggs: { n: { ...node, fn: metadata } } } as unknown as Rel;
    try { emit(rel); throw new Error('accepted malformed metadata'); }
    catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(String(error)).toContain('root.aggs.n');
    }
  }
});

it('keeps the supported recursive result grammar aligned with actual decoder values', () => {
  const descriptor = col.Array(col.NamedTuple([['__proto__', col.Nullable(col.UInt64)], ['when', col.DateTime64(3)]]));
  const query = q.map(() => ({ result: fn.hash().as(descriptor) }));
  for (const emit of [compile, emitNaive]) {
    const plan = emit(query.ir);
    const value = decoder(plan.columns.result!)([JSON.parse('{"__proto__":"7","when":"2024-02-29T12:00:00.123Z"}')]);
    expect(value).toEqual([{ ['__proto__']: 7n, when: new Date('2024-02-29T12:00:00.123Z') }]);
    expect(plan.sql).not.toContain('CAST');
  }
});
