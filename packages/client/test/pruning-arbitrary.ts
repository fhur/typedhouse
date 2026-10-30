import fc from 'fast-check';
import { col, crossJoin, from, join, table, type Query } from '@typedhouse/core';
export const seed = 20261107;
export const source = from(table('pruning_wide', { id: col.String, tenant: col.String, amount: col.UInt64, spare: col.String, ids: col.Array(col.String), waste: col.String }, { engine: 'MergeTree', sortingKey: ['tenant', 'id'], partitionKey: [] }));
export interface Row { id: string; tenant: string; amount: bigint; spare: string; ids: string[] }
export type Tree = { kind: 'scan' | 'array' | 'leftArray' } | { kind: 'join' | 'cross'; left: Tree; right: Tree } | { kind: 'shared'; left: Tree };
export interface Recipe { tree: Tree; fence: 'none' | 'distinct' | 'limit'; take: number; offset: number; tenant: string; renames: number; nested: boolean }
const leaf: fc.Arbitrary<Tree> = fc.record({ kind: fc.constantFrom('scan' as const, 'array' as const, 'leftArray' as const) });
function trees(depth: number): fc.Arbitrary<Tree> {
  if (!depth) return leaf;
  return fc.oneof(leaf,
    fc.record({ kind: fc.constantFrom('join' as const, 'cross' as const), left: trees(depth - 1), right: trees(depth - 1) }),
    fc.record({ kind: fc.constant('shared' as const), left: trees(depth - 1) }));
}
export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({ tree: trees(2), fence: fc.constantFrom('none' as const, 'distinct' as const, 'limit' as const), take: fc.integer({ min: 0, max: 12 }), offset: fc.integer({ min: 0, max: 3 }), tenant: fc.constantFrom('acme', 'other'), renames: fc.integer({ min: 0, max: 2 }), nested: fc.boolean() });
export function buildTree(tree: Tree): Query<Row> {
  if ('left' in tree) {
    const left = buildTree(tree.left);
    const right = tree.kind === 'shared' ? left : buildTree(tree.right);
    // Preserve an actual nested Join interface, not merely a sequence of flat
    // templates. Each recursive subtree can have a different topology and size.
    const pair = tree.kind === 'cross' ? crossJoin({ l: left, r: right }).where(r => r.l.id.eq(r.r.id).and(r.l.tenant.eq(r.r.tenant)))
      : join({ l: left, r: right }).on(r => [r.l.id.eq(r.r.id), r.l.tenant.eq(r.r.tenant)]);
    return join({ pair, anchor: source }).on(r => [r.pair.l.id.eq(r.anchor.id), r.pair.l.tenant.eq(r.anchor.tenant)])
      .map(r => ({ id: r.pair.l.id, tenant: r.pair.l.tenant, amount: r.pair.r.amount, spare: r.anchor.spare, ids: r.pair.r.ids }));
  }
  const q = tree.kind === 'scan' ? source : tree.kind === 'array' ? source.arrayJoin(r => r.ids, 'element') : source.leftArrayJoin(r => r.ids, 'element');
  return q.map(r => ({ id: r.id, tenant: r.tenant, amount: r.amount, spare: r.spare, ids: r.ids }));
}
export function build(recipe: Recipe) {
  let q = buildTree(recipe.tree);
  for (let i = 0; i < recipe.renames; i++) q = q.map(r => ({ x: r.id, tenant: r.tenant, amount: r.amount, spare: r.spare, ids: r.ids })).map(r => ({ id: r.x, tenant: r.tenant, amount: r.amount, spare: r.spare, ids: r.ids }));
  if (recipe.fence === 'distinct') q = q.distinct();
  if (recipe.fence === 'limit') q = q.orderBy(r => r.tenant).thenBy(r => r.id).limit(recipe.take, recipe.offset);
  const filtered = q.where(r => r.tenant.eq(recipe.tenant));
  const a = filtered.map(r => ({ id: r.id }));
  const b = filtered.map(r => ({ amount: r.amount }));
  // Disjoint demand on precisely the same Rel object, including zero-key cross
  // sides. Nested root exercises decoded columnPaths rather than flat lookup.
  const result = crossJoin({ a, b });
  return recipe.nested ? result : result.map(r => ({ id: r.a.id, amount: r.b.amount }));
}
export function nativeTree(tree: Tree): string {
  if ('left' in tree) {
    const left = nativeTree(tree.left), right = nativeTree(tree.kind === 'shared' ? tree.left : tree.right);
    return `SELECT l.id AS id,l.tenant AS tenant,r.amount AS amount,a.spare AS spare,r.ids AS ids FROM (${left}) l INNER ALL JOIN (${right}) r ON l.id=r.id AND l.tenant=r.tenant INNER ALL JOIN pruning_wide a ON l.id=a.id AND l.tenant=a.tenant`;
  }
  return `SELECT id,tenant,amount,spare,ids FROM pruning_wide${tree.kind === 'scan' ? '' : ` ${tree.kind === 'leftArray' ? 'LEFT ' : ''}ARRAY JOIN ids AS element`}`;
}
export function native(recipe: Recipe): string {
  let sql = nativeTree(recipe.tree);
  if (recipe.fence === 'distinct') sql = `SELECT DISTINCT id,tenant,amount,spare,ids FROM (${sql})`;
  if (recipe.fence === 'limit') sql = `SELECT id,tenant,amount,spare,ids FROM (${sql}) ORDER BY tenant,id LIMIT ${recipe.take} OFFSET ${recipe.offset}`;
  sql = `SELECT id,amount FROM (${sql}) WHERE tenant='${recipe.tenant}'`;
  return `SELECT a.id AS id,b.amount AS amount FROM (${sql}) a CROSS JOIN (${sql}) b`;
}
export function topology(tree: Tree): string {
  return tree.kind === 'shared' ? `shared(${topology(tree.left)})`
    : 'left' in tree ? `${tree.kind}(${topology(tree.left)},${topology(tree.right)})` : tree.kind;
}
