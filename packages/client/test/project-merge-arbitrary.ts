import fc from 'fast-check';
import {
  cast,
  col,
  count,
  Expr,
  exprNode,
  from,
  join,
  Query,
  scalar,
  sql,
  table,
  val,
} from '@typedhouse/core';

export const seed = 20261113;

const meta = { engine: 'Memory', sortingKey: [], partitionKey: [] };

const columns = {
  tenant: col.String,
  id: col.String,
  category: col.Nullable(col.String),
  amount: col.UInt64,
  score: col.Int64,
};

export const items = from(table('merge_items', columns, meta));

const liveItems = from(table('merge_items', columns, { ...meta, source: { kind: 'test' } }));

export interface Row {
  tenant: string;
  id: string;
  category: string | null;
  label: string;
  amount: bigint;
  score: bigint;
  total: bigint;
}

/** `plus`/`minus` write a non-physical alias; `amountPlus`/`scoreMinus`/`swap` write an
 * alias that shadows a physical column, the planner's alias hazard. */
export type Step =
  | { op: 'rename' | 'ifNull' | 'swap' }
  | { op: 'plus' | 'minus' | 'amountPlus' | 'scoreMinus'; k: number };

export interface Recipe {
  tenant: 'acme' | 'other';
  steps: Step[];
  at: number;
  minimum: number;
  nullable: boolean;
  shared: boolean;
  ordering?: 'column' | 'castConstant' | 'rawConstant' | 'scalar';
  live?: boolean;
  ownership?: 'constructed' | 'plain' | 'implicitRowMode' | 'implicitScope';
}

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constantFrom('rename' as const, 'ifNull' as const, 'swap' as const) }),
  fc.record({
    op: fc.constantFrom(
      'plus' as const,
      'minus' as const,
      'amountPlus' as const,
      'scoreMinus' as const,
    ),
    k: fc.integer({ min: 0, max: 3 }),
  }),
);

export const recipeArbitrary: fc.Arbitrary<Recipe> = fc.record({
  tenant: fc.constantFrom('acme' as const, 'other' as const),
  steps: fc.array(stepArbitrary, { minLength: 1, maxLength: 4 }),
  at: fc.integer({ min: 0, max: 4 }),
  minimum: fc.integer({ min: -3, max: 6 }),
  nullable: fc.boolean(),
  shared: fc.boolean(),
  ordering: fc.constantFrom(
    'column' as const,
    'castConstant' as const,
    'rawConstant' as const,
    'scalar' as const,
  ),
  live: fc.boolean(),
  ownership: fc.constantFrom(
    'constructed' as const,
    'plain' as const,
    'implicitRowMode' as const,
    'implicitScope' as const,
  ),
});

function apply(q: Query<Row>, step: Step): Query<Row> {
  switch (step.op) {
    case 'rename':
      return q
        .map(r => ({
          tenant: r.tenant,
          x: r.id,
          category: r.category,
          label: r.label,
          amount: r.amount,
          score: r.score,
          total: r.total,
        }))
        .map(r => ({
          tenant: r.tenant,
          id: r.x,
          category: r.category,
          label: r.label,
          amount: r.amount,
          score: r.score,
          total: r.total,
        }));
    case 'plus':
      return q.map(r => ({ ...r, total: r.total.plus(BigInt(step.k)) }));
    case 'minus':
      return q.map(r => ({ ...r, total: r.total.minus(BigInt(step.k)) }));
    case 'amountPlus':
      return q.map(r => ({ ...r, amount: r.amount.plus(BigInt(step.k)) }));
    case 'scoreMinus':
      return q.map(r => ({ ...r, score: r.score.minus(BigInt(step.k)) }));
    case 'ifNull':
      return q.map(r => ({ ...r, label: r.category.ifNull(r.label) }));
    case 'swap':
      return q.map(r => ({ ...r, id: r.label, label: r.id }));
  }
}

