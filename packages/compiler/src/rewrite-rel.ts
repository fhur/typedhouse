import { nullExtended, outputLeaves, print, relNode as constructRel, type CHType, type ExprNode, type Rel } from '@typedhouse/core';
import { exprNode, conjunction, conjuncts, contains, mapExpression, nullRejecting, rebind, references, safeAggregate, safePredicate, substitute, totalExpression, totalPredicate } from './rewrite-expressions.js';

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

export type RewriteRule = 'MergeFilter' | 'MergeProject' | 'PushFilterProject' | 'LeftToInner' | 'PushFilterJoin' | 'PushFilterArrayJoin' | 'PushFilterAggKey' | 'PushFilterUnion';
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
/** Nodes at or below (through relational edges, not Subquery scopes) a Filter with a conjunct
 * outside the total fragment. ClickHouse's own filter push-down may evaluate such a conjunct
 * below any WHERE of an inner join it crosses, and it never crosses into the extended input of
 * an outer join: LeftToInner under such a Filter would let a cast or a division run on rows a
 * null-rejecting guard above the join was keeping from it (observed on 24.8: CANNOT_PARSE_TEXT
 * where naive returns rows). */
function fallibleExposure(root: Rel): Set<Rel> {
  const exposed = new Set<Rel>(), visited = new Set<Rel>();
  const mark = (node: Rel): void => { if (exposed.has(node)) return; exposed.add(node); edges(node).rels.forEach(mark); };
  function visit(node: Rel): void {
    if (visited.has(node)) return;
    visited.add(node);
    if (node.kind === 'Filter' && !conjuncts(node.pred).every(totalPredicate)) mark(node);
    const { rels, exprs } = edges(node);
    rels.forEach(visit);
    for (const e of exprs) mapExpression(e, r => r, sub => { visit(sub); return sub; });
  }
  visit(root);
  return exposed;
}
/** Fix round 1 (D1): whether a subtree (through relational edges, not Subquery scopes) evaluates any expression
 * outside the total fragment: a Filter conjunct outside `totalPredicate`, a projected, expanded, sort or grouping
 * expression outside `totalExpression` (Raw, Subquery, casts, division, known/user calls...), an aggregate outside
 * `totalAggregate`, or a RawRel. ClickHouse 24.8 pushes a join's WHERE (or its ON-equality image) into an INNER
 * join's inputs below their projections, expansions and GROUP BY, so a row such an expression would fail on in naive
 * SQL is never computed (LeftToInner suppressing a failure), or the guard leaves the WHERE and stops being copied
 * across ON into the other input (PushFilterJoin raising one). Immutable nodes, so the memo is global. */
const fallibleMemo = new WeakMap<Rel, boolean>();
const totalAggregates = new Set(['count', 'max', 'min', 'any', 'anyLast', 'uniq']);
function totalAggregate(e: ExprNode): boolean {
  if (e.kind !== 'Agg') return totalExpression(e);
  if (e.fn.origin !== 'typed' || e.params.length || e.combinators.length || !e.args.every(totalExpression)) return false;
  if (totalAggregates.has(e.fn.name)) return true;
  // Integer sum wraps; Decimal sum can overflow and raise.
  const integer = (t: CHType | null | undefined): boolean => !!t && (t.kind === 'Nullable' || t.kind === 'LowCardinality' ? integer(t.inner) : t.kind === 'scalar' && /^U?Int(8|16|32|64|128|256)$/.test(t.name));
  return e.fn.name === 'sum' && e.args.every(a => integer(a.type));
}
export function fallibleWithin(node: Rel): boolean {
  const known = fallibleMemo.get(node);
  if (known !== undefined) return known;
  let own = false;
  switch (node.kind) {
    case 'Filter': own = !conjuncts(node.pred).every(totalPredicate); break;
    case 'Project': own = !values(node.exprs).every(totalExpression); break;
    case 'ArrayJoin': own = !totalExpression(node.expr); break;
    case 'Aggregate': own = !values(node.keys).every(totalExpression) || !values(node.aggs).every(totalAggregate); break;
    case 'Sort': own = !node.keys.every(k => totalExpression(k.expr)); break;
    case 'Join': own = !node.on.every(totalPredicate); break;
    case 'RawRel': own = true; break;
  }
  const result = own || edges(node).rels.some(fallibleWithin);
  fallibleMemo.set(node, result);
  return result;
}
/** Null-extended input occurrences of a Join kind: what LeftToInner strictly decreases. */
const extendedSides = (node: Extract<Rel, { kind: 'Join' }>) => node.inputs.filter((_, i) => nullExtended(node.joinKind, i, node.inputs.length)).length;
/** Lexicographic occurrence-tree measure. Filters do not contribute to distance,
 * so splitting one join predicate cannot increase a residual's distance. The
 * third component counts non-Filter occurrences, including subquery scopes; the
 * fourth counts null-extended join inputs over the same occurrences. */
