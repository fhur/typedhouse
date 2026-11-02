import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { col, from, scalar, table, unionAll } from '@typedhouse/core';
import { dataflow } from '../src/index.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), writeFile: vi.fn(actual.writeFile) };
});

const source = from(table('offers<&"', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

it('writes a self-contained SVG, creates directories and escapes names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const path = join(dir, 'nested', 'query.svg');
  const graph = dataflow(unionAll(source, source).ir);
  expect(await graph.viz(path)).toBe(path);
  const image = await readFile(path, 'utf8');
  expect(image).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(image).toContain('offers&lt;&amp;&quot;');
  expect(image).not.toContain('offers<&"');
  expect(image.match(/<path d="M /g)).toHaveLength(3); // marker + two input edges
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(2);
  await graph.viz(path); // documented overwrite
  expect(await readFile(path, 'utf8')).toBe(image);
});

it('defaults to graph.svg without creating files on graph construction', async () => {
  const fs = await import('node:fs/promises');
  const mkdir = vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);
  const write = vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined);
  const graph = dataflow(source.ir);
  expect(write).not.toHaveBeenCalled();
  expect(await graph.viz()).toBe('graph.svg');
  expect(mkdir).toHaveBeenCalledWith('.', { recursive: true });
  expect(write).toHaveBeenCalledWith('graph.svg', expect.stringContaining('<svg'), 'utf8');
});

it('defaults Mermaid output to graph.md', async () => {
  const fs = await import('node:fs/promises');
  vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined);
  const write = vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined);
  expect(await dataflow(source.ir).mermaid()).toBe('graph.md');
  expect(write).toHaveBeenCalledWith('graph.md', expect.stringContaining('flowchart TD'), 'utf8');
});

it('lays out SVG producers above consumers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const path = await dataflow(source.limit(20).ir).viz(join(dir, 'vertical.svg'));
  const image = await readFile(path, 'utf8');
  const edge = image.match(/d="M ([\d.]+) ([\d.]+) C [^"]*, ([\d.]+) ([\d.]+)"/)!;
  expect(Number(edge[4])).toBeGreaterThan(Number(edge[2]));
  expect(Number(edge[1])).toBe(Number(edge[3]));
});

it('shows at most five attributes while retaining all graph columns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const wide = from(table('wide', {
    first: col.String, second: col.String, third: col.String,
    fourth: col.String, fifth: col.String, sixth: col.String,
  }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const graph = dataflow(wide.ir);
  const path = await graph.viz(join(dir, 'wide.svg'));
  const image = await readFile(path, 'utf8');
  expect(image).toContain('fifth');
  expect(image).not.toContain('sixth');
  expect(image).toContain('1 more attributes');
  expect(graph.nodes[0]!.columns).toHaveLength(6);
});

it('renders limits as a label without attributes or a graph ID prefix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const graph = dataflow(source.limit(20).ir);
  const path = await graph.viz(join(dir, 'limit.svg'));
  const image = await readFile(path, 'utf8');
  expect(image).toContain('>Limit 20</text>');
  expect(image).not.toContain('n0: Limit');
  // The id attribute is displayed only on the source node, not the limit.
  expect(image.match(/&quot;id&quot; : UInt64/g)).toHaveLength(1);
  expect(graph.nodes[0]!.columns).toHaveLength(1);
});

it('renders filter conditions instead of repeated attributes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const path = await dataflow(source.where(r => r.id.gt(20n).and(r.id.le(50n))).ir).viz(join(dir, 'filter.svg'));
  const image = await readFile(path, 'utf8');
  expect(image).toContain('>Filter ((id &gt; 20) AND (id &lt;= 50))</text>');
  expect(image).not.toContain('n0: Filter');
  expect(image.match(/&quot;id&quot; : UInt64/g)).toHaveLength(1);
});

it('renders sort keys, directions and null ordering without attributes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const sortable = from(table('sortable', { price: col.Nullable(col.Float64), id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }));
  const graph = dataflow(sortable.orderBy(r => r.price.desc().nullsLast()).thenBy(r => r.id).ir);
  const path = await graph.viz(join(dir, 'sort.svg'));
  const image = await readFile(path, 'utf8');
  expect(image).toContain('>Sort price DESC NULLS LAST, id ASC</text>');
  expect(image).not.toContain('n0: Sort');
  expect(image.match(/&quot;id&quot; : UInt64/g)).toHaveLength(1);
  expect(graph.nodes[0]!.columns).toHaveLength(2);
});

it('draws scalar dependencies distinctly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-viz-'));
  dirs.push(dir);
  const q = source.map(r => ({ id: r.id, total: scalar(source.count()) }));
  const path = await dataflow(q.ir).viz(join(dir, 'scalar.svg'));
  expect(await readFile(path, 'utf8')).toContain('stroke-dasharray="6 4"');
});
