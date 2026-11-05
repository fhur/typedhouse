import { col, from, table, type Column, type InsertRow, type TableDef } from '@typedhouse/core';

const meta = { engine: 'MergeTree', sortingKey: [], partitionKey: [] };

const target = table(
  'insert',
  {
    id: col.UInt64,
    value: col.Nullable(col.String),
    d: col.String,
    alias: col.String,
    materialized: col.String,
    hidden: col.String,
  },
  {
    ...meta,
    columnMetadata: {
      d: { defaultKind: 'DEFAULT' },
      alias: { defaultKind: 'ALIAS' },
      materialized: { defaultKind: 'MATERIALIZED' },
    },
    hiddenColumns: ['hidden'],
  },
);

const rows: readonly InsertRow<typeof target>[] = [
  { id: 1n, value: null },
  { id: 2n, value: 'v', d: 'd' },
];

from(target).insertMany(rows);
from(target).insertMany([]);
// @ts-expect-error nullable is still required
from(target).insertMany([{ id: 1n }]);
// @ts-expect-error undefined is not omission
from(target).insertMany([{ id: 1n, value: null, d: undefined }]);
const extra = { id: 1n, value: null, extra: true };
// @ts-expect-error inferred variables must have exact keys
from(target).insertMany([extra]);
const union: ({ id: bigint; value: null } | { id: bigint; value: null; extra: boolean })[] = [];
// @ts-expect-error each union member must have exact keys
from(target).insertMany(union);
// @ts-expect-error generated column
from(target).insertMany([{ id: 1n, value: null, alias: 'a' }]);
// @ts-expect-error hidden column
from(target).insertMany([{ id: 1n, value: null, hidden: 'a' }]);
// @ts-expect-error scan hints remove insertion
from(target).final().insertMany(rows);
// prettier-ignore
// @ts-expect-error read operations remove insertion
from(target).where(r => r.id.eq(1n)).insertMany(rows);
declare const erased: TableDef;
// @ts-expect-error erased descriptors fail closed
from(erased).insertMany([{}]);
declare const erasedColumn: Column<string>;

const erasedTable = table('erased', { v: erasedColumn }, meta);
// @ts-expect-error erased column descriptor fails closed
from(erasedTable).insertMany([{ v: 'x' }]);

const unsupported = table(
  'unsupported',
  { v: col.Array(col.FixedString(2)) },
  { ...meta, columnMetadata: { v: { defaultKind: 'DEFAULT' } } },
);

from(unsupported).insertMany([{}]);
// @ts-expect-error unsupported descendants fail even for empty values
from(unsupported).insertMany([{ v: [] }]);

const nested = table(
  'nested',
  {
    v: col.Tuple({ x: col.Array(col.UInt32), y: col.Nullable(col.String) }),
    p: col.Tuple([col.String, col.UInt64]),
    time: col.DateTime64(3),
  },
  meta,
);

from(nested).insertMany([{ v: { x: [], y: null }, p: ['x', 1n], time: new Date() }]);
const requiredUnsupported = table('requiredUnsupported', { v: col.FixedString(2) }, meta);
from(requiredUnsupported).insertMany([]);
// @ts-expect-error required unsupported columns cannot be omitted
from(requiredUnsupported).insertMany([{}]);
// @ts-expect-error required unsupported columns cannot be supplied
from(requiredUnsupported).insertMany([{ v: 'ab' }]);
const preciseTime = table('preciseTime', { v: col.DateTime64(4) }, meta);
// @ts-expect-error high precision dates are not writable
from(preciseTime).insertMany([{ v: '2026-01-01 00:00:00.0000' }]);
const wideMeta: { defaultKind: string } = { defaultKind: 'DEFAULT' };

const widened = table('widened', { v: col.String }, { ...meta, columnMetadata: { v: wideMeta } });
// @ts-expect-error widened DEFAULT is not definitely defaulted
from(widened).insertMany([{}]);
