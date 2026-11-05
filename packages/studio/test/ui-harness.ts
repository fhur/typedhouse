// Tester harness (not a test file): starts the studio with a faux-backed LLM so the UI can be driven by
// Playwright without network. Usage:
//   tsx test/ui-harness.ts <clickhouse-url> <user> <password> <database> <port> [--no-llm] [--built]
//     --no-llm   no model at all, as without credentials
//     --built    serve the built dist/web (run the build first), as the bin does; otherwise the dev UI through Vite
//   env: HARNESS_DATA_DIR  saved queries and chats in SQLite there (else a temp dir, and chats in memory)
//        HARNESS_LOG       appends one JSON line per model request (a line without its newline is still being written)
//        HARNESS_DUMP      with the "dumpschema" keyword, writes that request there
//        HARNESS_TIMEOUT_MS, HARNESS_GRACE_MS  the run timeout and the abort grace, to make "stuck" quick
//
// Keywords are read from what the user typed only, never from the editor source, the sample rows or earlier turns that the
// request also carries. They are whole words, so "change" is not "hang". The first match wins:
//   say:<words>      a text reply, to the end of the line
//   src:<source>     check_query with that exact source, to the end of the line
//   spec:<json>      check_chart with that exact JSON spec, to the end of the line; refused specs repeat until the turn limit
//   chartquery       check_chart with a query change: the base query plus a limit, and a bar chart over it
//   chartfail        check_chart with an unknown field, every round (a failed chart turn)
//   dotted           check_chart over dotted join columns
//   chart            check_chart with a bar of parts by id: needs those columns in the editor
//   hang             never answers, honours the abort (a stop that settles)
//   stuck            never answers, ignores the abort (a stop or timeout that forks)
//   huge             check_query with 64,001 characters, every round (a failed turn whose last attempt is too long to load)
//   retry            a failed check, then a passing one (a version with 2 attempts)
//   fail             a source that never compiles, every round (a failed turn at the turn limit)
//   slowfail         the same, 2 s into each request, so a failure can be watched from elsewhere
//   slow             waits 2 s, then answers as below
//   dumpschema       writes the request to $HARNESS_DUMP, then answers as below
//   anything else    a passing check_query. Each turn of a chat gets a new source, so each is a new version.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { connect } from '../server/clickhouse.js';
import { createLlm, openStorage, unavailableLlm } from '../server/llm.js';
import { startServer } from '../server/server.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--')));
const [url, username, password, database, port] = args.filter(arg => !arg.startsWith('--'));
const env = process.env;
const conn = connect({ url: url!, username: username!, password: password ?? '', database: database! });
await conn.refresh();

