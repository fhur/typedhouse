import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { initTRPC } from '@trpc/server';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import superjson from 'superjson';
import { homedir } from 'node:os';
import type { Connection } from './clickhouse.js';
import { savedStore, type SavedStore } from './saved.js';
import { MAX_SAMPLE_ROWS, unavailableLlm, type ChartInput, type Llm, type ModelStatus } from './llm.js';

const t = initTRPC.create({ transformer: superjson });

function runInput(value: unknown): { source: string; autoLimit: boolean } {
  const v = value as { source?: unknown; autoLimit?: unknown } | null;
  if (!v || typeof v.source !== 'string' || typeof v.autoLimit !== 'boolean') throw new Error('Expected { source: string, autoLimit: boolean }');
  return { source: v.source, autoLimit: v.autoLimit };
}

function generateInput(value: unknown): { prompt: string; source?: string } {
  const v = value as { prompt?: unknown; source?: unknown } | null;
  if (!v || typeof v.prompt !== 'string' || !v.prompt.trim() || (v.source !== undefined && typeof v.source !== 'string')) throw new Error('Expected { prompt: string, source?: string }');
  return v.source === undefined ? { prompt: v.prompt } : { prompt: v.prompt, source: v.source };
}

function chartInput(value: unknown): ChartInput {
  const v = value as { prompt?: unknown; columns?: unknown; sample?: unknown } | null;
  const columns = Array.isArray(v?.columns) ? v.columns : undefined;
  if (!v || typeof v.prompt !== 'string' || !v.prompt.trim() || !columns || !Array.isArray(v.sample) ||
      !columns.every(c => c && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { type?: unknown }).type === 'string')) {
    throw new Error('Expected { prompt: string, columns: { name, type }[], sample: unknown[] }');
  }
  return { prompt: v.prompt, columns: (columns as { name: string; type: string }[]).map(c => ({ name: c.name, type: c.type })), sample: v.sample.slice(0, MAX_SAMPLE_ROWS) };
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
const modelInput = (value: unknown) => {
  const v = value as { provider?: unknown; modelId?: unknown } | null;
  if (!v || typeof v.provider !== 'string' || typeof v.modelId !== 'string') throw new Error('Expected { provider, modelId }');
  return { provider: v.provider, modelId: v.modelId };
};

/** The LLM is injected so tests can pass a faux-backed one; without one, generation reports why it is off. */
export function createRouter(conn: Connection, llm: Llm = unavailableLlm('not configured'), saved: SavedStore = savedStore(join(homedir(), '.typedhouse', 'studio'))) {
  const meta = () => ({
    connection: conn.label,
    model: llm.status as ModelStatus,
    schemaError: conn.schemaError() ?? null,
    tables: conn.tables(),
  });
  return t.router({
    meta: t.router({ get: t.procedure.query(meta) }),
    schema: t.router({ refresh: t.procedure.mutation(async () => { await conn.refresh(); return meta(); }) }),
    query: t.router({ run: t.procedure.input(runInput).mutation(({ input }) => conn.runQuery(input)) }),
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
    ai: t.router({
      generateQuery: t.procedure.input(generateInput).mutation(({ input }) => llm.generateQuery(input)),
      generateChart: t.procedure.input(chartInput).mutation(({ input }) => llm.generateChart(input)),
    }),
  });
}
export type AppRouter = ReturnType<typeof createRouter>;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

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
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
      const file = join(webRoot, path);
      const target = file.startsWith(webRoot + sep) && extname(file) ? file : join(webRoot, 'index.html');
      readFile(target).then(body => {
        res.setHeader('content-type', MIME[extname(target)] ?? 'application/octet-stream');
        res.end(body);
      }, () => { res.statusCode = 404; res.end('Not found'); });
    };
  }
  server.on('request', (req, res) => {
    if (req.url?.startsWith('/trpc/')) trpc(req, res);
    else fallback(req, res);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      await closeVite();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
