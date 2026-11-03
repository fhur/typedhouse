// Tester harness (not a test file): starts the studio with a faux-backed LLM so the UI can be driven by
// Playwright without network. Usage:
//   tsx test/ui-harness.ts <clickhouse-url> <user> <password> <database> <port> [--no-llm]
// Prompt keywords pick the scripted model behaviour:
//   "dumpschema" → dumps the model context to $HARNESS_DUMP; "src:<source>" → answers with that source;
//   "fail" → never compiles (turn limit); "slow" → waits 2 s before answering; anything else → passes first try.
//   Chart prompts are recognised by the result-column list in the message (see respond()).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { connect } from '../server/clickhouse.js';
import { createLlm, unavailableLlm } from '../server/llm.js';
import { startServer } from '../server/server.js';

const [url, username, password, database, port, flag] = process.argv.slice(2);
const conn = connect({ url: url!, username: username!, password: password ?? '', database: database! });
await conn.refresh();

const good = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts }))';
const bad = 'export default from(no_such_table)';
const call = (source: string) => fauxAssistantMessage([fauxToolCall('check_query', { source })], { stopReason: 'toolUse' });
let calls = 0;

const chartCall = (spec: unknown) => fauxAssistantMessage([fauxToolCall('check_chart', { spec } as never)], { stopReason: 'toolUse' });
async function respond(context: { messages: { role: string; content: unknown }[]; tools?: { name: string }[] }, _options?: unknown, _state?: unknown, requestModel?: { id: string }) {
  calls++;
  process.stdout.write(`MODEL ${requestModel?.id ?? '?'}\n`);
  const user = JSON.stringify(context.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
  // Chart conversations carry the result columns in the user message (faux contexts have no tool list).
  if (user.includes('Result columns')) {
    // Chart prompts: "chartfail" → unknown field forever; "dotted" → a dotted join column; else bar of parts by id.
    if (user.includes('chartfail')) return chartCall({ mark: 'bar', encoding: { x: { field: 'nation' } } });
    if (user.includes('dotted')) return chartCall({ mark: 'bar', encoding: { x: { field: 'c.entityId', type: 'nominal' }, y: { field: 'c.countOfParts', type: 'quantitative' } } });
    if (user.includes('slow')) await new Promise(resolve => setTimeout(resolve, 2_000));
    return chartCall({ mark: 'bar', encoding: { x: { field: 'id', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } });
  }
  // "dumpschema": write what the model was shown (system prompt + messages) to $HARNESS_DUMP.
  if (user.includes('dumpschema') && process.env['HARNESS_DUMP']) writeFileSync(process.env['HARNESS_DUMP'], JSON.stringify(context));
  // "src:<source>" answers with that exact source.
  const custom = /src:(.*?)(?:\\n|"$)/.exec(user);
  if (custom) return call(JSON.parse(`"${custom[1]}"`) as string);
  if (user.includes('fail')) return call(bad);
  if (user.includes('slow')) await new Promise(resolve => setTimeout(resolve, 2_000));
  return call(good);
}

let llm;
if (flag === '--no-llm') llm = unavailableLlm('No credentials for openai-codex: log in with pi');
else {
  // Two models so "Switch model…" has a choice; HARNESS_DATA_DIR enables saved queries.
  const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(Array.from({ length: 500 }, () => respond as never));
  const model = faux.getModel();
  llm = await createLlm({ models, model: { provider: model.provider, modelId: model.id }, schema: conn.schemaSource, check: conn.check, maxTurns: 3 });
}
// Saved queries go to $HARNESS_DATA_DIR, else a temp dir (never the home dir).
const ownDir = process.env['HARNESS_DATA_DIR'] ? undefined : mkdtempSync(join(tmpdir(), 'studio-harness-'));
const dataDir = process.env['HARNESS_DATA_DIR'] ?? ownDir!;
process.once('exit', () => { if (ownDir) rmSync(ownDir, { recursive: true, force: true }); });
const server = await startServer({ conn, llm, dataDir, port: Number(port), ui: 'dev', packageRoot: new URL('..', import.meta.url).pathname });
// Lets the Playwright script count model requests (duplicate-request checks).
process.stdout.write(`HARNESS ${server.url}\n`);
setInterval(() => process.stdout.write(`CALLS ${calls}\n`), 500).unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void Promise.all([server.close(), conn.close(), llm.close()]).finally(() => process.exit(0)); });
