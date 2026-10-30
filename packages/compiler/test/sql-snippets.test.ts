import { expect, it } from 'vitest';
import { col, from, table, sql, val, cast, scalar, count, sum, join, unionAll, type Rel, type ExprNode } from '@chql/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import { planCtes } from '../src/plan-ctes.js';
const q = from(table('items', { 'odd`column': col.String, id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));

it('binds malicious values, not SQL or identifiers, through both emitters', () => {
  const value = "'\"`{}; -- /* SELECT injected */";
  const query = q.map(p => ({ distance: sql`editDistance(${p['odd`column']}, ${value})`.as(col.UInt64) }));
  for (const emit of [compile, emitNaive]) {
    const result = emit(query.ir);
    expect(result.sql).toContain('editDistance(');
    expect(result.sql).not.toContain(value);
    expect(result.sql).toContain('`odd\\`column`');
    expect(Object.values(result.params)).toEqual([value]);
    expect(result.columns).toEqual({ distance: col.UInt64.type });
    expect(result.sql).not.toContain('CAST');
  }
});
it('keeps parameter identity, explicit parameter types and nested precedence', () => {
  const p = val(2n, col.UInt64);
  const inner = sql`${p} + ${p}`.as(col.UInt64);
  for (const emit of [compile, emitNaive]) {
    const result = emit(q.map(() => ({ x: sql`${inner} * ${3n}`.as(col.UInt64) })).ir);
    expect(result.params).toEqual({ p0: '2', p1: '3' });
    expect(result.sql.match(/\{p0:UInt64\}/g)).toHaveLength(2);
    expect(result.sql).toContain('(({p0:UInt64}) + ({p0:UInt64}))');
    expect(result.sql).toContain('{p1:Int64}');
  }
});
it('permits an independent typed scalar aggregate query with fresh scope', () => {
  for (const emit of [compile, emitNaive]) expect(emit(q.map(() => ({ x: sql`${scalar(q.aggregate(() => ({ n: count() })))}`.as(col.UInt64) })).ir).sql).toContain('count()');
});
it('owns snapshots before declaration and keeps row expressions unnamed', () => {
  const values = ['before'];
  const snippet = sql`${values}`;
  values[0] = 'after';
  const expression = snippet.as(col.Array(col.String));
  expect(expression.name).toBeUndefined();
  expect(Object.keys(snippet)).toEqual(['as']);
  for (const emit of [compile, emitNaive]) expect(Object.values(emit(q.map(() => ({ x: expression })).ir).params)[0]).toContain('before');
});
it('rejects direct queries, snippets and grouped operands after type erasure', () => {
  const invoke = sql as (...args: unknown[]) => unknown;
  for (const value of [q, sql`1`, {}, null]) expect(() => invoke(['', ''], value)).toThrow();
  expect(() => q.aggregate(g => { invoke(['', ''], g.id); return { n: count() }; })).toThrow('invalid_expression_mode');
});
it('rejects malformed raw nodes with paths and without executing getters', () => {
  const query = q.map(p => ({ x: sql`length(${p['odd`column']})`.as(col.UInt64) })).ir;
  if (query.kind !== 'Project') throw new Error('expected project');
  const raw = query.exprs.x;
  if (raw?.kind !== 'Raw') throw new Error('expected raw');
  let calls = 0;
  const accessor = Object.defineProperty({ ...raw }, 'parts', { get() { calls++; return ['1']; } });
  const typeGetter = Object.defineProperty({}, 'kind', { get() { calls++; return 'scalar'; } });
  const cycle: unknown[] = []; cycle.push(cycle);
  const invalid: unknown[] = [
    { ...raw, resolution: 'deferred' }, { ...raw, type: null }, { ...raw, type: col.JSON.type },
    { ...raw, parts: [] }, { ...raw, parts: new Array(2) }, { ...raw, parts: [1, ''] },
    { ...raw, args: new Array(1) }, { ...raw, args: cycle }, { ...raw, opaque: false },
    { ...raw, provenance: { origin: 'sql.relation' } }, accessor, { ...raw, type: typeGetter },
    { ...raw, [Symbol('bad')]: true }, { ...raw, args: [{ ...raw.args[0], rel: -1 }] },
    { ...raw, args: [{ ...raw.args[0], mode: 'grouped' }] }, { ...raw, args: [count().ir] },
  ];
  for (const emit of [compile, emitNaive]) for (const x of invalid) {
    try { emit({ ...query, exprs: { x } } as Rel); throw new Error('accepted invalid raw'); }
    catch (error) { expect(error).toBeInstanceOf(ValidationError); expect(String(error)).toContain('root.exprs.x'); }
  }
  expect(calls).toBe(0);
});
it('rejects raw aggregate outputs and operands through Cast/Call wrappers', () => {
  const raw = sql`1`.as(col.UInt64);
  const aggregate = q.aggregate(g => ({ n: sum(g.id) })).ir;
  const countNode = aggregate.aggs.n!;
  const nodes: ExprNode[] = [raw.ir, cast(raw, col.UInt64).ir, raw.plus(1n).ir];
  if (countNode.kind !== 'Agg') throw new Error('expected aggregate');
  for (const emit of [compile, emitNaive]) for (const node of nodes) {
    expect(() => emit({ ...aggregate, aggs: { n: node } })).toThrow('invalid_aggregate_placement');
    expect(() => emit({ ...aggregate, aggs: { n: { ...countNode, args: [node] } } })).toThrow('invalid_expression_mode');
  }
});
it('retains binding through alias collisions, pruning and order rebinding without unsafe CTE extraction', () => {
  const projected = q.map(p => ({ id: p.id, text: sql`concat(${p['odd`column']}, ${'!'})`.as(col.String) }));
  const joined = join({ t0: projected, other: q }).on(r => r.t0.id.eq(r.other.id)).map(r => ({ text: sql`lower(${r.t0.text})`.as(col.String) }));
  for (const emit of [compile, emitNaive]) {
    expect(emit(joined.ir).sql).toContain('lower(');
    const reordered = q.orderBy(r => r.id).orderBy(r => sql`length(${r['odd`column']})`.as(col.UInt64));
    expect(emit(reordered.ir).sql).toContain('length(');
  }
  const repeated = unionAll(projected, projected);
  expect(planCtes(repeated.ir).definitions).not.toContain(projected.ir);
  const live = from(table('live', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [], source: { kind: 'test' } }));
  expect(live.caps.live).toBe(true);
  expect(live.map(r => ({ n: sql`${r.id}`.as(col.UInt64) })).caps.live).toBe(false);
});
it('rejects hostile template and descriptor accessors without invoking them', () => {
  let calls = 0;
  const parts = Object.defineProperty([''], '0', { get() { calls++; return ''; } });
  expect(() => sql(parts as unknown as TemplateStringsArray)).toThrow();
  const descriptor = Object.defineProperty({}, 'type', { get() { calls++; return col.UInt64.type; } });
  expect(() => sql`1`.as(descriptor as typeof col.UInt64)).toThrow();
  expect(calls).toBe(0);
});
