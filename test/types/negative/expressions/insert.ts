import { col, from, table } from '@typedhouse/core';
import type { createClient } from '@typedhouse/client';
const target = table('insert', { id: col.UInt64, value: col.Nullable(col.String), d: col.String, alias: col.String, materialized: col.String, hidden: col.String }, { engine: 'Memory', sortingKey: [], partitionKey: [], columnMetadata: { d: { defaultKind: 'DEFAULT' }, alias: { defaultKind: 'ALIAS' }, materialized: { defaultKind: 'MATERIALIZED' } }, hiddenColumns: ['hidden'] });
const scan = from(target);
const command = scan.insertMany([{ id: 1n, value: null }]);
declare const client: ReturnType<typeof createClient>;
client.execute(scan); // expect: TS2345 insertCommandBrand // expect-ts7: TS2741 insertCommandBrand
client.run(command); // expect: TS2345 InsertCommand // expect-ts7: TS2739 InsertCommand
client.stream(command); // expect: TS2345 InsertCommand // expect-ts7: TS2739 InsertCommand
scan.insertMany([{ id: 1, value: null }]); // expect: TS2322 Type 'number' is not assignable to type 'bigint'.
scan.insertMany([{ id: 1n }]); // expect: TS2322 Property 'value' is missing
scan.insertMany([{ id: 1n, value: null, d: undefined }]); // expect: TS2375 Type 'undefined' is not assignable to type 'string'.
const extra = { id: 1n, value: null, extra: true };
scan.insertMany([extra]); // expect: TS2322 Type 'boolean' is not assignable to type 'never'.
scan.insertMany([{ id: 1n, value: null, alias: 'x' }]); // expect: TS2322 Type 'string' is not assignable to type 'never'.
scan.insertMany([{ id: 1n, value: null, materialized: 'x' }]); // expect: TS2322 Type 'string' is not assignable to type 'never'.
scan.insertMany([{ id: 1n, value: null, hidden: 'x' }]); // expect: TS2322 Type 'string' is not assignable to type 'never'.
scan.final().insertMany([]); // expect: TS2339 Property 'insertMany' does not exist
scan.sample(0.1).insertMany([]); // expect: TS2339 Property 'insertMany' does not exist
scan.where(r => r.id.eq(1n)).insertMany([]); // expect: TS2339 Property 'insertMany' does not exist
scan.map(r => r.id).insertMany([]); // expect: TS2339 Property 'insertMany' does not exist
command.toSQL(); // expect: TS2339 Property 'toSQL' does not exist
command.where(() => true); // expect: TS2339 Property 'where' does not exist
command.ir; // expect: TS2339 Property 'ir' does not exist
