// Not a test file: a real server process for test/chat-tester-restart.test.ts, on the same openStorage as main.ts.
//   node --import tsx test/chat-tester-child.ts   (env CHILD_DATA_DIR, CHILD_LOG, CHILD_UNGUARDED?)
// CHILD_UNGUARDED builds the chat service with no busy guard, so that several chats can really be in flight when the process dies.
// The prompt picks the model: "say:<words>"; "hang" never answers but honours the abort; "ignore" never answers, ignores the abort;
// "badthenhang" a failed check, then hang; "retrythenhang" a retryable provider error, then hang; "src:<source>|" check_query with that source.
// A source containing BAD fails the check, HANGCHECK blocks it.
import { appendFileSync } from 'node:fs';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { chatExtension, createChats, type CheckResult } from '../server/chat.js';
import type { Connection } from '../server/clickhouse.js';
import { createLlm, openStorage, unavailableLlm, type Llm } from '../server/llm.js';
import { startServer } from '../server/server.js';

const env = process.env;
const log = (entry: unknown) => appendFileSync(env['CHILD_LOG']!, `${JSON.stringify(entry)}\n`);
type Request = { messages: { role: string; content: unknown }[] };
const textOf = (content: unknown) => (typeof content === 'string' ? content : (content as { text?: string }[]).map(block => block.text ?? '').join(''));
const toolCall = (source: string) => fauxAssistantMessage([fauxToolCall('check_query', { source })], { stopReason: 'toolUse' });
const hang = (options?: { signal?: AbortSignal }) => new Promise(resolve => options?.signal?.addEventListener('abort', () => resolve(fauxAssistantMessage('', { stopReason: 'aborted', errorMessage: 'Request was aborted' }))));

function respond(ctx: Request, options?: { signal?: AbortSignal }) {
  log({ type: 'request', request: ctx });
  const prompt = textOf(ctx.messages.filter(m => m.role === 'user').at(-1)?.content ?? '').split('\n\nThe editor currently contains')[0]!;
  const inRun = ctx.messages.at(-1)?.role !== 'user';
  if (prompt.includes('ignore')) return new Promise(() => undefined);
  if (prompt.includes('badthenhang')) return inRun ? hang(options) : toolCall('BAD_ATTEMPT');
  if (prompt.includes('retrythenhang')) return inRun || ctx.messages.at(-1)?.role !== 'user' ? hang(options) : fauxAssistantMessage('', { stopReason: 'error', errorMessage: '503 overloaded, retry' });
  if (prompt.includes('hang')) return hang(options);
  const say = /say:(.*)/.exec(prompt);
  if (say) return fauxAssistantMessage([fauxText(say[1]!)]);
  const src = /src:(.*?)\|/s.exec(prompt);
  return toolCall(src ? src[1]! : `Q_${prompt.replace(/\W+/g, '_')}`);
}
const check = async (source: string): Promise<CheckResult> => {
  log({ type: 'check', source });
  if (source.includes('HANGCHECK')) await new Promise(() => undefined);
  return source.includes('BAD') ? { ok: false, stage: 'compile', message: 'refused' } : { ok: true, sql: 'SELECT 1', rowType: '{ n: number }' };
};

const faux = fauxProvider({ models: [{ id: 'faux-a' }, { id: 'faux-b' }] });
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses(Array.from({ length: 500 }, () => respond as never));
const model = { provider: faux.provider.id, modelId: 'faux-a' };
const storage = await openStorage(env['CHILD_DATA_DIR']!);
let llm: Llm;
if (env['CHILD_UNGUARDED']) {
  const extension = chatExtension({ guide: 'guide', schema: () => '', check });
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(storage, { models, registry }, context);
  const chat = createChats(harness, { extension, model: () => model, maxTurns: 6, timeoutMs: 600_000, abortGraceMs: 5_000, check, exclusive: (_busy, _fail, work) => work() });
  llm = { ...unavailableLlm('unguarded'), chat };
} else {
  llm = await createLlm({ models, model, schema: () => '', check, storage, ...(env['CHILD_GRACE_MS'] ? { abortGraceMs: Number(env['CHILD_GRACE_MS']) } : {}) });
}
const server = await startServer({ conn: {} as Connection, llm, dataDir: env['CHILD_DATA_DIR']!, port: 0, ui: 'none', packageRoot: '.' });
log({ type: 'open' });
process.stdout.write(`READY ${server.url}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void Promise.all([server.close(), llm.close()]).finally(() => process.exit(0)); });
}
