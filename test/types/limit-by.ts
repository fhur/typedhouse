import { expectTypeOf } from 'expect-type';
import { col, count, from, join, table, unionAll, val, type CompiledQuery, type Infer, type LimitByBuilder, type LimitByQuery, type Query } from '@typedhouse/core';
import { createClient } from '../../packages/client/src/index.js';
const t = table('t', { id: col.UInt32, cat: col.String, n: col.Nullable(col.UInt32), tags: col.Array(col.String) }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });
const q = from(t);
type T = Infer<typeof t>;

// One key and many keys, with and without offset, keep the row.
const pending = q.limitBy(r => r.cat);
expectTypeOf(pending).toMatchTypeOf<LimitByBuilder<T>>();
const taken = pending.take(1);
expectTypeOf(taken).toMatchTypeOf<LimitByQuery<T>>();
expectTypeOf(taken).toMatchTypeOf<Query<T>>();
expectTypeOf(taken.caps).toEqualTypeOf<{ readonly live: false }>();
expectTypeOf<Infer<typeof taken>>().toEqualTypeOf<T>();
const paged = taken.offset(2);
expectTypeOf(paged).toMatchTypeOf<Query<T>>();
expectTypeOf<Infer<typeof paged>>().toEqualTypeOf<T>();
expectTypeOf(paged.caps).toEqualTypeOf<{ readonly live: false }>();
const many = q.limitBy(r => [r.cat, r.id.plus(1), r.n, r.tags]).take(1).offset(1);
expectTypeOf<Infer<typeof many>>().toEqualTypeOf<T>();

// The row proxy survives, including descriptors.
expectTypeOf(taken.row.id.ir.type).toEqualTypeOf(q.row.id.ir.type);
expectTypeOf(paged.row.cat.ir.type).toEqualTypeOf(q.row.cat.ir.type);

// Flat inputs after other operators.
const ordered = q.orderBy(r => r.id.desc()).thenBy(r => r.cat).limitBy(r => r.cat).take(1);
expectTypeOf<Infer<typeof ordered>>().toEqualTypeOf<T>();
const mapped = q.where(r => r.id.gt(1)).map(r => ({ k: r.id.plus(1), c: r.cat })).limitBy(r => r.k).take(1).offset(1);
expectTypeOf<Infer<typeof mapped>>().toEqualTypeOf<{ k: bigint; c: string }>();
const aggregated = q.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ total: count() })).limitBy(r => [r.cat, r.total]).take(1);
expectTypeOf<Infer<typeof aggregated>>().toEqualTypeOf<{ cat: string; total: bigint }>();
const expanded = q.arrayJoin(r => r.tags, 'tag').limitBy(r => r.tag).take(1);
expectTypeOf<Infer<typeof expanded>>().toEqualTypeOf<{ id: number; cat: string; n: number | null; tags: string[]; tag: string }>();
const unioned = unionAll(q.map(r => r.id), q.map(r => r.id)).limitBy(r => r.id).take(1);
expectTypeOf<Infer<typeof unioned>>().toEqualTypeOf<{ id: number }>();

// A nested join keeps its nesting.
const joined = join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id)).limitBy(r => [r.a.cat, r.b.id]).take(1);
expectTypeOf<Infer<typeof joined>>().toEqualTypeOf<{ a: T; b: T }>();
const joinedPage = joined.offset(1).map(r => ({ cat: r.a.cat }));
expectTypeOf<Infer<typeof joinedPage>>().toEqualTypeOf<{ cat: string }>();
const joinedGroup = joined.groupBy(r => ({ cat: r.a.cat })).count();
expectTypeOf<Infer<typeof joinedGroup>>().toEqualTypeOf<{ cat: string; count: bigint }>();

// Both results are ordinary queries: operators, join inputs, and execution.
const composed = taken.where(r => r.id.gt(1)).orderBy(r => r.id).limit(1);
expectTypeOf<Infer<typeof composed>>().toEqualTypeOf<T>();
const asInput = join({ a: taken, b: paged }).on(r => r.a.id.eq(r.b.id));
expectTypeOf<Infer<typeof asInput>>().toEqualTypeOf<{ a: T; b: T }>();
expectTypeOf(taken.toSQL()).toEqualTypeOf<CompiledQuery>();
expectTypeOf(taken.limitBy(r => r.id).take(1).offset(1).limitBy(r => r.cat).take(1)).toMatchTypeOf<Query<T>>();
expectTypeOf(q.limitBy(r => r.id.plus(val(1, col.UInt32))).take(1)).toMatchTypeOf<Query<T>>();
const client = createClient();
expectTypeOf(client.run(taken)).resolves.toEqualTypeOf<T[]>();
expectTypeOf(client.run(paged)).resolves.toEqualTypeOf<T[]>();
expectTypeOf(client.run(joined)).resolves.toEqualTypeOf<{ a: T; b: T }[]>();
