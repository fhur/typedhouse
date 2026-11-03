import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface SavedQuery { name: string; prompt: string; source: string; chart: Record<string, unknown> | null; updatedAt: string }
interface SavedFile { version: 1; queries: SavedQuery[] }

export type ListResult = { ok: true; queries: SavedQuery[] } | { ok: false; error: string };
export type SaveResult = { ok: true } | { ok: false; exists: true } | { ok: false; error: string };
export type DeleteResult = { ok: true } | { ok: false; error: string };

export const MAX_NAME = 100;

/** Trimmed, 1–100 characters; returns the name or an error message. */
export function validName(name: unknown): string | { error: string } {
  if (typeof name !== 'string') return { error: 'A name is required.' };
  const trimmed = name.trim();
  if (!trimmed) return { error: 'A name is required.' };
  if (trimmed.length > MAX_NAME) return { error: `Names are at most ${MAX_NAME} characters.` };
  return trimmed;
}

/**
 * Saved queries in `<dataDir>/saved.json` (`{ version: 1, queries }`). Writes are atomic (temp file +
 * rename, mode 0600) and serialized in-process. A file that cannot be read or parsed is never overwritten:
 * listing reports it and saves are refused until it is fixed or moved aside.
 */
export function savedStore(dataDir: string) {
  const path = join(dataDir, 'saved.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  async function load(): Promise<SavedFile | { error: string }> {
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, queries: [] };
      return { error: `Cannot read ${path}: ${(error as Error).message}` };
    }
    const broken = (why: string) => ({ error: `${path} is not a valid saved-queries file (${why}). It was left untouched: fix it or move it aside to save again.` });
    let data: unknown;
    try { data = JSON.parse(text); } catch (error) { return broken((error as Error).message); }
    const file = data as Partial<SavedFile> | null;
    if (!file || typeof file !== 'object' || file.version !== 1 || !Array.isArray(file.queries)) return broken('expected { "version": 1, "queries": [...] }');
    const ok = file.queries.every(q => q && typeof q.name === 'string' && typeof q.source === 'string' && typeof q.prompt === 'string' && typeof q.updatedAt === 'string');
    if (!ok) return broken('an entry is missing name, prompt, source or updatedAt');
    return { version: 1, queries: file.queries.map(q => ({ ...q, chart: q.chart && typeof q.chart === 'object' ? q.chart : null })) };
  }

  async function store(file: SavedFile): Promise<void> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, path);
    } catch (error) { await rm(temp, { force: true }); throw error; }
  }

  const newestFirst = (a: SavedQuery, b: SavedQuery) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.name.localeCompare(b.name));

  return {
    path,
    async list(): Promise<ListResult> {
      const file = await load();
      return 'error' in file ? { ok: false, error: file.error } : { ok: true, queries: [...file.queries].sort(newestFirst) };
    },
    save(input: { name: string; prompt: string; source: string; chart?: Record<string, unknown> | null; overwrite?: boolean }): Promise<SaveResult> {
      return serialized(async () => {
        const name = validName(input.name);
        if (typeof name !== 'string') return { ok: false, error: name.error };
        const file = await load();
        if ('error' in file) return { ok: false, error: file.error };
        const existing = file.queries.findIndex(q => q.name === name);
        if (existing >= 0 && !input.overwrite) return { ok: false, exists: true };
        // Strictly newer than every entry, so "newest first" is exact even within one millisecond.
        const latest = Math.max(0, ...file.queries.map(q => Date.parse(q.updatedAt) || 0));
        const updatedAt = new Date(Math.max(Date.now(), latest + 1)).toISOString();
        const entry: SavedQuery = { name, prompt: input.prompt, source: input.source, chart: input.chart ?? null, updatedAt };
        const queries = existing >= 0 ? file.queries.map((q, i) => (i === existing ? entry : q)) : [...file.queries, entry];
        try { await store({ version: 1, queries }); } catch (error) { return { ok: false, error: `Cannot write ${path}: ${(error as Error).message}` }; }
        return { ok: true };
      });
    },
    delete(name: string): Promise<DeleteResult> {
      return serialized(async () => {
        const file = await load();
        if ('error' in file) return { ok: false, error: file.error };
        if (!file.queries.some(q => q.name === name)) return { ok: true };
        try { await store({ version: 1, queries: file.queries.filter(q => q.name !== name) }); } catch (error) { return { ok: false, error: `Cannot write ${path}: ${(error as Error).message}` }; }
        return { ok: true };
      });
    },
  };
}
export type SavedStore = ReturnType<typeof savedStore>;
