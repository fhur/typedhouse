// #9, independent tester: docs at every parity of the page boundary, title and excerpt.
import { describe, expect, it, vi } from 'vitest';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const doc = (shift: number) => `---\ntitle: ${'t'.repeat(shift)}${'🦄'.repeat(150)}\n---\n${'p'.repeat(shift)}${'🦄'.repeat(7000)}needle${shift}${'🦄'.repeat(7000)}`;
const shifts = [0, 1, 2, 3, 4, 5];
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    readdirSync: () => shifts.map(shift => ({ name: `emoji${shift}.md`, isDirectory: () => false, isFile: () => true })),
    readFileSync: (path: string, encoding: BufferEncoding) => { const shift = /emoji(\d)\.md$/.exec(String(path)); return shift ? doc(Number(shift[1])) : fs.readFileSync(path, encoding); },
  };
});

describe('docs at every parity', () => {
  it.each(shifts)('shift %i: pages rejoin exactly, nothing lone, excerpt and title whole', async shift => {
    const { createAgentDocs } = await import('../server/agent-docs.js');
    const docs = createAgentDocs();
    const id = `emoji${shift}`;
    let cursor: string | null = null;
    let joined = '';
    do {
      const page: ReturnType<typeof docs.read> = docs.read(id, cursor);
      expect(page.text).not.toMatch(LONE);
      expect(page.title).not.toMatch(LONE);
      expect(page.text.length).toBeGreaterThan(0);
      joined += page.text;
      expect(page.truncated).toBe(page.nextCursor !== null);
      cursor = page.nextCursor;
    } while (cursor);
    expect(joined).toBe(doc(shift));
    const { matches } = docs.search(`needle${shift}`);
    expect(matches[0]?.id).toBe(id);
    expect(matches[0]?.excerpt).toContain(`needle${shift}`);
    expect(matches[0]?.excerpt).not.toMatch(LONE);
    expect(matches[0]?.title).not.toMatch(LONE);
  });
});
