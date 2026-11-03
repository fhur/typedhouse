import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DatabaseSchema } from '@typedhouse/codegen';
import { resolveCore, type Completion, type CoreMode, type Hover, type TypeDiagnostic } from './types.js';

type Lane = 'check' | 'completions' | 'hover';
interface Pending { op: string; args: unknown[]; resolve: (value: unknown) => void; reject: (error: Error) => void }

/**
 * The editor's TypeScript service, off the main thread (one worker thread, request/response messages).
 * Editor requests are latest-wins per lane: while one is being computed, a newer request replaces the
 * queued one and the replaced caller gets `null` (its text has moved on). `checkExact` (generation) is never
 * dropped. A crashed worker is restarted on the next request with the last schema.
 */
export function createTypeWorker(options: { core?: CoreMode | 'auto' } = {}) {
  const core = resolveCore(options.core);
  const dev = new URL('./types-worker.dev.mjs', import.meta.url);
  const built = new URL('./types-worker.js', import.meta.url);
  // Built CLI: dist/types-worker.js next to dist/main.js. Dev/tests: the .ts source through tsx.
  const entry = import.meta.url.endsWith('.ts') || !existsSync(fileURLToPath(built)) ? dev : built;

  let worker: Worker | undefined;
  let seq = 0;
  let schema: DatabaseSchema | undefined;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  function spawn(): Worker {
    const w = new Worker(entry, { workerData: { core: core.mode } });
    w.unref();
    w.on('message', (message: { id?: number; result?: unknown; error?: string }) => {
      if (message.id === undefined) return;
      const waiter = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error !== undefined) waiter?.reject(new Error(message.error)); else waiter?.resolve(message.result);
    });
    const fail = (error: Error) => {
      if (worker === w) worker = undefined;
      for (const waiter of waiting.values()) waiter.reject(error);
      waiting.clear();
    };
    w.on('error', fail);
    w.on('exit', code => { if (code !== 0) fail(new Error(`type worker exited (${code})`)); else if (worker === w) worker = undefined; });
    if (schema) w.postMessage({ id: -1, op: 'setSchema', args: [schema] });
    return w;
  }
  function call<T>(op: string, args: unknown[]): Promise<T> {
    worker ??= spawn();
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker!.postMessage({ id, op, args });
    });
  }

  // Latest-wins lanes for editor requests.
  const lanes: Record<Lane, { busy: boolean; next?: Pending | undefined }> = { check: { busy: false }, completions: { busy: false }, hover: { busy: false } };
  function latest<T>(lane: Lane, op: string, args: unknown[]): Promise<T | null> {
    const slot = lanes[lane];
    return new Promise<T | null>((resolve, reject) => {
      const job: Pending = { op, args, resolve: resolve as (value: unknown) => void, reject };
      if (slot.busy) {
        slot.next?.resolve(null); // superseded: the editor has newer text
        slot.next = job;
        return;
      }
      run(job);
    });
    function run(job: Pending) {
      slot.busy = true;
      call(job.op, job.args).then(job.resolve, job.reject).finally(() => {
        const next = slot.next;
        slot.next = undefined;
        slot.busy = false;
        if (next) run(next);
      });
    }
  }

  return {
    core,
    setSchema(next: DatabaseSchema) {
      schema = next;
      if (worker) worker.postMessage({ id: -1, op: 'setSchema', args: [next] });
    },
    /** Editor diagnostics (TS + contract + guard); `null` when a newer request replaced this one. */
    check: (source: string) => latest<TypeDiagnostic[]>('check', 'check', [source]),
    /** Generation's check_query: never dropped. */
    checkExact: (source: string) => call<TypeDiagnostic[]>('check', [source]),
    completions: (source: string, pos: number) => latest<{ from: number; items: Completion[] }>('completions', 'completions', [source, pos]),
    hover: (source: string, pos: number) => latest<Hover | null>('hover', 'hover', [source, pos]),
    warm: () => call<void>('warm', []),
    async close() { const w = worker; worker = undefined; await w?.terminate(); },
  };
}
export type TypeWorker = ReturnType<typeof createTypeWorker>;
