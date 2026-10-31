import type { Rel } from '@typedhouse/core';
import { toDataflowGraph, type DataflowGraph } from './dataflow.js';

export interface Dataflow extends DataflowGraph {
  /** Write an SVG (Node.js only), creating parent directories. Replaces an existing file.
   * @returns The supplied output path, after the file has been written.
   */
  viz(path?: string): Promise<string>;
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Render a left-to-right, layered relational DAG without external tools. */
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

  const lines = new Map(graph.nodes.map(n => [n.id, [
    n.kind === 'Limit' || n.kind === 'Filter' || n.kind === 'Sort' ? n.label : `${n.id}: ${n.label}`,
    ...(n.kind === 'Limit' || n.kind === 'Filter' || n.kind === 'Sort' ? [] : [
      ...n.columns.slice(0, 5).map(c => `${c.path.map(p => JSON.stringify(p)).join('.')} : ${c.type ?? '?'}`),
      ...(n.columns.length > 5 ? [`… ${n.columns.length - 5} more attributes`] : []),
    ]),
  ]]));
  const widths = new Map<number, number>();
  for (const node of graph.nodes) {
    const width = Math.max(240, ...lines.get(node.id)!.map(line => line.length * 8 + 32));
    widths.set(ranks.get(node.id)!, Math.max(widths.get(ranks.get(node.id)!) ?? 0, width));
  }
  const xs = new Map<number, number>();
  let totalWidth = 32;
  for (let rank = 0; rank < widths.size; rank++) {
    xs.set(rank, totalWidth);
    totalWidth += widths.get(rank)! + 100;
  }
  const bottoms = new Map<number, number>();
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id)!;
    const y = bottoms.get(rank) ?? 32;
    const height = lines.get(node.id)!.length * 20 + 24;
    boxes.set(node.id, { x: xs.get(rank)!, y, width: widths.get(rank)!, height });
    bottoms.set(rank, y + height + 40);
  }
  const height = Math.max(100, ...bottoms.values());
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
    const x1 = a.x + a.width, y1 = a.y + a.height * sourcePort / (outgoing.get(edge.source)!.length + 1);
    const x2 = b.x, y2 = b.y + b.height * targetPort / (targetCounts.get(edge.target)! + 1);
    const mid = (x1 + x2) / 2;
    const title = escape(`${edge.kind}: ${JSON.stringify(edge.path)}`);
    return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="${edge.kind === 'input' ? '#64748b' : '#9333ea'}" stroke-width="2"${edge.kind === 'input' ? '' : ' stroke-dasharray="6 4"'} marker-end="url(#arrow)"><title>${title}</title></path>`;
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

/** Build an inspectable graph with an SVG file writer.
 * @example
 * ```ts
 * await dataflow(query.ir).viz(); // graph.svg in the working directory
 * await dataflow(query.ir).viz('debug/offers.svg');
 * ```
 */
export function dataflow(ir: Rel): Dataflow {
  const graph = toDataflowGraph(ir);
  return {
    ...graph,
    async viz(path = 'graph.svg') {
      const image = svg(graph);
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, image, 'utf8');
      return path;
    },
  };
}
