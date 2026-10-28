import { col, from, table, val } from '@chql/core';
const q = from(table('dates', { day32: col.Date32, time: col.DateTime(), high: col.DateTime64(4), low: col.LowCardinality(col.Date), text: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.row.day32.toStartOfWeek(); // expect: TS2684 The 'this' context
q.row.time.toStartOfWeek(); // expect: TS2684 The 'this' context
q.row.high.toStartOfWeek(); // expect: TS2684 The 'this' context
q.row.low.toStartOfWeek(); // expect: TS2684 The 'this' context
q.row.text.toStartOfWeek(); // expect: TS2684 The 'this' context
val(new Date(), col.Date).toStartOfWeek(1); // expect: TS2554 Expected 0 arguments
