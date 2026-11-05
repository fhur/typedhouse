import { describe, expect, it } from 'vitest';
import { col, count, exprNode, from, join, LimitByBuilder, LimitByQuery, OrderedQuery, Query, scalar, table, val, Expr } from '../src/index.js';

const t = table('t', { id: col.UInt32, cat: col.String, n: col.Nullable(col.UInt32) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const q = from(t);

describe('limitBy builder', () => {
  it('returns an intermediate with only take, which builds no node', () => {
    const pending = q.limitBy(r => r.cat);
    expect(pending).toBeInstanceOf(LimitByBuilder);
    expect(pending).not.toBeInstanceOf(Query);
    expect(Object.keys(pending)).toEqual([]);
    expect(Object.getOwnPropertyNames(LimitByBuilder.prototype).sort()).toEqual(['constructor', 'take']);
    for (const name of ['ir', 'toSQL', 'where', 'map', 'limit', 'orderBy', 'offset', 'row']) expect((pending as unknown as Record<string, unknown>)[name]).toBeUndefined();
    expect(Object.isFrozen(pending)).toBe(true);
  });

  it('take builds the node over the input with one or many keys', () => {
    const one = q.limitBy(r => r.cat).take(2);
    expect(one).toBeInstanceOf(LimitByQuery);
    expect(one).toBeInstanceOf(Query);
    expect(one).not.toBeInstanceOf(OrderedQuery);
    if (one.ir.kind !== 'LimitBy') throw new Error('wrong node');
    expect(one.ir.input).toBe(q.ir);
    expect(one.ir.n).toBe(2);
    expect(one.ir.offset).toBeUndefined();
    expect(one.ir.keys).toEqual([q.row.cat.ir]);
    expect(one.ir.output).toBe(q.ir.output);
    const many = q.limitBy(r => [r.cat, r.id.plus(1)]).take(1);
    if (many.ir.kind !== 'LimitBy') throw new Error('wrong node');
    expect(many.ir.keys).toHaveLength(2);
    expect(Object.isFrozen(many.ir.keys)).toBe(true);
  });

  it('offset replaces the node rather than nesting a second LimitBy', () => {
    const taken = q.limitBy(r => r.cat).take(2);
    const page = taken.offset(3);
    expect(page).toBeInstanceOf(Query);
    expect(page).not.toBeInstanceOf(LimitByQuery);
    if (page.ir.kind !== 'LimitBy' || taken.ir.kind !== 'LimitBy') throw new Error('wrong node');
    expect(page.ir).not.toBe(taken.ir);
    expect(page.ir.input).toBe(q.ir);
    expect(page.ir.input.kind).toBe('Scan');
    expect(page.ir.n).toBe(2);
    expect(page.ir.offset).toBe(3);
    expect(page.ir.keys).toBe(taken.ir.keys);
    expect(taken.ir.offset).toBeUndefined();
    expect('offset' in page).toBe(false);
  });

  it('every other operator returns a query without offset', () => {
    const taken = q.limitBy(r => r.cat).take(2);
    for (const next of [taken.where(r => r.id.gt(1)), taken.limit(1), taken.distinct(), taken.cte(), taken.orderBy(r => r.id), taken.map(r => r.id)]) expect('offset' in next).toBe(false);
    expect('thenBy' in taken).toBe(false);
    expect('thenBy' in taken.offset(1)).toBe(false);
  });

  it('is available after every query shape, and its result composes', () => {
    const ordered = q.orderBy(r => r.id).limitBy(r => r.cat).take(1);
    if (ordered.ir.kind !== 'LimitBy') throw new Error('wrong node');
    expect(ordered.ir.input.kind).toBe('Sort');
    const aggregate = q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ c: count() })).limitBy(r => r.cat).take(1);
    expect(aggregate.row.c.ir.type).toEqual(col.UInt64.type);
    const joined = join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id)).limitBy(r => r.b.cat).take(1).offset(1);
    expect(joined.ir.output.shape).toBe('nested');
    expect(joined.row.a.id.ir).toMatchObject({ kind: 'ColumnRef', rel: joined.ir.id });
    expect(join({ a: q.limitBy(r => r.cat).take(1), b: q }).on(r => r.a.id.eq(r.b.id)).ir.kind).toBe('Join');
  });

  it('is not live', () => {
    const live = from(table('s', { id: col.UInt32 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [], source: {} as never }));
    expect(live.caps.live).toBe(true);
    const taken = live.limitBy(r => r.id).take(1);
    expect(taken.caps.live).toBe(false);
    expect(taken.offset(1).caps.live).toBe(false);
    expect(taken.where(r => r.id.gt(1)).caps.live).toBe(false);
  });

  it('rejects an empty key list', () => {
    expect(() => q.limitBy(() => [])).toThrow(/invalid_limit_by_key/);
  });

  it('rejects a key that reads no column', () => {
    expect(() => q.limitBy(() => val(1, col.UInt32))).toThrow(/invalid_limit_by_key/);
    expect(() => q.limitBy(r => [r.cat, val(1, col.UInt32)])).toThrow(/invalid_limit_by_key/);
    expect(() => q.limitBy(() => val(1, col.UInt32).plus(2))).toThrow(/invalid_limit_by_key/);
    // A subquery opens another scope, so its columns are not the row's.
    expect(() => q.limitBy(() => scalar(q.aggregate(() => ({ c: count() }))))).toThrow(/invalid_limit_by_key/);
    const raw = new Expr<number>(exprNode({ kind: 'Raw', type: col.UInt32.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['2'], args: [] }), undefined as never, 'row');
    expect(() => q.limitBy(() => raw)).toThrow(/invalid_limit_by_key/);
  });

  it('accepts computed keys that read a column', () => {
    expect(() => q.limitBy(r => r.id.plus(1)).take(1)).not.toThrow();
    expect(() => q.limitBy(r => r.n.ifNull(0)).take(1)).not.toThrow();
  });

  it('rejects what is not a row expression', () => {
    const js = q as unknown as { limitBy(by: (row: typeof q.row) => unknown): unknown };
    expect(() => js.limitBy(r => r.cat.asc())).toThrow(/invalid_limit_by_key/);
    expect(() => js.limitBy(() => 'cat')).toThrow(/invalid_limit_by_key/);
    expect(() => js.limitBy(() => undefined)).toThrow(/invalid_limit_by_key/);
    expect(() => js.limitBy(r => [r.cat, 1])).toThrow(/invalid_limit_by_key/);
    expect(() => js.limitBy(() => count())).toThrow(/invalid_limit_by_key/);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined])('rejects %s as a count or offset', bad => {
    expect(() => q.limitBy(r => r.cat).take(bad as number)).toThrow(/invalid_limit/);
    expect(() => q.limitBy(r => r.cat).take(1).offset(bad as number)).toThrow(/invalid_limit/);
  });

  it('accepts zero for both', () => {
    const page = q.limitBy(r => r.cat).take(0).offset(0);
    if (page.ir.kind !== 'LimitBy') throw new Error('wrong node');
    expect([page.ir.n, page.ir.offset]).toEqual([0, 0]);
  });
});
