import { col, from, table, uniqExact, uniqExactIf, val, type Column } from '@typedhouse/core';
const q = from(table('unsupported', { fixed: col.FixedString(3), precise: col.DateTime64(6), decimal: col.Decimal64(2), low: col.LowCardinality(col.String), array: col.Array(col.String), mixed: Math.random() ? col.String : col.DateTime64(6), nested: Math.random() ? col.Nullable(col.String) : col.Nullable(col.FixedString(3)), n: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
q.aggregate(g => uniqExact(g.fixed)); // expect: TS2345 parameter of type 'never'
q.aggregate(g => uniqExact(g.precise)); // expect: TS2345 parameter of type 'never'
q.aggregate(g => uniqExact(g.decimal)); // expect: TS2345 parameter of type 'never'
q.aggregate(g => uniqExact(g.low)); // expect: TS2345 parameter of type 'never'
q.aggregate(g => uniqExact(g.array)); // expect: TS2345 AggregateOperand
q.aggregate(g => uniqExact(g.mixed)); // expect: TS2345 parameter of type 'never'
q.aggregate(g => uniqExact(g.nested)); // expect: TS2345 parameter of type 'never'
q.aggregate(g => uniqExact(g.n)); // expect: TS2345 AggregateOperand
uniqExact(q.row.fixed); // expect: TS2345 AggregateOperand
q.aggregate(g => uniqExactIf(val('x'), g.n)); // expect: TS2345 AggregateOperand
q.map(() => uniqExact(val('x'))); // expect: TS2322 not assignable
q.aggregate(() => uniqExact(uniqExact(val('x')))); // expect: TS2345 AggregateOperand
uniqExact(); // expect: TS2554 Expected 1 arguments
uniqExact(val('a'), val('b')); // expect: TS2554 Expected 1 arguments
uniqExactIf(val('a')); // expect: TS2554 Expected 2 arguments
uniqExact(val('a', col.Enum8({ a: 1 }))); // expect: TS2345 parameter of type 'never'
uniqExactIf(val('a'), val(true, col.LowCardinality(col.Bool))); // expect: TS2345 parameter of type 'never'
declare const innerUnion: Column<string, true, typeof col.String.type | ReturnType<typeof col.FixedString<3>>['type']>;
const inner = from(table('inner_union', { x: col.Nullable(innerUnion) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
inner.aggregate(g => uniqExact(g.x)); // expect: TS2345 parameter of type 'never'
uniqExact(val('x', Math.random() ? col.String : col.FixedString(3))); // expect: TS2345 parameter of type 'never'
uniqExactIf(val('x'), val(true, Math.random() ? col.Bool : col.LowCardinality(col.Bool))); // expect: TS2345 parameter of type 'never'
declare const predicateInner: Column<boolean, true, typeof col.Bool.type | { readonly kind: 'LowCardinality'; readonly inner: typeof col.Bool.type }>;
const predicateUnion = from(table('predicate_union', { p: col.Nullable(predicateInner) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
predicateUnion.aggregate(g => uniqExactIf(val('x'), g.p)); // expect: TS2345 parameter of type 'never'
