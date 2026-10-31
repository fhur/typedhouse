import fc from 'fast-check';
import { cast, col, from, table, type Query } from '@typedhouse/core';
export const seed = 20261119;
export const items = from(table('array_join_items', {
  tenant: col.String, id: col.String, category: col.Nullable(col.String),
  ids: col.Array(col.String), parts: col.Array(col.Tuple({ id: col.String, mpn: col.Nullable(col.String) })), amount: col.UInt64,
}, { engine: 'MergeTree', sortingKey: ['tenant', 'id'], partitionKey: [] }));
type Base = { tenant: string; id: string; category: string | null; ids: string[]; parts: { id: string; mpn: string | null }[]; amount: bigint };
export type Expanded = Base & { part: string | null };
/** `before` is a filter under the expansion: safe folds under both kinds, total/unsafe only under LEFT.
 * `after` filters above it: an alias-dependent one stays above, an independent one is pushed below. */
export interface Recipe {
  tenant: 'acme' | 'other'; left: boolean; source: 'ids' | 'mpn';
  before: 'none' | 'safe' | 'total' | 'unsafe'; after: 'none' | 'alias' | 'independent' | 'both';
  fence: 'none' | 'distinct' | 'sort'; project: boolean; minimum: number; take: number;
}
export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({
  tenant: fc.constantFrom('acme' as const, 'other' as const), left: fc.boolean(), source: fc.constantFrom('ids' as const, 'mpn' as const),
  before: fc.constantFrom('none' as const, 'safe' as const, 'total' as const, 'unsafe' as const),
  after: fc.constantFrom('none' as const, 'alias' as const, 'independent' as const, 'both' as const),
  fence: fc.constantFrom('none' as const, 'distinct' as const, 'sort' as const), project: fc.boolean(),
  minimum: fc.integer({ min: 0, max: 8 }), take: fc.integer({ min: 0, max: 6 }),
});
export function build(recipe: Recipe) {
  // Keep the inferred row type here: an explicit `Query<Base>` would erase the tuple-array column's descriptor.
  const q = recipe.before === 'safe' ? items.where(r => r.tenant.eq(recipe.tenant))
    : recipe.before === 'total' ? items.where(r => r.amount.plus(1n).ge(BigInt(recipe.minimum)))
    : recipe.before === 'unsafe' ? items.where(r => cast(r.amount, col.String).ne('x')) : items;
  // The element type differs per source (String vs Nullable(String)); the IR carries the exact descriptor.
  const expanded = (recipe.source === 'ids'
    ? recipe.left ? q.leftArrayJoin(r => r.ids, 'part') : q.arrayJoin(r => r.ids, 'part')
    : recipe.left ? q.leftArrayJoin(r => r.parts.element('mpn'), 'part') : q.arrayJoin(r => r.parts.element('mpn'), 'part')) as unknown as Query<Expanded>;
  let e: Query<Expanded> = expanded;
  if (recipe.after === 'alias' || recipe.after === 'both') e = e.where(r => r.part.eq('p'));
  if (recipe.after === 'independent' || recipe.after === 'both') e = e.where(r => r.category.isNotNull());
  if (recipe.fence === 'distinct') e = e.distinct();
  // Ties on (tenant,id,part) are identical rows, so LIMIT is deterministic.
  if (recipe.fence === 'sort') e = e.orderBy(r => r.tenant).thenBy(r => r.id).thenBy(r => r.part).limit(recipe.take);
  if (recipe.project) {
    const projected = e.map(r => ({ tenant: r.tenant, id: r.id, part: r.part, amount: r.amount }));
    return projected.orderBy(r => r.tenant).thenBy(r => r.id).thenBy(r => r.part);
  }
  return e.orderBy(r => r.tenant).thenBy(r => r.id).thenBy(r => r.part);
}
/** Independent native SQL: every stage is its own subquery; the expansion is written on a derived table. */
export function native(recipe: Recipe): string {
  const all = 'tenant,id,category,ids,parts,amount';
  let sql = `SELECT ${all} FROM array_join_items`;
  if (recipe.before === 'safe') sql = `SELECT ${all} FROM (${sql}) WHERE tenant='${recipe.tenant}'`;
  if (recipe.before === 'total') sql = `SELECT ${all} FROM (${sql}) WHERE amount+1>=${recipe.minimum}`;
  if (recipe.before === 'unsafe') sql = `SELECT ${all} FROM (${sql}) WHERE toString(amount)!='x'`;
  const expression = recipe.source === 'ids' ? 'ids' : "tupleElement(parts,'mpn')";
  sql = `SELECT ${all},part FROM (${sql}) ${recipe.left ? 'LEFT ' : ''}ARRAY JOIN ${expression} AS part`;
  if (recipe.after === 'alias' || recipe.after === 'both') sql = `SELECT ${all},part FROM (${sql}) WHERE part='p'`;
  if (recipe.after === 'independent' || recipe.after === 'both') sql = `SELECT ${all},part FROM (${sql}) WHERE isNotNull(category)`;
  if (recipe.fence === 'distinct') sql = `SELECT DISTINCT ${all},part FROM (${sql})`;
  if (recipe.fence === 'sort') sql = `SELECT ${all},part FROM (${sql}) ORDER BY tenant,id,part LIMIT ${recipe.take}`;
  const list = recipe.project ? 'tenant,id,part,amount' : `${all},part`;
  return `SELECT ${list} FROM (${sql}) ORDER BY tenant,id,part`;
}
export function shape(recipe: Recipe): string {
  return `${recipe.left ? 'left' : 'inner'}:${recipe.source}:${recipe.before}:${recipe.after}:${recipe.fence}:${recipe.project ? 'project' : 'full'}`;
}
/** Slice 3b: an `independent` filter pushed below the expansion lands above an `unsafe` (non-total) `before` filter and
 * is never AND-ed into it, so that block closes under the expansion (`total` merges with it instead: both are total). */
function pushedAboveUnsafe(recipe: Recipe): boolean {
  return recipe.before === 'unsafe' && (recipe.after === 'independent' || recipe.after === 'both');
}
/** The expansion folds into the scan block when it is LEFT over a single Filter block, or no non-safe filter sits under an inner one. */
export function expansionFolds(recipe: Recipe): boolean {
  return (recipe.left && !pushedAboveUnsafe(recipe)) || recipe.before === 'none' || recipe.before === 'safe';
}
/** One SELECT exactly when the expansion folds, no total filter sits above a folded non-total one (the `alias` filter
 * over an `unsafe` LEFT block opens its own, slice 3b), no second ORDER BY follows a LIMIT (the `sort` fence always
 * re-sorts above its LIMIT) and no selection follows DISTINCT (it opens a block, and the ordering above it another). */
export function foldsToOneSelect(recipe: Recipe): boolean {
  return expansionFolds(recipe) && !(recipe.before === 'unsafe' && recipe.after !== 'none') && recipe.fence !== 'sort' && !(recipe.fence === 'distinct' && recipe.project);
}
