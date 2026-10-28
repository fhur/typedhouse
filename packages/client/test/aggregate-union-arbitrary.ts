import fc from 'fast-check';
import { Query, count, join, max, sum, unionAll } from '@chql/core';
import { buildTree, nativeTree, recipeArbitrary as trees, topology, type Tree } from './pruning-arbitrary.js';
export const seed = 20261118;
type Row = { id: string; amount: bigint };
export type Composition = { kind: 'leaf'; tree: Tree; latest: boolean } | { kind: 'rollup'; input: Composition } | { kind: 'union'; left: Composition; right: Composition; all: boolean; repeat: boolean; take: number; fence: boolean };
export interface Recipe { composition: Composition; key: string; minimum: number; take: number; offset: number }
function compositions(depth: number): fc.Arbitrary<Composition> {
  const leaf: fc.Arbitrary<Composition> = fc.record({ kind: fc.constant('leaf' as const), tree: trees.map(r => r.tree), latest: fc.boolean() });
  if (!depth) return leaf;
  return fc.oneof(leaf, fc.record({ kind: fc.constant('rollup' as const), input: compositions(depth - 1) }), fc.record({ kind: fc.constant('union' as const), left: compositions(depth - 1), right: compositions(depth - 1), all: fc.boolean(), repeat: fc.boolean(), take: fc.integer({ min: 0, max: 6 }), fence: fc.boolean() }));
}
export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({ composition: compositions(2), key: fc.constantFrom('a', 'b', 'missing'), minimum: fc.integer({ min: 0, max: 3 }), take: fc.integer({ min: 0, max: 4 }), offset: fc.integer({ min: 0, max: 2 }) });
export function shape(c: Composition): string {
  return c.kind === 'leaf' ? `${c.latest ? 'latest' : 'leaf'}(${topology(c.tree)})` : c.kind === 'rollup' ? `agg(${shape(c.input)})` : `union-${c.all}-${c.repeat}-${c.fence}(${shape(c.left)},${shape(c.right)})`;
}
export function buildComposition(c: Composition): Query<Row> {
  if (c.kind === 'leaf') {
    const s = buildTree(c.tree).map(r => ({ id: r.id, amount: r.amount }));
    if (!c.latest) return s;
    const latest = s.groupBy(r => ({ key: r.id })).aggregate(g => ({ highest: max(g.amount) }));
    return join({ s, latest }).on(r => [r.s.id.eq(r.latest.key), r.s.amount.eq(r.latest.highest)]).map(r => ({ id: r.s.id, amount: r.s.amount }));
  }
  if (c.kind === 'rollup') return buildComposition(c.input).groupBy(r => ({ key: r.id })).aggregate(g => ({ total: sum(g.amount) })).map(r => ({ id: r.key, amount: r.total }));
  let left = buildComposition(c.left), right = c.repeat ? left : buildComposition(c.right);
  if (c.fence) { left = left.orderBy(r => r.id).thenBy(r => r.amount).limit(c.take); right = right.distinct(); }
  const all = unionAll(left, right, left);
  const q = c.all ? all : new Query<Row>({ ...all.ir, kind: 'Union', inputs: all.ir.kind === 'Union' ? all.ir.inputs : [], all: false }, all.caps);
  return q.where(r => r.amount.gt(0n)).map(r => ({ id: r.id, amount: r.amount }));
}
export function build(r: Recipe) {
  return buildComposition(r.composition).groupBy(x => ({ key: x.id })).aggregate(g => ({ n: count(), total: sum(g.amount), highest: max(g.amount) }))
    .where(x => x.key.eq(r.key).and(x.n.gt(BigInt(r.minimum))))
    .orderBy(x => x.key).limit(r.take, r.offset);
}
export function nativeComposition(c: Composition): string {
  if (c.kind === 'leaf') {
    const s = `SELECT id,amount FROM (${nativeTree(c.tree)})`;
    return c.latest ? `SELECT s.id AS id,s.amount AS amount FROM (${s}) s INNER ALL JOIN (SELECT id,max(amount) AS highest FROM (${s}) GROUP BY id) l ON s.id=l.id AND s.amount=l.highest` : s;
  }
  if (c.kind === 'rollup') return `SELECT id,sum(amount) AS amount FROM (${nativeComposition(c.input)}) GROUP BY id`;
  let left = nativeComposition(c.left), right = c.repeat ? left : nativeComposition(c.right);
  if (c.fence) { left = `SELECT id,amount FROM (${left}) ORDER BY id,amount LIMIT ${c.take}`; right = `SELECT DISTINCT id,amount FROM (${right})`; }
  return `SELECT id,amount FROM (${[left, right, left].map(s => `SELECT id,amount FROM (${s})`).join(c.all ? ' UNION ALL ' : ' UNION DISTINCT ')}) WHERE amount>0`;
}
export function native(r: Recipe): string {
  return `SELECT id AS key,count() AS n,sum(amount) AS total,max(amount) AS highest FROM (${nativeComposition(r.composition)}) GROUP BY id HAVING key='${r.key}' AND n>${r.minimum} ORDER BY key LIMIT ${r.take} OFFSET ${r.offset}`;
}
export const anchor: Recipe = { composition: { kind: 'leaf', tree: { kind: 'scan' }, latest: false }, key: 'a', minimum: 0, take: 4, offset: 0 };
