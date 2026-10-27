import { expectTypeOf } from 'expect-type';
import { col, table, from, val, type Infer, type Row, type IsLive } from '@chql/core';
import { createClient } from '@chql/client';
const t = table('entity', { tenantId: col.String, id: col.UInt64, updatedAt: col.DateTime64(3), category: col.Nullable(col.String), tuple: col.Tuple({ name: col.String }) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const forTenant = (tenantId: string) => <R extends { tenantId: string }>(r: Row<R>) => r.tenantId.eq(tenantId);
const q = from(t).where(forTenant('acme')).map(r => ({ id: r.id, updatedAt: r.updatedAt, category: r.category })).limit(10);
expectTypeOf<Infer<typeof q>>().toEqualTypeOf<{ id: bigint; updatedAt: Date; category: string | null }>();
expectTypeOf<Infer<typeof q>>().not.toBeAny();
expectTypeOf<IsLive<typeof q>>().toEqualTypeOf<false>();
const tuple = from(t).where(forTenant('acme')).map(r => ({ renamed: r.tuple })).limit(2).map(r => ({ name: r.renamed.element('name') }));
expectTypeOf<Infer<typeof tuple>>().toEqualTypeOf<{ name: string }>();
expectTypeOf<Infer<typeof tuple>>().not.toBeAny();
const wrapped = table('wrapped', { label: col.LowCardinality(col.String), optional: col.LowCardinality(col.Nullable(col.String)) }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const composed = from(wrapped).where(r => r.label.eq('safe')).map(r => ({ renamed: r.optional }))
  .where(r => r.renamed.eq('value')).limit(1, 0).map(r => ({ result: r.renamed }));
expectTypeOf<Infer<typeof composed>>().toEqualTypeOf<{ result: string | null }>();
expectTypeOf<Infer<typeof composed>>().not.toBeAny();
const retainedWrapper: typeof wrapped.columns.optional = composed.row.result.ir.type;
void retainedWrapper;
const structuralTable = table('structural', { names: col.Array(col.String), specs: col.Array(col.Tuple({ mpn: col.Nullable(col.String), description: col.Nullable(col.String) })), n: col.UInt32 }, { engine: 'Memory', sortingKey: [], partitionKey: [] });
const structural = from(structuralTable).where(r => r.names.hasAny([]).or(r.names.empty()))
  .map(r => ({ specs: r.specs, size: r.names.length(), total: r.n.plus(2) })).limit(2)
  .map(r => ({ mpns: r.specs.element('mpn'), first: r.specs.arrayElement(-1).element('description'), size: r.size, total: r.total.multiply(2n), empty: r.size.eq(0n) }));
expectTypeOf<Infer<typeof structural>>().toEqualTypeOf<{ mpns: (string | null)[]; first: string | null; size: bigint; total: bigint; empty: boolean }>();
expectTypeOf<Infer<typeof structural>>().not.toBeAny();
const repairComposition = from(structuralTable).limit(1).map(() => ({
  flags: val([null, false, true], col.Array(col.Nullable(col.Bool))),
  missing: val(null, col.Nullable(col.Int32)),
})).map(r => ({ first: r.flags.arrayElement(1), fallback: r.missing.ifNull(val(4294967295, col.UInt32)) }));
expectTypeOf<Infer<typeof repairComposition>>().toEqualTypeOf<{ first: boolean | null; fallback: bigint }>();
expectTypeOf<Infer<typeof repairComposition>>().not.toBeAny();
const client = createClient();
const structuralRun = () => client.run(structural);
expectTypeOf<Awaited<ReturnType<typeof structuralRun>>>().toEqualTypeOf<{ mpns: (string | null)[]; first: string | null; size: bigint; total: bigint; empty: boolean }[]>();
expectTypeOf<Awaited<ReturnType<typeof structuralRun>>>().not.toBeAny();
const run = () => client.run(q);
expectTypeOf<Awaited<ReturnType<typeof run>>>().toEqualTypeOf<{ id: bigint; updatedAt: Date; category: string | null }[]>();
expectTypeOf<Awaited<ReturnType<typeof run>>>().not.toBeAny();
// @ts-expect-error predicate must be boolean
from(t).where(r => r.id);
// @ts-expect-error flat expression projection only
from(t).map(r => ({ nested: { id: r.id } }));
// @ts-expect-error exact retained tuple names
from(t).map(r => ({ x: r.tuple.element('missing') }));
