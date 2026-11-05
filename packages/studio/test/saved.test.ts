import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createLlm, type Llm } from '../server/llm.js';
import { savedStore } from '../server/saved.js';
import { matchShortcut } from '../web/keymap.js';
import { matchScore, rank } from '../web/palette-match.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'studio-saved-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const entry = (name: string, source = 'export default from(events)') => ({ name, prompt: `prompt for ${name}`, source });

describe('saved store', () => {
  it('creates the data dir and file on first save, mode 0600, and lists newest first', async () => {
    const store = savedStore(join(dir, 'nested', 'studio'));
    expect(await store.list()).toEqual({ ok: true, queries: [] });
    expect(await store.save(entry('a'))).toEqual({ ok: true });
    expect(await store.save({ ...entry('b'), chart: { mark: 'bar' } })).toEqual({ ok: true });
    expect(await store.save(entry('c'))).toEqual({ ok: true });
    const listed = await store.list();
    expect(listed.ok && listed.queries.map(q => q.name)).toEqual(['c', 'b', 'a']);
    expect(listed.ok && listed.queries[1]).toMatchObject({ name: 'b', prompt: 'prompt for b', chart: { mark: 'bar' } });
    expect(listed.ok && listed.queries[0]!.chart).toBeNull();
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toMatchObject({ version: 1, queries: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
  });

  it('refuses to overwrite an existing name unless asked, then overwrites and moves it to the top', async () => {
    const store = savedStore(dir);
    await store.save(entry('x', 'v1'));
    await store.save(entry('y'));
    expect(await store.save(entry('x', 'v2'))).toEqual({ ok: false, exists: true });
    expect(await store.save({ ...entry(' x ', 'v2'), overwrite: true })).toEqual({ ok: true });
    const listed = await store.list();
    expect(listed.ok && listed.queries.map(q => [q.name, q.source])).toEqual([['x', 'v2'], ['y', 'export default from(events)']]);
  });

  it('validates names: trimmed, 1–100 characters', async () => {
    const store = savedStore(dir);
    expect(await store.save(entry('   '))).toMatchObject({ ok: false, error: expect.stringMatching(/name is required/) });
    expect(await store.save(entry('n'.repeat(101)))).toMatchObject({ ok: false, error: expect.stringMatching(/at most 100/) });
    expect(await store.save(entry(`  ${'n'.repeat(100)}  `))).toEqual({ ok: true });
  });

  it('deletes by name; deleting a missing name is a no-op', async () => {
    const store = savedStore(dir);
    await store.save(entry('a'));
    await store.save(entry('b'));
    expect(await store.delete('a')).toEqual({ ok: true });
    expect(await store.delete('zzz')).toEqual({ ok: true });
    const listed = await store.list();
    expect(listed.ok && listed.queries.map(q => q.name)).toEqual(['b']);
  });

  it('a corrupt file is reported, never overwritten, and saves are refused until it is fixed', async () => {
    const store = savedStore(dir);
    for (const content of ['{ not json', '{"version":2,"queries":[]}', '{"version":1,"queries":[{"name":1}]}']) {
      await writeFile(store.path, content);
      const listed = await store.list();
      expect(listed).toMatchObject({ ok: false, error: expect.stringMatching(/saved\.json is not a valid saved-queries file.*left untouched/s) });
      expect(await store.save(entry('a'))).toMatchObject({ ok: false, error: expect.stringMatching(/left untouched/) });
      expect(await store.delete('a')).toMatchObject({ ok: false });
      expect(await readFile(store.path, 'utf8')).toBe(content);
    }
  });

  it('concurrent saves are serialized and leave no temp files', async () => {
    const store = savedStore(dir);
    await Promise.all(Array.from({ length: 15 }, (_, i) => store.save(entry(`q${i}`))));
    const listed = await store.list();
    expect(listed.ok && listed.queries).toHaveLength(15);
    expect(await readdir(dir)).toEqual(['saved.json']);
  });
});

describe('palette matching', () => {
  const labels = ['Run query', 'Toggle auto-limit (100 rows)', 'Show Table', 'Show Chart', 'Show SQL', 'Save query', 'Refresh schema', 'Switch model…', 'entity_ots_component', 'metric_group_ots_component_indices'];
  const top = (q: string) => rank(labels, q, l => l).map(r => r.item);

  it('is a case-insensitive subsequence match; non-matches are dropped', () => {
    expect(matchScore('TGL', 'Toggle auto-limit')).toBeDefined();
    expect(matchScore('xyz', 'Toggle auto-limit')).toBeUndefined();
    expect(top('')).toEqual(labels);
  });

  it('prefers prefixes and word starts over scattered matches', () => {
    expect(top('tab')[0]).toBe('Show Table');
    expect(top('sh').slice(0, 3).every(l => l.startsWith('Show'))).toBe(true);
    expect(top('chart')[0]).toBe('Show Chart');
    expect(top('limit')[0]).toBe('Toggle auto-limit (100 rows)');
    expect(top('sm')[0]).toBe('Switch model…');
    expect(top('eoc')[0]).toBe('entity_ots_component');
    expect(top('model')).toEqual(['Switch model…']);
  });

  it('returns the matched indices for highlighting', () => {
    expect(matchScore('chart', 'Show Chart')?.indices).toEqual([5, 6, 7, 8, 9]);
    expect(matchScore('sm', 'Switch model…')?.indices).toEqual([0, 7]);
  });
});

describe('keymap ⌘K / ⌘S', () => {
  const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) => matchShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  it('maps with ⌘ or Ctrl, case-insensitive, never without a modifier or with Alt', () => {
    expect(key('k', { metaKey: true })).toBe('palette');
    expect(key('K', { ctrlKey: true })).toBe('palette');
    expect(key('s', { metaKey: true })).toBe('save');
    expect(key('s', { ctrlKey: true })).toBe('save');
    expect(key('s', {})).toBeUndefined();
    expect(key('s', { ctrlKey: true, altKey: true })).toBeUndefined();
  });
});

describe('models.select (faux provider with two models)', () => {
  let llm: Llm | undefined;
  afterEach(async () => { await llm?.close(); llm = undefined; });

  it('lists the models, and the next generation uses the selected one', async () => {
    const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
    const models = createModels();
    models.setProvider(faux.provider);
    llm = await createLlm({ models, model: { provider: faux.provider.id, modelId: 'faux-a' }, schema: () => '', check: () => ({ ok: true, sql: 'SELECT 1', rowType: '{}' }) });
    expect((await llm.listModels()).models.map(m => m.modelId)).toEqual(['faux-a', 'faux-b']);
    expect(await llm.selectModel({ provider: faux.provider.id, modelId: 'nope' })).toMatchObject({ ok: false });
    expect(await llm.selectModel({ provider: faux.provider.id, modelId: 'faux-b' })).toEqual({ ok: true });
    expect(llm.status).toEqual({ available: true, provider: faux.provider.id, modelId: 'faux-b' });
    let used = '';
    faux.setResponses([((_ctx: unknown, _options: unknown, _state: unknown, model: { id: string }) => { used = model.id; return fauxAssistantMessage([fauxToolCall('query_apply', { source: 'x' })], { stopReason: 'toolUse' }); }) as never]);
    expect(await llm.chat.send({ chatId: null, text: 'x', source: '' })).toMatchObject({ ok: true });
    expect(used).toBe('faux-b');
  });
});
