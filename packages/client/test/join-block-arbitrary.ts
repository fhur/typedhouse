import fc from 'fast-check';
import { count, crossJoin, join, sum, type Query } from '@typedhouse/core';
import { buildTree, nativeTree, source, recipeArbitrary as trees, topology, type Tree } from './pruning-arbitrary.js';
export const seed = 20261123;
export interface Recipe { tree: Tree; shared: boolean; fence: boolean; projection: boolean; aggregate: boolean }
export const recipes: fc.Arbitrary<Recipe> = fc.record({ tree: trees.map(r => r.tree), shared: fc.boolean(), fence: fc.boolean(), projection: fc.boolean(), aggregate: fc.boolean() });
export function shape(r: Recipe) { return `${topology(r.tree)}:${r.shared}:${r.fence}:${r.projection}:${r.aggregate}`; }
export function build(r: Recipe, loseCondition = false) {
  const left = buildTree(r.tree);
  const right = r.shared ? left : source;
  const b = r.fence ? right.orderBy(x => x.tenant).thenBy(x => x.id).limit(2) : right;
  const joined = loseCondition ? crossJoin({ a: left, b }) : join({ a: left, b }).on(x => [x.a.id.eq(x.b.id), x.a.tenant.eq(x.b.tenant)]);
  const projected = joined.map(x => ({ id: x.a.id, amount: x.b.amount }));
  if (r.aggregate) return r.projection
    ? projected.groupBy(x => ({ key: x.id })).aggregate(g => ({ n: count(), total: sum(g.amount) }))
    : joined.groupBy(x => ({ key: x.a.id })).aggregate(g => ({ n: count(), total: sum(g.b.amount) }));
  return r.projection ? projected : joined;
}
function nativeFrom(r: Recipe) {
  const a = nativeTree(r.tree);
  let b = r.shared ? a : 'SELECT id,tenant,amount,spare,ids,waste FROM pruning_wide';
  if (r.fence) b = `SELECT * FROM (${b}) ORDER BY tenant,id LIMIT 2`;
  return `FROM (${a}) a INNER ALL JOIN (${b}) b ON a.id=b.id AND a.tenant=b.tenant`;
}
export function native(r: Recipe) {
  const from = nativeFrom(r);
  // Nested output is represented by named tuples in the independent oracle,
  // then decoded to the same path-aware row shape as the Backend.
  if (r.aggregate) return `SELECT a.id AS key,count() AS n,sum(b.amount) AS total ${from} GROUP BY a.id`;
  if (r.projection) return `SELECT a.id AS id,b.amount AS amount ${from}`;
  const fields = (alias: string, waste: boolean) => `CAST(tuple(${alias}.id,${alias}.tenant,${alias}.amount,${alias}.spare,${alias}.ids${waste ? `,${alias}.waste` : ''}) AS Tuple(id String,tenant String,amount UInt64,spare String,ids Array(String)${waste ? ',waste String' : ''}))`;
  return `SELECT ${fields('a', false)} AS a,${fields('b', !r.shared)} AS b ${from}`;
}

/** Slice 4c variant: aggregates folded onto (or fenced off) the join block whose output aliases collide with join-input
 * columns. `key`: `id` = a.id (identity read of a name both inputs carry), `tenant` = b.id (alias = another column of
 * both inputs), `waste` = a.tenant (alias = a column only the pruned right scan or a nested scan carries), `k` = a.id
 * (no collision). `aggs`: `amount`/`spare` collide with input columns (the second reads `b`.`amount`), `n`/`total` do not.
 * `having`/`order` name the count or key alias unqualified, which is where prefer_column_name_to_alias = 1 binds a column. */
export interface Colliding { base: Recipe; key: 'id' | 'tenant' | 'waste' | 'k'; aggs: 'collide' | 'plain'; having: 'none' | 'count' | 'key'; order: 'none' | 'count' | 'key' }
export const colliding: fc.Arbitrary<Colliding> = fc.record({
  base: recipes, key: fc.constantFrom('id' as const, 'tenant' as const, 'waste' as const, 'k' as const), aggs: fc.constantFrom('collide' as const, 'plain' as const),
  having: fc.constantFrom('none' as const, 'count' as const, 'key' as const), order: fc.constantFrom('none' as const, 'count' as const, 'key' as const),
});
export function collidingShape(r: Colliding) { return `${shape(r.base)}:${r.key}:${r.aggs}:${r.having}:${r.order}`; }
const keyColumn = { id: 'a.id', tenant: 'b.id', waste: 'a.tenant', k: 'a.id' } as const;
export function buildColliding(r: Colliding, loseCondition = false): Query<Record<string, unknown>> {
  const left = buildTree(r.base.tree);
  const right = r.base.shared ? left : source;
  const b = r.base.fence ? right.orderBy(x => x.tenant).thenBy(x => x.id).limit(2) : right;
  const joined = loseCondition ? crossJoin({ a: left, b }) : join({ a: left, b }).on(x => [x.a.id.eq(x.b.id), x.a.tenant.eq(x.b.tenant)]);
  const grouped = joined.groupBy(x => r.key === 'id' ? { id: x.a.id } : r.key === 'tenant' ? { tenant: x.b.id } : r.key === 'waste' ? { waste: x.a.tenant } : { k: x.a.id });
  let q = (r.aggs === 'collide' ? grouped.aggregate(g => ({ amount: count(), spare: sum(g.b.amount) })) : grouped.aggregate(g => ({ n: count(), total: sum(g.b.amount) }))) as unknown as Query<Record<string, unknown>>;
  const count_ = r.aggs === 'collide' ? 'amount' : 'n';
  const row = (x: unknown, name: string) => (x as Record<string, { gt(v: bigint): never; ne(v: string): never; asc(): never }>)[name]!;
  if (r.having === 'count') q = q.where(x => row(x, count_).gt(1n));
  if (r.having === 'key') q = q.where(x => row(x, r.key).ne('zz'));
  if (r.order !== 'none') q = q.orderBy(x => row(x, r.order === 'count' ? count_ : r.key).asc());
  return q;
}
export function nativeColliding(r: Colliding) {
  // Inner aliases (kk, cc, tt) collide with nothing; the outer SELECT renames them, so the oracle is setting-independent.
  const [c, t] = r.aggs === 'collide' ? ['amount', 'spare'] : ['n', 'total'];
  const where = r.having === 'count' ? ' WHERE cc > 1' : r.having === 'key' ? " WHERE kk != 'zz'" : '';
  return `SELECT kk AS ${r.key},cc AS ${c},tt AS ${t} FROM (SELECT ${keyColumn[r.key]} AS kk,count() AS cc,sum(b.amount) AS tt ${nativeFrom(r.base)} GROUP BY ${keyColumn[r.key]})${where}`;
}
