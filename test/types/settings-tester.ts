import { expectTypeOf } from 'expect-type';
import {
  col,
  from,
  join,
  leftJoin,
  table,
  unionAll,
  type Infer,
  type SettingsQuery,
} from '@typedhouse/core';
import { createClient } from '@typedhouse/client';

/** D6 Tester: `settings()` on every query the builder can return, and the set operands that
 * `SetQuery`'s new required `row` must not exclude. */
const t = table(
  't',
  { id: col.UInt32, cat: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const q = from(t);

type T = Infer<typeof t>;

const s = { max_threads: 1 } as const;

expectTypeOf(q.settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.final().settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.sample(0.1).settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.prewhere(r => r.id.gt(1)).settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.where(r => r.id.gt(1)).settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.orderBy(r => r.id).settings(s)).toEqualTypeOf<SettingsQuery<T>>();

expectTypeOf(
  q
    .orderBy(r => r.id)
    .thenBy(r => r.cat)
    .settings(s),
).toEqualTypeOf<SettingsQuery<T>>();

expectTypeOf(q.limit(1).settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.limit(1, 2).settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.distinct().settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.cte().settings(s)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(unionAll(q, q).settings(s)).toEqualTypeOf<SettingsQuery<T>>();

const sorted = q.orderBy(r => r.id);

expectTypeOf(
  sorted
    .limitBy(r => r.cat)
    .take(1)
    .settings(s),
).toEqualTypeOf<SettingsQuery<T>>();

expectTypeOf(
  sorted
    .limitBy(r => r.cat)
    .take(1)
    .offset(1)
    .settings(s),
).toEqualTypeOf<SettingsQuery<T>>();

expectTypeOf(q.map(r => ({ x: r.id })).settings(s)).toEqualTypeOf<SettingsQuery<{ x: number }>>();

const joined = join({ a: q, b: q }).on(r => r.a.id.eq(r.b.id));
expectTypeOf(joined.settings(s)).toEqualTypeOf<SettingsQuery<{ a: T; b: T }>>();

const outer = leftJoin({ a: q }, { b: q }).on(r => r.a.id.eq(r.b.id));
expectTypeOf(outer.settings(s)._rowType.a).toEqualTypeOf<T>();

// Every query value is still a set operand.
const ids = q.map(r => r.id);
q.where(r => r.id.in(ids));
q.where(r => r.id.in(ids.limit(1)));
q.where(r => r.id.in(ids.distinct()));
q.where(r => r.id.in(ids.cte()));
q.where(r => r.id.in(unionAll(ids, ids)));
q.where(r => r.id.in(ids));
q.where(r => r.id.notIn(unionAll(ids, ids).limit(1)));
q.map(r => ({ yes: r.id.in(ids) }));

// A settings result runs through every client entry, with its row.
const client = createClient();
expectTypeOf(client.run(q.settings(s))).resolves.toEqualTypeOf<T[]>();
expectTypeOf(client.stream(q.settings(s))).toEqualTypeOf<AsyncGenerator<T, void>>();

// `row` is required on the type: a hand-rolled operand no longer type-checks, and at runtime still works.
// @ts-expect-error SetQuery requires row, which SettingsQuery and hand-rolled operands lack.
q.where(r => r.id.in({ _rowType: 1 as number, ir: ids.ir }));
