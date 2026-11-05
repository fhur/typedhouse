import { expect, it } from 'vitest';
import { col, exprNode, from, join, relNode, scalar, table, unionAll, val } from '@typedhouse/core';
import { toDataflowGraph } from '../src/index.js';

const t = table(
  'offers',
  { id: col.UInt64, origin: col.String, parts: col.Array(col.String) },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);

it('returns a detached JSON-friendly relational graph in producer-to-consumer direction', () => {
  const source = from(t);

  const q = source
    .where(r => r.id.gt(42n))
    .groupBy(r => r.origin)
    .count()
    .orderBy(r => r.count)
    .limit(3);

  const graph = toDataflowGraph(q.ir);
  expect(graph.root).toBe('n0');
  expect(graph.nodes.map(n => n.kind)).toEqual(['Limit', 'Sort', 'Aggregate', 'Filter', 'Scan']);
  expect(graph.edges[0]).toEqual({ source: 'n1', target: 'n0', kind: 'input', path: ['input'] });

  expect(graph.nodes[2]!.columns).toEqual([
    { path: ['origin'], type: 'String' },
    { path: ['count'], type: 'UInt64' },
  ]);

  expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  expect(toDataflowGraph(q.ir)).toEqual(graph);
});

it('retains repeated slots and identity sharing without merging equal-shaped nodes', () => {
  const shared = from(t).where(r => r.id.gt(0n));
  const graph = toDataflowGraph(unionAll(shared, shared, from(t)).ir);
  expect(graph.nodes.filter(n => n.kind === 'Scan')).toHaveLength(2);
  const inputs = graph.edges.filter(e => e.target === graph.root);
  expect(inputs.map(e => e.source)).toEqual(['n1', 'n1', 'n2']);

  expect(inputs.map(e => e.path)).toEqual([
    ['inputs', 0],
    ['inputs', 1],
    ['inputs', 2],
  ]);

  expect(graph.edges.filter(e => e.target === 'n1')).toHaveLength(1);
});

it('preserves join aliases, nested output paths and array expansion', () => {
  const source = from(t);
  const q = join({ ['__proto__']: source, 'a.b': source }).on(r => r.__proto__.id.eq(r['a.b'].id));
  const graph = toDataflowGraph(q.ir);
  expect(graph.nodes).toHaveLength(2);

  expect(graph.edges.map(e => e.path)).toEqual([
    ['inputs', 0, '__proto__'],
    ['inputs', 1, 'a.b'],
  ]);

  expect(graph.nodes[0]!.columns[0]!.path).toEqual(['__proto__', 'id']);

  const expanded = toDataflowGraph(
    source
      .arrayJoin(r => r.parts, 'part')
      .distinct()
      .cte().ir,
  );

  expect(expanded.nodes.map(n => n.kind)).toEqual(['Materialize', 'Distinct', 'ArrayJoin', 'Scan']);
  expect(expanded.nodes[2]!.label).toBe('ArrayJoin part');
});

it('includes repeated scalar and IN subquery occurrences without duplicating shared relations', () => {
  const source = from(t);
  const total = source.count();
  const totalExpr = scalar(total);

  const q = source
    .where(r => r.id.in(source.map(x => x.id)))
    .map(r => ({ id: r.id, a: totalExpr, b: totalExpr }));

  const graph = toDataflowGraph(q.ir);
  const scalarEdges = graph.edges.filter(e => e.kind === 'scalar');
  expect(scalarEdges).toHaveLength(2);
  expect(scalarEdges[0]!.source).toBe(scalarEdges[1]!.source);

  expect(scalarEdges.map(e => e.path)).toEqual([
    ['exprs', 'a', 'rel'],
    ['exprs', 'b', 'rel'],
  ]);

  expect(graph.edges.filter(e => e.kind === 'in')).toHaveLength(1);
  expect(graph.nodes.filter(n => n.kind === 'Scan')).toHaveLength(1);
});

it('keeps constants out of the graph and supports keyless aggregates', () => {
  const q = from(t)
    .map(() => ({ secret: val('do-not-export') }))
    .count();

  expect(JSON.stringify(toDataflowGraph(q.ir))).not.toContain('do-not-export');
});

it('finds subqueries inside raw arguments, casts, cases and aggregate parameters', () => {
  const source = from(t);
  const sub = scalar(source.count()).ir;
  const wrapped = exprNode({ kind: 'Cast', expr: sub, to: col.UInt64.type, type: col.UInt64.type });

  const choice = exprNode({
    kind: 'Case',
    branches: [{ when: val(true).ir, then: wrapped }],
    otherwise: sub,
    type: sub.type!,
  });

  const aggregate = exprNode({
    kind: 'Agg',
    fn: { name: 'probe', origin: 'typed', deterministic: true, linear: false },
    args: [choice],
    params: [sub],
    combinators: [],
    type: col.UInt64.type,
  });

  const raw = relNode({
    kind: 'RawRel',
    opaque: true,
    provenance: { origin: 'sql.relation' },
    parts: ['', ''],
    args: [aggregate],
    output: { shape: 'deferred', reason: 'raw', declaredNames: ['value'] },
  });

  const graph = toDataflowGraph(raw);
  expect(graph.nodes[0]!.columns).toEqual([{ path: ['value'], type: null }]);

  expect(graph.edges.filter(e => e.kind === 'scalar').map(e => e.path)).toEqual([
    ['args', 0, 'args', 0, 'branches', 0, 'then', 'expr', 'rel'],
    ['args', 0, 'args', 0, 'otherwise', 'rel'],
    ['args', 0, 'params', 0, 'rel'],
  ]);
});

it('walks long relational chains without recursive traversal', () => {
  let q = from(t).limit(1);
  for (let i = 0; i < 2000; i++) q = q.limit(1);
  expect(toDataflowGraph(q.ir).nodes).toHaveLength(2002);
});
