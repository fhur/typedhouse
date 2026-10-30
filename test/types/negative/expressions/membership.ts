import { from, table, col, countIf } from '@typedhouse/core';
const q = from(table('s', { id: col.UInt64, text: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.row.id.in([1]); // expect: TS2769 No overload matches this call
q.row.id.in([null]); // expect: TS2769 No overload matches this call
q.row.id.in(q); // expect: TS2769 set_column_count
q.row.id.in(q.map(r => r.text)); // expect: TS2769 incompatible_set_values
q.row.id.in(q.row.id); // expect: TS2769 No overload matches this call
q.aggregate(g => ({ bad: g.id.in([1n]) })); // expect: TS2322 "grouped"
countIf(q.row.id.in([1n])); // expect: TS2345 "row"
