import { outputLeaves, type CHType, type ExprNode, type Rel } from '@chql/core';
import { safePredicate } from './rewrite-expressions.js';
import { directSelection, type ColumnDemand } from './prune-columns.js';
import type { CtePlan } from './plan-ctes.js';

export type SelectClause = Extract<Rel, { kind: 'Filter' | 'Sort' | 'Limit' }>;
export interface SelectBlock {
  readonly source: { readonly kind: 'table'; readonly scan: Extract<Rel, { kind: 'Scan' }> }
    | { readonly kind: 'derived'; readonly rel: Rel }
    | { readonly kind: 'cte'; readonly rel: Rel }
    | { readonly kind: 'join'; readonly rel: Extract<Rel, { kind: 'Join' }> };
  readonly project?: Extract<Rel, { kind: 'Project' }>;
  /** Original nodes retain their expression bindings and diagnostic paths. */
  readonly clauses: readonly SelectClause[];
  readonly aggregate?: Extract<Rel, { kind: 'Aggregate' }>;
  readonly where?: readonly SelectClause[];
}
export interface SqlPlan {
  readonly root: Rel;
  readonly blocks: ReadonlyMap<Rel, SelectBlock>;
  readonly columns?: ColumnDemand;
  readonly ctes?: CtePlan;
}
const rank = { Filter: 1, Sort: 2, Limit: 3 } as const;
function referencesName(e: import('@chql/core').ExprNode, name: string): boolean {
  if (e.kind === 'ColumnRef') return e.path.length === 1 && e.path[0] === name;
  if (e.kind === 'Call' || e.kind === 'Agg') return e.args.some(a => referencesName(a, name));
  if (e.kind === 'Cast') return referencesName(e.expr, name);
  return e.kind !== 'Param'; // Unknown computations retain the fence.
}

/** Closed, total arithmetic fragment. In particular, casts, division, raw SQL
 * and subqueries retain their scope. Integer arithmetic wraps in ClickHouse. */
function safeProjection(e: ExprNode): boolean {
  const integer = (t: CHType | null): boolean => t !== null && (t.kind === 'Nullable' || t.kind === 'LowCardinality'
    ? integer(t.inner) : t.kind === 'scalar' && /^U?Int(8|16|32|64|128|256)$/.test(t.name));
  if (e.kind === 'ColumnRef' || e.kind === 'Param') return true;
  return e.kind === 'Call' && ['plus', 'minus', 'multiply'].includes(e.fn.name) && integer(e.type)
    && e.args.every(a => integer(a.type) && safeProjection(a));
}

/** Identity selections need no alias substitution and cannot duplicate evaluation. */
function isColumnSelection(rel: Extract<Rel, { kind: 'Project' }>): boolean {
  return rel.input.output.shape === 'flat' && Object.entries(rel.exprs).every(([name, expr]) =>
    expr.kind === 'ColumnRef' && expr.rel === rel.input.id && expr.path.length === 1 && expr.path[0] === name);
}

/** Lower validated IR into SELECT blocks without changing relational identities.
 * Every unhandled operator is a fence. Repeated filters share WHERE; repeated
 * sorts/limits and earlier clauses start new blocks. Identity selections can
 * fold before sorting/limiting without changing expression scopes.
 */
