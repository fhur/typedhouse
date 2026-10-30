import { exprNode as constructExpr, methodCatalog, print, type CHType, type ExprNode, type Rel } from '@chql/core';
import { resolveAggregate, resolveCall } from './resolve.js';

type Ref = Extract<ExprNode, { kind: 'ColumnRef' }>;
/** Constructors snapshot unregistered manual graphs. Restore graph edges (not
 * owned containers) after allocation so even manual Params retain identity. */
export function exprNode<K extends ExprNode['kind']>(fields: Parameters<typeof constructExpr<K>>[0]): Extract<ExprNode, { kind: K }>;
export function exprNode(fields: Parameters<typeof constructExpr>[0]): ExprNode {
  const made = constructExpr(fields);
  const edges: Record<string, unknown> = {};
  if ('args' in fields) edges.args = Object.freeze([...fields.args]);
  if ('params' in fields) edges.params = Object.freeze([...fields.params]);
  if ('expr' in fields) edges.expr = fields.expr;
  if ('rel' in fields && fields.kind === 'Subquery') edges.rel = fields.rel;
  if ('branches' in fields) { edges.branches = Object.freeze(fields.branches.map(b => Object.freeze({ ...b }))); edges.otherwise = fields.otherwise; }
  // Normal constructor-built graphs already retain all edges.
  const sameEdges = Object.keys(edges).every(k => {
    const a = edges[k], b = (made as unknown as Record<string, unknown>)[k];
    return Array.isArray(a) && Array.isArray(b) ? a.every((v, i) => v === b[i]) : a === b;
  });
  return sameEdges ? made : Object.freeze({ ...made, ...edges });
}
/** Scope-local substitution. Params are identity-bearing inputs, never copied. */
export function mapExpression(e: ExprNode, ref: (e: Ref) => ExprNode, subquery: (r: Rel) => Rel = r => r): ExprNode {
  const visit = (a: ExprNode) => mapExpression(a, ref, subquery);
  const { id: _id, ...fields } = e;
  switch (e.kind) {
    case 'ColumnRef': return ref(e);
    case 'Param': case 'Literal': return e;
    case 'Subquery': {
      const rel = subquery(e.rel);
      return rel === e.rel ? e : exprNode({ ...fields, kind: 'Subquery', usage: e.usage, type: e.type, rel });
    }
    case 'Call': case 'Raw': case 'Agg': {
      const args = e.args.map(visit);
      const params = e.kind === 'Agg' ? e.params.map(visit) : undefined;
      if (args.every((a, i) => a === e.args[i]) && (!params || e.kind === 'Agg' && params.every((a, i) => a === e.params[i]))) return e;
      const { id: _id, ...callFields } = e;
      return exprNode({ ...callFields, args, ...(params ? { params } : {}) });
    }
    case 'Cast': {
      const expr = visit(e.expr);
      return expr === e.expr ? e : exprNode({ kind: 'Cast', expr, to: e.to, type: e.type });
    }
    case 'Case': {
      const branches = e.branches.map(b => ({ when: visit(b.when), then: visit(b.then) }));
      const otherwise = visit(e.otherwise);
      return otherwise === e.otherwise && branches.every((b, i) => b.when === e.branches[i]!.when && b.then === e.branches[i]!.then) ? e : exprNode({ kind: 'Case', branches, otherwise, type: e.type });
    }
  }
}
export function rebind(e: ExprNode, from: Rel, to: Rel): ExprNode {
  return from === to ? e : mapExpression(e, r => r.rel === from.id ? exprNode({ kind: 'ColumnRef', type: r.type, path: r.path, ...(r.mode === undefined ? {} : { mode: r.mode }), rel: to.id }) : r);
}
function base(t: CHType): CHType { return t.kind === 'Nullable' || t.kind === 'LowCardinality' ? base(t.inner) : t; }
function family(t: CHType): string | undefined {
  const b = base(t);
  if (b.kind !== 'scalar') return undefined;
  return b.name === 'String' || b.name === 'Bool' ? b.name : /^U?Int(8|16|32|64|128|256)$/.test(b.name) ? 'integer' : undefined;
}
/** Closed total fragment, checked against the authoritative resolver, not flags. */
export function safePredicate(e: ExprNode): boolean {
  function resolve(a: ExprNode, expected?: CHType): CHType {
    if (a.kind === 'ColumnRef' || a.kind === 'Param') {
      const t = a.type ?? expected;
      if (!t || !family(t)) throw new Error('unsafe operand');
      return a.kind === 'Param' && a.value === null && t.kind !== 'Nullable' ? { kind: 'Nullable', inner: t } : t;
    }
    if (a.kind !== 'Call' || a.fn.origin !== 'typed') throw new Error('unsafe expression');
    const name = a.fn.name;
    if (!['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not', 'isNull', 'isNotNull'].includes(name)) throw new Error('unsafe function');
    const resolved = resolveCall(a, resolve);
    if (['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(name) && print(base(resolved.types[0]!)) !== print(base(resolved.types[1]!))) throw new Error('unsafe comparison coercion');
    if (!methodCatalog.find(d => d.name === name)?.deterministic) throw new Error('unsafe metadata');
    return resolved.result;
  }
  try { return print(base(resolve(e))) === 'Bool'; } catch { return false; }
}
/** Whole-computation envelope, not merely determinism: direct non-null
 * String/Bool/integer keys, count(), max of those direct columns and integer
 * sum. No casts, combinators,
 * nullable/decimal state, raw calls or hidden fallible outputs may be suppressed.
 * Integer sum has ClickHouse's wrapping semantics, not checked overflow. */
export function safeAggregate(rel: Extract<Rel, { kind: 'Aggregate' }>): boolean {
  const direct = (e: ExprNode): boolean => e.kind === 'ColumnRef' && e.rel === rel.input.id && e.type.kind === 'scalar' && family(e.type) !== undefined;
  if (!Object.getOwnPropertyNames(rel.keys).every(k => direct(rel.keys[k]!))) return false;
  return Object.getOwnPropertyNames(rel.aggs).every(k => {
    const e = rel.aggs[k]!;
    if (e.kind !== 'Agg' || e.fn.origin !== 'typed' || e.params.length || e.combinators.length) return false;
    if (e.fn.name !== 'count' && e.fn.name !== 'max' && e.fn.name !== 'sum') return false;
    if (!e.args.every(a => direct(a) && (e.fn.name !== 'sum' || family(a.type!) === 'integer'))) return false;
    try { resolveAggregate(e, a => { if (!a.type) throw new Error('untyped'); return a.type; }); return true; } catch { return false; }
  });
}
export function conjuncts(e: ExprNode): ExprNode[] {
  return e.kind === 'Call' && e.fn.origin === 'typed' && e.fn.name === 'and' ? e.args.flatMap(conjuncts) : [e];
}
export function conjunction(es: readonly ExprNode[]): ExprNode {
  if (!es.length) throw new Error('empty conjunction');
  return es.slice(1).reduce((a, b) => exprNode({ kind: 'Call', fn: { name: 'and', deterministic: true, origin: 'typed' }, args: [a, b], type: a.type?.kind === 'Nullable' || b.type?.kind === 'Nullable' ? { kind: 'Nullable', inner: { kind: 'scalar', name: 'Bool' } } : { kind: 'scalar', name: 'Bool' } }), es[0]!);
}
export function references(e: ExprNode): Ref[] {
  const refs: Ref[] = [];
  mapExpression(e, r => { refs.push(r); return r; });
  return refs;
}
