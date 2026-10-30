import { col, columnExpr, createKnownFunctions, from, table, val, type NodeId } from '@typedhouse/core';
const { fn, agg } = createKnownFunctions({ hash: { isAggregate: false, deterministic: true, aliasTo: '' }, count: { isAggregate: true, deterministic: null, aliasTo: '' } });
const q = from(table('items', { id: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const row = columnExpr(col.String, 1 as NodeId, ['id'], 'id', 'row');
const grouped = columnExpr(col.String, 1 as NodeId, ['id'], 'id', 'grouped');
fn.missing(); // expect: TS2339 Property 'missing' does not exist
fn.count(); // expect: TS2339 Property 'count' does not exist
agg.hash(); // expect: TS2339 Property 'hash' does not exist
fn.hash('plain'); // expect: TS2345 ExprOperand
fn.hash(1); // expect: TS2345 ExprOperand
agg.count('plain'); // expect: TS2769 No overload matches this call
fn.hash(row, grouped); // expect: TS2345 "grouped"
fn.hash(grouped, row); // expect: TS2345 "row"
fn.hash(agg.count(), grouped); // expect: TS2345 "grouped"
agg.count(row); // expect: TS2769 No overload matches this call
agg.count(agg.count()); // expect: TS2769 No overload matches this call
q.map(() => agg.count().as(col.UInt64)); // expect: TS2322 "agg"
q.where(() => agg.count().as(col.Bool)); // expect: TS2322 "agg"
q.aggregate(g => ({ h: fn.hash(g.id).as(col.UInt64) })); // expect: TS2322 "grouped"
fn.hash(row).as(col.JSON); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.DateTime64(9)); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.Array(col.JSON)); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.Decimal(18, 2)); // expect: TS2769 No overload matches this call
agg.count(val(1), row); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.Variant(col.String, col.UInt64)); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.Map(col.String, col.UInt64)); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.Dynamic); // expect: TS2769 No overload matches this call
fn.hash(row).as(col.AggregateFunction('sum', col.UInt64)); // expect: TS2769 No overload matches this call
