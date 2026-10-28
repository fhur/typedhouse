import fc from 'fast-check';
import { crossJoin, join, max, scalar, sum, unionAll } from '@chql/core';
import { buildTree, nativeTree, recipeArbitrary as pruningRecipes, source, topology, type Tree } from './pruning-arbitrary.js';
export const seed = 20261112;
export interface Recipe {
  tree: Tree;
  mode: 'diamond' | 'union' | 'scalar' | 'in' | 'hint' | 'latest';
  fence: 'none' | 'distinct' | 'limit';
  take: number;
  renames: number;
  nested: boolean;
}
export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({
  tree: pruningRecipes.map(r => r.tree),
  mode: fc.constantFrom('diamond' as const, 'union' as const, 'scalar' as const, 'in' as const, 'hint' as const, 'latest' as const),
  fence: fc.constantFrom('none' as const, 'distinct' as const, 'limit' as const),
  take: fc.integer({ min: 0, max: 7 }), renames: fc.integer({ min: 0, max: 3 }), nested: fc.boolean(),
});
export const shape = (r: Recipe) => `${r.mode}/${r.fence}/${topology(r.tree)}`;
export function build(r: Recipe) {
  let shared = buildTree(r.tree).map(x => ({ id: x.id, amount: x.amount }));
  for (let i = 0; i < r.renames; i++) shared = shared.map(x => ({ renamed: x.id, amount: x.amount })).map(x => ({ id: x.renamed, amount: x.amount }));
  if (r.fence === 'distinct') shared = shared.distinct();
  if (r.fence === 'limit') shared = shared.orderBy(x => x.id).thenBy(x => x.amount).limit(r.take);
  if (r.mode === 'hint') shared = shared.materialize();
  let q;
  if (r.mode === 'union' || r.mode === 'hint') q = unionAll(shared, shared, shared);
  else if (r.mode === 'scalar') {
    const total = shared.aggregate(g => ({ amount: sum(g.amount) }));
    const s = scalar(total);
    return shared.map(x => ({ id: x.id, amount: x.amount, first: s, second: s }));
  } else if (r.mode === 'in') {
    const set = shared.map(x => x.id);
    q = source.where(x => x.id.in(set).and(x.id.in(set))).map(x => ({ id: x.id, amount: x.amount }));
  } else if (r.mode === 'latest') {
    const newest = shared.groupBy(x => ({ id: x.id })).aggregate(g => ({ amount: max(g.amount) }));
    q = join({ t0: shared, t1: newest }).on(x => [x.t0.id.eq(x.t1.id), x.t0.amount.eq(x.t1.amount)]).map(x => ({ id: x.t0.id, amount: x.t0.amount }));
  } else {
    const a = shared.where(x => x.id.eq('a')).map(x => ({ id: x.id }));
    const b = shared.where(x => x.id.ne('b')).map(x => ({ amount: x.amount }));
    const pair = crossJoin({ t0: a, __chql_input: b });
    if (r.nested) return pair;
    q = pair.map(x => ({ id: x.t0.id, amount: x.__chql_input.amount }));
  }
  return q;
}
/** Native SQL is independent of both compiler backends and uses no WITHs. */
export function native(r: Recipe): string {
  let s = `SELECT id,amount FROM (${nativeTree(r.tree)})`;
  if (r.fence === 'distinct') s = `SELECT DISTINCT id,amount FROM (${s})`;
  if (r.fence === 'limit') s = `SELECT id,amount FROM (${s}) ORDER BY id,amount LIMIT ${r.take}`;
  switch (r.mode) {
    case 'union': case 'hint': return [s, s, s].join(' UNION ALL ');
    case 'scalar': return `SELECT id,amount,(SELECT sum(amount) FROM (${s})) AS first,(SELECT sum(amount) FROM (${s})) AS second FROM (${s})`;
    case 'in': return `SELECT id,amount FROM pruning_wide WHERE id IN (SELECT id FROM (${s})) AND id IN (SELECT id FROM (${s}))`;
    case 'latest': return `SELECT l.id AS id,l.amount AS amount FROM (${s}) l INNER ALL JOIN (SELECT id,max(amount) AS amount FROM (${s}) GROUP BY id) r ON l.id=r.id AND l.amount=r.amount`;
    case 'diamond': return `SELECT a.id AS id,b.amount AS amount FROM (SELECT id FROM (${s}) WHERE id='a') a CROSS JOIN (SELECT amount FROM (${s}) WHERE id!='b') b`;
  }
}
export function decodeNative(r: Recipe, row: { id: string; amount: string; first?: string; second?: string }) {
  if (r.mode === 'scalar') return { id: row.id, amount: BigInt(row.amount), first: BigInt(row.first!), second: BigInt(row.second!) };
  if (r.mode === 'diamond' && r.nested) return { t0: { id: row.id }, __chql_input: { amount: BigInt(row.amount) } };
  return { id: row.id, amount: BigInt(row.amount) };
}
