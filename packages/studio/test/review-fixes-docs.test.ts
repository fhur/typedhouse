// #9: documentation pages over a document that has surrogate pairs at every boundary. The real docs may not.
import { describe, expect, it, vi } from 'vitest';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const DOCUMENT = `---\ntitle: ${'🦄'.repeat(150)}\n---\n${'🦄'.repeat(7000)}needle${'🦄'.repeat(7000)}x${'🦄'.repeat(3000)}`;

vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    readdirSync: () => [{ name: 'emoji.md', isDirectory: () => false, isFile: () => true }],
    readFileSync: (path: string, encoding: BufferEncoding) => String(path).endsWith('.json') ? fs.readFileSync(path, encoding) : DOCUMENT,
  };
});

describe('agent docs', () => {
  it('pages rejoin to the document, each well formed', async () => {
    const { createAgentDocs } = await import('../server/agent-docs.js');
    const docs = createAgentDocs();
    let cursor: string | null = null;
    let joined = '';
    let pages = 0;
    do {
      const page: ReturnType<typeof docs.read> = docs.read('emoji', cursor);
      expect(page.text).not.toMatch(LONE_SURROGATE);
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.text.length).toBeLessThanOrEqual(8000);
      joined += page.text;
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(2);
    expect(joined).toBe(DOCUMENT);
    expect(docs.read('emoji').title).not.toMatch(LONE_SURROGATE);
  });

  it('search excerpts around a term stay well formed, whichever side a pair falls on', async () => {
    const { createAgentDocs } = await import('../server/agent-docs.js');
    const docs = createAgentDocs();
    for (const term of ['needle', 'x']) {
      const [match] = docs.search(term).matches;
      expect(match?.excerpt).toContain(term);
      expect(match?.excerpt).not.toMatch(LONE_SURROGATE);
    }
  });
});
