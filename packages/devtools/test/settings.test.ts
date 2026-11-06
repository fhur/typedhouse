import { expect, it } from 'vitest';
import { col, from, table } from '@typedhouse/core';
import { toDataflowGraph } from '../src/index.js';

it('shows a Settings root over its input, without its values', () => {
  const t = table(
    't',
    { id: col.UInt64 },
    { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] },
  );

  const q = from(t);
  const graph = toDataflowGraph(q.settings({ log_comment: 'private' }).ir);

  expect(graph.nodes.map(n => [n.kind, n.label])).toEqual([
    ['Settings', 'Settings'],
    ['Scan', 'Scan t'],
  ]);

  expect(graph.edges.map(e => e.path)).toEqual([['input']]);
});