export function build(recipe: Recipe) {
  const source = recipe.live ? liveItems : items;

  let q: Query<Row> = source.map(r => ({
    tenant: r.tenant,
    id: r.id,
    category: r.category,
    label: r.tenant,
    amount: r.amount,
    score: r.score,
    total: r.score,
  }));

  const where = (x: Query<Row>): Query<Row> =>
    x.where(r => r.total.ge(BigInt(recipe.minimum)).and(r.tenant.eq(recipe.tenant)));

  recipe.steps.forEach((step, i) => {
    if (i === recipe.at) q = where(q);
    q = apply(q, step);
  });

  if (recipe.at >= recipe.steps.length) q = where(q);
  if (recipe.nullable) q = q.where(r => r.category.isNotNull());

  if (recipe.shared) {
    const a = q.map(r => ({ tenant: r.tenant, id: r.id, score: r.score, total: r.total }));

    const b = q.map(r => ({
      tenant: r.tenant,
      id: r.id,
      category: r.category,
      label: r.label,
      amount: r.amount,
    }));

    q = join({ a, b })
      .on(r => [r.a.tenant.eq(r.b.tenant), r.a.id.eq(r.b.id)])
      .map(r => ({
        tenant: r.a.tenant,
        id: r.a.id,
        category: r.b.category,
        label: r.b.label,
        amount: r.b.amount,
        score: r.a.score,
        total: r.a.total,
      }));
  }

  // Parameter-only leading keys are identical for every row. They must survive
  // replacing a previous ordering without being rebound into its row scope.
  // The native oracle omits this invariant prefix; tenant/id/... still defines
  // the same complete ordering, including the duplicate-row tie invariant.
  const ordered =
    recipe.ordering === 'scalar'
      ? q
          .orderBy(r => r.id)
          .orderBy(() => scalar(q.aggregate(() => ({ rows: count() }))))
          .thenBy(r => r.tenant)
      : recipe.ordering === 'castConstant'
        ? q
            .orderBy(r => r.id)
            .orderBy(() => cast(val(BigInt(recipe.minimum), col.Int64), col.String))
            .thenBy(r => r.tenant)
        : recipe.ordering === 'rawConstant'
          ? q
              .orderBy(r => r.id)
              .orderBy(() => sql`${val(String(recipe.minimum), col.String)}`.as(col.String))
              .thenBy(r => r.tenant)
          : q.orderBy(r => r.tenant);

  const sortKey = <T, N extends string>(expr: Expr<T, N, 'row'>): Expr<T, N, 'row'> => {
    if (recipe.ownership !== 'implicitRowMode' || expr.ir.kind !== 'ColumnRef') return expr;
    const { rel, path, type } = expr.ir;
    return new Expr(exprNode({ kind: 'ColumnRef', rel, path, type }), expr.name, expr.mode);
  };

  const result = ordered
    .thenBy(r => sortKey(r.id))
    .thenBy(r => r.total)
    .thenBy(r => r.label)
    .thenBy(r => r.amount);

  if (!recipe.ownership || recipe.ownership === 'constructed') return result;
  const ir = structuredClone(result.ir);

  if (recipe.ownership === 'implicitRowMode' || recipe.ownership === 'implicitScope') {
    // Manual IR may omit row mode or a Join's separate callback scope. Grouped
    // markers remain authoritative; implicit Join scopes bind to the Join id.
    const seen = new WeakSet<object>();
    const scopes = new Map<number, number>();
    const nodes: Record<string, unknown>[] = [];
    const pending: unknown[] = [ir];

    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const node = value as Record<string, unknown>;
      nodes.push(node);

      if (
        recipe.ownership === 'implicitRowMode' &&
        node.kind === 'ColumnRef' &&
        node.mode === 'row'
      ) {
        delete node.mode;
      }

      if (
        recipe.ownership === 'implicitScope' &&
        node.kind === 'Join' &&
        typeof node.scope === 'number' &&
        typeof node.id === 'number'
      ) {
        scopes.set(node.scope, node.id);
        delete node.scope;
      }

      pending.push(...Object.values(node));
    }

    for (const node of nodes) {
      if (node.kind !== 'ColumnRef' || typeof node.rel !== 'number') continue;
      const scope = scopes.get(node.rel);
      if (scope !== undefined) node.rel = scope;
    }
  }

  return new Query<Row>(ir, result.caps);
}

/** Independent native SQL: every stage is its own qualified subquery, so no alias can shadow a column. */
export function native(recipe: Recipe): string {
  const names = ['tenant', 'id', 'category', 'label', 'amount', 'score', 'total'];

  const list = (over: Partial<Record<string, string>>) =>
    names.map(c => (over[c] ? `${over[c]} AS ${c}` : `s.${c}`)).join(',');

  let sql =
    'SELECT s.tenant,s.id,s.category,s.tenant AS label,s.amount,s.score,s.score AS total FROM merge_items AS s';

  const wrap = (over: Partial<Record<string, string>>, where = '') => {
    sql = `SELECT ${list(over)} FROM (${sql}) AS s${where}`;
  };

  const filter = () =>
    wrap({}, ` WHERE s.total>=${recipe.minimum} AND s.tenant='${recipe.tenant}'`);

  recipe.steps.forEach((step, i) => {
    if (i === recipe.at) filter();

    switch (step.op) {
      case 'rename':
        break;
      case 'plus':
        wrap({ total: `s.total+${step.k}` });
        break;
      case 'minus':
        wrap({ total: `s.total-${step.k}` });
        break;
      case 'amountPlus':
        wrap({ amount: `s.amount+${step.k}` });
        break;
      case 'scoreMinus':
        wrap({ score: `s.score-${step.k}` });
        break;
      case 'ifNull':
        wrap({ label: 'ifNull(s.category,s.label)' });
        break;
      case 'swap':
        wrap({ id: 's.label', label: 's.id' });
        break;
    }
  });

  if (recipe.at >= recipe.steps.length) filter();
  if (recipe.nullable) wrap({}, ' WHERE isNotNull(s.category)');

  if (recipe.shared)
    sql = `SELECT a.tenant AS tenant,a.id AS id,b.category AS category,b.label AS label,b.amount AS amount,a.score AS score,a.total AS total FROM (${sql}) AS a INNER ALL JOIN (${sql}) AS b ON a.tenant=b.tenant AND a.id=b.id`;

  return `SELECT ${list({})} FROM (${sql}) AS s ORDER BY s.tenant,s.id,s.total,s.label,s.amount`;
}

export function shape(recipe: Recipe): string {
  return `${recipe.steps.map(s => s.op).join('>')}@${Math.min(recipe.at, recipe.steps.length)}${recipe.shared ? '*' : ''}`;
}
