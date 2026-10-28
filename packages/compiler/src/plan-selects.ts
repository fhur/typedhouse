import type { Rel } from '@chql/core';

export type SelectClause = Extract<Rel, { kind: 'Filter' | 'Sort' | 'Limit' }>;
export interface SelectBlock {
  readonly source: { readonly kind: 'table'; readonly scan: Extract<Rel, { kind: 'Scan' }> }
    | { readonly kind: 'derived'; readonly rel: Rel };
  /** Original nodes retain their expression bindings and diagnostic paths. */
  readonly clauses: readonly SelectClause[];
}
export interface SqlPlan {
  readonly root: Rel;
  readonly blocks: ReadonlyMap<Rel, SelectBlock>;
}
const rank = { Filter: 1, Sort: 2, Limit: 3 } as const;

/** Identity selections need no alias substitution and cannot duplicate evaluation.
 * Renames, computed expressions and nested outputs remain explicit scopes.
 */
function isColumnSelection(rel: Extract<Rel, { kind: 'Project' }>): boolean {
  return rel.input.output.shape === 'flat' && Object.entries(rel.exprs).every(([name, expr]) =>
    expr.kind === 'ColumnRef' && expr.rel === rel.input.id && expr.path.length === 1 && expr.path[0] === name);
}

/** Lower validated IR into SELECT blocks without changing relational identities.
 * Every unhandled operator is a fence. Repeated filters share WHERE; repeated
 * sorts/limits and earlier clauses start new blocks. Identity selections can
 * fold before sorting/limiting without changing expression scopes.
 */
export function planSelects(root: Rel, nodes: Iterable<Rel>): SqlPlan {
  const blocks = new Map<Rel, SelectBlock>();
  function plan(rel: Rel): SelectBlock | undefined {
    const cached = blocks.get(rel);
    if (cached) return cached;
    let block: SelectBlock;
    if (rel.kind === 'Scan') {
      block = { source: Object.freeze({ kind: 'table', scan: rel }), clauses: Object.freeze([]) };
    } else if (rel.kind === 'Project' && isColumnSelection(rel)) {
      const child = plan(rel.input);
      if (!child || child.clauses.some(node => node.kind !== 'Filter')) return undefined;
      block = { source: child.source, clauses: child.clauses };
    } else if (rel.kind === 'Filter' || rel.kind === 'Sort' || rel.kind === 'Limit') {
      const child = plan(rel.input);
      const last = child?.clauses.at(-1);
      block = child && (!last || rank[last.kind] < rank[rel.kind] || (last.kind === 'Filter' && rel.kind === 'Filter'))
        ? { source: child.source, clauses: Object.freeze([...child.clauses, rel]) }
        : { source: Object.freeze({ kind: 'derived', rel: rel.input }), clauses: Object.freeze([rel]) };
    } else return undefined;
    blocks.set(rel, Object.freeze(block));
    return block;
  }
  // The validated node index includes branches and expression subqueries.
  for (const node of nodes) plan(node);
  return Object.freeze({ root, blocks });
}
