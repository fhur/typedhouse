import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { initTRPC } from '@trpc/server';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import superjson from 'superjson';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Connection } from './clickhouse.js';
import { savedStore, type SavedStore } from './saved.js';
import { MAX_SAMPLE_ROWS, MAX_SOURCE, type ChatSendInput } from './chat.js';
import { unavailableLlm, type Llm, type ModelStatus } from './llm.js';

const t = initTRPC.create({ transformer: superjson });

function runInput(value: unknown): { source: string; autoLimit: boolean } {
  const v = value as { source?: unknown; autoLimit?: unknown } | null;
  if (!v || typeof v.source !== 'string' || typeof v.autoLimit !== 'boolean') throw new Error('Expected { source: string, autoLimit: boolean }');
  return { source: v.source, autoLimit: v.autoLimit };
}

function savedInput(value: unknown): { name: string; prompt: string; source: string; chart?: Record<string, unknown> | null; overwrite?: boolean } {
  const v = value as { name?: unknown; prompt?: unknown; source?: unknown; chart?: unknown; overwrite?: unknown } | null;
  if (!v || typeof v.name !== 'string' || typeof v.prompt !== 'string' || typeof v.source !== 'string' ||
      (v.chart !== undefined && v.chart !== null && (typeof v.chart !== 'object' || Array.isArray(v.chart))) || (v.overwrite !== undefined && typeof v.overwrite !== 'boolean')) {
    throw new Error('Expected { name, prompt, source, chart?, overwrite? }');
  }
  return { name: v.name, prompt: v.prompt, source: v.source, chart: (v.chart as Record<string, unknown> | undefined) ?? null, ...(v.overwrite === true ? { overwrite: true } : {}) };
}
const nameInput = (value: unknown) => {
  const v = value as { name?: unknown } | null;
  if (!v || typeof v.name !== 'string') throw new Error('Expected { name: string }');
  return { name: v.name };
};
const MAX_EDITOR_SOURCE = MAX_SOURCE;
const MAX_MESSAGE = 16_000;
const chatSendInput = (value: unknown): ChatSendInput => {
  const v = value as { chatId?: unknown; text?: unknown; source?: unknown; sample?: unknown; replaceFrom?: unknown } | null;
  if (!v || (v.chatId !== null && typeof v.chatId !== 'string') || typeof v.text !== 'string' || !v.text.trim() || v.text.length > MAX_MESSAGE || typeof v.source !== 'string' || v.source.length > MAX_EDITOR_SOURCE ||
      (v.sample !== undefined && !Array.isArray(v.sample)) || (v.replaceFrom !== undefined && !Number.isInteger(v.replaceFrom))) {
    throw new Error('Expected { chatId: string | null, text: string, source: string, sample?: unknown[], replaceFrom?: integer }');
  }
  return { chatId: v.chatId, text: v.text, source: v.source, ...(v.sample ? { sample: (v.sample as unknown[]).slice(0, MAX_SAMPLE_ROWS) } : {}), ...(v.replaceFrom === undefined ? {} : { replaceFrom: v.replaceFrom as number }) };
};
const chatNoteInput = (value: unknown) => {
  const v = value as { id?: unknown; text?: unknown } | null;
  if (!v || typeof v.id !== 'string' || typeof v.text !== 'string' || !v.text.trim() || v.text.length > MAX_MESSAGE) throw new Error('Expected { id: string, text: string }');
  return { id: v.id, text: v.text };
};
const chatIdInput = (value: unknown) => {
  const v = value as { id?: unknown } | null;
  if (!v || typeof v.id !== 'string') throw new Error('Expected { id: string }');
  return { id: v.id };
};
const sourceInput = (value: unknown) => {
  const v = value as { source?: unknown } | null;
  if (!v || typeof v.source !== 'string' || v.source.length > MAX_EDITOR_SOURCE) throw new Error('Expected { source: string }');
  return { source: v.source };
};
const positionInput = (value: unknown) => {
  const v = value as { source?: unknown; pos?: unknown } | null;
  if (!v || typeof v.source !== 'string' || v.source.length > MAX_EDITOR_SOURCE || typeof v.pos !== 'number' || !Number.isInteger(v.pos) || v.pos < 0 || v.pos > v.source.length) {
    throw new Error('Expected { source: string, pos: integer within source }');
  }
  return { source: v.source, pos: v.pos };
};
const modelInput = (value: unknown) => {
  const v = value as { provider?: unknown; modelId?: unknown } | null;
  if (!v || typeof v.provider !== 'string' || typeof v.modelId !== 'string') throw new Error('Expected { provider, modelId }');
  return { provider: v.provider, modelId: v.modelId };
};

/**
 * Without an explicit data dir (tests, embedding), saved queries go to a fresh temp directory, never the
 * user's real `~/.typedhouse/studio`; only `main.ts` resolves that default.
 */
export function defaultSavedStore(): SavedStore {
  // Created lazily by the first save (savedStore mkdirs on write) and removed when the process exits.
  const dir = join(tmpdir(), `typedhouse-studio-${process.pid}-${randomBytes(6).toString('hex')}`);
  if (!defaultDirs.size) process.once('exit', () => { for (const d of defaultDirs) rmSync(d, { recursive: true, force: true }); });
  defaultDirs.add(dir);
  return savedStore(dir);
}
const defaultDirs = new Set<string>();

