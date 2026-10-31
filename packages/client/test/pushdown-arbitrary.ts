import fc from 'fast-check';
import { cast, col, crossJoin, defineFunction, join, val, type Expr, type Query, type Infer } from '@typedhouse/core';
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
  /** `constant` expands a Param array: any total array expression may now be filtered below. */
  expansion: fc.constantFrom('column' as const, 'constant' as const),
  /** Adds a total-arithmetic and a cast conjunct to the first filter: only the safe conjuncts may cross. */
  mixed: fc.boolean(),
  /** Adds a filter outside the total fragment directly after the first one: `intDiv(10, amount) > 0` fails with
   * ILLEGAL_DIVISION on the `amount = 0` row whenever that row reaches it (see `fails`), so the kept and the filtered-out
   * cases both occur. The planner keeps it in its own SELECT above the earlier filters (slice 3b). */
  fallible: fc.boolean(),
});
export type Recipe = typeof recipeArbitrary extends fc.Arbitrary<infer T> ? T : never;
/** ClickHouse's integer division as a user function: outside the total fragment, and 10 / 0 raises ILLEGAL_DIVISION. */
export const intDiv = defineFunction({ name: 'intDiv', args: [col.UInt64, col.UInt64], returns: col.UInt64, deterministic: true });
const failing = (amount: Expr<bigint, string, 'row'>) => intDiv(val(10n, col.UInt64), amount).gt(0n);
export function build(recipe: Recipe) {
  const { kind } = recipe;
  const base = components;
  const constant = val(['p', 'q'], col.Array(col.String));
  const array = recipe.expansion === 'column' ? (r: typeof base.row) => r.ids : () => constant;
  const expanded = kind === 'leftArray' ? base.leftArrayJoin(array, 'part') : base.arrayJoin(array, 'part');
  const extra = (r: { amount: Expr<bigint, string, 'row'> }, pred: Expr<boolean, string, 'row'>) =>
    recipe.mixed ? pred.and(r.amount.plus(1n).ge(BigInt(recipe.minimum + 1))).and(cast(r.amount, col.String).ne('x')) : pred;
  // The fallible filter follows the first filter directly, before any selection, so it lands on the join or expanded block
  // itself. `where` keeps the row type; only the caps parameter differs nominally, hence the cast back to the first filter's type.
  const inner = () => {
    const first = join({ c: expanded, p: parts }).on(r => [r.c.tenant.eq(r.p.tenant), r.c.part.eq(r.p.id)]).where(r => extra(r.c, r.c.tenant.eq(recipe.tenant).and(r.p.tenant.eq(recipe.tenant))));
    return recipe.fallible ? first.where(r => failing(r.c.amount)) as typeof first : first;
  };
  const cross = () => {
    const first = crossJoin({ c: base, p: parts }).where(r => extra(r.c, r.c.tenant.eq(recipe.tenant).and(r.p.tenant.eq(recipe.tenant))));
    return recipe.fallible ? first.where(r => failing(r.c.amount)) as typeof first : first;
  };
  const shared = () => {
    const first = join({ c: base, p: base }).on(r => r.c.tenant.eq(r.p.tenant)).where(r => extra(r.c, r.c.tenant.eq(recipe.tenant).and(r.p.amount.ge(BigInt(recipe.minimum))).and(r.c.id.eq('a')).and(r.p.id.eq('b'))));
    return recipe.fallible ? first.where(r => failing(r.c.amount)) as typeof first : first;
  };
  const flat = () => {
    const first = expanded.where(r => extra(r, r.tenant.eq(recipe.tenant)));
    return recipe.fallible ? first.where(r => failing(r.amount)) as typeof first : first;
  };
  let query: Query<Infer<typeof components>> = kind === 'inner' ? inner()
    .map(r => ({ ...r.c })).map(r => ({ tenant: r.tenant, id: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }))
    : kind === 'cross' ? cross().map(r => ({ ...r.c }))
    : kind === 'shared' ? shared().map(r => ({ ...r.c }))
    : flat().map(r => ({ tenant: r.tenant, id: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }));
  for (let i = 0; i < recipe.renames; i++) query = query.map(r => ({ tenant: r.tenant, renamed: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }))
    .map(r => ({ tenant: r.tenant, id: r.renamed, category: r.category, ids: r.ids, at: r.at, amount: r.amount }));
  if (recipe.fence === 'distinct') query = query.distinct();
  if (recipe.fence === 'limit') query = query.orderBy(r => r.tenant).thenBy(r => r.id).limit(recipe.take, recipe.offset);
  query = query.where(r => r.amount.ge(BigInt(recipe.minimum))).where(r => r.tenant.eq(recipe.tenant));
  if (recipe.nullable) query = query.where(r => r.category.isNotNull());
  // Complete rows are functionally determined by (tenant,id), including copies.
  return query.orderBy(r => r.tenant).thenBy(r => r.id);
}
/** Whether the `amount = 0` row (acme, id c, empty `ids`) certainly reaches the fallible filter in IR order, so that every
 * execution fails with ILLEGAL_DIVISION: it survives the cross join, a LEFT expansion and a constant (Param) expansion,
 * not an inner expansion of its own empty array nor the shared join's `c.id = 'a'`, and the mixed arithmetic conjunct
 * `amount + 1 >= minimum + 1` on the first filter removes it unless `minimum` is 0. One-directional: the server may
 * divide more rows than IR order says (it pushes an alias-independent predicate below an inner ARRAY JOIN in any text),
 * never fewer; the differential requires both texts and the oracle to agree either way. */
