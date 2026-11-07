import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
import { charStart, cut } from './text.js';

interface Bundle { version: string; documents: Record<string, string> }
const here = dirname(fileURLToPath(import.meta.url));
function workspaceBundle(): Bundle {
  const root = resolve(here, '../../..');
  const version = (JSON.parse(readFileSync(resolve(root, 'packages/core/package.json'), 'utf8')) as { version: string }).version;
  const docsRoot = resolve(root, 'apps/docs/src/content/docs/docs');
  const documents: Record<string, string> = {};
  let totalBytes = 0;
  function walk(directory: string, prefix: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // Ignore symlinks; discovery is build/dev-time only, never influenced by tool arguments.
      if (entry.isDirectory()) walk(resolve(directory, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
        const id = `${prefix}${entry.name.replace(/\.mdx?$/, '')}`;
        const text = readFileSync(resolve(directory, entry.name), 'utf8');
        totalBytes += Buffer.byteLength(text);
        if (Buffer.byteLength(text) > 500_000 || totalBytes > 8_000_000) throw new Error('Documentation bundle exceeds byte budget');
        documents[id] = text;
      }
    }
  }
  walk(docsRoot, '');
  return { version, documents };
}
/** Copy same-workspace docs and core version into the build; installed reads never use source paths. */
export function buildAgentDocs() {
  const out = resolve(here, '../dist');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'agent-docs.json'), JSON.stringify(workspaceBundle()));
}
export function createAgentDocs() {
  const bundle: Bundle = basename(here) === 'dist'
    ? JSON.parse(readFileSync(resolve(here, 'agent-docs.json'), 'utf8')) as Bundle
    : workspaceBundle();
  const ids = Object.keys(bundle.documents).sort();
  const cursors = new Map<string, { key: string; offset: number; expires: number }>();
  function offsetOf(key: string, cursor?: string | null) {
    if (cursor == null) return 0;
    const value = cursors.get(cursor);
    if (!value || value.key !== key || value.expires <= Date.now()) throw new Error('Invalid or expired documentation cursor');
    return value.offset;
  }
  function next(key: string, offset: number, total: number) {
    if (offset >= total) return null;
    while (cursors.size >= 256) cursors.delete(cursors.keys().next().value!);
    const token = randomUUID(); cursors.set(token, { key, offset, expires: Date.now() + 300_000 }); return token;
  }
  const titleOf = (id: string) => cut(/^title:\s*(.+)$/m.exec(bundle.documents[id] ?? '')?.[1] ?? id, 200);
  return {
    read(id: string, cursor?: string | null) {
      // Exact allowlisted bundle lookup: never resolve a caller-supplied filesystem path or URL.
      if (!Object.hasOwn(bundle.documents, id)) throw new Error('Unknown documentation ID');
      const text = bundle.documents[id]!;
      const key = JSON.stringify(['read', id]);
      const offset = offsetOf(key, cursor);
      // The next page starts where this one ended, so a pair at the boundary moves to it whole.
      const page = cut(text.slice(offset, offset + 8001), 8000);
      return { id, title: titleOf(id), version: bundle.version, text: page, nextCursor: next(key, offset + page.length, text.length), truncated: offset + page.length < text.length };
    },
    search(query: string, cursor?: string | null) {
      if (query.length > 256) throw new Error('Documentation search exceeds 256 characters');
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
      const key = JSON.stringify(['search', query]);
      const offset = offsetOf(key, cursor);
      const matches = ids.filter(id => terms.every(term => `${id}\n${bundle.documents[id] ?? ''}`.toLowerCase().includes(term)));
      const page = matches.slice(offset, offset + 8);
      return { version: bundle.version, matches: page.map(id => {
        const text = bundle.documents[id]!;
        const index = terms.length ? Math.max(0, text.toLowerCase().indexOf(terms[0]!)) : 0;
        const start = charStart(text, Math.max(0, index - 80));
        return { id, title: titleOf(id), excerpt: cut(text.slice(start, index + 321), index + 320 - start) };
      }), total: matches.length, nextCursor: next(key, offset + page.length, matches.length), truncated: offset + page.length < matches.length };
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--bundle')) buildAgentDocs();
export type AgentDocs = ReturnType<typeof createAgentDocs>;
