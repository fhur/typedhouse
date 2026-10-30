import { outputLeaves, print, relNode as constructRel, type ExprNode, type Rel } from '@typedhouse/core';
import { exprNode, conjunction, conjuncts, mapExpression, rebind, references, safeAggregate, safePredicate } from './rewrite-expressions.js';

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

export type RewriteRule = 'MergeFilter' | 'PushFilterProject' | 'PushFilterJoin' | 'PushFilterArrayJoin' | 'PushFilterAggKey' | 'PushFilterUnion';
export interface RewriteResult { readonly root: Rel; readonly hits: Readonly<Record<RewriteRule, number>> }
const filter = (input: Rel, pred: ExprNode): Rel => relNode({ kind: 'Filter', input, pred, output: input.output });
/** Lexicographic occurrence-tree measure. Filters do not contribute to distance,
 * so splitting one join predicate cannot increase a residual's distance. */
export function rewriteMeasure(root: Rel): readonly [number, number] {
  const memo = new Map<Rel, readonly [number, number, number]>();
  function visit(node: Rel): readonly [number, number, number] {
    const old = memo.get(node);
    if (old) return old;
    const children = 'input' in node ? [node.input] : node.kind === 'Join' ? node.inputs.map(([, r]) => r) : node.kind === 'Union' ? node.inputs : [];
    let size = node.kind === 'Filter' ? 0 : 1, distance = 0, filters = node.kind === 'Filter' ? 1 : 0;
    for (const child of children) { const [s, d, f] = visit(child); size += s; distance += d; filters += f; }
    if (node.kind === 'Filter') distance += size * conjuncts(node.pred).length;
    const es = node.kind === 'Filter' ? [node.pred] : node.kind === 'Project' ? Object.getOwnPropertyNames(node.exprs).map(k => node.exprs[k]!) : node.kind === 'Aggregate' ? [...Object.values(node.keys), ...Object.values(node.aggs)] : node.kind === 'Join' ? node.on : node.kind === 'Sort' ? node.keys.map(k => k.expr) : node.kind === 'ArrayJoin' ? [node.expr] : node.kind === 'RawRel' ? node.args : [];
    for (const e of es) mapExpression(e, r => r, sub => { const [, d, f] = visit(sub); distance += d; filters += f; return sub; });
    const result = [size, distance, filters] as const;
    memo.set(node, result);
    return result;
  }
  const [, distance, filters] = visit(root);
  return [distance, filters];
}
/** Validated graphs only. No mutation, registry or predicate memoization by input.
 * Each pass memoizes original occurrences, never consumer-specific pushdowns.
 * Termination: each atomic conjunct moves strictly toward leaves (sum of sizes
 * of its non-Filter descendant occurrence trees decreases); merging decreases Filter count
 * when that distance is unchanged. Union replication replaces weight
 * 1 + sum(branch sizes) with sum(branch sizes) per conjunct, strictly decreasing
 * distance despite increasing Filter count. Repeated slots count as occurrences.
 * No rule pulls predicates upward. Fifty passes are a safety limit, never partial success.
 */
