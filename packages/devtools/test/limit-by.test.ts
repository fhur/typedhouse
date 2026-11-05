import { expect, it } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { toDataflowGraph } from '../src/index.js';
import { nodeLabel } from '../src/node-label.js';

const t = table(
  't',
  { id: col.UInt64, cat: col.String },
  { engine: 'Memory', sortingKey: [], partitionKey: [] },
);

it('labels a LimitBy with its count, offset and keys, and follows a key subquery', () => {
  const sub = from(t).map(r => r.id);

  const graph = toDataflowGraph(
    from(t)
      .limitBy(r => [r.cat, r.id.in(sub)])
      .take(2)
      .offset(3).ir,
  );

  const node = graph.nodes.find(n => n.id === graph.root)!;
  expect(node.kind).toBe('LimitBy');
  expect(node.label).toMatch(/^LimitBy 2 OFFSET 3 BY /);
  expect(nodeLabel(node)).toEqual([node.label]);

  expect(
    graph.edges.some(e => e.target === graph.root && e.kind === 'input' && e.path[0] === 'input'),
  ).toBe(true);

  expect(
    graph.edges.some(
      e => e.target === graph.root && e.kind !== 'input' && e.path[0] === 'keys' && e.path[1] === 1,
    ),
  ).toBe(true);

  expect(
    toDataflowGraph(
      from(t)
        .limitBy(r => r.cat)
        .take(2).ir,
    ).nodes[0]!.label,
  ).toMatch(/^LimitBy 2 BY /);
});
