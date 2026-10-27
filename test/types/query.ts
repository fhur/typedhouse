import { expectTypeOf } from 'expect-type';
import { count, countIf, sum, sumIf, max, maxIf, col, table, from, val, type Query, type Infer, type Row, type IsLive } from '@chql/core';
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
const ordered = from(t).orderBy(r => r.id.desc()).thenBy(r => r.category.asc().nullsLast());
expectTypeOf<Infer<typeof ordered>>().toEqualTypeOf<Infer<typeof t>>();
expectTypeOf<Infer<typeof ordered>>().not.toBeAny();
const named = ordered.map(r => r.tuple).distinct().orderBy(r => r.tuple.element('name')).thenBy(r => r.tuple.element('name').desc()).limit(2).map(r => r.tuple.element('name'));
expectTypeOf<Infer<typeof named>>().toEqualTypeOf<{ tuple: string }>();
expectTypeOf<Infer<typeof named>>().not.toBeAny();
const renamedSingle = from(t).map(r => ({ renamed: r.tuple })).map(r => r.renamed).distinct();
expectTypeOf<Infer<typeof renamedSingle>>().toEqualTypeOf<{ renamed: { name: string } }>();
expectTypeOf<Infer<typeof renamedSingle>>().not.toBeAny();
const prototypeSingle = from(t).map(r => ({ ['__proto__']: r.category })).map(r => r.__proto__).distinct().orderBy(r => r.__proto__.desc().nullsLast()).limit(3);
expectTypeOf<Infer<typeof prototypeSingle>>().toEqualTypeOf<{ __proto__: string | null }>();
expectTypeOf<Infer<typeof prototypeSingle>>().not.toBeAny();
const computedSingle = from(t).orderBy(() => val(1)).thenBy(r => r.id).limit(2, 1).map(r => r.id.plus(2n)).distinct();
expectTypeOf<Infer<typeof computedSingle>>().toEqualTypeOf<{ id: bigint }>();
expectTypeOf<Infer<typeof computedSingle>>().not.toBeAny();
const retainedTuple: typeof t.columns.tuple = renamedSingle.row.renamed.ir.type;
void retainedTuple;
expectTypeOf<'thenBy' extends keyof typeof named ? true : false>().toEqualTypeOf<false>();
const grouped = from(structuralTable).groupBy(r => r.n).aggregate(g => ({ total: sum(g.n), names: max(g.specs), count: count() }));
expectTypeOf<Infer<typeof grouped>>().toEqualTypeOf<{ n: number; total: bigint; names: { mpn: string | null; description: string | null }[]; count: bigint }>();
expectTypeOf<Infer<typeof grouped>>().not.toBeAny();
const genericGrouped = <R extends { id: bigint; category: string | null }>(input: Query<R>) => input.groupBy(r => r.category).aggregate(g => ({ newest: max(g.id) }));
const genericResult = genericGrouped(from(t));
expectTypeOf<Infer<typeof genericResult>>().toEqualTypeOf<{ category: string | null; newest: bigint }>();
expectTypeOf<Infer<typeof genericResult>>().not.toBeAny();
const global = from(structuralTable).aggregate(g => sum(g.n));
expectTypeOf<Infer<typeof global>>().toEqualTypeOf<{ n: bigint }>();
expectTypeOf<Infer<typeof global>>().not.toBeAny();
const namedCount = from(t).groupBy(r => r.category).aggregate(() => count());
expectTypeOf<Infer<typeof namedCount>>().toEqualTypeOf<{ category: string | null; count: bigint }>();
expectTypeOf<Infer<typeof namedCount>>().not.toBeAny();
const afterGroup = grouped.where(r => r.total.gt(1n)).orderBy(r => r.total).limit(2).map(r => r.names.arrayElement(1).element('mpn'));
expectTypeOf<Infer<typeof afterGroup>>().toEqualTypeOf<{ names: string | null }>();
expectTypeOf<Infer<typeof afterGroup>>().not.toBeAny();
const nullablePredicate = from(table('predicate', { n: col.UInt32, p: col.Nullable(col.Bool) }, { engine: 'Memory', sortingKey: [], partitionKey: [] }))
  .aggregate(g => ({ s: sumIf(g.n, g.p), m: maxIf(g.n, g.p), c: countIf(g.p) }));
expectTypeOf<Infer<typeof nullablePredicate>>().toEqualTypeOf<{ s: bigint; m: number; c: bigint }>();
expectTypeOf<Infer<typeof nullablePredicate>>().not.toBeAny();
const repeatedAggregation = grouped.where(r => r.count.gt(1n)).orderBy(r => r.total).limit(1)
  .aggregate(g => ({ total: sum(g.total), high: max(g.count), rows: count() }));
expectTypeOf<Infer<typeof repeatedAggregation>>().toEqualTypeOf<{ total: bigint; high: bigint; rows: bigint }>();
expectTypeOf<Infer<typeof repeatedAggregation>>().not.toBeAny();
const structuralMaximum = from(t).groupBy(r => ({ flag: r.category.isNull() })).aggregate(g => ({ pair: max(g.tuple) }))
  .map(r => ({ flag: r.flag, label: r.pair.element('name') }));
expectTypeOf<Infer<typeof structuralMaximum>>().toEqualTypeOf<{ flag: boolean; label: string }>();
expectTypeOf<Infer<typeof structuralMaximum>>().not.toBeAny();
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
