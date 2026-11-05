// What the browser specs share: a real server process (test/ui-harness.ts) on a temp data dir, and the moves a user makes.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';

// Runs in the page; the root TypeScript program has no DOM lib, on purpose.
declare const document: any;

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
export type Ui = 'built' | 'dev';
export const uiOf = (info: TestInfo) => info.project.metadata['ui'] as Ui;

export interface Harness { url: string; dataDir: string; requests(): { model: string; messages: { role: string; content: unknown }[] }[]; restart(signal?: NodeJS.Signals): Promise<void>; stop(): Promise<void> }

export async function startHarness(ui: Ui, options: { noLlm?: boolean; env?: Record<string, string>; clickhouse?: string } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'studio-browser-'));
  const dataDir = join(dir, 'data');
  const log = join(dir, 'model.log');
  writeFileSync(log, '');
  let child: ChildProcess;
  // The same port after a restart: a browser's localStorage belongs to the origin, as for a real user.
  let port = '0';
  const clickhouse = options.clickhouse ?? process.env['STUDIO_TEST_CLICKHOUSE'];
  if (!clickhouse) throw new Error('STUDIO_TEST_CLICKHOUSE is not set: run through playwright.config.ts');
  const launch = () => new Promise<string>((resolve, reject) => {
    child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'test/ui-harness.ts', clickhouse, 'fixture', 'test-secret', 'fixture', port, ...(ui === 'built' ? ['--built'] : []), ...(options.noLlm ? ['--no-llm'] : [])], {
      cwd: packageRoot, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HARNESS_DATA_DIR: dataDir, HARNESS_LOG: log, HARNESS_GRACE_MS: '400', ...options.env },
    });
    let out = '';
    child.stdout!.on('data', chunk => { out += String(chunk); const match = /^HARNESS (\S+)/m.exec(out); if (match) resolve(match[1]!); });
    child.once('exit', code => reject(new Error(`harness exited with ${code}`)));
  });
  const stopChild = (signal: NodeJS.Signals = 'SIGTERM') => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.removeAllListeners('exit');
    child.once('exit', () => resolve());
    child.kill(signal);
    setTimeout(() => child.kill('SIGKILL'), 8_000).unref();
  });
  const url = await launch();
  port = new URL(url).port;
  const harness: Harness = {
    url,
    dataDir,
    requests: () => readFileSync(log, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line) as { model: string; messages: { role: string; content: unknown }[] }),
    async restart(signal = 'SIGKILL') { await stopChild(signal); harness.url = await launch(); },
    async stop() { await stopChild(); rmSync(dir, { recursive: true, force: true }); },
  };
  return harness;
}

export const q1 = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts }))';
export const qOnlyId = 'export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ only_id: c.entityId }))';

export async function open(page: Page, harness: Harness) {
  await page.goto(harness.url);
  await page.waitForSelector('.cm-content');
}
/** The source of truth for what is in the editor. */
export const editorText = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:source'));
/** Replaces the editor text the way paste does, with no bracket closing in the way. */
export async function setEditor(page: Page, text: string) {
  await page.click('.cm-content');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}
export async function sendMessage(page: Page, text: string) {
  await page.fill('#composer', text);
  await page.press('#composer', 'Enter');
}
export const turnKinds = (page: Page) => page.locator('.thread [data-kind]').evaluateAll(all => all.map(e => e.getAttribute('data-kind')));
/** Column names, without the type shown beside each. */
export const headers = async (page: Page) => (await page.locator('.results-table thead th').allInnerTexts()).map(text => text.trim().split(/\s+/)[0]!);
export const waitForTurns = (page: Page, count: number) => page.waitForFunction(n => document.querySelectorAll('.thread .turn[data-turn]').length >= n && !document.querySelector('[data-testid="generating"]'), count);
export const lastUser = (request: { messages: { role: string; content: unknown }[] }) => JSON.stringify(request.messages.filter(m => m.role === 'user').at(-1)?.content);
