#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connect } from './clickhouse.js';
import { createAgentCapabilities } from './agent-results.js';
import { createAgentDocs } from './agent-docs.js';
import { createLlm, openStorage, unavailableLlm, type Llm } from './llm.js';
import { defaultPiDir, setupModels } from './pi.js';
import { startServer } from './server.js';

const usage = `Usage: typedhouse-studio [options]

  --url <url>          ClickHouse HTTP URL      (env TYPEDHOUSE_URL, default http://localhost:8123)
  --user <name>        ClickHouse user          (env TYPEDHOUSE_USER, default "default")
  --password <secret>  ClickHouse password      (env TYPEDHOUSE_PASSWORD, default "")
  --database <name>    Database to introspect   (env TYPEDHOUSE_DATABASE, default "default")
  --port <n>           Port on 127.0.0.1        (env TYPEDHOUSE_STUDIO_PORT, default 5480; 0 picks one)
  --model <p/id>       LLM as provider/model-id (env TYPEDHOUSE_STUDIO_MODEL, default openai-codex/gpt-5.6-sol)
  --pi-dir <dir>       pi agent directory       (env TYPEDHOUSE_STUDIO_PI_DIR or PI_CODING_AGENT_DIR, default ~/.pi/agent)
  --data-dir <dir>     Studio data              (env TYPEDHOUSE_STUDIO_DATA_DIR, default ~/.typedhouse/studio)
  --dev                Serve web/ through Vite instead of dist/web
`;

// `pnpm --filter @typedhouse/studio dev -- --port 1234` forwards the `--` separator; drop it.
const argv = process.argv.slice(2);
if (argv[0] === '--' || argv[1] === '--') argv.splice(argv.indexOf('--'), 1);
const { values } = parseArgs({
  args: argv,
  options: {
    url: { type: 'string' }, user: { type: 'string' }, password: { type: 'string' }, database: { type: 'string' },
    port: { type: 'string' }, model: { type: 'string' }, 'pi-dir': { type: 'string' }, 'data-dir': { type: 'string' }, dev: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
  },
});
if (values.help) { process.stdout.write(usage); process.exit(0); }

// Last-resort net: nothing stray (a driver socket, editor code that slipped past the async guard) may take the server down.
process.on('unhandledRejection', reason => process.stderr.write(`Unhandled rejection (ignored): ${reason instanceof Error ? reason.message : String(reason)}\n`));
process.on('uncaughtException', error => process.stderr.write(`Uncaught exception (ignored): ${error.message}\n`));

const env = process.env;
const config = {
  url: values.url ?? env['TYPEDHOUSE_URL'] ?? 'http://localhost:8123',
  username: values.user ?? env['TYPEDHOUSE_USER'] ?? 'default',
  password: values.password ?? env['TYPEDHOUSE_PASSWORD'] ?? '',
  database: values.database ?? env['TYPEDHOUSE_DATABASE'] ?? 'default',
};
const port = Number(values.port ?? env['TYPEDHOUSE_STUDIO_PORT'] ?? 5480);
if (!Number.isInteger(port) || port < 0 || port > 65535) { process.stderr.write(`Invalid port: ${values.port}\n${usage}`); process.exit(2); }

// server/main.ts (dev) and dist/main.js (built) both sit one level below the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const conn = connect(config);
await conn.refresh();
const schemaError = conn.schemaError();
if (schemaError) process.stderr.write(`Warning: could not introspect ${config.database} at ${config.url}: ${schemaError}\n`);
else process.stdout.write(`Connected to ${conn.label}: ${conn.tables().length} tables\n`);
// Warm the TypeScript service (lib + core + schema) so the first keystroke does not pay the cold start.
{
  const started = performance.now();
  await conn.types.warm();
  process.stdout.write(`Types: core from ${conn.types.core.mode} (${conn.types.core.path}), warm ${Math.round(performance.now() - started)} ms\n`);
}

// The LLM is optional: without credentials or a model the rest of the studio works and the header says why.
const piDir = values['pi-dir'] ?? defaultPiDir();
const dataDir = values['data-dir'] ?? env['TYPEDHOUSE_STUDIO_DATA_DIR'] ?? join(homedir(), '.typedhouse', 'studio');
const setup = await setupModels({ piDir, override: values.model ?? env['TYPEDHOUSE_STUDIO_MODEL'] });
let llm: Llm;
if (setup.ok) {
  try {
    const exploration = createAgentCapabilities(conn);
    const docs = createAgentDocs();
    llm = await createLlm({
      models: setup.models, model: setup.model, schema: conn.schemaSource,
      check: conn.checkAsync, storage: await openStorage(dataDir),
      exploration: {
        query_run: (args, owner) => exploration.queryRun(args.source, String(owner)),
        query_results_get: (args, owner) => exploration.queryResultsGet(args.resultId, args.cursor, String(owner)),
        tables_list: args => exploration.tablesList(args.search, args.cursor),
        table_describe: args => exploration.tableDescribe(args.table, args.cursor),
        columns_describe: args => exploration.columnsDescribe(args.table, args.columns),
        docs_search: args => docs.search(args.query, args.cursor),
        docs_read: args => docs.read(args.id, args.cursor),
      },
    });
    process.stdout.write(`LLM: ${setup.model.provider}/${setup.model.modelId}${(values.model ?? env['TYPEDHOUSE_STUDIO_MODEL'])?.trim() ? '' : ' (default)'}, credentials from ${join(piDir, 'auth.json')}\n`);
  } catch (error) {
    llm = unavailableLlm(error instanceof Error ? error.message : String(error));
  }
} else {
  llm = unavailableLlm(setup.reason);
}
if (!llm.status.available) process.stderr.write(`LLM unavailable: ${llm.status.reason}\n`);

const server = await startServer({ conn, llm, dataDir, port, ui: values.dev ? 'dev' : 'static', packageRoot }).catch((error: unknown) => {
  process.stderr.write(`Could not start on 127.0.0.1:${port}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    void Promise.all([server.close(), conn.close(), llm.close()]).finally(() => process.exit(0));
  });
}
// Last: whoever reads this may signal right away.
process.stdout.write(`TypedHouse Studio: ${server.url}\n`);
