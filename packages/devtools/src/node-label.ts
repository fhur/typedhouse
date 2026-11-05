import type { DataflowNode } from './dataflow.js';

/** Shared compact display policy; the underlying graph keeps all columns. */
export function nodeLabel(node: DataflowNode): string[] {
  if (node.kind === 'LimitBy' || node.kind === 'Limit' || node.kind === 'Filter' || node.kind === 'Prewhere' || node.kind === 'Sort') return [node.label];
  return [
    `${node.id}: ${node.label}`,
    ...node.columns.slice(0, 5).map(c => `${c.path.map(p => JSON.stringify(p)).join('.')} : ${c.type ?? '?'}`),
    ...(node.columns.length > 5 ? [`… ${node.columns.length - 5} more attributes`] : []),
  ];
}
