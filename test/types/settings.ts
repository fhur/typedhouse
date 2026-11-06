import { expectTypeOf } from 'expect-type';
import {
  col,
  count,
  from,
  join,
  table,
  unionAll,
  type CompiledQuery,
  type Infer,
  type IsLive,
  type QuerySettings,
  type Rel,
  type Settings,
  type SettingsQuery,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';
import { createClient, createClientFromBackend, type Backend } from '@typedhouse/client';

const t = table(
  't',
  { id: col.UInt32, cat: col.String, n: col.Nullable(col.UInt32) },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const u = table(
  'u',
  { id: col.UInt32, name: col.String },
  { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
);

const q = from(t);

type T = Infer<typeof t>;

const client = createClient();

// Every allowed key, and the row is kept.
const settled = q.settings({
  max_threads: 2,
  max_execution_time: 1.5,
  max_memory_usage: 1_000_000n,
  max_rows_to_read: 1,
  max_bytes_to_read: 1n,
  max_result_rows: 1,
  max_result_bytes: 1n,
  max_block_size: 1024,
  max_bytes_before_external_group_by: 1,
  max_bytes_before_external_sort: 1n,
  priority: 0,
  log_comment: 'report',
});

expectTypeOf(settled).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(settled).not.toBeAny();
expectTypeOf(settled._rowType).toEqualTypeOf<T>();
expectTypeOf(settled.ir).toEqualTypeOf<Settings>();
expectTypeOf(settled.ir).toMatchTypeOf<Rel>();
expectTypeOf(settled.caps).toEqualTypeOf<{ readonly live: false }>();
expectTypeOf<IsLive<typeof settled>>().toEqualTypeOf<false>();
expectTypeOf(settled.toSQL()).toEqualTypeOf<CompiledQuery>();
expectTypeOf<keyof typeof settled>().toEqualTypeOf<'_rowType' | 'ir' | 'caps' | 'toSQL'>();
expectTypeOf(compile(settled.ir)).toEqualTypeOf<CompiledQuery>();
expectTypeOf(emitNaive(settled.ir)).toEqualTypeOf<CompiledQuery>();

// Accepted by run and stream, with the row.
const rows = client.run(settled);
expectTypeOf(rows).resolves.toEqualTypeOf<T[]>();
expectTypeOf(rows).not.toBeAny();
const stream = client.stream(settled);
expectTypeOf(stream).toEqualTypeOf<AsyncGenerator<T, void>>();
expectTypeOf(stream).not.toBeAny();

declare const backend: Backend;
expectTypeOf(createClientFromBackend(backend).run(settled)).resolves.toEqualTypeOf<T[]>();

// Every query shape ends with settings.
const mapped = q.map(r => ({ x: r.id })).settings({ priority: 1 });
expectTypeOf(mapped).toEqualTypeOf<SettingsQuery<{ x: number }>>();

const grouped = q
  .groupBy(r => ({ cat: r.cat }))
  .aggregate(() => ({ c: count() }))
  .settings({ priority: 1 });

expectTypeOf(grouped).toEqualTypeOf<SettingsQuery<{ cat: string; c: bigint }>>();
expectTypeOf(q.orderBy(r => r.id).settings({ priority: 1 })).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.limit(1).settings({ priority: 1 })).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.final().settings({ priority: 1 })).toEqualTypeOf<SettingsQuery<T>>();

expectTypeOf(
  q
    .limitBy(r => r.cat)
    .take(1)
    .settings({ priority: 1 }),
).toEqualTypeOf<SettingsQuery<T>>();

expectTypeOf(q.cte().settings({ priority: 1 })).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(unionAll(q, q).settings({ priority: 1 })).toEqualTypeOf<SettingsQuery<T>>();

const joined = join({ a: q, b: from(u) })
  .on(({ a, b }) => a.id.eq(b.id))
  .settings({ priority: 1 });

expectTypeOf(joined._rowType.b.name).toEqualTypeOf<string>();
expectTypeOf(joined._rowType.a.n).toEqualTypeOf<number | null>();

// A settings object can be declared on its own.
const shared: QuerySettings = { max_threads: 1n };
expectTypeOf(q.settings(shared)).toEqualTypeOf<SettingsQuery<T>>();
expectTypeOf(q.settings({})).toEqualTypeOf<SettingsQuery<T>>();