export function rewriteRel(root: Rel, maxPasses = 50): RewriteResult {
  const hits: Record<RewriteRule, number> = { MergeFilter: 0, PushFilterProject: 0, PushFilterJoin: 0, PushFilterArrayJoin: 0, PushFilterAggKey: 0, PushFilterUnion: 0 };
  function local(node: Rel): Rel {
    if (node.kind !== 'Filter' || !safePredicate(node.pred)) return node;
    const child = node.input;
    if (child.kind === 'Filter' && safePredicate(child.pred)) {
      hits.MergeFilter++;
      return filter(child.input, conjunction([child.pred, rebind(node.pred, child, child.input)]));
    }
    if (child.kind === 'Aggregate' && Object.getOwnPropertyNames(child.keys).length && safeAggregate(child)) {
      const pushed: ExprNode[] = [], residual: ExprNode[] = [];
      for (const pred of conjuncts(node.pred)) {
        const refs = references(pred);
        if (!refs.every(r => r.rel === child.id && r.path.length === 1 && Object.hasOwn(child.keys, r.path[0]!))) { residual.push(pred); continue; }
        pushed.push(mapExpression(pred, r => child.keys[r.path[0]!]!));
      }
      if (!pushed.length) return node;
      const input = filter(child.input, conjunction(pushed));
      const aggregate = relNode({ kind: 'Aggregate', input, output: child.output, columns: child.columns,
        keys: mapRecord(child.keys, e => rebind(e, child.input, input)), aggs: mapRecord(child.aggs, e => rebind(e, child.input, input)) });
      hits.PushFilterAggKey++;
      return residual.length ? filter(aggregate, rebind(conjunction(residual), child, aggregate)) : aggregate;
    }
    if (child.kind === 'Union') {
      const schema = (r: Rel) => JSON.stringify(outputLeaves(r.output).map(l => [l.path, print(l.type)]));
      if (!child.inputs.every(r => schema(r) === schema(child))) return node;
      // Each slot gets its own binding; the branch itself (including fences) is
      // untouched. Subsequent passes can only cross their existing safe rules.
      const inputs = child.inputs.map(input => filter(input, rebind(node.pred, child, input)));
      hits.PushFilterUnion++;
      return relNode({ kind: 'Union', inputs, all: child.all, output: child.output });
    }
    if (child.kind === 'Project' && Object.getOwnPropertyNames(child.exprs).every(k => { const e = child.exprs[k]!; return e.kind === 'ColumnRef' && e.rel === child.input.id; })) {
      const pred = mapExpression(node.pred, r => r.rel === child.id && r.path.length === 1 ? child.exprs[r.path[0]!]! : r);
      if (!references(pred).every(r => r.rel === child.input.id)) return node;
      const input = filter(child.input, pred);
      hits.PushFilterProject++;
      return relNode({ kind: 'Project', input, output: child.output, columns: child.columns, exprs: mapRecord(child.exprs, e => rebind(e, child.input, input)) });
    }
    if (child.kind === 'ArrayJoin' && child.expr.kind === 'ColumnRef' && child.expr.rel === child.input.id && references(node.pred).every(r => r.rel === child.id && !(r.path.length === 1 && r.path[0] === child.alias))) {
      const input = filter(child.input, rebind(node.pred, child, child.input));
      hits.PushFilterArrayJoin++;
      return relNode({ kind: 'ArrayJoin', input, expr: rebind(child.expr, child.input, input), alias: child.alias, left: child.left, output: child.output, columns: child.columns });
    }
    if (child.kind === 'Join' && (child.joinKind === 'inner' || child.joinKind === 'cross') && child.on.every(safePredicate)) {
      const sides = new Map<string, ExprNode[]>();
      const residual: ExprNode[] = [];
      for (const pred of conjuncts(node.pred)) {
        const refs = references(pred);
        const alias = refs[0]?.path[0];
        if (!alias || !refs.every(r => r.rel === child.id && r.path[0] === alias) || !child.inputs.some(([a]) => a === alias)) { residual.push(pred); continue; }
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
      return residual.length ? filter(joined, rebind(conjunction(residual), child, joined)) : joined;
    }
    return node;
  }
  for (let pass = 0; pass < maxPasses; pass++) {
    const memo = new Map<Rel, Rel>();
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
      memo.set(node, result);
      return result;
    }
    const next = visit(root);
    if (next === root) return Object.freeze({ root, hits: Object.freeze(hits) });
    const before = rewriteMeasure(root), after = rewriteMeasure(next);
    if (!(after[0] < before[0] || after[0] === before[0] && after[1] < before[1])) throw new Error('rewrite_nonconvergence: non-decreasing measure');
    root = next;
  }
  throw new Error(`rewrite_nonconvergence: exceeded ${maxPasses} passes`);
}
