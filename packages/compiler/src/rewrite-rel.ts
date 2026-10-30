import { outputLeaves, print, relNode as constructRel, type ExprNode, type Rel } from '@typedhouse/core';
import { exprNode, conjunction, conjuncts, contains, mapExpression, rebind, references, safeAggregate, safePredicate, substitute, totalExpression, totalPredicate } from './rewrite-expressions.js';

function mapRecord(es: Readonly<Record<string, ExprNode>>, visit: (e: ExprNode) => ExprNode): Readonly<Record<string, ExprNode>> {
  const out: Record<string, ExprNode> = {};
  let changed = false;
  for (const key of Object.getOwnPropertyNames(es)) {
    const value = visit(es[key]!);
    changed ||= value !== es[key];
    Object.defineProperty(out, key, { value, enumerable: Object.prototype.propertyIsEnumerable.call(es, key) });
  }
  return changed ? Object.freeze(out) : es;
}
function relNode<K extends Rel['kind']>(fields: Parameters<typeof constructRel<K>>[0]): Extract<Rel, { kind: K }>;
function relNode(fields: Parameters<typeof constructRel>[0]): Rel {
  const made = constructRel(fields);
  const edges: Record<string, unknown> = {};
  if ('input' in fields) edges.input = fields.input;
  if ('pred' in fields) edges.pred = fields.pred;
  if ('expr' in fields) edges.expr = fields.expr;
  if ('inputs' in fields) edges.inputs = fields.kind === 'Join' ? Object.freeze(fields.inputs.map(([a, r]) => Object.freeze([a, r]))) : Object.freeze([...fields.inputs]);
  if ('on' in fields) edges.on = Object.freeze([...fields.on]);
  if ('exprs' in fields) edges.exprs = fields.exprs;
  if ('aggs' in fields) edges.aggs = fields.aggs;
  if ('keys' in fields) edges.keys = fields.kind === 'Sort' ? Object.freeze(fields.keys.map(k => Object.freeze({ ...k }))) : fields.keys;
  // No constructor registry dependency: manual graph edges are legal too.
  function same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || 'id' in a || 'id' in b) return false;
    return Object.getOwnPropertyNames(a).length === Object.getOwnPropertyNames(b).length && Object.getOwnPropertyNames(a).every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return Object.keys(edges).every(k => same(edges[k], (made as unknown as Record<string, unknown>)[k])) ? made : Object.freeze({ ...made, ...edges });
}

export type RewriteRule = 'MergeFilter' | 'MergeProject' | 'PushFilterProject' | 'PushFilterJoin' | 'PushFilterArrayJoin' | 'PushFilterAggKey' | 'PushFilterUnion';
export interface RewriteResult { readonly root: Rel; readonly hits: Readonly<Record<RewriteRule, number>> }
const filter = (input: Rel, pred: ExprNode): Rel => relNode({ kind: 'Filter', input, pred, output: input.output });
const values = (r: Readonly<Record<string, ExprNode>>) => Object.getOwnPropertyNames(r).map(k => r[k]!);
/** Direct relational and expression edges of one node; repeated slots are retained. */
function edges(node: Rel): { readonly rels: readonly Rel[]; readonly exprs: readonly ExprNode[] } {
  const rels = 'input' in node ? [node.input] : node.kind === 'Join' ? node.inputs.map(([, r]) => r) : node.kind === 'Union' ? node.inputs : [];
  const exprs = node.kind === 'Filter' ? [node.pred] : node.kind === 'Project' ? values(node.exprs) : node.kind === 'Aggregate' ? [...values(node.keys), ...values(node.aggs)] : node.kind === 'Join' ? node.on : node.kind === 'Sort' ? node.keys.map(k => k.expr) : node.kind === 'ArrayJoin' ? [node.expr] : node.kind === 'RawRel' ? node.args : [];
  return { rels, exprs };
}
/** Parents per node by identity, counting every slot and every Subquery occurrence once per parent. */
function countUses(root: Rel): Map<Rel, number> {
  const uses = new Map<Rel, number>(), visited = new Set<Rel>();
  function visit(node: Rel): void {
    if (visited.has(node)) return;
    visited.add(node);
    const edge = (child: Rel) => { uses.set(child, (uses.get(child) ?? 0) + 1); visit(child); };
    const { rels, exprs } = edges(node);
    rels.forEach(edge);
    for (const e of exprs) mapExpression(e, r => r, sub => { edge(sub); return sub; });
  }
  visit(root);
  return uses;
}
/** Lexicographic occurrence-tree measure. Filters do not contribute to distance,
 * so splitting one join predicate cannot increase a residual's distance. The
 * third component counts non-Filter occurrences, including subquery scopes. */
