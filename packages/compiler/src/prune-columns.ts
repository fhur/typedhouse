import { outputLeaves, type OutputLeaf, type ExprNode, type Rel } from '@typedhouse/core';

/** Physical interfaces only: paths and transport names always come from the full
 * validated schema. No logical node, binding, descriptor or Param is rewritten. */
export type ColumnDemand = ReadonlyMap<Rel, readonly OutputLeaf[]>;
export function directSelection(rel: Extract<Rel, { kind: 'Project' }>): boolean {
  return Object.getOwnPropertyNames(rel.exprs).every(k => {
    const e = rel.exprs[k]!;
    return e.kind === 'ColumnRef' && e.rel === rel.input.id;
  });
}
const key = (path: readonly string[]) => JSON.stringify(path);

/** Monotone identity-keyed worklist. Shared consumers contribute before any
 * interface is emitted; subqueries start their own complete output demand. */
export function pruneColumns(root: Rel): ColumnDemand {
  const demand = new Map<Rel, Set<string>>();
  const schemas = new Map<Rel, readonly OutputLeaf[]>();
  const queue: Rel[] = [];
  const pending = new Set<Rel>();
  function leaves(rel: Rel) {
    let result = schemas.get(rel);
    if (!result) { result = outputLeaves(rel.output); schemas.set(rel, result); }
    return result;
  }
  function add(rel: Rel, paths: readonly (readonly string[])[]) {
    let set = demand.get(rel);
    let changed = !set;
    if (!set) { set = new Set(); demand.set(rel, set); }
    for (const path of paths) {
      const k = key(path);
      if (!set.has(k)) { set.add(k); changed = true; }
    }
    if (changed && !pending.has(rel)) { queue.push(rel); pending.add(rel); }
  }
  const full = (rel: Rel) => add(rel, leaves(rel).map(l => l.path));
  function expression(e: ExprNode, input: Rel, on = false) {
    const visit = (a: ExprNode) => expression(a, input, on);
    switch (e.kind) {
      case 'ColumnRef': {
        if (on && input.kind === 'Join') {
          const side = input.inputs.find(([alias]) => alias === e.path[0])!;
          add(side[1], [e.path.slice(1)]);
        } else add(input, [e.path]);
        break;
      }
      case 'Subquery': full(e.rel); break; // Never capture inner references.
      case 'Call': case 'Raw': case 'Agg':
        for (const a of e.args) visit(a);
        if (e.kind === 'Agg') for (const a of e.params) visit(a);
        break;
      case 'Cast': visit(e.expr); break;
      case 'Case':
        for (const b of e.branches) { visit(b.when); visit(b.then); }
        visit(e.otherwise); break;
    }
  }
  full(root);
  // Empty interfaces get a carrier only after semantic demand reaches a fixpoint.
  // This avoids adding an accidental first column to every newly discovered side.
  for (;;) {
    for (let i = 0; i < queue.length; i++) {
      const rel = queue[i]!;
      pending.delete(rel);
      const selected = leaves(rel).filter(l => demand.get(rel)!.has(key(l.path)));
      const paths = selected.map(l => l.path);
      switch (rel.kind) {
        case 'Scan': break;
        case 'Project': {
          const direct = directSelection(rel);
          if (!direct) full(rel);
          add(rel.input, []);
          for (const leaf of direct ? selected : leaves(rel)) expression(rel.exprs[leaf.path[0]!]!, rel.input);
          break;
        }
        case 'Aggregate':
          full(rel); add(rel.input, []);
          for (const es of [rel.keys, rel.aggs]) for (const k of Object.getOwnPropertyNames(es)) expression(es[k]!, rel.input);
          break;
        case 'Join':
          for (const [alias, input] of rel.inputs) add(input, paths.filter(p => p[0] === alias).map(p => p.slice(1)));
          // ON uses scope ?? id, while downstream references use id. Both are
          // already validated; paths identify occurrences, never child node ids.
          for (const e of rel.on) expression(e, rel, true);
          break;
        case 'ArrayJoin':
          add(rel.input, paths.filter(p => !(p.length === 1 && p[0] === rel.alias)));
          expression(rel.expr, rel.input); break;
        case 'Filter': add(rel.input, paths); expression(rel.pred, rel.input); break;
        case 'Sort': add(rel.input, paths); for (const k of rel.keys) expression(k.expr, rel.input); break;
        case 'Limit': add(rel.input, paths); break;
        case 'Distinct': case 'Materialize': full(rel); full(rel.input); break;
        case 'Union': full(rel); for (const input of rel.inputs) full(input); break;
        case 'RawRel': full(rel); for (const e of rel.args) expression(e, rel); break;
      }
    }
    queue.length = 0;
    for (const [rel, set] of demand) if (!set.size) add(rel, [leaves(rel)[0]!.path]);
    if (!queue.length) break;
  }
  return new Map([...demand].map(([rel, set]) => [rel, Object.freeze(leaves(rel).filter(l => set.has(key(l.path))))]));
}
