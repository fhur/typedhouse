import type { DataflowGraph } from './dataflow.js';
import { nodeLabel } from './node-label.js';

// Mermaid entity syntax, not HTML escaping. Encode syntax-bearing characters
// before inserting our own line breaks, including Markdown fence backticks.
const escape = (text: string) => text.replace(/[&<>"'`#\\\[\]{}|\r\n]/g, c => `#${c.charCodeAt(0)};`);

/** Markdown source only: rendering is left to a Mermaid-capable viewer. */
export function mermaidMarkdown(graph: DataflowGraph): string {
  const nodes = graph.nodes.map(node => `  ${node.id}["${nodeLabel(node).map(escape).join('<br/>')}"]`);
  const edges = graph.edges.map(edge => {
    const label = escape(`${edge.kind}: ${JSON.stringify(edge.path)}`);
    return edge.kind === 'input'
      ? `  ${edge.source} -->|"${label}"| ${edge.target}`
      : `  ${edge.source} -.->|"${label}"| ${edge.target}`;
  });
  return ['```mermaid', 'flowchart TD', ...nodes, ...edges, '```', ''].join('\n');
}
