import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { col, from, scalar, table, unionAll } from '@typedhouse/core';
import { dataflow } from '../src/index.js';
import { mermaidMarkdown } from '../src/mermaid.js';

const source = from(
  table('offers', { id: col.UInt64 }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
);

it('writes Markdown with top-to-bottom flow and retains shared nodes and parallel edges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typedhouse-mermaid-'));

  try {
    const graph = dataflow(unionAll(source, source).limit(20).ir);
    const path = join(dir, 'nested', 'query.md');
    expect(await graph.mermaid(path)).toBe(path);
    const text = await readFile(path, 'utf8');
    expect(text).toMatch(/^```mermaid\nflowchart TD\n/);
    expect(text).toContain('n0["Limit 20"]');
    expect(text.match(/n2\["/g)).toHaveLength(1);
    expect(text.match(/n2 -->/g)).toHaveLength(2);
    expect(text).toContain('n1 -->');
    await graph.mermaid(path);
    expect(await readFile(path, 'utf8')).toBe(text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('uses dashed subquery edges and shares compact node labels', () => {
  const q = source
    .where(r => r.id.gt(2n))
    .map(r => ({ id: r.id, total: scalar(source.count()) }))
    .orderBy(r => r.id);

  const text = mermaidMarkdown(dataflow(q.ir));
  expect(text).toContain(' -.->|"scalar:');
  expect(text).toContain('Filter (id #62; 2)');
  expect(text).toContain('n0["Sort id ASC"]');

  const wide = from(
    table(
      'wide',
      {
        a: col.String,
        b: col.String,
        c: col.String,
        d: col.String,
        e: col.String,
        hidden: col.String,
      },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  const wideText = mermaidMarkdown(dataflow(wide.ir));
  expect(wideText).not.toContain('hidden');
  expect(wideText).toContain('1 more attributes');
});

it('escapes Mermaid/HTML syntax, backticks and newlines inside labels', () => {
  const hostile = from(
    table(
      'x"]\n```\n<script>&#60;|',
      { id: col.UInt64 },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  const text = mermaidMarkdown(dataflow(hostile.ir));
  expect(text.match(/```/g)).toHaveLength(2);
  expect(text).not.toContain('<script>');
  expect(text).toContain('#34;#93;#10;#96;#96;#96;');
  expect(text).toContain('#60;script#62;#38;#35;60;#124;');
});
