import { expectTypeOf } from 'expect-type';
import { col, count, from, join, table, type Infer } from '@typedhouse/core';

// Slice 4f: `hiddenColumns` is shadow-only descriptor metadata. Hidden names are never row fields, never select items,
// and the descriptor's row type is identical with and without the option.
const meta = { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] } as const;

const columns = { id: col.UInt32, v: col.String };

const hidden = table('xm', columns, { ...meta, hiddenColumns: ['hidden', 'mat'] });

const plain = table('xm', columns, meta);
expectTypeOf<Infer<typeof hidden>>().toEqualTypeOf<{ id: number; v: string }>();
expectTypeOf<Infer<typeof hidden>>().toEqualTypeOf<Infer<typeof plain>>();
expectTypeOf<'hidden' extends keyof Infer<typeof hidden> ? true : false>().toEqualTypeOf<false>();
expectTypeOf(hidden.hiddenColumns).toEqualTypeOf<readonly string[] & readonly ['hidden', 'mat']>(); // metadata, not part of the row type

// An output alias may still be named like a hidden column: it is an ordinary output of the query.
const grouped = from(hidden)
  .groupBy(r => ({ id: r.id }))
  .aggregate(() => ({ hidden: count() }))
  .where(r => r.hidden.gt(1n));

expectTypeOf<Infer<typeof grouped>>().toEqualTypeOf<{ id: number; hidden: bigint }>();

const joined = join({ a: from(plain), m: from(hidden) })
  .on(r => r.a.id.eq(r.m.id))
  .map(r => ({ id: r.a.id, v: r.m.v }));

expectTypeOf<Infer<typeof joined>>().toEqualTypeOf<{ id: number; v: string }>();
