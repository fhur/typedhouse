import fc from 'fast-check';
import { col, table, from, join, unionAll, count, uniqExact } from '@chql/core';

export const seed = 20261027;
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] };
export const components = from(table('differential_components', {
  tenant: col.String, id: col.String, category: col.Nullable(col.String),
  ids: col.Array(col.String), at: col.Date, amount: col.UInt64,
}, meta));
export const parts = from(table('differential_parts', { tenant: col.String, id: col.String }, meta));
export type Tree =
  | { op: 'scan'; tenant: string }
  | { op: 'join'; tenant: string }
  | { op: 'filter'; input: Tree; minimum: number }
  | { op: 'project' | 'distinct'; input: Tree }
  | { op: 'union'; left: Tree; right: Tree };
export type Recipe = { tree: Tree; end: 'bag' | 'limit' | 'rollup'; take: number; offset: number };
const leaf: fc.Arbitrary<Tree> = fc.record({ op: fc.constantFrom('scan' as const, 'join' as const), tenant: fc.constantFrom('acme', 'other') });
function trees(depth: number): fc.Arbitrary<Tree> {
  if (!depth) return leaf;
  const child = trees(depth - 1);
  return fc.oneof({ withCrossShrink: true }, leaf,
    fc.record({ op: fc.constant('filter' as const), input: child, minimum: fc.integer({ min: 0, max: 5 }) }),
    fc.record({ op: fc.constantFrom('project' as const, 'distinct' as const), input: child }),
    fc.record({ op: fc.constant('union' as const), left: child, right: child }));
}
// Three recipe edges maximum, including the optional terminal operator.
export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({ tree: trees(2), end: fc.constantFrom('bag', 'limit', 'rollup'), take: fc.integer({ min: 0, max: 8 }), offset: fc.integer({ min: 0, max: 3 }) });
export function buildTree(tree: Tree): ReturnType<typeof base> {
  switch (tree.op) {
    case 'scan': return base(tree.tenant);
    case 'join': return join({ c: base(tree.tenant).arrayJoin(r => r.ids, 'part'), p: parts })
      .on(r => [r.c.tenant.eq(r.p.tenant), r.c.part.eq(r.p.id)])
      .map(r => ({ tenant: r.c.tenant, id: r.c.id, category: r.c.category, ids: r.c.ids, at: r.c.at, amount: r.c.amount }));
    case 'filter': return buildTree(tree.input).where(r => r.amount.ge(BigInt(tree.minimum)));
    case 'project': return buildTree(tree.input).map(r => ({ tenant: r.tenant, renamed: r.id, category: r.category, ids: r.ids, at: r.at, amount: r.amount }))
      .map(r => ({ tenant: r.tenant, id: r.renamed, category: r.category, ids: r.ids, at: r.at, amount: r.amount }));
    case 'distinct': return buildTree(tree.input).distinct();
    case 'union': return unionAll(buildTree(tree.left), buildTree(tree.right)).map(r => ({ ...r }));
  }
}
function base(tenant: string) { return components.where(r => r.tenant.eq(tenant)); }
export function build(recipe: Recipe) {
  const q = buildTree(recipe.tree);
  if (recipe.end === 'rollup') return q.groupBy(r => ({ category: r.category.ifNull('uncategorised') })).aggregate(g => ({ rows: count(), entities: uniqExact(g.id) }));
  // Fixture invariant: (tenant,id) uniquely determines the COMPLETE projected row.
  // Expansion and UNION only copy that row, so ties are identical, even at LIMIT.
  if (recipe.end === 'limit') return q.orderBy(r => r.tenant).thenBy(r => r.id).limit(recipe.take, recipe.offset);
  return q;
}
export const anchors: Recipe[] = [
  { tree: { op: 'scan', tenant: 'acme' }, end: 'bag', take: 8, offset: 0 },
  { tree: { op: 'join', tenant: 'acme' }, end: 'rollup', take: 8, offset: 0 },
  { tree: { op: 'distinct', input: { op: 'union', left: { op: 'scan', tenant: 'acme' }, right: { op: 'join', tenant: 'acme' } } }, end: 'limit', take: 2, offset: 1 },
  { tree: { op: 'filter', minimum: 2, input: { op: 'project', input: { op: 'scan', tenant: 'acme' } } }, end: 'bag', take: 8, offset: 0 },
];
export function topology(tree: Tree): string {
  if ('input' in tree) return `${tree.op}(${topology(tree.input)})`;
  if (tree.op === 'union') return `union(${topology(tree.left)},${topology(tree.right)})`;
  return tree.op;
}
