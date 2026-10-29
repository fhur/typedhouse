import { expectTypeOf } from 'expect-type';
import { col, crossJoin, from, sum, table, val, type Infer } from '@chql/core';

const numbers = from(table('nested_numbers', { n: col.Float64, u: col.UInt16, nullable: col.Nullable(col.Float64) }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] }));
const one = val(1, col.Float64);
// Regression: checking a promoted expression as another method's operand must
// not recursively compare the entire generated method surface (TS2589).
const q = crossJoin({ a: numbers, b: numbers }).map(r => ({
  n: r.a.n.divide(r.b.n.plus(one)),
  difference: r.a.n.minus(r.a.n.minus(one)),
  promoted: r.a.u.multiply(r.b.u.plus(1)),
  nullable: r.a.n.divide(r.b.nullable.plus(one)),
}));
expectTypeOf<Infer<typeof q>>().toEqualTypeOf<{ n: number; difference: number; promoted: bigint; nullable: number | null }>();
expectTypeOf<Infer<typeof q>>().not.toBeAny();
expectTypeOf(q.row.promoted.ir.type.name).toEqualTypeOf<'UInt64'>();
expectTypeOf(q.row.nullable.ir.type.kind).toEqualTypeOf<'Nullable'>();
const expression = numbers.row.n.divide(numbers.row.n.plus(one));
expectTypeOf(expression.name).toEqualTypeOf<'n'>();
expectTypeOf(expression.mode).toEqualTypeOf<'row'>();
expectTypeOf(expression.ir.type.name).toEqualTypeOf<'Float64'>();
const agg = numbers.aggregate(g => {
  const expression = sum(g.n).divide(sum(g.n).plus(one));
  expectTypeOf(expression.mode).toEqualTypeOf<'agg'>();
  expectTypeOf(expression.name).toEqualTypeOf<'n'>();
  return { n: expression };
});
expectTypeOf<Infer<typeof agg>>().toEqualTypeOf<{ n: number }>();
expectTypeOf<Infer<typeof agg>>().not.toBeAny();
