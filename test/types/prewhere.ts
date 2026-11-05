import { expectTypeOf } from 'expect-type';
import { col, count, from, join, table, type CompiledQuery, type Infer, type Query } from '@typedhouse/core';
import { createClient } from '../../packages/client/src/index.js';
const t = table('t', { id: col.UInt32, cat: col.String, n: col.Nullable(col.UInt32), ok: col.Nullable(col.Bool), tags: col.Array(col.String) }, { engine: 'ReplacingMergeTree', sortingKey: ['id'], partitionKey: [] });
const q = from(t);
type T = Infer<typeof t>;

// After from, final, sample and both, keeping the row and its descriptors.
const direct = q.prewhere(r => r.id.gt(1));
expectTypeOf(direct).toMatchTypeOf<Query<T>>();
expectTypeOf<Infer<typeof direct>>().toEqualTypeOf<T>();
expectTypeOf(direct.caps).toEqualTypeOf<{ readonly live: false }>();
expectTypeOf(direct.row.id.ir.type).toEqualTypeOf(q.row.id.ir.type);
const finalNonKey = q.final().prewhere(r => r.cat.eq('open'));
expectTypeOf<Infer<typeof finalNonKey>>().toEqualTypeOf<T>();
const sampled = q.sample(0.1).prewhere(r => r.id.gt(1));
expectTypeOf<Infer<typeof sampled>>().toEqualTypeOf<T>();
const both = q.final().sample(0.5).prewhere(r => r.id.gt(1));
expectTypeOf<Infer<typeof both>>().toEqualTypeOf<T>();

// Same predicate type as where, including Nullable booleans.
expectTypeOf<Infer<ReturnType<typeof q.where>>>().toEqualTypeOf<Infer<typeof direct>>();
const nullable = q.prewhere(r => r.n.gt(1));
expectTypeOf<Infer<typeof nullable>>().toEqualTypeOf<T>();
const column = q.prewhere(r => r.ok);
expectTypeOf<Infer<typeof column>>().toEqualTypeOf<T>();

// The result composes as an ordinary query.
const composed = direct.where(r => r.cat.eq('x')).map(r => ({ id: r.id })).orderBy(r => r.id).limit(1);
expectTypeOf<Infer<typeof composed>>().toEqualTypeOf<{ id: number }>();
const grouped = direct.groupBy(r => ({ cat: r.cat })).aggregate(() => ({ total: count() }));
expectTypeOf<Infer<typeof grouped>>().toEqualTypeOf<{ cat: string; total: bigint }>();
const expanded = direct.arrayJoin(r => r.tags, 'tag');
expectTypeOf<Infer<typeof expanded>>().toEqualTypeOf<{ id: number; cat: string; n: number | null; ok: boolean | null; tags: string[]; tag: string }>();
const limited = direct.limitBy(r => r.cat).take(1).offset(1);
expectTypeOf<Infer<typeof limited>>().toEqualTypeOf<T>();
const joined = join({ a: q.prewhere(r => r.id.gt(1)), b: q.final().prewhere(r => r.id.gt(2)) }).on(r => r.a.id.eq(r.b.id));
expectTypeOf<Infer<typeof joined>>().toEqualTypeOf<{ a: T; b: T }>();
expectTypeOf(direct.toSQL()).toEqualTypeOf<CompiledQuery>();
expectTypeOf(createClient().run(direct)).resolves.toEqualTypeOf<T[]>();
