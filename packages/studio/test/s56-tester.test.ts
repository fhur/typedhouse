// Tester (S5 + S6): saved-query store edge cases, palette ranking, and session model switching.
// Temp data dirs only; faux provider only.
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { savedStore } from '../server/saved.js';
import { createLlm } from '../server/llm.js';
import { matchScore, rank } from '../web/palette-match.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'studio-saved-tester-')); });
afterEach(async () => { await chmod(dir, 0o700).catch(() => undefined); await rm(dir, { recursive: true, force: true }); });
const entry = (name: string, extra: Record<string, unknown> = {}) => ({ name, prompt: `p ${name}`, source: `export default from(t) // ${name}`, ...extra });

describe('saved store: names', () => {
  it('refuses empty, whitespace-only and 101-character names; accepts 100', async () => {
    const store = savedStore(dir);
    for (const name of ['', '   ', '\t\n', 'x'.repeat(101), ` ${'x'.repeat(101)} `]) expect(await store.save(entry(name))).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await store.save(entry('x'.repeat(100)))).toEqual({ ok: true });
    expect(await store.save(entry(`  ${'y'.repeat(100)}  `))).toEqual({ ok: true });
  });

  it('round-trips unicode, emoji and path-like names without touching other paths', async () => {
    const store = savedStore(join(dir, 'data'));
    const names = ['Umsatz pro Länder 🇩🇪', '売上 📈', '../../escape', 'a/b\\c', 'nul\u0000byte', '__proto__', 'constructor'];
    for (const name of names) expect(await store.save(entry(name))).toEqual({ ok: true });
    const listed = await store.list();
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.queries.map(q => q.name).sort()).toEqual([...names].sort());
    expect(await readdir(dir)).toEqual(['data']);
    expect(await readdir(join(dir, 'data'))).toEqual(['saved.json']);
  });

  it('a name differing only by surrounding whitespace is the same name', async () => {
    const store = savedStore(dir);
    expect(await store.save(entry('Revenue'))).toEqual({ ok: true });
    expect(await store.save(entry('  Revenue\t'))).toEqual({ ok: false, exists: true });
    expect(await store.save({ ...entry('  Revenue  '), source: 'new', overwrite: true })).toEqual({ ok: true });
    const listed = await store.list();
    expect(listed.ok && listed.queries.map(q => [q.name, q.source])).toEqual([['Revenue', 'new']]);
  });
});

describe('saved store: files', () => {
  it('a missing data dir lists empty without creating anything; the first save creates it 0700 and the file 0600', async () => {
    const data = join(dir, 'a', 'b');
    const store = savedStore(data);
    expect(await store.list()).toEqual({ ok: true, queries: [] });
    expect(await readdir(dir)).toEqual([]);
    expect(await store.save(entry('q'))).toEqual({ ok: true });
    expect((await stat(join(data, 'saved.json'))).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['truncated JSON', '{"version":1,"queries":[{"name":"a","prompt":"","source":"x","updatedAt":"2026'],
    ['wrong version', JSON.stringify({ version: 2, queries: [] })],
    ['queries not an array', JSON.stringify({ version: 1, queries: {} })],
    ['entry missing source', JSON.stringify({ version: 1, queries: [{ name: 'a', prompt: '', updatedAt: 'x' }] })],
    ['empty file', ''],
  ])('%s: list explains, save and delete refuse, the bytes are untouched', async (_name, text) => {
    await writeFile(join(dir, 'saved.json'), text);
    const store = savedStore(dir);
    const listed = await store.list();
    expect(listed).toMatchObject({ ok: false, error: expect.stringMatching(/saved\.json/) });
    expect(await store.save(entry('q'))).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await store.delete('a')).toMatchObject({ ok: false });
    expect(await readFile(join(dir, 'saved.json'), 'utf8')).toBe(text);
    expect(await readdir(dir)).toEqual(['saved.json']);
  });

  it('an unreadable file is reported and never replaced', async () => {
    const path = join(dir, 'saved.json');
    await writeFile(path, JSON.stringify({ version: 1, queries: [] }));
    await chmod(path, 0o000);
    try {
      const store = savedStore(dir);
      expect(await store.list()).toMatchObject({ ok: false, error: expect.stringMatching(/Cannot read|permission|EACCES/i) });
      expect(await store.save(entry('q'))).toMatchObject({ ok: false });
      expect((await stat(path)).mode & 0o777).toBe(0o000);
    } finally { await chmod(path, 0o600); }
  });

  it('a data dir that cannot be created gives a clean error', async () => {
    await writeFile(join(dir, 'blocker'), 'a file, not a dir');
    const store = savedStore(join(dir, 'blocker', 'data'));
    expect(await store.save(entry('q'))).toMatchObject({ ok: false, error: expect.stringMatching(/blocker/) });
  });
});