export function rewriteMeasure(root: Rel): readonly [number, number, number] {
  const memo = new Map<Rel, readonly [number, number, number, number]>();
  function visit(node: Rel): readonly [number, number, number, number] {
    const old = memo.get(node);
    if (old) return old;
    const { rels, exprs } = edges(node);
    let size = node.kind === 'Filter' ? 0 : 1, distance = 0, filters = node.kind === 'Filter' ? 1 : 0, nodes = size;
    for (const child of rels) { const [s, d, f, n] = visit(child); size += s; distance += d; filters += f; nodes += n; }
    if (node.kind === 'Filter') distance += size * conjuncts(node.pred).length;
    for (const e of exprs) mapExpression(e, r => r, sub => { const [, d, f, n] = visit(sub); distance += d; filters += f; nodes += n; return sub; });
    const result = [size, distance, filters, nodes] as const;
    memo.set(node, result);
    return result;
  }
  const [, distance, filters, nodes] = visit(root);
  return [distance, filters, nodes];
}
/** Validated graphs only. No mutation, registry or predicate memoization by input.
 * Each pass memoizes original occurrences, never consumer-specific pushdowns.
 * Termination: each atomic conjunct moves strictly toward leaves (sum of sizes
 * of its non-Filter descendant occurrence trees decreases); merging decreases Filter count
 * when that distance is unchanged. Union replication replaces weight
 * 1 + sum(branch sizes) with sum(branch sizes) per conjunct, strictly decreasing
 * distance despite increasing Filter count. Repeated slots count as occurrences.
 * Splitting a conjunction leaves every residual conjunct at its old distance while
 * each pushed conjunct loses at least the crossed node's weight, so per-conjunct
 * arms decrease distance exactly as whole-predicate pushes did.
 * MergeProject changes neither distance nor Filter count unless a Filter sits above
 * it (then distance drops); it strictly decreases the non-Filter occurrence count.
 * No rule pulls predicates upward. Fifty passes are a safety limit, never partial success.
 */
