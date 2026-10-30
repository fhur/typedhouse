import { outputLeaves, type ExprNode, type Rel } from '@typedhouse/core';

export interface CtePlan {
  /** Global WITH scope: every definition sees only earlier dependencies. */
  readonly definitions: readonly Rel[];
  readonly names: ReadonlyMap<Rel, string>;
  readonly uses: ReadonlyMap<Rel, number>;
  readonly aliases: ReadonlyMap<Rel, ReadonlyMap<string, string>>;
  readonly inputAlias: string;
  readonly elementAlias: string;
}

/** Direct edges of one relational owner. Repeated slots/expressions are retained;
 * visiting a shared parent twice must not multiply its descendants' use counts. */
function expressions(rel: Rel): readonly ExprNode[] {
  const values = (r: Readonly<Record<string, ExprNode>>) => Object.getOwnPropertyNames(r).map(k => r[k]!);
  switch (rel.kind) {
    case 'Filter': return [rel.pred];
    case 'Project': return values(rel.exprs);
    case 'Aggregate': return [...values(rel.keys), ...values(rel.aggs)];
    case 'Join': return rel.on;
    case 'Sort': return rel.keys.map(k => k.expr);
    case 'ArrayJoin': return [rel.expr];
    case 'RawRel': return rel.args;
    default: return [];
  }
}
export function planCtes(root: Rel): CtePlan {
  const uses = new Map<Rel, number>();
  const visited = new Set<Rel>();
  const ordered: Rel[] = [];
  const safe = new Map<Rel, boolean>();
  const reserved = new Set<string>(['__typedhouse_input', '__typedhouse_element']);
  function visit(rel: Rel): void {
    if (visited.has(rel)) return;
    visited.add(rel);
    for (const l of outputLeaves(rel.output)) reserved.add(l.name);
    if (rel.kind === 'Scan') reserved.add(rel.table.name);
    let extractable = rel.kind !== 'RawRel';
    function edge(child: Rel) {
      uses.set(child, (uses.get(child) ?? 0) + 1);
      visit(child);
      extractable = safe.get(child)! && extractable;
    }
    function expression(e: ExprNode): void {
      switch (e.kind) {
        case 'Subquery': edge(e.rel); break;
        case 'Call': case 'Agg': case 'Raw':
          if (e.kind === 'Raw' || e.fn.deterministic !== true) extractable = false;
          for (const a of e.args) expression(a);
          if (e.kind === 'Agg') for (const a of e.params) expression(a);
          break;
        case 'Cast': expression(e.expr); break;
        case 'Case': for (const b of e.branches) { expression(b.when); expression(b.then); } expression(e.otherwise); break;
      }
    }
    if ('input' in rel) edge(rel.input);
    else if (rel.kind === 'Join') for (const [, child] of rel.inputs) edge(child);
    else if (rel.kind === 'Union') for (const child of rel.inputs) edge(child);
    for (const e of expressions(rel)) expression(e);
    safe.set(rel, extractable);
    ordered.push(rel);
  }
  visit(root);
  const definitions = ordered.filter(r => r.kind === 'Materialize' || (uses.get(r) ?? 0) > 1 && safe.get(r));
  const names = new Map<Rel, string>();
  let index = 0;
  for (const rel of definitions) {
    let name: string;
    do { name = `t${index++}`; } while (reserved.has(name));
    names.set(rel, name); reserved.add(name);
  }
  // Logical Join aliases never change. Physical aliases are local to each Join,
  // but avoid every globally visible identifier (including underlying tables).
  const aliases = new Map<Rel, ReadonlyMap<string, string>>();
  for (const rel of ordered) if (rel.kind === 'Join') {
    const local = new Set(reserved);
    for (const [a] of rel.inputs) local.add(a);
    const map = new Map<string, string>();
    for (const [a] of rel.inputs) {
      let name = a;
      if (reserved.has(name)) { do { name += '_'; } while (local.has(name)); }
      local.add(name); map.set(a, name);
    }
    aliases.set(rel, map);
  }
  for (const rel of ordered) if (rel.kind === 'Join') for (const name of aliases.get(rel)!.values()) reserved.add(name);
  const fresh = (base: string) => { let name = base; while (reserved.has(name)) name += '_'; reserved.add(name); return name; };
  // Preserve established internal spelling when it does not capture user data.
  reserved.delete('__typedhouse_input'); reserved.delete('__typedhouse_element');
  for (const rel of ordered) {
    for (const l of outputLeaves(rel.output)) reserved.add(l.name);
    if (rel.kind === 'Scan') reserved.add(rel.table.name);
    if (rel.kind === 'Join') for (const a of aliases.get(rel)!.values()) reserved.add(a);
  }
  return Object.freeze({ definitions: Object.freeze(definitions), names, uses, aliases, inputAlias: fresh('__typedhouse_input'), elementAlias: fresh('__typedhouse_element') });
}
