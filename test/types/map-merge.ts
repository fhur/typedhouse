import { expectTypeOf } from 'expect-type';
import { col, columnExpr, maxMerge, type Decimal, type Expr, type NodeId, type UUID } from '@typedhouse/core';
import type { DescriptorValue } from '../../packages/core/src/catalog/descriptor-types.js';

type Phantoms<E> = E extends Expr<infer T, infer N, infer M> ? Expr<T, N, M> : never;
const named = col.Tuple({ labels: col.Map(col.String, col.UInt64) });
const namedMerge = maxMerge(columnExpr(col.AggregateFunction('max', named), 1 as NodeId, ['s'], 's', 'grouped'));
expectTypeOf<Phantoms<typeof namedMerge>>().toEqualTypeOf<Expr<{ labels: Record<string, bigint> }, 's', 'agg'>>();
expectTypeOf(namedMerge).not.toBeAny();
const positional = col.Tuple([col.Map(col.UInt64, col.Nullable(col.String))]);
const positionalMerge = maxMerge(columnExpr(col.AggregateFunction('max', positional), 1 as NodeId, ['s'], 's', 'grouped'));
expectTypeOf<Phantoms<typeof positionalMerge>>().toEqualTypeOf<Expr<readonly [Array<[bigint, string | null]>], 's', 'agg'>>();
expectTypeOf(positionalMerge).not.toBeAny();
expectTypeOf(positional.type.items[0].type.key.name).toEqualTypeOf<'UInt64'>();
expectTypeOf(positional.type.items[0].type.value.inner.name).toEqualTypeOf<'String'>();

const recursive = col.Map(col.LowCardinality(col.Enum8({ 42: 1, b: 2 })), col.Array(col.Map(col.Decimal64(2), col.Map(col.DateTime64(9), col.Nullable(col.DateTime64(3))))));
expectTypeOf<DescriptorValue<typeof recursive.type>>().toEqualTypeOf<Record<'42' | 'b', Array<Array<[Decimal<18, 2>, Array<[string, Date | null]>]>>>>();
expectTypeOf<DescriptorValue<typeof recursive.type>>().not.toBeAny();
const fixed = col.Map(col.FixedString(3), col.UInt64);
expectTypeOf<DescriptorValue<typeof fixed.type>>().toEqualTypeOf<Record<string, bigint>>();
const address = col.Map(col.UUID, col.String);
expectTypeOf<DescriptorValue<typeof address.type>>().toEqualTypeOf<Record<UUID, string>>();
const timestamp = col.Map(col.LowCardinality(col.DateTime64(9)), col.String);
expectTypeOf<DescriptorValue<typeof timestamp.type>>().toEqualTypeOf<Array<[string, string]>>();
