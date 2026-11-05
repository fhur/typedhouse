import { expectTypeOf } from 'expect-type';
import { col, sql, val, type DescribedExpr, type Infer, from, table } from '@typedhouse/core';

const distance = sql`editDistance(${'x'}, ${'y'})`.as(col.UInt64);
expectTypeOf(distance).toEqualTypeOf<DescribedExpr<bigint, never, 'row', typeof col.UInt64.type>>();
expectTypeOf(distance).not.toBeAny();
const nullable = col.Nullable(col.UInt64);

const declared = sql`${val('x')}`.as(nullable);

expectTypeOf(declared).toEqualTypeOf<
  DescribedExpr<bigint | null, never, 'row', typeof nullable.type>
>();

const source = from(
  table('parts', { mpn: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
);

const query = source.map(p => ({
  distance: sql`editDistance(${p.mpn}, ${'GRM155'})`.as(col.UInt64),
}));

expectTypeOf<Infer<typeof query>>().toEqualTypeOf<{ distance: bigint }>();
expectTypeOf<Infer<typeof query>>().not.toBeAny();
expectTypeOf<keyof ReturnType<typeof sql>>().toEqualTypeOf<'as'>();
