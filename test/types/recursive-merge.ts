import { expectTypeOf } from 'expect-type';
import { col, columnExpr, maxMerge, type Expr, type NodeId } from '@typedhouse/core';
import type { DescriptorValue } from '../../packages/core/src/catalog/descriptor-types.js';

type Phantoms<E> = E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;
const nested = col.Array(col.Tuple([
  col.FixedString(3), col.Enum16({ 42: 1, b: 2 }),
  col.NamedTuple([['42', col.UInt64], ['0', col.Nullable(col.DateTime64(3))]]),
]));
const merged = maxMerge(columnExpr(col.AggregateFunction('max', nested), 1 as NodeId, ['s'], 's', 'grouped'));
expectTypeOf<Phantoms<typeof merged>>().toEqualTypeOf<Expr<(readonly [string, '42' | 'b', { '42': bigint; '0': Date | null }])[], 's', 'agg'>>();
expectTypeOf(merged).not.toBeAny();
expectTypeOf(nested.type.inner.items[2].type.items[0].name).toEqualTypeOf<'42'>();
expectTypeOf(nested.type.inner.items[2].type.items[1].name).toEqualTypeOf<'0'>();
const named = col.Tuple({ id: col.UInt64, states: col.Array(col.Enum8({ a: 1, b: 2 })) });
expectTypeOf<DescriptorValue<typeof named.type>>().toEqualTypeOf<{ id: bigint; states: ('a' | 'b')[] }>();
const empty = col.Tuple({});
expectTypeOf<DescriptorValue<typeof empty.type>>().toEqualTypeOf<readonly []>();
const unnamedEmpty = col.Tuple([]);
expectTypeOf<DescriptorValue<typeof unnamedEmpty.type>>().toEqualTypeOf<readonly []>();
