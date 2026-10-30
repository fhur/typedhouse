import { from, table, col, val, count, columnExpr, Expr, exprNode, type NodeId } from '@typedhouse/core';
const q = from(table('t', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const ordered = q.orderBy(r => r.id);
ordered.map(r => r.id).thenBy; // expect: TS2339 Property 'thenBy' does not exist
ordered.where(r => r.id.eq(1n)).thenBy; // expect: TS2339 Property 'thenBy' does not exist
ordered.limit(1).thenBy; // expect: TS2339 Property 'thenBy' does not exist
ordered.distinct().thenBy; // expect: TS2339 Property 'thenBy' does not exist
q.orderBy(() => count()); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
q.orderBy(() => count().desc()); // expect: TS2322 Type '"agg"' is not assignable to type '"row"'.
const grouped = columnExpr(col.UInt64, 1 as NodeId, ['id'], 'id', 'grouped');
ordered.thenBy(() => grouped.asc()); // expect: TS2322 Type '"grouped"' is not assignable to type '"row"'.
q.map(() => val(1)); // expect: TS2322 unnamed_expression
const raw = new Expr<number>(exprNode({ kind: 'Raw', type: col.Float64.type, resolution: 'declared', opaque: true, provenance: { origin: 'sql' }, parts: ['1'], args: [] }), undefined as never, 'row');
q.map(() => raw); // expect: TS2322 unnamed_expression
