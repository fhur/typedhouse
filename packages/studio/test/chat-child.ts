// Not a test file: a real server process for test/chat-restart.test.ts and test/chat.integration.ts. It opens the data
// dir through the same `openStorage` as main.ts, answers from a faux model, and appends every model request to $CHILD_LOG.
//   node --import tsx test/chat-child.ts   (env CHILD_DATA_DIR, CHILD_LOG, CHILD_MODEL?, CHILD_CLICKHOUSE? as { url, username, password, database })
// The newest user message picks the reply: "say:<words>" a text reply; "hang" a model that never answers (honours the
// abort); "src:<source>|" check_query with that source and summary "s:<source>"; anything else a source built from the prompt.
// A source containing HANGCHECK blocks in check_query; a source containing KILLRECHECK kills the process on its re-check.
import { appendFileSync } from 'node:fs';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import type { CheckResult } from '../server/chat.js';
import { createLlm, openStorage } from '../server/llm.js';
import { startServer } from '../server/server.js';
import type { Connection } from '../server/clickhouse.js';

const env = process.env;
const log = (entry: unknown) => appendFileSync(env['CHILD_LOG']!, `${JSON.stringify(entry)}\n`);

type Request = { systemPrompt?: string; messages: { role: string; content: unknown }[] };
const toolCall = (source: string, summary?: string) => fauxAssistantMessage([fauxToolCall('query_apply', { source, ...(summary ? { summary } : {}) })], { stopReason: 'toolUse' });
function textOf(content: unknown): string {
  return typeof content === 'string' ? content : (content as { text?: string }[]).map(block => block.text ?? '').join('');
}
function respond(ctx: Request, options?: { signal?: AbortSignal }, _state?: unknown, model?: { id: string }) {
  const content = textOf(ctx.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
  log({ type: 'request', model: model?.id, request: ctx });
  // Keywords live in the prompt, not in the editor source the message also carries.
  const prompt = content.split('\n\nThe editor currently contains')[0]!;
  if (prompt.includes('hang')) {
    return new Promise(resolve => options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'Request was aborted' }))));
  }
  const say = /say:(.*)/.exec(prompt);
  if (say) return fauxAssistantMessage([fauxText(say[1]!)]);
  const src = /src:(.*?)\|/s.exec(prompt);
  if (src) return toolCall(src[1]!, `s:${src[1]!}`);
  return toolCall(`export default ${prompt.replace(/\W+/g, '_')}`);
}

let check: (source: string) => CheckResult | Promise<CheckResult> = () => ({ ok: true, sql: 'SELECT 1', rowType: '{ n: number }' });
let schema = () => '';
let conn = {} as Connection;
if (env['CHILD_CLICKHOUSE']) {
  const { connect } = await import('../server/clickhouse.js');
  conn = connect(JSON.parse(env['CHILD_CLICKHOUSE']) as Parameters<typeof connect>[0]);
  await conn.refresh();
  check = conn.checkAsync;
  schema = conn.schemaSource;
}
const checks = new Map<string, number>();
const fauxCheck = async (source: string) => {
  log({ type: 'check', source });
  const seen = (checks.get(source) ?? 0) + 1;
  checks.set(source, seen);
  if (source.includes('HANGCHECK')) await new Promise(() => undefined);
  if (source.includes('KILLRECHECK') && seen === 2) process.kill(process.pid, 'SIGKILL');
  return check(source);
};

const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses(Array.from({ length: 200 }, () => respond as never));
const llm = await createLlm({
  models, model: { provider: faux.provider.id, modelId: env['CHILD_MODEL'] ?? 'faux-a' }, schema, check: fauxCheck,
  storage: await openStorage(env['CHILD_DATA_DIR']!),
});
const server = await startServer({ conn, llm, dataDir: env['CHILD_DATA_DIR']!, port: 0, ui: 'none', packageRoot: '.' });
log({ type: 'open' });
process.stdout.write(`READY ${server.url}\n`);
// Same shutdown as main.ts.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void Promise.all([server.close(), llm.close(), env['CHILD_CLICKHOUSE'] ? conn.close() : undefined]).finally(() => process.exit(0)); });
}
