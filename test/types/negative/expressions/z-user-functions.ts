import { col, columnExpr, count, defineFunction, from, stringLike, table, val, type NodeId } from '@chql/core';
const distance = defineFunction({ name: 'editDistance', args: [stringLike, stringLike], returns: col.UInt64, deterministic: true });
const repeat = defineFunction({ name: 'repeat', args: [col.String, col.UInt64], returns: col.String, deterministic: true });
const q = from(table('parts', { mpn: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const grouped = columnExpr(col.String, 1 as NodeId, ['mpn'], 'mpn', 'grouped');
distance('a'); // expect: TS2554 Expected 2 arguments
distance('a', 'b', 'c'); // expect: TS2554 Expected 2 arguments
distance(1, 'a'); // expect: TS2345 Input<string, Mode>
distance(q.row.mpn, grouped); // expect: TS2345 never
distance(grouped, q.row.mpn); // expect: TS2345 never
distance(val('a'), count()); // expect: TS2345 bigint
repeat(q.row.mpn, 2); // expect: TS2345 Input<bigint, Mode>
repeat(q.row.mpn, count()); // expect: TS2345 never
repeat(grouped, count()); // expect: TS2345 never
q.map(() => distance(grouped, 'a')); // expect: TS2322 "grouped"
q.aggregate(g => distance(g.mpn, 'a')); // expect: TS2322 "grouped"
q.where(p => distance(p.mpn, 'a')); // expect: TS2322 bigint
q.map(p => distance(p.mpn, 'a')).where(p => p.mpn.gt(2)); // expect: TS2345 Operand<bigint
