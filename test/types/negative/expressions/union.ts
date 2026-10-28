import { from, table, col, unionAll, count } from '@chql/core';
const q = from(table('t', { id: col.UInt32, name: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
unionAll(q); // expect: TS2345 Source has 0 element(s) but target requires 1
unionAll(q, q.map(r => r.id)); // expect: TS2345 union_row_mismatch
unionAll(q, q.map(r => ({ id: r.name, name: r.name }))); // expect: TS2345 union_row_mismatch
unionAll(q, q, q.map(r => ({ id: r.id, name: r.name, extra: r.id }))); // expect: TS2345 union_row_mismatch
unionAll(q, q).thenBy; // expect: TS2339 Property 'thenBy' does not exist
unionAll(q, q).final; // expect: TS2339 Property 'final' does not exist
unionAll(q, q).map(() => ({ n: count() })); // expect: TS2322 Type 'Expr<bigint, "count", "agg">' is not assignable to type 'Expr<unknown, string, "row">'
