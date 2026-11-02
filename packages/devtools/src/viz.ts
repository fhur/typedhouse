import type { Rel } from '@typedhouse/core';
import { toDataflowGraph, type DataflowGraph } from './dataflow.js';
import { nodeLabel } from './node-label.js';
import { mermaidMarkdown } from './mermaid.js';

export interface Dataflow extends DataflowGraph {
  /** Write an SVG (Node.js only), creating parent directories. Replaces an existing file.
   * @returns The supplied output path, after the file has been written.
   */
  viz(path?: string): Promise<string>;
  /** Write a top-to-bottom Mermaid diagram in Markdown (default graph.md).
   * Node.js only; creates parent directories and replaces an existing file.
   */
  mermaid(path?: string): Promise<string>;
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Render a top-to-bottom, layered relational DAG without external tools. */
function svg(graph: DataflowGraph): string {
  const outgoing = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
  const incoming = new Map(graph.nodes.map(n => [n.id, 0]));
  const ranks = new Map(graph.nodes.map(n => [n.id, 0]));
  for (const edge of graph.edges) {
    outgoing.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  const ready = graph.nodes.filter(n => incoming.get(n.id) === 0).map(n => n.id);
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]!;
    for (const target of outgoing.get(id)!) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  if (ready.length !== graph.nodes.length) throw new Error('cyclic_dataflow');

  const lines = new Map(graph.nodes.map(n => [n.id, nodeLabel(n)]));
  const levels = new Map<number, string[]>();
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id)!;
    const level = levels.get(rank) ?? [];
    level.push(node.id);
    levels.set(rank, level);
    boxes.set(node.id, {
      x: 0, y: 0,
      width: Math.max(240, ...lines.get(node.id)!.map(line => line.length * 8 + 32)),
      height: lines.get(node.id)!.length * 20 + 24,
    });
  }
  const levelWidths = new Map([...levels].map(([rank, ids]) => [rank,
    ids.reduce((width, id) => width + boxes.get(id)!.width, 0) + (ids.length - 1) * 40,
  ]));
  const totalWidth = Math.max(240, ...levelWidths.values()) + 64;
  let height = 32;
  for (let rank = 0; rank < levels.size; rank++) {
    const ids = levels.get(rank)!;
    let x = (totalWidth - levelWidths.get(rank)!) / 2;
    let levelHeight = 0;
    for (const id of ids) {
      const box = boxes.get(id)!;
      box.x = x;
      box.y = height;
      x += box.width + 40;
      levelHeight = Math.max(levelHeight, box.height);
    }
    height += levelHeight + 80;
  }
  const targetCounts = new Map<string, number>();
  for (const edge of graph.edges) targetCounts.set(edge.target, (targetCounts.get(edge.target) ?? 0) + 1);
  const sourcePorts = new Map<string, number>();
  const targetPorts = new Map<string, number>();
  const edges = graph.edges.map(edge => {
    const a = boxes.get(edge.source)!;
    const b = boxes.get(edge.target)!;
    const sourcePort = (sourcePorts.get(edge.source) ?? 0) + 1;
    const targetPort = (targetPorts.get(edge.target) ?? 0) + 1;
    sourcePorts.set(edge.source, sourcePort);
    targetPorts.set(edge.target, targetPort);
    const x1 = a.x + a.width * sourcePort / (outgoing.get(edge.source)!.length + 1), y1 = a.y + a.height;
    const x2 = b.x + b.width * targetPort / (targetCounts.get(edge.target)! + 1), y2 = b.y;
    const mid = (y1 + y2) / 2;
    const title = escape(`${edge.kind}: ${JSON.stringify(edge.path)}`);
    return `<path d="M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}" fill="none" stroke="${edge.kind === 'input' ? '#64748b' : '#9333ea'}" stroke-width="2"${edge.kind === 'input' ? '' : ' stroke-dasharray="6 4"'} marker-end="url(#arrow)"><title>${title}</title></path>`;
  }).join('\n');
  const nodes = graph.nodes.map(node => {
    const box = boxes.get(node.id)!;
    const text = lines.get(node.id)!.map((line, i) => `<text x="${box.x + 16}" y="${box.y + 24 + i * 20}"${i === 0 ? ' font-weight="bold"' : ''}>${escape(line)}</text>`).join('\n');
    return `<g><title>${escape(`${node.kind} (IR ${node.irId})`)}</title><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${node.id === graph.root ? '#eff6ff' : '#ffffff'}" stroke="#334155"/>${text}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="Query dataflow graph">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>
<rect width="100%" height="100%" fill="#f8fafc"/>
<g font-family="monospace" font-size="13" fill="#0f172a">${edges}\n${nodes}</g>
</svg>\n`;
}

async function writeOutput(path: string, content: string): Promise<string> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return path;
}

/** Build an inspectable graph with SVG and Mermaid Markdown file writers.
 * @example
 * ```ts
 * await dataflow(query.ir).viz(); // graph.svg in the working directory
 * await dataflow(query.ir).viz('debug/offers.svg');
 * await dataflow(query.ir).mermaid(); // graph.md
 * await dataflow(query.ir).mermaid('debug/offers.md');
 * ```
 */
export function dataflow(ir: Rel): Dataflow {
  const graph = toDataflowGraph(ir);
  return {
    ...graph,
    async viz(path = 'graph.svg') {
      return writeOutput(path, svg(graph));
    },
    async mermaid(path = 'graph.md') {
      return writeOutput(path, mermaidMarkdown(graph));
    },
  };
}