/** The LLM is injected so tests can pass a faux-backed one; without one, generation reports why it is off. */
export function createRouter(conn: Connection, llm: Llm = unavailableLlm('not configured'), saved: SavedStore = defaultSavedStore()) {
  const meta = () => ({
    connection: conn.label,
    database: conn.database,
    model: llm.status as ModelStatus,
    schemaError: conn.schemaError() ?? null,
    tables: conn.tables(),
  });
  return t.router({
    meta: t.router({ get: t.procedure.query(meta) }),
    schema: t.router({ refresh: t.procedure.mutation(async () => { await conn.refresh(); return meta(); }) }),
    query: t.router({ run: t.procedure.input(runInput).mutation(({ input }) => conn.runQuery(input)) }),
    // Editor language intelligence (R12). Mutations so the source travels in the body, not the URL.
    types: t.router({
      // `null`: superseded by a newer request for newer text (latest wins).
      diagnostics: t.procedure.input(sourceInput).mutation(({ input }) => conn.types.check(input.source)),
      completions: t.procedure.input(positionInput).mutation(async ({ input }) => (await conn.types.completions(input.source, input.pos)) ?? { from: input.pos, items: [] }),
      hover: t.procedure.input(positionInput).mutation(({ input }) => conn.types.hover(input.source, input.pos)),
    }),
    saved: t.router({
      list: t.procedure.query(() => saved.list()),
      save: t.procedure.input(savedInput).mutation(({ input }) => saved.save(input)),
      delete: t.procedure.input(nameInput).mutation(({ input }) => saved.delete(input.name)),
    }),
    // The model choice lives in this server session only; a restart reverts to flag/env/default.
    models: t.router({
      list: t.procedure.query(() => llm.listModels()),
      select: t.procedure.input(modelInput).mutation(({ input }) => llm.selectModel(input)),
    }),
    chat: t.router({
      list: t.procedure.query(() => llm.chat.list()),
      get: t.procedure.input(chatIdInput).query(({ input }) => llm.chat.get(input.id)),
      send: t.procedure.input(chatSendInput).mutation(({ input }) => llm.chat.send(input)),
      stop: t.procedure.input(chatIdInput).mutation(({ input }) => llm.chat.stop(input.id)),
      note: t.procedure.input(chatNoteInput).mutation(({ input }) => llm.chat.note(input.id, input.text)),
    }),
  });
}
export type AppRouter = ReturnType<typeof createRouter>;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

/**
 * A second line behind `checkChartSpec`: whatever a chart spec manages to ask for, the page may only talk to this server.
 * - `default-src 'self'`, and so `img-src`/`connect-src`/`script-src`: no image, fetch or external SVG paint can carry a row out.
 * - no `'unsafe-eval'`: charts run with Vega's expression interpreter (`ast` in `web/chart.tsx`).
 * - `style-src 'unsafe-inline'`: CodeMirror, React `style` and Vite's dev CSS inject styles; CSS can't fetch past `img-src`/`font-src`.
 * - Google Fonts for the stylesheet and font files of `web/index.html`; `data:`/`blob:` images only.
 * - dev only: Vite's HMR websocket on this port, which not every browser counts as `'self'`, and the `blob:` worker its client
 *   starts to ping the server after a restart. The built page has no Vite client, so `dist/web` never gets either.
 */
export function contentSecurityPolicy(devPort?: number): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self'${devPort === undefined ? '' : ` ws://127.0.0.1:${devPort}`}`,
    ...(devPort === undefined ? [] : ["worker-src 'self' blob:"]),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** `ui`: 'dev' mounts Vite middleware over web/, 'static' serves dist/web, 'none' is tRPC only (tests). */
export async function startServer(options: { conn: Connection; llm?: Llm; dataDir?: string; port: number; ui: 'dev' | 'static' | 'none'; packageRoot: string }) {
  const trpc = createHTTPHandler({ router: createRouter(options.conn, options.llm, options.dataDir === undefined ? undefined : savedStore(options.dataDir)), basePath: '/trpc/' });
  const server = http.createServer();
  let fallback: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => { res.statusCode = 404; res.end('Not found'); };
  let closeVite = async () => {};
  if (options.ui === 'dev') {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: join(options.packageRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    fallback = vite.middlewares;
    closeVite = () => vite.close();
  } else if (options.ui === 'static') {
    const webRoot = join(options.packageRoot, 'dist', 'web');
    fallback = (req, res) => {
      let path: string;
      try { path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, ''); }
      catch { res.statusCode = 400; res.end('Bad request'); return; }
      const file = join(webRoot, path);
      const target = file.startsWith(webRoot + sep) && extname(file) ? file : join(webRoot, 'index.html');
      readFile(target).then(body => {
        res.setHeader('content-type', MIME[extname(target)] ?? 'application/octet-stream');
        res.end(body);
      }, () => { res.statusCode = 404; res.end('Not found'); });
    };
  }
  let policy = contentSecurityPolicy();
  server.on('request', (req, res) => {
    res.setHeader('Content-Security-Policy', policy);
    if (req.url?.startsWith('/trpc/')) trpc(req, res);
    else fallback(req, res);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  if (options.ui === 'dev') policy = contentSecurityPolicy(port);
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      await closeVite();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
