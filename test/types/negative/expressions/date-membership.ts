import { col, table, from, val, type Row } from '@typedhouse/core';
const q = from(table('dates', { day: col.Date, maybe: col.Nullable(col.Date), extended: col.Date32, seconds: col.DateTime(), instant: col.DateTime64(3), precise: col.DateTime64(9), wrapped: col.LowCardinality(col.Date) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.row.day.in(q.map(r => r.extended)); // expect: TS2769 No overload matches this call
q.row.day.notIn(q.map(r => r.seconds)); // expect: TS2769 No overload matches this call
q.row.day.in(q.map(r => r.instant)); // expect: TS2769 No overload matches this call
q.row.day.in(q.map(r => r.precise)); // expect: TS2769 No overload matches this call
q.row.day.in(q.map(r => r.wrapped)); // expect: TS2769 No overload matches this call
q.row.extended.in([new Date()]); // expect: TS2769 No overload matches this call
q.row.seconds.in([new Date()]); // expect: TS2769 No overload matches this call
q.row.instant.in([new Date()]); // expect: TS2769 No overload matches this call
q.row.wrapped.in([new Date()]); // expect: TS2769 No overload matches this call
q.row.day.in(q); // expect: TS2769 No overload matches this call
q.row.day.in([null]); // expect: TS2769 No overload matches this call
q.row.day.in([val(new Date(), col.Date)]); // expect: TS2769 No overload matches this call
q.row.day.in(['2024-02-29']); // expect: TS2769 No overload matches this call
const erased = (r: Row<{ day: Date }>) => r.day.in([new Date()]); // expect: TS2769 No overload matches this call
