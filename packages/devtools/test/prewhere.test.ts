import { expect, it } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { toDataflowGraph } from '../src/index.js';
import { nodeLabel } from '../src/node-label.js';

const t = table('t', { id: col.UInt64 }, { engine: 'MergeTree', sortingKey: [], partitionKey: [] });

it('labels a Prewhere with its predicate, and follows a predicate subquery and its scan', () => {
  const sub = from(t).map(r => r.id);
  const graph = toDataflowGraph(from(t).final().prewhere(r => r.id.in(sub)).ir);
  const node = graph.nodes.find(n => n.id === graph.root)!;
  expect(node.kind).toBe('Prewhere');
  expect(node.label).toMatch(/^Prewhere /);
  expect(nodeLabel(node)).toEqual([node.label]);
  expect(graph.nodes.some(n => n.label === 'Scan t FINAL')).toBe(true);
  expect(graph.edges.some(e => e.target === graph.root && e.kind === 'input')).toBe(true);
  expect(graph.edges.some(e => e.target === graph.root && e.kind !== 'input' && e.path[0] === 'pred')).toBe(true);
});
