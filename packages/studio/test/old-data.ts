// Not a test file: writes the data old installs have. One-shot generations were ownerless conversations with an extension named
// `typedhouse-query`, in the same pi.sqlite. A raw Harness with a test-local extension under that name makes them, so these tests keep
// their point when the product has no such extension. As a process: node --import tsx test/old-data.ts <dir> <prompt> [hang], which logs to stdout.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, defineExtension, defineTool, Harness } from '@earendil-works/pi-durable';
import { obj, str } from '@earendil-works/pi-schema';
import { openStorage } from '../server/llm.js';

const checkQuery = defineTool({
  name: 'check_query',
  description: 'Compile the complete TypedHouse source.',
  parameters: obj({ source: str() }),
  execute: async () => ({ output: [{ type: 'text' as const, text: 'OK.' }], control: { terminate: true } }),
});
const oldExtension = defineExtension({ name: 'typedhouse-query', tools: [checkQuery] });

/** A finished one-shot generation, in the file at `dataDir`. The harness is closed afterwards, as after a clean stop. */
export async function writeOldGeneration(dataDir: string, prompt: string, options: { hang?: true } = {}) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  faux.setResponses([options.hang
    ? (((_ctx: unknown, _options?: { signal?: AbortSignal }) => { process.stdout.write('OLD_REQUEST\n'); return new Promise(() => undefined); }) as never)
    : fauxAssistantMessage([fauxToolCall('check_query', { source: `OLD_SOURCE ${prompt}` })], { stopReason: 'toolUse' })]);
  const registry = createRegistry();
  registry.install(oldExtension);
  const harness = await Harness.open(await openStorage(dataDir), { models, registry }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: model.provider, modelId: model.id }, maxTurns: 6, extensions: [oldExtension] } }, context);
  const submission = await conversation.submit({ type: 'input', content: prompt }, context);
  if (options.hang) return;
  await submission.wait(context);
  await harness.close(context);
}

/** A one-shot generation a real SIGKILL cut off mid-request, in the file at `dataDir`. */
export async function cutOffOldGeneration(dataDir: string, prompt: string) {
  const child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/old-data.ts', dataDir, prompt, 'hang'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', chunk => { out += String(chunk); if (out.includes('OLD_REQUEST')) resolve(); });
    void exited.then(() => reject(new Error('the old generation exited before its request')));
  });
  child.kill('SIGKILL');
  await exited;
}

// Run as a process, for a generation a real kill cuts off.
if (process.argv[1]?.endsWith('old-data.ts')) {
  const [dir, prompt, hang] = process.argv.slice(2);
  await writeOldGeneration(dir!, prompt!, hang ? { hang: true } : {});
  setInterval(() => undefined, 1_000);
}
