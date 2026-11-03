import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Credential } from '@earendil-works/pi-ai';
import { chooseModel, DEFAULT_MODEL, defaultPiDir, parseModelRef, piCredentialStore, setupModels } from '../server/pi.js';

let dir: string;
const oauth = { type: 'oauth', access: 'access-1', refresh: 'refresh-1', expires: 1_900_000_000_000, accountId: 'acct' } as const;
const other = { type: 'api_key', key: 'sk-other' } as const;
const write = (name: string, value: unknown, mode = 0o600) => writeFile(join(dir, name), JSON.stringify(value, null, 2), { mode });

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'studio-pi-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('pi auth.json credential store', () => {
  it('reads an OAuth credential and lists without secrets', async () => {
    await write('auth.json', { 'openai-codex': oauth, anthropic: other });
    const store = piCredentialStore(join(dir, 'auth.json'));
    expect(await store.read('openai-codex')).toEqual(oauth);
    expect(await store.read('missing')).toBeUndefined();
    expect(await store.list()).toEqual([{ providerId: 'openai-codex', type: 'oauth' }, { providerId: 'anthropic', type: 'api_key' }]);
  });

  it('modify writes pi\'s exact format atomically, keeps other providers and the 0600 mode', async () => {
    await write('auth.json', { 'openai-codex': oauth, anthropic: other });
    const store = piCredentialStore(join(dir, 'auth.json'));
    const refreshed = { ...oauth, access: 'access-2', refresh: 'refresh-2' };
    expect(await store.modify('openai-codex', async current => ({ ...(current as typeof oauth), access: 'access-2', refresh: 'refresh-2' }))).toEqual(refreshed);
    // Byte-compatible with pi's own writer: JSON.stringify(data, null, 2), insertion order kept, no trailing newline.
    expect(await readFile(join(dir, 'auth.json'), 'utf8')).toBe(JSON.stringify({ 'openai-codex': refreshed, anthropic: other }, null, 2));
    expect((await stat(join(dir, 'auth.json'))).mode & 0o777).toBe(0o600);
    // Returning undefined leaves the entry (and the file) unchanged.
    expect(await store.modify('openai-codex', async () => undefined)).toEqual(refreshed);
    await store.delete('anthropic');
    expect(JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8'))).toEqual({ 'openai-codex': refreshed });
    // No temp files or lock directory left behind.
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual(['auth.json']);
  });

  it('serializes concurrent modify calls (each sees the previous write)', async () => {
    await write('auth.json', { counter: { type: 'api_key', key: '0' } });
    const store = piCredentialStore(join(dir, 'auth.json'));
    const bump = (current: Credential | undefined) => new Promise<Credential>(resolve =>
      setTimeout(() => resolve({ type: 'api_key', key: String(Number((current as { key?: string } | undefined)?.key ?? 0) + 1) }), Math.random() * 5));
    await Promise.all(Array.from({ length: 20 }, () => store.modify('counter', bump)));
    expect(await store.read('counter')).toEqual({ type: 'api_key', key: '20' });
  });

  it('creates a missing auth.json with mode 0600 on first write', async () => {
    const store = piCredentialStore(join(dir, 'nested', 'auth.json'));
    expect(await store.list()).toEqual([]);
    await store.modify('anthropic', async () => other);
    expect((await stat(join(dir, 'nested', 'auth.json'))).mode & 0o777).toBe(0o600);
  });
});

describe('model resolution', () => {
  it('parses provider/id, where the id may contain slashes', () => {
    expect(parseModelRef('openai-codex/gpt-5.5')).toEqual({ provider: 'openai-codex', modelId: 'gpt-5.5' });
    expect(parseModelRef('openrouter/anthropic/claude')).toEqual({ provider: 'openrouter', modelId: 'anthropic/claude' });
    expect(parseModelRef('nope')).toBeUndefined();
  });

  it('honors the pi dir env overrides', () => {
    expect(defaultPiDir({ TYPEDHOUSE_STUDIO_PI_DIR: '/a', PI_CODING_AGENT_DIR: '/b' })).toBe('/a');
    expect(defaultPiDir({ PI_CODING_AGENT_DIR: '/b' })).toBe('/b');
    expect(defaultPiDir({})).toMatch(/\.pi[/\\]agent$/);
  });

  it('defaults to openai-codex/gpt-5.6-sol, an override wins, and settings.json does not affect the model', async () => {
    expect(DEFAULT_MODEL).toBe('openai-codex/gpt-5.6-sol');
    expect(await chooseModel(dir, undefined)).toEqual({ provider: 'openai-codex', modelId: 'gpt-5.6-sol' });
    await write('settings.json', { defaultProvider: 'anthropic', defaultModel: 'claude-x' });
    expect(await chooseModel(dir, undefined)).toEqual({ provider: 'openai-codex', modelId: 'gpt-5.6-sol' });
    expect(await chooseModel(dir, 'anthropic/claude-x')).toEqual({ provider: 'anthropic', modelId: 'claude-x' });
    expect(await chooseModel(dir, 'bad')).toMatch(/Invalid model/);
  });

  it('resolves a catalog model, fills a missing one from models-store.json, and explains failures', async () => {
    await write('auth.json', { 'openai-codex': oauth });
    expect(await setupModels({ piDir: dir })).toMatchObject({ ok: true, model: { provider: 'openai-codex', modelId: 'gpt-5.6-sol' } });
    // An override id that is in neither the catalog nor the store: a clear error listing what exists.
    const missing = await setupModels({ piDir: dir, override: 'openai-codex/gpt-5.5' });
    expect(missing).toMatchObject({ ok: false, reason: expect.stringMatching(/Model "gpt-5\.5" not found for openai-codex\. Available: .*gpt-/) });

    const catalog = await setupModels({ piDir: dir, override: 'openai-codex/gpt-6-sol' });
    expect(catalog).toMatchObject({ ok: true, model: { provider: 'openai-codex', modelId: 'gpt-6-sol' } });

    const cached = { id: 'gpt-5.5', name: 'GPT-5.5', api: 'openai-codex-responses', provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 128000 };
    await write('models-store.json', { 'openai-codex': { models: [cached] } });
    const filled = await setupModels({ piDir: dir, override: 'openai-codex/gpt-5.5' });
    expect(filled).toMatchObject({ ok: true, model: { provider: 'openai-codex', modelId: 'gpt-5.5' } });
    if (filled.ok) expect(filled.models.getModel('openai-codex', 'gpt-5.5')?.api).toBe('openai-codex-responses');

    expect(await setupModels({ piDir: dir, override: 'nope/x' })).toMatchObject({ ok: false, reason: 'Unknown provider "nope".' });
    await write('auth.json', {});
    expect(await setupModels({ piDir: dir })).toMatchObject({ ok: false, reason: expect.stringMatching(/No credentials for openai-codex/) });
  });
});
