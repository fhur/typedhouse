import { avgState, col, columnExpr, from, maxMerge, minState, quantile, quantileExactMerge, quantileMerge, quantileState, sumMerge, sumState, table, uniqState, argMaxState, uniqMerge, type NodeId } from '@typedhouse/core';
const t = table('t', { k: col.String, total: col.AggregateFunction('sum', col.UInt64), p: col.AggregateFunction('quantile(0.9)', col.Float64), s: col.String, d: col.Decimal(18, 2), lc: col.LowCardinality(col.String) }, { engine: 'AggregatingMergeTree', sortingKey: ['k'], partitionKey: [] });
const q = from(t);
// Wrong function.
q.aggregate(g => ({ x: maxMerge(g.total) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: uniqMerge(g.total) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: quantileMerge(0.5)(g.total) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: quantileExactMerge(0.5)(g.p) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: sumMerge(g.p) })); // expect: TS2345 is not assignable to parameter
// Not a state.
q.aggregate(g => ({ x: sumMerge(g.k) })); // expect: TS2345 is not assignable to parameter
// A row-mode column in a map is not grouped.
q.map(r => { sumMerge(r.total); return { k: r.k }; }); // expect: TS2345 is not assignable to parameter
const merged = columnExpr(col.AggregateFunction('sum', col.UInt64), 1 as NodeId, ['s'], 's', 'grouped');
q.map(() => ({ x: sumMerge(merged) })); // expect: TS2322 is not assignable to type
// A level is required: the state is not a level.
quantileMerge(merged); // expect: TS2345 is not assignable to parameter
quantileMerge(); // expect: TS2554 Expected 1 arguments
quantileExactMerge(); // expect: TS2554 Expected 1 arguments
quantileState(); // expect: TS2554 Expected 1 arguments
// Operand families match the base function.
q.aggregate(g => ({ x: sumState(g.s) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: avgState(g.d) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: quantileState(0.5)(g.d) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: uniqState(g.lc) })); // expect: TS2345 is not assignable to parameter
q.aggregate(g => ({ x: argMaxState(g.d, g.s) })); // expect: TS2345 is not assignable to parameter
// Row-mode operands and a base aggregate's result are not states.
q.map(r => { minState(r.s); return { k: r.k }; }); // expect: TS2345 is not assignable to parameter
const base = columnExpr(col.Float64, 1 as NodeId, ['x'], 'x', 'grouped');
quantileMerge(0.5)(quantile(0.5)(base)); // expect: TS2345 is not assignable to parameter
