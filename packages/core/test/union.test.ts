import { expect, it } from 'vitest';
import { expectTypeOf } from 'expect-type';
import { col, from, table, unionAll, crossJoin, count, type Query, type Infer, type IsLive } from '../src/index.js';
const metadata = { engine: 'Memory', sortingKey: [], partitionKey: [] };
const live = from(table('live', { id: col.UInt32, xs: col.Array(col.Nullable(col.Int64)) }, { ...metadata, source: { kind: 'test' } }));
const union = unionAll(live, live);
expectTypeOf<IsLive<typeof union>>().toEqualTypeOf<true>();
expectTypeOf<Infer<typeof union>>().toEqualTypeOf<{ id: number; xs: (bigint | null)[] }>();
expectTypeOf<Infer<typeof union>>().not.toBeAny();
const repeat = <R>(query: Query<R>) => unionAll(query, query);
expectTypeOf<Infer<ReturnType<typeof repeat<{ id: string }>>>>().toEqualTypeOf<{ id: string }>();
it('preserves nested grouped and expansion proxies across further union composition', () => {
  const nested = crossJoin({ a: live, b: live }).leftArrayJoin(r => r.a.xs, 'item');
  const q = unionAll(nested, nested);
  expectTypeOf(q.row.item).toEqualTypeOf(nested.row.item);
  expectTypeOf<Infer<typeof q>>().toEqualTypeOf<Infer<typeof nested>>();
  expectTypeOf<Infer<typeof q>>().not.toBeAny();
  const grouped = q.groupBy(r => r.item).aggregate(() => count());
  expectTypeOf<Infer<typeof grouped>>().toEqualTypeOf<{ item: bigint | null; count: bigint }>();
  expect(q.row.a.xs.ir.type).toEqual(live.row.xs.ir.type);
  expect(q.row.item.ir).toMatchObject({ rel: q.ir.id, path: ['item'], type: col.Nullable(col.Int64).type });
  expect(Object.isFrozen(q.row.a)).toBe(true);
  expect(unionAll(q, nested).ir.kind).toBe('Union');
});
it('rejects equal-length renamed paths instead of aligning by position', () => {
  const renamed = live.map(r => ({ other: r.id, xs: r.xs }));
  expect(() => (unionAll as unknown as (...args: unknown[]) => unknown)(live, renamed)).toThrow('union_schema_mismatch at Union.inputs[1].output: ["id"]');
});
