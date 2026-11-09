import fc from 'fast-check';
import {
  cast,
  col,
  count,
  Expr,
  exprNode,
  type ExprNode,
  from,
  join,
  Query,
  type Rel,
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

type MutableNode<T> = T extends Rel | ExprNode ? { -readonly [K in keyof T]: T[K] } : never;

/** Clone once to preserve shared graph identity, then normalize only IR graph nodes. */
function normalizeOwnership(result: Query<Row>, ownership: Recipe['ownership']): Query<Row> {
  if (!ownership || ownership === 'constructed') return result;
  const ir = structuredClone(result.ir);

  if (ownership === 'implicitRowMode' || ownership === 'implicitScope') {
    const seen = new WeakSet<Rel | ExprNode>();
    const scopes = new Map<Rel['id'], Rel['id']>();
    const refs: MutableNode<Extract<ExprNode, { kind: 'ColumnRef' }>>[] = [];
    const pending: (Rel | ExprNode)[] = [ir];

    while (pending.length) {
      const next = pending.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const node = next as MutableNode<Rel | ExprNode>;

      // Follow graph edges only, never parameter values, descriptors or metadata.
      switch (node.kind) {
        case 'ColumnRef':
          refs.push(node);
          // Explicit grouped modes remain authoritative.
          if (ownership === 'implicitRowMode' && node.mode === 'row') delete node.mode;
          break;
        case 'Scan':
        case 'Literal':
        case 'Param':
          break;
        case 'Call':
        case 'Raw':
        case 'RawRel':
          pending.push(...node.args);
          break;
        case 'Agg':
          pending.push(...node.args, ...node.params);
          break;
        case 'Case':
          for (const branch of node.branches) pending.push(branch.when, branch.then);
          pending.push(node.otherwise);
          break;
        case 'Cast':
          pending.push(node.expr);
          break;
        case 'Subquery':
          pending.push(node.rel);
          break;
        case 'Filter':
        case 'Prewhere':
          pending.push(node.input, node.pred);
          break;
        case 'Project':
          pending.push(node.input, ...Object.values(node.exprs));
          break;
        case 'Aggregate':
          pending.push(node.input, ...Object.values(node.keys), ...Object.values(node.aggs));
          break;
        case 'Join':
          if (ownership === 'implicitScope' && node.scope !== undefined) {
            scopes.set(node.scope, node.id);
            delete node.scope;
          }

          for (const [, input] of node.inputs) pending.push(input);
          pending.push(...node.on);
          break;
        case 'ArrayJoin':
          pending.push(node.input, node.expr);
          break;
        case 'Sort':
          pending.push(node.input, ...node.keys.map(key => key.expr));
          break;
        case 'LimitBy':
          pending.push(node.input, ...node.keys);
          break;
        case 'Limit':
        case 'Distinct':
        case 'Materialize':
        case 'Settings':
          pending.push(node.input);
          break;
        case 'Union':
          pending.push(...node.inputs);
          break;

        default: {
          const unhandled: never = node;

          throw new Error(
            `Ownership normalization: unsupported IR kind ${(unhandled as { kind: string }).kind}`,
          );
        }
      }
    }

    // A ref may precede its Join in the walk; remap only after all scopes are known.
    for (const ref of refs) {
      const scope = scopes.get(ref.rel);
      if (scope !== undefined) ref.rel = scope;
    }
  }

  return new Query<Row>(ir, result.caps);
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

  // Omit mode before thenBy's builder rebinding to exercise that boundary too;
  // post-build ownership normalization alone cannot test mode-free sort inputs.
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

  return normalizeOwnership(result, recipe.ownership);
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
