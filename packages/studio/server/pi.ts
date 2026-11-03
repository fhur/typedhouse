import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { Credential, CredentialInfo, CredentialStore, Model, Api, MutableModels, Provider } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

/** pi's agent directory: `--pi-dir`, else `PI_CODING_AGENT_DIR` (pi's own override), else `~/.pi/agent`. */
export function defaultPiDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['TYPEDHOUSE_STUDIO_PI_DIR'] ?? env['PI_CODING_AGENT_DIR'] ?? join(homedir(), '.pi', 'agent');
}

type AuthFile = Record<string, Credential>;
async function readJson<T>(path: string): Promise<T | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(text.replace(/^﻿/, '')) as T;
}

/**
 * A pi-ai `CredentialStore` over pi's `auth.json`, shared with a running `pi`.
 * - Same lock as pi (proper-lockfile's `auth.json.lock` directory), so OAuth refreshes by pi and the
 *   studio never interleave; the file is re-read inside the lock, so a token pi just rotated is seen.
 * - Same format as pi (`JSON.stringify(data, null, 2)`, other providers untouched), written atomically
 *   (temp file + rename) with the file's existing mode, 0600 when new.
 * - In-process writes are additionally chained, so one process never contends for its own lock.
 */
export function piCredentialStore(authPath: string): CredentialStore {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };
  const load = async (): Promise<AuthFile> => (await readJson<AuthFile>(authPath)) ?? {};

  async function locked<T>(fn: (data: AuthFile) => Promise<{ result: T; next?: AuthFile }>): Promise<T> {
    await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });
    try { await writeFile(authPath, '{}', { flag: 'wx', mode: 0o600 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const release = await lockfile.lock(authPath, { realpath: false, stale: 30_000, retries: { retries: 40, minTimeout: 20, maxTimeout: 1_000 } });
    try {
      const { result, next } = await fn(await load());
      if (next !== undefined) {
        const mode = (await stat(authPath)).mode & 0o777;
        const temp = `${authPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
          await chmod(temp, mode);
          await rename(temp, authPath);
        } catch (error) { await rm(temp, { force: true }); throw error; }
      }
      return result;
    } finally {
      await release().catch(() => undefined);
    }
  }

  return {
    async read(providerId) { return (await load())[providerId]; },
    async list(): Promise<readonly CredentialInfo[]> {
      return Object.entries(await load()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
    },
    modify(providerId, fn) {
      return serialized(() => locked(async data => {
        const current = data[providerId];
        const updated = await fn(current);
        if (updated === undefined) return { result: current };
        return { result: updated, next: { ...data, [providerId]: updated } };
      }));
    },
    delete(providerId) {
      return serialized(() => locked(async data => {
        if (!(providerId in data)) return { result: undefined };
        const { [providerId]: _removed, ...rest } = data;
        return { result: undefined, next: rest };
      }));
    },
  };
}

export interface ModelRef { provider: string; modelId: string }
export type ModelSetup = { ok: true; models: MutableModels; model: ModelRef } | { ok: false; reason: string };

/** `provider/model-id` (the id may contain `/`). */
export function parseModelRef(text: string): ModelRef | undefined {
  const slash = text.indexOf('/');
  if (slash <= 0 || slash === text.length - 1) return undefined;
  return { provider: text.slice(0, slash), modelId: text.slice(slash + 1) };
}

/** Studio's default model (user decision): pi's `settings.json` default is not used; credentials still come from pi. */
export const DEFAULT_MODEL = 'openai-codex/gpt-5.6-sol';

/** Which model to use: an explicit `provider/id` override (`--model` > `TYPEDHOUSE_STUDIO_MODEL`), else {@link DEFAULT_MODEL}. */
export async function chooseModel(_piDir: string, override: string | undefined): Promise<ModelRef | string> {
  // A set-but-empty TYPEDHOUSE_STUDIO_MODEL= (or --model '') means the default.
  const text = override?.trim() || DEFAULT_MODEL;
  return parseModelRef(text) ?? `Invalid model "${text}": expected provider/model-id.`;
}

/** The provider with `extra` appended to its static chat models (pi's dynamic catalog can be newer than pi-ai's). */
function withModel(provider: Provider, extra: Model<Api>): Provider {
  return {
    ...provider,
    getModels: () => [...provider.getModels(), extra],
    ...(provider.getAllModels ? { getAllModels: () => [...provider.getAllModels!(), extra] } : {}),
  } as Provider;
}

/**
 * Builds pi-ai `Models` over pi's credentials and resolves the configured model. A model missing from the
 * static catalog is taken from pi's `models-store.json` cache. Never touches the network: `checkAuth`
 * only checks that a credential (or env key) exists.
 */
export async function setupModels(options: { piDir: string; override?: string | undefined; credentials?: CredentialStore }): Promise<ModelSetup> {
  try {
    const choice = await chooseModel(options.piDir, options.override);
    if (typeof choice === 'string') return { ok: false, reason: choice };
    const models = builtinModels({ credentials: options.credentials ?? piCredentialStore(join(options.piDir, 'auth.json')) });
    const provider = models.getProvider(choice.provider);
    if (!provider) return { ok: false, reason: `Unknown provider "${choice.provider}".` };
    if (!models.getModel(choice.provider, choice.modelId)) {
      const store = await readJson<Record<string, { models?: Model<Api>[] }>>(join(options.piDir, 'models-store.json')).catch(() => undefined);
      const cached = store?.[choice.provider]?.models?.find(m => m.id === choice.modelId && m.provider === choice.provider);
      if (!cached) {
        const known = [...new Set([...models.getModels(choice.provider), ...(store?.[choice.provider]?.models ?? [])].map(m => m.id))];
        return { ok: false, reason: `Model "${choice.modelId}" not found for ${choice.provider}. Available: ${known.join(', ') || 'none'}.` };
      }
      models.setProvider(withModel(provider, cached));
    }
    const auth = await models.checkAuth(choice.provider);
    if (!auth) return { ok: false, reason: `No credentials for ${choice.provider}: log in with pi (auth.json in ${options.piDir}).` };
    return { ok: true, models, model: choice };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
