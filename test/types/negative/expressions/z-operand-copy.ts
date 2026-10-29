import { col, from, table, val } from '@chql/core';
const q = from(table('operand_copy', { n: col.Float64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
// Object spread drops Expr's prototype/private brand, not its declared symbol
// properties. A copied wrapper is not recognized by operand() at runtime.
q.row.n.plus({ ...q.row.n }); // expect: TS2769 No overload matches this call.
q.row.n.divide({ ...val(1, col.Float64) }); // expect: TS2769 No overload matches this call.