const good = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts }))';
const bad = 'export default from(no_such_table)';
const bar = { mark: 'bar', encoding: { x: { field: 'id', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } };
const call = (source: string, summary?: string) => fauxAssistantMessage([fauxToolCall('query_apply', { source, ...(summary ? { summary } : {}) })], { stopReason: 'toolUse' });
const chartCall = (spec: unknown, source?: string) => fauxAssistantMessage([fauxToolCall('chart_apply', { spec, ...(source ? { source } : {}), summary: 'Charted parts by id.' } as never)], { stopReason: 'toolUse' });
let calls = 0;

type Message = { role: string; content: unknown };
const textOf = (content: unknown) => (typeof content === 'string' ? content : Array.isArray(content) ? (content as { text?: string }[]).map(block => block.text ?? '').join('') : '');
/** What the user typed: the server appends the editor source and the sample rows. */
const typed = (message: string) => message.split(/\n\n(?:The editor currently contains|Sample result rows)/)[0]!;

async function respond(context: { messages: Message[] }, options?: { signal?: AbortSignal }, _state?: unknown, requestModel?: { id: string }) {
  calls++;
  process.stdout.write(`MODEL ${requestModel?.id ?? '?'}\n`);
  if (env['HARNESS_LOG']) appendFileSync(env['HARNESS_LOG'], `${JSON.stringify({ model: requestModel?.id, messages: context.messages })}\n`);
  const users = context.messages.filter(m => m.role === 'user');
  const message = textOf(users.at(-1)?.content);
  const prompt = typed(message);
  const has = (word: string) => new RegExp(`\\b${word}\\b`).test(prompt);
  // This run has already had a check back: the second round of "retry".
  const secondRound = context.messages.at(-1)?.role === 'toolResult';
  if (has('dumpschema') && env['HARNESS_DUMP']) writeFileSync(env['HARNESS_DUMP'], JSON.stringify(context));

  if (has('transparent')) {
    if (secondRound) {
      if (has('multicall') && (context.messages.at(-1) as Message & { toolName?: string }).toolName === 'docs_search') {
        await new Promise(resolve => setTimeout(resolve, 1_000));
        return fauxAssistantMessage([fauxToolCall('query_apply', { source: `throw new Error("<img src=x onerror=alert(1)>"); ${good}`, summary: 'Inspecting input' })], { stopReason: 'toolUse' });
      }
      await new Promise(resolve => setTimeout(resolve, 4_000));
      return fauxAssistantMessage([fauxText('Finished the public check.')]);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
    if (has('multicall')) return fauxAssistantMessage([fauxToolCall('docs_search', { query: 'select' })], { stopReason: 'toolUse' });
    return fauxAssistantMessage([
      fauxText('Checking <b>public progress</b>.'),
      fauxToolCall('query_apply', { source: `throw new Error("<img src=x onerror=alert(1)>"); ${good}`, summary: 'Inspecting input' }),
    ], { stopReason: 'toolUse' });
  }
  const say = /say:(.*)/.exec(prompt);
  if (say) return fauxAssistantMessage([fauxText(say[1]!)]);
  const src = /src:(.*)/.exec(prompt);
  if (src) return call(src[1]!, 'Used the source you gave.');
  const spec = /spec:(.*)/.exec(prompt);
  if (spec) return chartCall(JSON.parse(spec[1]!) as unknown);
  if (has('chartquery')) return chartCall(bar, `${good}\n  .limit(${users.length + 1})`);
  if (has('chartfail')) return chartCall({ mark: 'bar', encoding: { x: { field: 'nation' } } });
  if (has('dotted')) return chartCall({ mark: 'bar', encoding: { x: { field: 'c.entityId', type: 'nominal' }, y: { field: 'c.countOfParts', type: 'quantitative' } } });
  if (has('chart')) return chartCall(bar);
  if (has('hang')) return new Promise(resolve => options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'Request was aborted' }))));
  if (has('stuck')) return new Promise(() => undefined);
  if (has('huge')) return call('x'.repeat(64_001));
  if (has('retry') && !secondRound) return call(bad);
  if (has('slowfail')) { await new Promise(resolve => setTimeout(resolve, 2_000)); return call(bad); }
  if (has('fail')) return call(bad);
  if (has('slow')) await new Promise(resolve => setTimeout(resolve, 2_000));
  return call(users.length > 1 ? `${good}\n  .limit(${users.length})` : good, `Step ${users.length} of this chat.`);
}

const milliseconds = (name: string) => (env[name] ? { [name === 'HARNESS_TIMEOUT_MS' ? 'timeoutMs' : 'abortGraceMs']: Number(env[name]) } : {});
let llm;
if (flags.has('--no-llm')) llm = unavailableLlm('No credentials for openai-codex: log in with pi');
else {
  // Two models so "Switch model…" has a choice.
  const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(Array.from({ length: 2_000 }, () => respond as never));
  const model = faux.getModel();
  // The same check as main.ts, so completions stay answerable while a check runs.
  llm = await createLlm({ models, model: { provider: model.provider, modelId: model.id }, schema: conn.schemaSource, check: conn.checkAsync, maxTurns: 3, ...milliseconds('HARNESS_TIMEOUT_MS'), ...milliseconds('HARNESS_GRACE_MS'), ...(env['HARNESS_DATA_DIR'] ? { storage: await openStorage(env['HARNESS_DATA_DIR']) } : {}) });
}
// Saved queries go to $HARNESS_DATA_DIR, else a temp dir (never the home dir).
const ownDir = env['HARNESS_DATA_DIR'] ? undefined : mkdtempSync(join(tmpdir(), 'studio-harness-'));
const dataDir = env['HARNESS_DATA_DIR'] ?? ownDir!;
process.once('exit', () => { if (ownDir) rmSync(ownDir, { recursive: true, force: true }); });
const server = await startServer({ conn, llm, dataDir, port: Number(port), ui: flags.has('--built') ? 'static' : 'dev', packageRoot: new URL('..', import.meta.url).pathname });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void Promise.all([server.close(), conn.close(), llm.close()]).finally(() => process.exit(0)); });
// Last: whoever reads this may signal right away. CALLS lets a script count model requests (duplicate-request checks).
process.stdout.write(`HARNESS ${server.url}\n`);
setInterval(() => process.stdout.write(`CALLS ${calls}\n`), 500).unref();
