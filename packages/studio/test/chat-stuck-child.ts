// Not a test file: test/chat-stuck-fork.test.ts runs it as a real process, on pi-durable alone.
//   CHILD_STAGE=first:  ALPHA answered, STUCK run on a provider that ignores the abort, abort not settled, fork at the stopped entry. Prints FORKED <forkId> <parentId> and stays up.
//   CHILD_STAGE=second: marks every leftover task aborted as Studio does at open, then continues the fork. Prints the facts as JSON.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, defineExtension, defineTool, Harness, type Conversation, type ConversationId } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { obj, str } from '@earendil-works/pi-schema';

const env = process.env;
const log = (entry: unknown) => appendFileSync(env['CHILD_LOG']!, `${JSON.stringify(entry)}\n`);
const check = defineTool({
  name: 'check', description: 'check', parameters: obj({ source: str() }),
  execute: async () => ({ output: [{ type: 'text' as const, text: 'OK' }], control: { terminate: true } }),
});
const extension = defineExtension({ name: 'probe', tools: [check] });
const registry = createRegistry();
registry.install(extension);
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const respond = (ctx: { messages: { role: string; content: unknown }[] }) => {
  log({ type: 'request', stage: env['CHILD_STAGE'], messages: ctx.messages });
  if (JSON.stringify(ctx.messages.filter(m => m.role === 'user').at(-1)?.content).includes('STUCK')) return new Promise(() => undefined);
  return fauxAssistantMessage([fauxToolCall('check', { source: 'SOURCE' })], { stopReason: 'toolUse' });
};
faux.setResponses(Array.from({ length: 20 }, () => respond as never));
const model = faux.getModel();
const harness = await Harness.open(await openNodeSqliteStorage(join(env['CHILD_DATA_DIR']!, 'pi.sqlite')), { models, registry }, context);
const ask = async (c: Conversation, content: string) => (await c.submit({ type: 'input', content, whenBusy: 'reject' }, context)).wait(context);

if (env['CHILD_STAGE'] === 'first') {
  const parent = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } }, context);
  await ask(parent, 'ALPHA');
  void ask(parent, 'STUCK_BRAVO').catch(() => undefined);
  while (true) {
    const { items } = await parent.entries({ order: 'descending' }, 5, undefined, context);
    const entry = items.find(e => JSON.stringify(e.model ?? '').includes('STUCK_BRAVO'));
    if (entry) {
      await new Promise(resolve => setTimeout(resolve, 100));
      void parent.abort(context).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 100));
      const fork = await parent.fork(entry.id, { ownership: { kind: 'ownerless' } }, context);
      // The handler goes first: the test sends SIGTERM the moment it reads this line.
      process.on('SIGTERM', () => {
        void Promise.race([harness.close(context).catch(() => undefined), new Promise(resolve => setTimeout(resolve, 300))]).finally(() => process.exit(0));
      });
      process.stdout.write(`FORKED ${fork.id} ${parent.id}\n`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  setInterval(() => undefined, 1_000);
} else {
  const { tasks } = await harness.inspect(context);
  const left = tasks.map(t => t.record.conversationId as number);
  for (const task of tasks) await harness.abortTask(task.record.id, context);
  if (tasks.length) { harness.resume(); await harness.waitForIdle(context); }
  await new Promise(resolve => setTimeout(resolve, 200));
  log({ type: 'opened' });
  const fork = (await harness.conversation(Number(env['CHILD_FORK']) as ConversationId, context))!;
  const parent = (await harness.conversation(Number(env['CHILD_PARENT']) as ConversationId, context))!;
  const answered = await ask(fork, 'CHARLIE');
  const after = await harness.inspect(context);
  const parentEntries = (await parent.entries({ order: 'ascending' }, 100, undefined, context)).items.map(e => e.kind);
  process.stdout.write(`RESULT ${JSON.stringify({ left, status: answered.status, live: after.tasks.length, parentEntries })}\n`);
  await harness.close(context);
  process.exit(0);
}
