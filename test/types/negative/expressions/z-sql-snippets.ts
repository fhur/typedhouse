import { col, sql, cast, from, table, count, sum, columnExpr, type NodeId } from '@typedhouse/core';
const q = from(table('items', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const grouped = columnExpr(col.String, 1 as NodeId, ['id'], 'id', 'grouped');
sql`1`.as(); // expect: TS2554 Expected 1 arguments
sql<number>`1`; // expect: TS2558 Expected 0 type arguments
sql`1`.as(col.JSON); // expect: TS2345 parameter of type 'never'
sql`1`.as(col.Unknown('Future')); // expect: TS2345 parameter of type 'never'
sql`1`.as(col.DateTime64(9)); // expect: TS2345 parameter of type 'never'
sql`1`.as(col.Map(col.String, col.UInt64)); // expect: TS2345 parameter of type 'never'
sql`${grouped}`; // expect: TS2345 "grouped"
sql`${count()}`; // expect: TS2345 "agg"
sql`${q}`; // expect: TS2345 Query
sql`${sql`1`}`; // expect: TS2345 SqlSnippet
cast(sql`1`, col.UInt64); // expect: TS2345 SqlSnippet // expect-ts7: TS2740 SqlSnippet
sum(sql`1`.as(col.UInt64)); // expect: TS2345 AggregateOperand
q.map(() => ({ x: sql`1` })); // expect: TS2740 SqlSnippet
q.map(() => sql`1`.as(col.UInt64)); // expect: TS2322 unnamed_expression
q.aggregate(() => ({ x: sql`1`.as(col.UInt64) })); // expect: TS2322 "row"