export function rewriteRel(root: Rel, maxPasses = 50): RewriteResult {
  const hits: Record<RewriteRule, number> = { MergeFilter: 0, MergeProject: 0, PushFilterProject: 0, PushFilterJoin: 0, PushFilterArrayJoin: 0, PushFilterAggKey: 0, PushFilterUnion: 0 };
  let uses = new Map<Rel, number>();
  const scoped = (e: ExprNode) => contains(e, a => a.kind === 'Subquery' || a.kind === 'Agg');
  const repeatable = (e: ExprNode) => !contains(e, a => a.kind === 'Raw' || (a.kind === 'Call' || a.kind === 'Agg') && a.fn.deterministic !== true);
  function mergeProject(outer: Extract<Rel, { kind: 'Project' }>): Rel {
    const inner = outer.input;
    // (a) one parent by identity, Subquery occurrences included; (b) Materialize is its own node kind.
    if (inner.kind !== 'Project' || uses.get(inner) !== 1) return outer;
    const counts = new Map<string, number>();
    for (const e of values(outer.exprs)) for (const r of references(e)) if (r.rel === inner.id && r.path.length === 1) counts.set(r.path[0]!, (counts.get(r.path[0]!) ?? 0) + 1);
    for (const name of Object.getOwnPropertyNames(inner.exprs)) {
      const e = inner.exprs[name]!, n = counts.get(name) ?? 0;
      // (e) scope hygiene; (c) duplicated evaluation; (d) dropped evaluation must be total.
      if (scoped(e) || n > 1 && !repeatable(e) || n === 0 && !totalExpression(e)) return outer;
    }
    hits.MergeProject++;
    return relNode({ kind: 'Project', input: inner.input, exprs: mapRecord(outer.exprs, e => substitute(e, inner)), columns: outer.columns, output: outer.output });
  }
  /** Every arm decides conjunct by conjunct: the qualifying subset crosses the child,
   * the rest stays above as a residual Filter. A conjunction never promises to evaluate
   * one conjunct on rows another rejects, so splitting cannot suppress a failure; what
   * crosses a Join/ArrayJoin/Aggregate/Union boundary is `safePredicate`, what crosses
   * a Project is `totalPredicate` (the substituted copy), and nothing else moves. */
  function local(node: Rel): Rel {
    if (node.kind === 'Project') return mergeProject(node);
    if (node.kind !== 'Filter') return node;
    const child = node.input;
    const split = (qualifies: (pred: ExprNode) => boolean) => {
      const pushed: ExprNode[] = [], residual: ExprNode[] = [];
      for (const pred of conjuncts(node.pred)) (qualifies(pred) ? pushed : residual).push(pred);
      return { pushed, residual };
    };
    const above = (rewritten: Rel, residual: readonly ExprNode[]) => residual.length ? filter(rewritten, rebind(conjunction(residual), child, rewritten)) : rewritten;
    // Merging changes no evaluation set, so both predicates need only be total.
    if (child.kind === 'Filter') {
      if (!totalPredicate(node.pred) || !totalPredicate(child.pred)) return node;
      hits.MergeFilter++;
      return filter(child.input, conjunction([child.pred, rebind(node.pred, child, child.input)]));
    }
    if (child.kind === 'Aggregate' && Object.getOwnPropertyNames(child.keys).length && safeAggregate(child)) {
      const { pushed, residual } = split(pred => safePredicate(pred) && references(pred).every(r => r.rel === child.id && r.path.length === 1 && Object.hasOwn(child.keys, r.path[0]!)));
      if (!pushed.length) return node;
      const input = filter(child.input, conjunction(pushed.map(pred => mapExpression(pred, r => child.keys[r.path[0]!]!))));
      const aggregate = relNode({ kind: 'Aggregate', input, output: child.output, columns: child.columns,
        keys: mapRecord(child.keys, e => rebind(e, child.input, input)), aggs: mapRecord(child.aggs, e => rebind(e, child.input, input)) });
      hits.PushFilterAggKey++;
      return above(aggregate, residual);
    }
    if (child.kind === 'Union') {
      const schema = (r: Rel) => JSON.stringify(outputLeaves(r.output).map(l => [l.path, print(l.type)]));
      if (!child.inputs.every(r => schema(r) === schema(child))) return node;
      const { pushed, residual } = split(safePredicate);
      if (!pushed.length) return node;
      // Each slot gets its own binding; the branch itself (including fences) is
      // untouched. Subsequent passes can only cross their existing safe rules.
      const inputs = child.inputs.map(input => filter(input, rebind(conjunction(pushed), child, input)));
      hits.PushFilterUnion++;
      return above(relNode({ kind: 'Union', inputs, all: child.all, output: child.output }), residual);
    }
    if (child.kind === 'Project') {
      const names = Object.getOwnPropertyNames(child.exprs);
      const pushed: ExprNode[] = [], residual: ExprNode[] = [];
      for (const pred of conjuncts(node.pred)) {
        const used = new Set(references(pred).filter(r => r.rel === child.id && r.path.length === 1).map(r => r.path[0]!));
        const substituted = substitute(pred, child);
        // (a) binds to the input only; (b) the copy is total; (c) what is not copied is total too.
        const qualifies = references(substituted).every(r => r.rel === child.input.id) && totalPredicate(substituted)
          && names.every(n => used.has(n) || totalExpression(child.exprs[n]!));
        if (qualifies) pushed.push(substituted); else residual.push(pred);
      }
      if (!pushed.length) return node;
      const input = filter(child.input, conjunction(pushed));
      const project = relNode({ kind: 'Project', input, output: child.output, columns: child.columns, exprs: mapRecord(child.exprs, e => rebind(e, child.input, input)) });
      hits.PushFilterProject++;
      return above(project, residual);
    }
    // An inner ARRAY JOIN drops empty-array rows before any later WHERE sees them, so a
    // conjunct moving below it is evaluated on rows it never saw: only total predicates
    // move, and the expansion expression itself must be total since it runs on fewer rows.
    if (child.kind === 'ArrayJoin' && totalExpression(child.expr)) {
      const { pushed, residual } = split(pred => safePredicate(pred) && references(pred).every(r => r.rel === child.id && !(r.path.length === 1 && r.path[0] === child.alias)));
      if (!pushed.length) return node;
      const input = filter(child.input, rebind(conjunction(pushed), child, child.input));
      hits.PushFilterArrayJoin++;
      return above(relNode({ kind: 'ArrayJoin', input, expr: rebind(child.expr, child.input, input), alias: child.alias, left: child.left, output: child.output, columns: child.columns }), residual);
    }
    if (child.kind === 'Join' && (child.joinKind === 'inner' || child.joinKind === 'cross') && child.on.every(safePredicate)) {
      const sides = new Map<string, ExprNode[]>();
      const residual: ExprNode[] = [];
      for (const pred of conjuncts(node.pred)) {
        const refs = references(pred);
        const alias = refs[0]?.path[0];
        if (!safePredicate(pred) || !alias || !refs.every(r => r.rel === child.id && r.path[0] === alias) || !child.inputs.some(([a]) => a === alias)) { residual.push(pred); continue; }
        const es = sides.get(alias) ?? [];
        es.push(pred); sides.set(alias, es);
      }
      if (!sides.size) return node;
      const inputs = child.inputs.map(([alias, input]) => {
        const es = sides.get(alias);
        if (!es) return [alias, input] as const;
        const pred = mapExpression(conjunction(es), r => exprNode({ kind: 'ColumnRef', rel: input.id, path: r.path.slice(1), type: r.type, ...(r.mode === undefined ? {} : { mode: r.mode }) }));
        return [alias, filter(input, pred)] as const;
      });
      const joined = relNode({ kind: 'Join', joinKind: child.joinKind, inputs, on: child.on, scope: child.scope ?? child.id, output: child.output });
      hits.PushFilterJoin++;
      return above(joined, residual);
    }
    return node;
  }
  for (let pass = 0; pass < maxPasses; pass++) {
    const memo = new Map<Rel, Rel>();
    uses = countUses(root);
    function visit(node: Rel): Rel {
      const cached = memo.get(node);
      if (cached) return cached;
      const { id: _id, ...fields } = node;
      let result: Rel = node;
      if ('input' in node) {
        const input = visit(node.input);
        const expr = (e: ExprNode) => mapExpression(rebind(e, node.input, input), r => r, visit);
        const record = (es: Readonly<Record<string, ExprNode>>) => mapRecord(es, expr);
        switch (node.kind) {
          case 'Filter': { const pred = expr(node.pred); if (input !== node.input || pred !== node.pred) result = relNode({ ...fields, kind: 'Filter', input, pred }); break; }
          case 'Project': case 'Aggregate': {
            const es = node.kind === 'Project' ? record(node.exprs) : record(node.keys);
            const aggs = node.kind === 'Aggregate' ? record(node.aggs) : {};
            const old = node.kind === 'Project' ? node.exprs : node.keys;
            if (input !== node.input || es !== old || node.kind === 'Aggregate' && aggs !== node.aggs) {
              result = node.kind === 'Project' ? relNode({ kind: 'Project', input, exprs: es, columns: node.columns, output: node.output }) : relNode({ kind: 'Aggregate', input, keys: es, aggs, columns: node.columns, output: node.output });
            } break;
          }
          case 'ArrayJoin': { const e = expr(node.expr); if (input !== node.input || e !== node.expr) result = relNode({ kind: 'ArrayJoin', input, expr: e, columns: node.columns, output: node.output, alias: node.alias, left: node.left }); break; }
          case 'Sort': { const keys = node.keys.map(k => ({ ...k, expr: expr(k.expr) })); if (input !== node.input || keys.some((k, i) => k.expr !== node.keys[i]!.expr)) result = relNode({ kind: 'Sort', input, keys, output: node.output }); break; }
          case 'Limit': if (input !== node.input) result = relNode({ kind: 'Limit', input, n: node.n, ...(node.offset === undefined ? {} : { offset: node.offset }), output: node.output }); break;
          case 'Distinct': case 'Materialize': if (input !== node.input) result = relNode({ kind: node.kind, input, output: node.output }); break;
        }
      } else if (node.kind === 'Join') {
        const inputs = node.inputs.map(([a, r]) => [a, visit(r)] as const);
        const on = node.on.map(e => mapExpression(e, r => r, visit));
        if (inputs.some(([, r], i) => r !== node.inputs[i]![1]) || on.some((e, i) => e !== node.on[i])) result = relNode({ kind: 'Join', inputs, on, scope: node.scope ?? node.id, joinKind: node.joinKind, output: node.output });
      } else if (node.kind === 'Union') {
        const inputs = node.inputs.map(visit);
        if (inputs.some((r, i) => r !== node.inputs[i])) result = relNode({ kind: 'Union', inputs, all: node.all, output: node.output });
      }
      result = local(result);
      // A rewritten occurrence replaces its original in every parent slot.
      if (result !== node) uses.set(result, uses.get(node) ?? 0);
      memo.set(node, result);
      return result;
    }
    const next = visit(root);
    if (next === root) return Object.freeze({ root, hits: Object.freeze(hits) });
    const before = rewriteMeasure(root), after = rewriteMeasure(next);
    if (!(after[0] < before[0] || after[0] === before[0] && (after[1] < before[1] || after[1] === before[1] && after[2] < before[2]))) throw new Error('rewrite_nonconvergence: non-decreasing measure');
    root = next;
  }
  throw new Error(`rewrite_nonconvergence: exceeded ${maxPasses} passes`);
}
