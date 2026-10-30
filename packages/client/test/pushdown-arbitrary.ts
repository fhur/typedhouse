import fc from 'fast-check';
import { crossJoin, join, type Query, type Infer } from '@typedhouse/core';
import { components, parts } from './differential-arbitrary.js';
export const seed = 20261101;
export const recipeArbitrary = fc.record({
  kind: fc.constantFrom('inner' as const, 'cross' as const, 'array' as const, 'leftArray' as const, 'shared' as const),
  tenant: fc.constantFrom('acme', 'other'),
  minimum: fc.integer({ min: 0, max: 5 }),
  renames: fc.integer({ min: 0, max: 3 }),
  nullable: fc.boolean(),
  fence: fc.constantFrom('none' as const, 'distinct' as const, 'limit' as const),
  take: fc.integer({ min: 0, max: 9 }), offset: fc.integer({ min: 0, max: 3 }),
});
export type Recipe = typeof recipeArbitrary extends fc.Arbitrary<infer T> ? T : never;
export function build(recipe: Recipe) {
  const { kind } = recipe;
  const base = components;
  const expanded = kind === 'leftArray' ? base.leftArrayJoin(r => r.ids, 'part') : base.arrayJoin(r => r.ids, 'part');
  let query: Query<Infer<typeof components>> = kind === 'inner' ? join({ c: expanded, p: parts }).on(r => [r.c.tenant.eq(r.p.tenant), r.c.part.eq(r.p.id)])
    .where(r => r.c.tenant.eq(recipe.tenant).and(r.p.tenant.eq(recipe.tenant)))
    .map(r => ({ ...r.c })).map(r => ({ tenant: r.tenant, id: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }))
    : kind === 'cross' ? crossJoin({ c: base, p: parts }).where(r => r.c.tenant.eq(recipe.tenant).and(r.p.tenant.eq(recipe.tenant)))
      .map(r => ({ ...r.c }))
    : kind === 'shared' ? join({ c: base, p: base }).on(r => r.c.tenant.eq(r.p.tenant))
      .where(r => r.c.tenant.eq(recipe.tenant).and(r.p.amount.ge(BigInt(recipe.minimum))).and(r.c.id.eq('a')).and(r.p.id.eq('b')))
      .map(r => ({ ...r.c }))
    : expanded.where(r => r.tenant.eq(recipe.tenant)).map(r => ({ tenant: r.tenant, id: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }));
  for (let i = 0; i < recipe.renames; i++) query = query.map(r => ({ tenant: r.tenant, renamed: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }))
    .map(r => ({ tenant: r.tenant, id: r.renamed, category: r.category, ids: r.ids, at: r.at, amount: r.amount }));
  if (recipe.fence === 'distinct') query = query.distinct();
  if (recipe.fence === 'limit') query = query.orderBy(r => r.tenant).thenBy(r => r.id).limit(recipe.take, recipe.offset);
  query = query.where(r => r.amount.ge(BigInt(recipe.minimum))).where(r => r.tenant.eq(recipe.tenant));
  if (recipe.nullable) query = query.where(r => r.category.isNotNull());
  // Complete rows are functionally determined by (tenant,id), including copies.
  return query.orderBy(r => r.tenant).thenBy(r => r.id);
}
/** Independent native SQL: generated values come only from this closed arbitrary. */
export function native(recipe: Recipe): string {
  const table = 'differential_components';
  const fields = 'c.tenant,c.id,c.category,c.ids,c.at,c.amount';
  const t = `'${recipe.tenant}'`;
  let sql: string;
  if (recipe.kind === 'inner') sql = `SELECT ${fields} FROM (SELECT *, part FROM ${table} ARRAY JOIN ids AS part) c INNER ALL JOIN differential_parts p ON c.tenant=p.tenant AND c.part=p.id WHERE c.tenant=${t} AND p.tenant=${t}`;
  else if (recipe.kind === 'cross') sql = `SELECT ${fields} FROM ${table} c CROSS JOIN differential_parts p WHERE c.tenant=${t} AND p.tenant=${t}`;
  else if (recipe.kind === 'shared') sql = `SELECT ${fields} FROM ${table} c INNER ALL JOIN ${table} p ON c.tenant=p.tenant WHERE c.tenant=${t} AND p.amount>=${recipe.minimum} AND c.id='a' AND p.id='b'`;
  else sql = `SELECT tenant,id,category,ids,at,amount FROM ${table} ${recipe.kind === 'leftArray' ? 'LEFT ' : ''}ARRAY JOIN ids AS part WHERE tenant=${t}`;
  if (recipe.fence === 'distinct') sql = `SELECT DISTINCT * FROM (${sql})`;
  if (recipe.fence === 'limit') sql = `SELECT * FROM (${sql}) ORDER BY tenant,id LIMIT ${recipe.take} OFFSET ${recipe.offset}`;
  return `SELECT * FROM (${sql}) WHERE amount>=${recipe.minimum} AND tenant=${t}${recipe.nullable ? ' AND isNotNull(category)' : ''} ORDER BY tenant,id`;
}