describe('saved store: content', () => {
  it('50 concurrent distinct saves all land; 20 concurrent overwrites leave one entry with one of the sources', async () => {
    const store = savedStore(dir);
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.save(entry(`q${i}`))));
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save({ ...entry('same'), source: `v${i}`, overwrite: true })));
    const listed = await store.list();
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.queries).toHaveLength(51);
    expect(listed.queries[0]!.name).toBe('same');
    expect(new Set(listed.queries.map(q => q.updatedAt)).size).toBe(51);
    expect((await readdir(dir)).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a 2 MB source and a chart spec round-trip exactly', async () => {
    const store = savedStore(dir);
    const source = `export default from(t)\n// ${'x'.repeat(2_000_000)}\n'quotes' "and" \`ticks\` \\  `;
    const chart = { mark: 'bar', encoding: { x: { field: 'e\\.name', type: 'nominal' }, tooltip: [{ field: 'n', format: ',.0f' }] }, data: { name: 'table' } };
    expect(await store.save({ ...entry('big'), source, chart })).toEqual({ ok: true });
    const listed = await store.list();
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.queries[0]).toMatchObject({ name: 'big', source, chart });
  });

  it('overwrite keeps the other entries and their order, and moves the overwritten one to the top', async () => {
    const store = savedStore(dir);
    for (const n of ['a', 'b', 'c']) await store.save(entry(n));
    await store.save({ ...entry('a'), prompt: 'changed', overwrite: true });
    const listed = await store.list();
    expect(listed.ok && listed.queries.map(q => `${q.name}:${q.prompt}`)).toEqual(['a:changed', 'c:p c', 'b:p b']);
    // A chart saved earlier is replaced by null when overwritten without one.
    await store.save({ ...entry('b'), chart: { mark: 'bar' } , overwrite: true });
    await store.save({ ...entry('b'), overwrite: true });
    const again = await store.list();
    expect(again.ok && again.queries[0]).toMatchObject({ name: 'b', chart: null });
  });
});

describe('palette ranking', () => {
  const names = (query: string, items: string[]) => rank(items, query, s => s).map(r => r.item);

  it('orders exact > prefix > word start > mid-word contiguous > scattered subsequence', () => {
    const items = ['scattered r-u-n letters', 'xrunx', 'quick run', 'runner stats', 'run'];
    expect(names('run', items)).toEqual(['run', 'runner stats', 'quick run', 'xrunx', 'scattered r-u-n letters']);
  });

  it('word starts across snake_case, kebab-case and camelCase beat scattered letters', () => {
    expect(names('eoc', ['become ozone circle', 'entity_ots_component'])[0]).toBe('entity_ots_component');
    expect(names('sq', ['Show SQL', 'sequence'])[0]).toBe('Show SQL');
    expect(names('al', ['Toggle auto-limit', 'Show Table'])[0]).toBe('Toggle auto-limit');
  });

  it('empty and whitespace queries list everything in the original order; non-matches are dropped', () => {
    const items = ['b', 'a', 'c'];
    expect(names('', items)).toEqual(items);
    expect(names('   ', items)).toEqual(items);
    expect(names('zzz', items)).toEqual([]);
  });

  it('is case-insensitive and handles unicode', () => {
    expect(matchScore('LÄN', 'Umsatz pro Länder')).toBeDefined();
    expect(matchScore('📈', '売上 📈')).toBeDefined();
  });

  it('ranks 2000 saved items quickly', () => {
    const items = Array.from({ length: 2000 }, (_, i) => `saved query number ${i} about revenue by country`);
    const started = performance.now();
    expect(rank(items, 'rev cty', s => s).length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('models.select edge cases', () => {
  it('unknown provider or id is refused and the model is unchanged', async () => {
    const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: 'faux-a' }, schema: () => '', check: () => ({ ok: true, sql: 'SELECT 1', rowType: '{}' }) });
    try {
      for (const ref of [{ provider: 'nope', modelId: 'faux-a' }, { provider: faux.provider.id, modelId: '' }, { provider: faux.provider.id, modelId: 'FAUX-B' }]) {
        expect(await llm.selectModel(ref)).toMatchObject({ ok: false, error: expect.any(String) });
      }
      expect(llm.status).toMatchObject({ modelId: 'faux-a' });
    } finally { await llm.close(); }
  });

  it('switching during a generation: the running one keeps its model, the next uses the new one', async () => {
    const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: 'faux-a' }, schema: () => '', check: () => ({ ok: true, sql: 'SELECT 1', rowType: '{}' }) });
    try {
      const used: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const reply = (_c: unknown, _o: unknown, _s: unknown, model: { id: string }) => { used.push(model.id); return fauxAssistantMessage([fauxToolCall('check_query', { source: 'x' })], { stopReason: 'toolUse' }); };
      faux.setResponses([(async (c: unknown, o: unknown, s: unknown, m: { id: string }) => { await gate; return reply(c, o, s, m); }) as never, reply as never]);
      const first = llm.generateQuery({ prompt: 'x' });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(await llm.selectModel({ provider: faux.provider.id, modelId: 'faux-b' })).toEqual({ ok: true });
      release();
      expect(await first).toMatchObject({ ok: true });
      expect(await llm.generateQuery({ prompt: 'y' })).toMatchObject({ ok: true });
      expect(used).toEqual(['faux-a', 'faux-b']);
    } finally { await llm.close(); }
  });
});

