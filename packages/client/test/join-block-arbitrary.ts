import fc from 'fast-check';
import { count, crossJoin, join, sum } from '@typedhouse/core';
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
export function native(r: Recipe) {
  const a = nativeTree(r.tree);
  let b = r.shared ? a : 'SELECT id,tenant,amount,spare,ids,waste FROM pruning_wide';
  if (r.fence) b = `SELECT * FROM (${b}) ORDER BY tenant,id LIMIT 2`;
  const from = `FROM (${a}) a INNER ALL JOIN (${b}) b ON a.id=b.id AND a.tenant=b.tenant`;
  // Nested output is represented by named tuples in the independent oracle,
  // then decoded to the same path-aware row shape as the Backend.
  if (r.aggregate) return `SELECT a.id AS key,count() AS n,sum(b.amount) AS total ${from} GROUP BY a.id`;
  if (r.projection) return `SELECT a.id AS id,b.amount AS amount ${from}`;
  const fields = (alias: string, waste: boolean) => `CAST(tuple(${alias}.id,${alias}.tenant,${alias}.amount,${alias}.spare,${alias}.ids${waste ? `,${alias}.waste` : ''}) AS Tuple(id String,tenant String,amount UInt64,spare String,ids Array(String)${waste ? ',waste String' : ''}))`;
  return `SELECT ${fields('a', false)} AS a,${fields('b', !r.shared)} AS b ${from}`;
}