export function rewriteMeasure(root: Rel): readonly [number, number, number, number] {
  const memo = new Map<Rel, readonly [number, number, number, number, number]>();
  function visit(node: Rel): readonly [number, number, number, number, number] {
    const old = memo.get(node);
    if (old) return old;
    const { rels, exprs } = edges(node);
    let size = node.kind === 'Filter' ? 0 : 1, distance = 0, filters = node.kind === 'Filter' ? 1 : 0, nodes = size, extended = node.kind === 'Join' ? extendedSides(node) : 0;
    for (const child of rels) { const [s, d, f, n, x] = visit(child); size += s; distance += d; filters += f; nodes += n; extended += x; }
    if (node.kind === 'Filter') distance += size * conjuncts(node.pred).length;
    for (const e of exprs) mapExpression(e, r => r, sub => { const [, d, f, n, x] = visit(sub); distance += d; filters += f; nodes += n; extended += x; return sub; });
    const result = [size, distance, filters, nodes, extended] as const;
    memo.set(node, result);
    return result;
  }
  const [, distance, filters, nodes, extended] = visit(root);
  return [distance, filters, nodes, extended];
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
 * LeftToInner replaces one Join by another over the same inputs and keeps its Filter, so
 * distance, Filter count and node count are unchanged; it strictly decreases the number
 * of null-extended join inputs (left/right 1 -> inner 0, full 2 -> left/right 1 or inner 0),
 * which no rule increases (no rule creates or copies a Join). Both join rules are fenced: never at or under a
 * Filter with a non-total conjunct, never over an input whose subtree evaluates a non-total expression.
 * No rule pulls predicates upward. Fifty passes are a safety limit, never partial success.
 */
function lexicographicallyLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}
export function rewriteRel(root: Rel, maxPasses = 50): RewriteResult {
  const hits: Record<RewriteRule, number> = { MergeFilter: 0, MergeProject: 0, PushFilterProject: 0, LeftToInner: 0, PushFilterJoin: 0, PushFilterArrayJoin: 0, PushFilterAggKey: 0, PushFilterUnion: 0 };
  let uses = new Map<Rel, number>(), exposed = new Set<Rel>();
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
    // LeftToInner: a safe conjunct that is null-rejecting on a null-extended input removes
    // every row that input's extension produced, so the Join stops extending it (full ->
    // left/right/inner by which inputs are rejected). The Filter stays above unchanged and the
    // Join keeps its output: descriptors stay Nullable, and the emitter reads a formerly
    // extended column through toNullable, so `columns` and server `meta` keep agreeing.
    // Never under (or in) a Filter with a non-total conjunct (`fallibleExposure`), nor over an input that evaluates a
    // non-total expression anywhere below (`fallibleWithin`, fix round 1).
    const fallibleInput = child.kind === 'Join' && child.inputs.some(([, input]) => fallibleWithin(input));
    if (child.kind === 'Join' && (child.joinKind === 'left' || child.joinKind === 'right' || child.joinKind === 'full') && !exposed.has(node) && !fallibleInput) {
      const n = child.inputs.length, preds = conjuncts(node.pred).filter(safePredicate);
      const still = child.inputs.map(([alias], i) => nullExtended(child.joinKind, i, n) && !preds.some(pred => nullRejecting(pred, child.id, alias)));
      const kinds = ['inner', 'left', 'right', 'full'] as const;
      const joinKind = kinds.find(k => still.every((x, i) => x === nullExtended(k, i, n)));
      if (joinKind && joinKind !== child.joinKind) {
        const joined = relNode({ kind: 'Join', joinKind, inputs: child.inputs, on: child.on, scope: child.scope ?? child.id, output: child.output });
        hits.LeftToInner++;
        return filter(joined, rebind(node.pred, child, joined));
      }
    }
    // A conjunct crosses into an input only if the Join neither null-extends it (left: the
    // first input; right: the last; full: none) nor reads it with wider descriptors than the
    // input's own (an input LeftToInner stopped extending): pushing there would retype it.
    // Neither at or under a Filter with a non-total conjunct (`fallibleExposure`): 24.8's filter
    // push-down copies such a conjunct across ON equalities into the other input, where a guard
    // this rule moved into one input no longer precedes it (CANNOT_PARSE_TEXT where naive, whose
    // guard is pushed together with it, returns rows). This held for inner joins before 4b too.
    if (child.kind === 'Join' && child.on.every(safePredicate) && !exposed.has(node) && !fallibleInput) {
      const sides = new Map<string, ExprNode[]>();
      const residual: ExprNode[] = [];
      const own = (r: Rel) => JSON.stringify(r.output);
      const admits = new Set(child.inputs.filter(([alias, input], i) => !nullExtended(child.joinKind, i, child.inputs.length)
        && (child.output.inputs[i]?.[1] === input.output || JSON.stringify(child.output.inputs[i]?.[1]) === own(input))).map(([alias]) => alias));
      for (const pred of conjuncts(node.pred)) {
        const refs = references(pred);
        const alias = refs[0]?.path[0];
        if (!safePredicate(pred) || !alias || !refs.every(r => r.rel === child.id && r.path[0] === alias) || !admits.has(alias)) { residual.push(pred); continue; }
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
    exposed = fallibleExposure(root);
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
      // A rebuilt occurrence inherits its original's exposure before the local rules see it.
      if (result !== node && exposed.has(node)) exposed.add(result);
      const before = result;
      result = local(result);
      if (result !== before && exposed.has(before)) exposed.add(result);
      // A rewritten occurrence replaces its original in every parent slot.
      if (result !== node) uses.set(result, uses.get(node) ?? 0);
      memo.set(node, result);
      return result;
    }
    const next = visit(root);
    if (next === root) return Object.freeze({ root, hits: Object.freeze(hits) });
    const before = rewriteMeasure(root), after = rewriteMeasure(next);
    if (!lexicographicallyLess(after, before)) throw new Error('rewrite_nonconvergence: non-decreasing measure');
    root = next;
  }
  throw new Error(`rewrite_nonconvergence: exceeded ${maxPasses} passes`);
}
