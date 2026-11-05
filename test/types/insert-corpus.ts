import { col, from, table, type InsertRow } from '@typedhouse/core';
import { expectTypeOf } from 'expect-type';

export const target = table(
  'insert_corpus',
  {
    id: col.UInt64,
    nullable: col.Nullable(col.String),
    label: col.String,
    alias: col.UInt64,
    materialized: col.UInt64,
  },
  {
    engine: 'Memory',
    sortingKey: [],
    partitionKey: [],
    columnMetadata: {
      label: { defaultKind: 'DEFAULT' },
      alias: { defaultKind: 'ALIAS' },
      materialized: { defaultKind: 'MATERIALIZED' },
    },
  },
);

export type Row = InsertRow<typeof target>;

export const rows: readonly Row[] = [
  { id: 1n, nullable: null },
  { id: 2n, nullable: 'x', label: 'provided' },
];

export const command = from(target).insertMany(rows);
expectTypeOf(command).toEqualTypeOf<import('@typedhouse/core').InsertCommand>();
expectTypeOf(command).not.toBeAny();
expectTypeOf<Row['id']>().toEqualTypeOf<bigint>();
expectTypeOf<Row['nullable']>().toEqualTypeOf<string | null>();
expectTypeOf<keyof Row>().toEqualTypeOf<'id' | 'nullable' | 'label'>();