export function fails(recipe: Recipe): boolean {
  const reaches = recipe.kind === 'cross' || recipe.kind === 'leftArray' || ((recipe.kind === 'inner' || recipe.kind === 'array') && recipe.expansion === 'constant');
  return recipe.fallible && recipe.tenant === 'acme' && reaches && (!recipe.mixed || recipe.minimum === 0);
}
/** Independent native SQL: generated values come only from this closed arbitrary. */
export function native(recipe: Recipe): string {
  const table = 'differential_components';
  const fields = 'c.tenant,c.id,c.category,c.ids,c.at,c.amount';
  const t = `'${recipe.tenant}'`;
  const expansion = recipe.expansion === 'column' ? 'ids' : "['p','q']";
  const extra = (alias: string) => recipe.mixed ? ` AND ${alias}.amount+1>=${recipe.minimum + 1} AND toString(${alias}.amount)!='x'` : '';
  let sql: string;
  if (recipe.kind === 'inner') sql = `SELECT ${fields} FROM (SELECT *, part FROM ${table} ARRAY JOIN ${expansion} AS part) c INNER ALL JOIN differential_parts p ON c.tenant=p.tenant AND c.part=p.id WHERE c.tenant=${t} AND p.tenant=${t}${extra('c')}`;
  else if (recipe.kind === 'cross') sql = `SELECT ${fields} FROM ${table} c CROSS JOIN differential_parts p WHERE c.tenant=${t} AND p.tenant=${t}${extra('c')}`;
  else if (recipe.kind === 'shared') sql = `SELECT ${fields} FROM ${table} c INNER ALL JOIN ${table} p ON c.tenant=p.tenant WHERE c.tenant=${t} AND p.amount>=${recipe.minimum} AND c.id='a' AND p.id='b'${extra('c')}`;
  else sql = `SELECT c.tenant,c.id,c.category,c.ids,c.at,c.amount FROM ${table} c ${recipe.kind === 'leftArray' ? 'LEFT ' : ''}ARRAY JOIN ${expansion} AS part WHERE c.tenant=${t}${extra('c')}`;
  // The fallible filter is written on its own derived table: it must only see the rows the first filter passes.
  if (recipe.fallible) sql = `SELECT * FROM (${sql}) WHERE intDiv(10, amount) > 0`;
  if (recipe.fence === 'distinct') sql = `SELECT DISTINCT * FROM (${sql})`;
  if (recipe.fence === 'limit') sql = `SELECT * FROM (${sql}) ORDER BY tenant,id LIMIT ${recipe.take} OFFSET ${recipe.offset}`;
  return `SELECT * FROM (${sql}) WHERE amount>=${recipe.minimum} AND tenant=${t}${recipe.nullable ? ' AND isNotNull(category)' : ''} ORDER BY tenant,id`;
}
/** Expansion only matters where the recipe expands; cross/shared recipes never do. */
export function shape(recipe: Recipe): string {
  const expands = recipe.kind === 'inner' || recipe.kind === 'array' || recipe.kind === 'leftArray';
  return `${recipe.kind}:${recipe.fence}:${expands ? recipe.expansion : '-'}:${recipe.mixed ? 'mixed' : 'plain'}:${recipe.fallible ? 'fallible' : 'total'}`;
}
export const shapeCount = (3 * 3 * 2 * 2 + 2 * 3 * 2) * 2;
