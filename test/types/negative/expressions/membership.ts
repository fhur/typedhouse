import { from, table, col, countIf } from '@typedhouse/core';
const q = from(table('s', { id: col.UInt64, text: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.row.id.in([1]); // expect: TS2769 No overload matches this call
q.row.id.in([null]); // expect: TS2769 No overload matches this call
q.row.id.in(q); // expect: TS2769 set_column_count
q.row.id.in(q.map(r => r.text)); // expect: TS2769 incompatible_set_values
q.row.id.in(q.row.id); // expect: TS2769 No overload matches this call
q.aggregate(g => ({ bad: g.id.in([1n]) })); // expect: TS2322 "grouped"
countIf(q.row.id.in([1n])); // expect: TS2345 "row"
const lc = from(table('lc', { kind: col.LowCardinality(col.String), day: col.LowCardinality(col.Date) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
lc.row.kind.in([1]); // expect: TS2769 No overload matches this call
lc.row.kind.in([null]); // expect: TS2769 No overload matches this call
lc.row.kind.in(q.map(r => r.id)); // expect: TS2769 incompatible_set_values
lc.row.day.in([new Date(0)]); // expect: TS2769 No overload matches this call
const strs = from(table('strs', { text: col.String, fixed: col.FixedString(3), en: col.Enum8({ a: 1, b: 2 }), uuid: col.UUID, nano: col.DateTime64(9), maybeNano: col.Nullable(col.DateTime64(6)), lcEn: col.LowCardinality(col.Enum8({ a: 1 })) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
strs.row.nano.in(['x']); // expect: TS2769 No overload matches this call
strs.row.maybeNano.notIn(['x']); // expect: TS2769 No overload matches this call
strs.row.nano.in(strs.map(r => r.nano)); // expect: TS2769 No overload matches this call
strs.row.lcEn.in(['a']); // expect: TS2769 No overload matches this call
strs.row.en.in(['zzz']); // expect: TS2769 No overload matches this call
strs.row.en.in(strs.map(r => r.text)); // expect: TS2769 incompatible_set_values
strs.row.text.in(strs.map(r => r.en)); // expect: TS2769 incompatible_set_values
strs.row.fixed.in(strs.map(r => r.en)); // expect: TS2769 No overload matches this call
strs.row.text.in(strs.map(r => r.uuid)); // expect: TS2769 incompatible_set_values