export function planSelects(root: Rel, nodes: Iterable<Rel>, columns?: ColumnDemand, ctes?: CtePlan): SqlPlan {
  const blocks = new Map<Rel, SelectBlock>();
  function plan(rel: Rel): SelectBlock | undefined {
    const cached = blocks.get(rel);
    if (cached) return cached;
    let block: SelectBlock;
    if (rel.kind === 'Scan') {
      block = { source: Object.freeze({ kind: 'table', scan: rel }), clauses: Object.freeze([]) };
    } else if (rel.kind === 'Join' && (rel.joinKind === 'inner' || rel.joinKind === 'cross') && rel.on.every(e => e.kind === 'Call' && e.fn.name === 'eq' && e.args.every(a => a.kind === 'ColumnRef'))) {
      block = { source: Object.freeze({ kind: 'join', rel }), clauses: Object.freeze([]) };
    } else if (rel.kind === 'Project' && directSelection(rel) && rel.input.kind === 'Join' && !ctes?.names.has(rel.input)) {
      const child = plan(rel.input);
      if (!child) return undefined;
      block = { ...child, project: rel };
    } else if (rel.kind === 'Project' && isColumnSelection(rel)) {
      // A CTE already provides a scope: select its columns directly rather than
      // wrapping its reference in another SELECT. Do not fold its definition.
      const child: SelectBlock | undefined = ctes?.names.has(rel.input)
        ? { source: { kind: 'cte', rel: rel.input }, clauses: [] }
        : plan(rel.input);
      if (!child || child.aggregate || child.project || child.clauses.some(node => node.kind !== 'Filter')) return undefined;
      block = { source: Object.freeze(child.source), clauses: Object.freeze(child.clauses) };
    } else if (rel.kind === 'Project' && rel.input.output.shape === 'flat' && Object.values(rel.exprs).every(safeProjection)) {
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      if (!child || child.source.kind !== 'table' || child.aggregate || child.project || child.clauses.some(n => n.kind !== 'Filter')) return undefined;
      // Check the full physical schema, not the pruned/projected interface:
      // ClickHouse aliases can shadow even columns used only in WHERE.
      const names = new Set(outputLeaves(child.source.scan.output).map(l => l.name));
      if (Object.entries(rel.exprs).some(([name, e]) => names.has(name)
        && !(e.kind === 'ColumnRef' && e.path.length === 1 && e.path[0] === name))) return undefined;
      block = { ...child, project: rel };
    } else if (rel.kind === 'Aggregate') {
      const sourceNames = new Set(outputLeaves(rel.input.output).map(l => l.name));
      // Alias substitution is server-setting-sensitive if an output shadows a
      // different source expression. Keep the explicit scope in that case.
      if ([...Object.entries(rel.keys), ...Object.entries(rel.aggs)].some(([name, e]) =>
        sourceNames.has(name) && !(e.kind === 'ColumnRef' && e.path.length === 1 && e.path[0] === name) &&
        !(ctes?.names.has(rel.input) && e.kind === 'Agg' && e.args.length === 1 && e.args[0]?.kind === 'ColumnRef' && e.args[0].path.length === 1 && e.args[0].path[0] === name &&
          [...Object.entries(rel.keys), ...Object.entries(rel.aggs)].every(([other, expression]) => other === name || !referencesName(expression, name))))) return undefined;
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      const fold = child && !child.aggregate && !child.project && (child.source.kind === 'table' || child.source.kind === 'join') && child.clauses.every(n => n.kind === 'Filter');
      block = { source: fold ? child.source : Object.freeze({ kind: ctes?.names.has(rel.input) ? 'cte' : 'derived', rel: rel.input }),
        aggregate: rel, where: fold ? child.clauses : Object.freeze([]), clauses: Object.freeze([]) };
    } else if (rel.kind === 'Filter' || rel.kind === 'Sort' || rel.kind === 'Limit') {
      const child = ctes?.names.has(rel.input) ? undefined : plan(rel.input);
      const last = child?.clauses.at(-1);
      const safe = !child?.aggregate || (rel.kind === 'Filter' ? safePredicate(rel.pred) : rel.kind === 'Sort' ? rel.keys.every(k => k.expr.kind === 'ColumnRef') : true);
      block = child && !child.project && safe && (!last || rank[last.kind] < rank[rel.kind] || (last.kind === 'Filter' && rel.kind === 'Filter'))
        ? { ...child, clauses: Object.freeze([...child.clauses, rel]) }
        : { source: Object.freeze({ kind: ctes?.names.has(rel.input) ? 'cte' : 'derived', rel: rel.input }), clauses: Object.freeze([rel]) };
    } else return undefined;
    blocks.set(rel, Object.freeze(block));
    return block;
  }
  // The validated node index includes branches and expression subqueries.
  for (const node of nodes) plan(node);
  return Object.freeze({ root, blocks, ...(columns ? { columns } : {}), ...(ctes ? { ctes } : {}) });
}
