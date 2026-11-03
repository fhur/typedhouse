// Tester (S2): the pi credential store and model resolution, edge cases on temp pi dirs. No network,
// never touches ~/.pi.
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseModel, piCredentialStore, setupModels } from '../server/pi.js';

let dir: string;
const oauth = { type: 'oauth', access: 'SECRET-ACCESS', refresh: 'SECRET-REFRESH', expires: 1_900_000_000_000, accountId: 'acct' } as const;
const apiKey = { type: 'api_key', key: 'SECRET-KEY' } as const;
const write = (name: string, value: unknown, mode = 0o600) => writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode });

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'studio-pi-tester-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('credential store edge cases', () => {
  it('a missing auth.json reads as empty and does not create the file', async () => {
    const store = piCredentialStore(join(dir, 'auth.json'));
    expect(await store.read('openai-codex')).toBeUndefined();
    expect(await store.list()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('list() never contains secret values', async () => {
    await write('auth.json', { 'openai-codex': oauth, anthropic: apiKey });
    const listed = JSON.stringify(await piCredentialStore(join(dir, 'auth.json')).list());
    expect(listed).not.toMatch(/SECRET/);
  });

  it('malformed auth.json: setupModels reports unavailable instead of throwing, and does not echo secrets', async () => {
    await write('auth.json', '{"openai-codex": {"type":"oauth","access":"SECRET-ACCESS", oops');
    const result = await setupModels({ piDir: dir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toMatch(/SECRET/);
  });

  it('a provider without a credential is unavailable with a clear reason', async () => {
    await write('auth.json', { anthropic: apiKey });
    expect(await setupModels({ piDir: dir })).toMatchObject({ ok: false, reason: expect.stringMatching(/No credentials for openai-codex/) });
  });

  it('keeps a non-default file mode and every other provider byte-for-byte', async () => {
    await write('auth.json', { anthropic: apiKey, 'openai-codex': oauth, zeta: { type: 'api_key', key: 'z' } }, 0o640);
    await chmod(join(dir, 'auth.json'), 0o640);
    const store = piCredentialStore(join(dir, 'auth.json'));
    await store.modify('openai-codex', async c => ({ ...(c as typeof oauth), access: 'NEW' }));
    const after = JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(after)).toEqual(['anthropic', 'openai-codex', 'zeta']);
    expect(after['anthropic']).toEqual(apiKey);
    expect((await stat(join(dir, 'auth.json'))).mode & 0o777).toBe(0o640);
  });

  it('a throwing modify callback leaves the file untouched and releases the lock', async () => {
    await write('auth.json', { 'openai-codex': oauth });
    const before = await readFile(join(dir, 'auth.json'), 'utf8');
    const store = piCredentialStore(join(dir, 'auth.json'));
    await expect(store.modify('openai-codex', async () => { throw new Error('refresh failed'); })).rejects.toThrow('refresh failed');
    expect(await readFile(join(dir, 'auth.json'), 'utf8')).toBe(before);
    expect(await readdir(dir)).toEqual(['auth.json']);
    // A later modify still works (no stuck in-process queue or lock).
    await store.modify('openai-codex', async c => ({ ...(c as typeof oauth), access: 'after' }));
    expect(JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8'))['openai-codex'].access).toBe('after');
  });

  it('waits for pi\'s lock held by another process and sees what that process wrote', async () => {
    const authPath = join(dir, 'auth.json');
    await write('auth.json', { 'openai-codex': oauth });
    // Another process (standing in for pi) takes proper-lockfile's lock, rotates the token, then releases.
    const lockfile = createRequire(fileURLToPath(new URL('../server/pi.ts', import.meta.url))).resolve('proper-lockfile');
    const script = `
      const lockfile = require(${JSON.stringify(lockfile)});
      const fs = require('node:fs');
      const release = lockfile.lockSync(${JSON.stringify(authPath)}, { realpath: false });
      console.log('LOCKED');
      setTimeout(() => {
        const data = JSON.parse(fs.readFileSync(${JSON.stringify(authPath)}, 'utf8'));
        data['openai-codex'].refresh = 'ROTATED-BY-PI';
        fs.writeFileSync(${JSON.stringify(authPath)}, JSON.stringify(data, null, 2), { mode: 0o600 });
        release();
        console.log('RELEASED');
      }, 1500);`;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise(resolve => child.once('exit', resolve));
    let output = '';
    await new Promise<void>(resolve => child.stdout.on('data', (d: Buffer) => { output += d; if (output.includes('LOCKED')) resolve(); }));
    const started = Date.now();
    const store = piCredentialStore(authPath);
    let seen: string | undefined;
    await store.modify('openai-codex', async c => { seen = (c as { refresh: string }).refresh; return { ...(c as typeof oauth), access: 'STUDIO' }; });
    await exited;
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(seen).toBe('ROTATED-BY-PI');
    const final = JSON.parse(await readFile(authPath, 'utf8'))['openai-codex'];
    expect(final).toMatchObject({ refresh: 'ROTATED-BY-PI', access: 'STUDIO' });
  }, 20_000);
});

describe('model resolution edge cases', () => {
  it('rejects malformed --model values', async () => {
    for (const bad of ['gpt-5', '/gpt-5', 'openai-codex/', '/']) {
      expect(await chooseModel(dir, bad)).toMatch(/Invalid model/);
    }
  });

  // Model default decision (user, after F5): `--model` > TYPEDHOUSE_STUDIO_MODEL > openai-codex/gpt-5.6-sol;
  // pi's settings.json no longer picks the model.
  it('settings.json is ignored for the model, whether missing, malformed or pointing elsewhere', async () => {
    await write('auth.json', { 'openai-codex': oauth });
    const expected = { ok: true, model: { provider: 'openai-codex', modelId: 'gpt-5.6-sol' } };
    expect(await setupModels({ piDir: dir })).toMatchObject(expected);
    await write('settings.json', '{ not json');
    expect(await setupModels({ piDir: dir })).toMatchObject(expected);
    await write('settings.json', { defaultProvider: 'acme-ai', defaultModel: 'x' });
    expect(await setupModels({ piDir: dir })).toMatchObject(expected);
  });

  it('the default still needs an openai-codex credential, and says so', async () => {
    await write('auth.json', { anthropic: apiKey });
    expect(await setupModels({ piDir: dir })).toMatchObject({ ok: false, reason: expect.stringMatching(/No credentials for openai-codex/) });
  });

  it('an unknown provider in the override is reported', async () => {
    expect(await setupModels({ piDir: dir, override: 'acme-ai/x' })).toMatchObject({ ok: false, reason: 'Unknown provider "acme-ai".' });
  });

  it('an override wins over the default and over settings.json', async () => {
    await write('settings.json', { defaultProvider: 'openai-codex', defaultModel: 'gpt-5.6-sol' });
    await write('auth.json', { 'openai-codex': oauth });
    expect(await setupModels({ piDir: dir, override: 'openai-codex/gpt-6-sol' })).toMatchObject({ ok: true, model: { provider: 'openai-codex', modelId: 'gpt-6-sol' } });
  });

  it('an override id missing from the catalog resolves through the user\'s real models-store (copied, fake credential)', async () => {
    const real = join(homedir(), '.pi', 'agent', 'models-store.json');
    try { await stat(real); } catch { return; }
    await copyFile(real, join(dir, 'models-store.json'));
    await write('auth.json', { 'openai-codex': oauth });
    expect(await setupModels({ piDir: dir, override: 'openai-codex/gpt-5.5' })).toMatchObject({ ok: true, model: { provider: 'openai-codex', modelId: 'gpt-5.5' } });
    // Not in the catalog nor the store: a clear error listing what exists.
    expect(await setupModels({ piDir: dir, override: 'openai-codex/gpt-0' })).toMatchObject({ ok: false, reason: expect.stringMatching(/Model "gpt-0" not found for openai-codex\. Available: .*gpt-5\.6-sol/) });
  });
});
