import fc from 'fast-check';
import { col, from, join, table, type Query } from '@typedhouse/core';
export const seed = 20261113;
const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] };
export const items = from(table('merge_items', { tenant: col.String, id: col.String, category: col.Nullable(col.String), amount: col.UInt64, score: col.Int64 }, meta));
export interface Row { tenant: string; id: string; category: string | null; label: string; amount: bigint; score: bigint; total: bigint }
/** `plus`/`minus` write a non-physical alias; `amountPlus`/`scoreMinus`/`swap` write an
 * alias that shadows a physical column, the planner's alias hazard. */
export type Step = { op: 'rename' | 'ifNull' | 'swap' } | { op: 'plus' | 'minus' | 'amountPlus' | 'scoreMinus'; k: number };
export interface Recipe { tenant: 'acme' | 'other'; steps: Step[]; at: number; minimum: number; nullable: boolean; shared: boolean }
const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constantFrom('rename' as const, 'ifNull' as const, 'swap' as const) }),
  fc.record({ op: fc.constantFrom('plus' as const, 'minus' as const, 'amountPlus' as const, 'scoreMinus' as const), k: fc.integer({ min: 0, max: 3 }) }));
export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({
  tenant: fc.constantFrom('acme' as const, 'other' as const),
  steps: fc.array(stepArbitrary, { minLength: 1, maxLength: 4 }),
  at: fc.integer({ min: 0, max: 4 }), minimum: fc.integer({ min: -3, max: 6 }),
  nullable: fc.boolean(), shared: fc.boolean(),
});
function apply(q: Query<Row>, step: Step): Query<Row> {
  switch (step.op) {
    case 'rename': return q.map(r => ({ tenant: r.tenant, x: r.id, category: r.category, label: r.label, amount: r.amount, score: r.score, total: r.total }))
      .map(r => ({ tenant: r.tenant, id: r.x, category: r.category, label: r.label, amount: r.amount, score: r.score, total: r.total }));
    case 'plus': return q.map(r => ({ ...r, total: r.total.plus(BigInt(step.k)) }));
    case 'minus': return q.map(r => ({ ...r, total: r.total.minus(BigInt(step.k)) }));
    case 'amountPlus': return q.map(r => ({ ...r, amount: r.amount.plus(BigInt(step.k)) }));
    case 'scoreMinus': return q.map(r => ({ ...r, score: r.score.minus(BigInt(step.k)) }));
    case 'ifNull': return q.map(r => ({ ...r, label: r.category.ifNull(r.label) }));
    case 'swap': return q.map(r => ({ ...r, id: r.label, label: r.id }));
  }
}
export function build(recipe: Recipe) {
  let q: Query<Row> = items.map(r => ({ tenant: r.tenant, id: r.id, category: r.category, label: r.tenant, amount: r.amount, score: r.score, total: r.score }));
  const where = (x: Query<Row>): Query<Row> => x.where(r => r.total.ge(BigInt(recipe.minimum)).and(r.tenant.eq(recipe.tenant)));
  recipe.steps.forEach((step, i) => { if (i === recipe.at) q = where(q); q = apply(q, step); });
  if (recipe.at >= recipe.steps.length) q = where(q);
  if (recipe.nullable) q = q.where(r => r.category.isNotNull());
  if (recipe.shared) {
    const a = q.map(r => ({ tenant: r.tenant, id: r.id, score: r.score, total: r.total }));
    const b = q.map(r => ({ tenant: r.tenant, id: r.id, category: r.category, label: r.label, amount: r.amount }));
    q = join({ a, b }).on(r => [r.a.tenant.eq(r.b.tenant), r.a.id.eq(r.b.id)])
      .map(r => ({ tenant: r.a.tenant, id: r.a.id, category: r.b.category, label: r.b.label, amount: r.b.amount, score: r.a.score, total: r.a.total }));
  }
  // Complete rows are functionally determined by the sort key: duplicates are exact copies.
  return q.orderBy(r => r.tenant).thenBy(r => r.id).thenBy(r => r.total).thenBy(r => r.label).thenBy(r => r.amount);
}
/** Independent native SQL: every stage is its own qualified subquery, so no alias can shadow a column. */
export function native(recipe: Recipe): string {
  const names = ['tenant', 'id', 'category', 'label', 'amount', 'score', 'total'];
  const list = (over: Partial<Record<string, string>>) => names.map(c => over[c] ? `${over[c]} AS ${c}` : `s.${c}`).join(',');
  let sql = 'SELECT s.tenant,s.id,s.category,s.tenant AS label,s.amount,s.score,s.score AS total FROM merge_items AS s';
  const wrap = (over: Partial<Record<string, string>>, where = '') => { sql = `SELECT ${list(over)} FROM (${sql}) AS s${where}`; };
  const filter = () => wrap({}, ` WHERE s.total>=${recipe.minimum} AND s.tenant='${recipe.tenant}'`);
  recipe.steps.forEach((step, i) => {
    if (i === recipe.at) filter();
    switch (step.op) {
      case 'rename': break;
      case 'plus': wrap({ total: `s.total+${step.k}` }); break;
      case 'minus': wrap({ total: `s.total-${step.k}` }); break;
      case 'amountPlus': wrap({ amount: `s.amount+${step.k}` }); break;
      case 'scoreMinus': wrap({ score: `s.score-${step.k}` }); break;
      case 'ifNull': wrap({ label: 'ifNull(s.category,s.label)' }); break;
      case 'swap': wrap({ id: 's.label', label: 's.id' }); break;
    }
  });
  if (recipe.at >= recipe.steps.length) filter();
  if (recipe.nullable) wrap({}, ' WHERE isNotNull(s.category)');
  if (recipe.shared) sql = `SELECT a.tenant AS tenant,a.id AS id,b.category AS category,b.label AS label,b.amount AS amount,a.score AS score,a.total AS total FROM (${sql}) AS a INNER ALL JOIN (${sql}) AS b ON a.tenant=b.tenant AND a.id=b.id`;
  return `SELECT ${list({})} FROM (${sql}) AS s ORDER BY s.tenant,s.id,s.total,s.label,s.amount`;
}
export function shape(recipe: Recipe): string {
  return `${recipe.steps.map(s => s.op).join('>')}@${Math.min(recipe.at, recipe.steps.length)}${recipe.shared ? '*' : ''}`;
}
