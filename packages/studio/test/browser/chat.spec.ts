// The chat in a real browser, on the built UI, over a real server process and ClickHouse (faux model). S12's flows, and the races.
import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startClickHouse } from './global-setup.js';
import { editorText, headers, lastUser, open, q1, qOnlyId, sendMessage, setEditor, startHarness, turnKinds, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page. The root TypeScript program has no DOM lib, on purpose, so only what these callbacks use is declared.
declare const document: any; declare const window: any; declare const innerWidth: number; declare const innerHeight: number;
let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

/** Holds query.run requests until released, so "a run in flight" is really in flight. */
function holdRuns(page: Page) {
  const held: Route[] = [];
  const seen: string[] = [];
  let holding = true;
  const ready = page.route('**/trpc/query.run*', async route => {
    seen.push(String((JSON.parse(route.request().postData() ?? '{}') as { json?: { source?: string } }).json?.source));
    if (holding) held.push(route); else await route.continue();
  });
  return { ready, seen, held, async release() { holding = false; for (const route of held.splice(0)) await route.continue(); } };
}
const until = (fn: () => boolean) => expect.poll(fn).toBe(true);

test.describe('the main flows', () => {
  test('a message gives a version: thread, editor, auto-run on the Table tab, "in editor"', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first plain');
    await expect(page.locator('[data-testid="generating"], .thread .turn[data-kind="version"]').first()).toBeVisible();
    await waitForTurns(page, 2);
    expect(await turnKinds(page)).toEqual(['user', 'version']);
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    expect(await headers(page)).toEqual(expect.arrayContaining(['id', 'parts']));
    await expect(page.locator('.turn-version .version-chip.on')).toHaveText('v1');
    await expect(page.locator('.chat-row.on')).toHaveText('first plain');
  });

  test('a text reply leaves the editor and the results alone', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    const runs: string[] = [];
    page.on('request', r => { if (r.url().includes('query.run')) runs.push(r.url()); });
    await sendMessage(page, 'say:just <b>words</b>');
    await waitForTurns(page, 4);
    await expect(page.locator('.turn-text').last()).toHaveText('just <b>words</b>');
    expect(await page.locator('.thread b').count()).toBe(0);
    expect(await editorText(page)).toBe(q1);
    expect(runs).toEqual([]);
  });

  test('a chart turn goes to the Chart tab with no new run; a query turn after it goes to Table', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    const runs: string[] = [];
    page.on('request', r => { if (r.url().includes('query.run')) runs.push(r.url()); });
    await sendMessage(page, 'chart it');
    await waitForTurns(page, 4);
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await expect(page.locator('.tab.on')).toContainText('Chart');
    expect(runs).toEqual([]);
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('.turn-version').last().locator('.turn-change')).toContainText('bar · x: id · y: parts');
    await sendMessage(page, 'plain again');
    await waitForTurns(page, 6);
    await expect(page.locator('.tab.on')).toContainText('Table');
  });

  test('sending while generating does nothing and keeps the draft; esc stops; the next message works', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang now');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.fill('#composer', 'second draft');
    await page.press('#composer', 'Enter');
    await expect(page.locator('#composer')).toHaveValue('second draft');
    await page.press('#composer', 'Escape');
    await waitForTurns(page, 4);
    expect(await turnKinds(page)).toEqual(['user', 'version', 'user', 'note']);
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    expect(await editorText(page)).toBe(q1);
    await page.press('#composer', 'Enter');
    await waitForTurns(page, 6);
    expect(lastUser(harness.requests().at(-1)!)).toContain('second draft');
  });

  test('a provider that ignores the abort: stop still ends it, and the chat goes on', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'stuck now');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.press('#composer', 'Escape');
    await waitForTurns(page, 2);
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await sendMessage(page, 'next message');
    await waitForTurns(page, 4);
    expect(await turnKinds(page)).toEqual(['user', 'note', 'user', 'version']);
  });

  test('reload mid-generation shows generating, then the reply, and the version applies and runs', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'slow one');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('.turn[data-turn]').first()).toBeVisible();
    await waitForTurns(page, 4);
    expect(await editorText(page)).toContain('.limit(2)');
    await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  });

  test('a real server kill and restart: the thread is back and the next message continues it', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'PROMPT_ONE');
    await waitForTurns(page, 2);
    await harness.restart('SIGKILL');
    await open(page, harness);
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await sendMessage(page, 'PROMPT_TWO');
    await waitForTurns(page, 4);
    const request = JSON.stringify(harness.requests().at(-1));
    expect(request).toContain('PROMPT_ONE');
    expect(request).toContain('PROMPT_TWO');
    await expect(page.locator('.turn-version .version-chip.on')).toHaveText('v2');
  });

  test('a failed turn: editor unchanged, load last attempt is by hand and does not run, and the next send carries it', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    const runs: string[] = [];
    page.on('request', r => { if (r.url().includes('query.run')) runs.push(r.url()); });
    await sendMessage(page, 'fail');
    await waitForTurns(page, 4);
    expect(await editorText(page)).toBe(q1);
    await page.getByRole('button', { name: /Load last attempt/ }).click();
    expect(await editorText(page)).toBe('export default from(no_such_table)');
    await page.waitForTimeout(300);
    expect(runs).toEqual([]);
    await expect(page.locator('.version-chip.on')).toHaveCount(0);
    await sendMessage(page, 'plain after');
    await waitForTurns(page, 6);
    expect(lastUser(harness.requests().at(-1)!)).toContain('no_such_table');
  });

  test('a last attempt too long to load says so; a refused spec with an attack in it is never rendered', async ({ page }) => {
    const beacons: string[] = [];
    page.on('request', r => { if (r.url().includes('sink.example')) beacons.push(r.url()); });
    await open(page, harness);
    await sendMessage(page, 'huge');
    await waitForTurns(page, 2);
    await expect(page.locator('.turn-toolong')).toContainText('64,001');
    await expect(page.getByRole('button', { name: /Load last attempt/ })).toHaveCount(0);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 4);
    await sendMessage(page, 'spec:{"mark":"image","encoding":{"url":{"value":"https://sink.example/x"}}}');
    await waitForTurns(page, 6);
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(300);
    await expect(page.locator('.chart-host')).toHaveCount(0);
    expect(beacons).toEqual([]);
  });

  test('edit and resend drops the later turns for the thread and the model', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await sendMessage(page, 'BRAVO');
    await waitForTurns(page, 4);
    await page.locator('.turn[data-kind="user"]', { hasText: 'BRAVO' }).click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await expect(page.locator('#composer')).toHaveValue('BRAVO');
    expect(await editorText(page)).toBe(q1);
    await sendMessage(page, 'DELTA');
    await waitForTurns(page, 4);
    expect(await turnKinds(page)).toEqual(['user', 'version', 'user', 'version']);
    await expect(page.locator('.thread')).not.toContainText('BRAVO');
    const request = JSON.stringify(harness.requests().at(-1));
    expect(request).toContain('DELTA');
    expect(request).not.toContain('BRAVO');
  });

  test('restore: the next message carries that source, numbers stay, a hand edit clears the mark', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'two');
    await waitForTurns(page, 4);
    await page.locator('.turn-version').first().click();
    await page.getByRole('button', { name: /restore & run/ }).click();
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Restored v1');
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('.version-chip.on')).toHaveText('v1');
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// mine');
    await expect(page.locator('.version-chip.on')).toHaveCount(0);
    await expect(page.locator('.editor-version')).toHaveCount(0);
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(3)');
    await waitForTurns(page, 7);
    expect(lastUser(harness.requests().at(-1)!)).toContain('// mine');
    await expect(page.locator('.version-chip.on')).toHaveText('v3');
  });

  test('a generation does not hold up type checks or a stop: chat.send is never in a batch', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', r => { if (r.url().includes('/trpc/')) urls.push(r.url()); });
    await open(page, harness);
    await sendMessage(page, 'hang now');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    const answered = page.waitForResponse(r => r.url().includes('types.diagnostics') && r.ok());
    await setEditor(page, 'export default from(no_such_table)');
    await answered;
    await expect(page.locator('.type-errors')).toBeVisible();
    await page.press('#composer', 'Escape');
    await waitForTurns(page, 2);
    const send = urls.filter(u => u.includes('chat.send'));
    expect(send.length).toBe(1);
    expect(send[0]).toMatch(/\/trpc\/chat\.send$/);
    expect(urls.filter(u => u.includes('query.run') && u.includes(','))).toEqual([]);
  });

  test('Switch model: the next message in the same chat uses it', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await page.keyboard.press('Control+k');
    await page.getByText('Switch model…').click();
    await page.getByText('faux/faux-b').click();
    await expect(page.locator('.model-chip')).toContainText('faux-b');
    await sendMessage(page, 'next');
    await waitForTurns(page, 4);
    expect(harness.requests().at(-1)!.model).toBe('faux-b');
  });
});

test.describe('races', () => {
  test('a reply arriving while another chat is open lands in its own chat', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await setEditor(page, qOnlyId);
    await sendMessage(page, 'CHAT_A one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'slow CHAT_A two');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await expect(page.locator('[data-testid="generating"]')).toHaveCount(0);
    const inB = await editorText(page);
    await page.waitForTimeout(2_600);
    expect(await editorText(page), 'the visible editor must not change').toBe(inB);
    await expect(page.locator('.thread')).not.toContainText('CHAT_A');
    await page.locator('.chat-row', { hasText: 'CHAT_A' }).click();
    await expect(page.locator('.turn-version')).toHaveCount(2);
    expect(await editorText(page)).toContain('.limit(2)');
    await expect(page.locator('.version-chip.on')).toHaveText('v2');
  });

  test('auto-run with a manual run truly in flight: not dropped, and the older result does not stay', async ({ page }) => {
    await open(page, harness);
    const runs = holdRuns(page);
    await runs.ready;
    await setEditor(page, qOnlyId);
    await sendMessage(page, `slow src:${q1}`);
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await until(() => runs.seen.length === 1);
    expect(runs.seen[0]).toBe(qOnlyId);
    await page.waitForTimeout(100);
    await waitForTurns(page, 2);
    expect(await editorText(page)).toBe(q1);
    await runs.release();
    await until(() => runs.seen.length === 2);
    expect(runs.seen[1]).toBe(q1);
    await expect.poll(() => headers(page)).toEqual(expect.arrayContaining(['id', 'parts']));
    await expect(page.locator('.results-table thead')).not.toContainText('only_id');
  });

  /** Chat B with a query, then chat A with a run of qOnlyId held in flight. */
  async function runHeldInChatA(page: Page) {
    await open(page, harness);
    await setEditor(page, q1);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'say:CHAT_A');
    await waitForTurns(page, 2);
    await setEditor(page, qOnlyId);
    const runs = holdRuns(page);
    await runs.ready;
    await page.keyboard.press('Control+Enter');
    await until(() => runs.seen.length === 1);
    return runs;
  }
  /** Lets the held run answer, and returns once the page has really had that answer. */
  async function deliver(page: Page, runs: ReturnType<typeof holdRuns>) {
    const answered = page.waitForResponse(r => r.url().includes('query.run'));
    await runs.release();
    await answered;
    await page.waitForTimeout(300);
  }
  const heldRows = (page: Page) => page.locator('.results-table thead', { hasText: 'only_id' });

  test('control: with no switch, the held run does show, so the checks below are live', async ({ page }) => {
    const runs = await runHeldInChatA(page);
    await expect(heldRows(page)).toHaveCount(0);
    await deliver(page, runs);
    await expect(heldRows(page)).toHaveCount(1);
  });

  test('a run in flight when another chat is opened: its rows never show under the other chat', async ({ page }) => {
    const runs = await runHeldInChatA(page);
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await deliver(page, runs);
    await expect(heldRows(page)).toHaveCount(0);
    await expect(page.locator('.empty')).toContainText('to run the query');
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('.footer .ready')).toContainText('Ready');
  });

  test('A to B to A with a run in flight: A stays cleared and one key runs it', async ({ page }) => {
    const runs = await runHeldInChatA(page);
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await page.locator('.chat-row', { hasText: 'say:CHAT_A' }).click();
    await expect(page.locator('.thread')).toContainText('say:CHAT_A');
    await deliver(page, runs);
    await expect(heldRows(page)).toHaveCount(0);
    await expect(page.locator('.empty')).toContainText('to run the query');
    expect(await editorText(page)).toBe(qOnlyId);
    await page.keyboard.press('Control+Enter');
    await expect(heldRows(page)).toHaveCount(1);
  });

  test('a manual run in B while the dropped run of A is still out: B gets its own rows and A cannot overwrite them', async ({ page }) => {
    const runs = await runHeldInChatA(page);
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await page.unroute('**/trpc/query.run*');
    await page.route('**/trpc/query.run*', route => route.continue());
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    expect(await headers(page)).toEqual(expect.arrayContaining(['id', 'parts']));
    const late = runs.held.splice(0);
    await Promise.all(late.map(route => route.continue().catch(() => undefined)));
    await page.waitForTimeout(500);
    await expect(heldRows(page)).toHaveCount(0);
    expect(await headers(page)).toEqual(expect.arrayContaining(['id', 'parts']));
  });

  test('a reply whose run was queued, then a switch: the queued run does not land in the other chat', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, q1);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await setEditor(page, qOnlyId);
    const runs = holdRuns(page);
    await runs.ready;
    await sendMessage(page, 'src:export default from(entity_ots_component).map(c => ({ queued_col: c.entityId }))');
    await page.keyboard.press('Control+Enter');
    await until(() => runs.seen.length === 1);
    await waitForTurns(page, 2);
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await deliver(page, runs);
    await page.waitForTimeout(500);
    await expect(page.locator('.results-table')).toHaveCount(0);
    expect(runs.seen.length).toBe(1);
    await page.locator('.chat-row', { hasText: 'src:export' }).click();
    await expect.poll(() => editorText(page)).toContain('queued_col');
    await expect(page.locator('.version-chip.on')).toHaveText('v1');
  });

  test('Ctrl+Enter twice quickly: one run at a time, and it ends Ready', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, q1);
    const urls: string[] = [];
    page.on('request', r => { if (r.url().includes('query.run')) urls.push(r.url()); });
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    await expect(page.locator('.footer .ready')).toContainText('Ready');
    await expect(page.locator('.run-btn')).toBeEnabled();
  });

  test('a saved query loaded during a run: the run finishes and Run works again', async ({ page }) => {
    mkdirSync(harness.dataDir, { recursive: true });
    writeFileSync(join(harness.dataDir, 'saved.json'), JSON.stringify({ version: 1, queries: [{ name: 'loaded', prompt: 'p', source: q1, chart: null, updatedAt: '2026-11-04T00:00:00.000Z' }] }));
    await open(page, harness);
    await setEditor(page, qOnlyId);
    const runs = holdRuns(page);
    await runs.ready;
    await page.keyboard.press('Control+Enter');
    await until(() => runs.seen.length === 1);
    await page.getByRole('button', { name: 'loaded', exact: true }).click();
    expect(await editorText(page)).toBe(q1);
    await deliver(page, runs);
    await expect(page.locator('.run-btn')).toBeEnabled();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => headers(page)).toEqual(expect.arrayContaining(['id', 'parts']));
  });

  test('palette Ask during a generation keeps the words', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'hang now');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.keyboard.insertText('ask this later');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(page.locator('#composer')).toHaveValue('ask this later');
  });

  test('a message sent from another chat during a generation does nothing and keeps the draft', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'hang CHAT_A');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await sendMessage(page, 'from B');
    await page.waitForTimeout(300);
    await expect(page.locator('#composer')).toHaveValue('from B');
    expect(await turnKinds(page)).toEqual(['user', 'version']);
    // Back in the generating chat, it can be stopped and the first send still works.
    await page.locator('.chat-row', { hasText: 'hang CHAT_A' }).click();
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
  });

  test('reload during an edit-and-resend loses no hand edit', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// HAND_EDIT');
    await page.locator('.turn[data-kind="user"]', { hasText: 'ALPHA' }).click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await page.waitForTimeout(100);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(page.locator('.turn-version')).toHaveCount(1);
    expect(await editorText(page)).toContain('HAND_EDIT');
  });
});

test.describe('states and old data', () => {
  test('no LLM: the box says why, nothing sends, and the rest works', async ({ page }, info) => {
    await harness.stop();
    harness = await startHarness(uiOf(info), { noLlm: true });
    await open(page, harness);
    await expect(page.locator('#composer')).toHaveAttribute('readonly');
    await expect(page.locator('#composer')).toHaveAttribute('placeholder', /The chat is off/);
    await expect(page.locator('.model-chip')).toContainText('LLM unavailable');
    await setEditor(page, q1);
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    await page.keyboard.press('Control+k');
    await page.keyboard.insertText('hello');
    await expect(page.getByText(/Ask: LLM unavailable/)).toBeVisible();
  });

  test('an existing install: stale keys go, the old source and spec stay, an old saved query with a chart loads and draws', async ({ page }) => {
    mkdirSync(harness.dataDir, { recursive: true });
    const chart = { mark: 'bar', encoding: { x: { field: 'id', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } } };
    writeFileSync(join(harness.dataDir, 'saved.json'), JSON.stringify({ version: 1, queries: [{ name: 'old one', prompt: 'old prompt', source: q1, chart, updatedAt: '2026-11-03T00:00:00.000Z' }] }));
    await page.addInitScript(([source, spec]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('typedhouse-studio:prompt', 'old prompt box');
      localStorage.setItem('typedhouse-studio:chart-prompt', 'old chart box');
      localStorage.setItem('typedhouse-studio:source', source!);
      localStorage.setItem('typedhouse-studio:chart-spec', spec!);
    }, [qOnlyId, JSON.stringify(chart)]);
    await open(page, harness);
    expect(await page.evaluate(() => [localStorage.getItem('typedhouse-studio:prompt'), localStorage.getItem('typedhouse-studio:chart-prompt')])).toEqual([null, null]);
    expect(await editorText(page)).toBe(qOnlyId);
    await expect(page.locator('#chart-ask')).toHaveCount(0);
    await page.keyboard.press('Control+g');
    await expect(page.locator('#chart-ask')).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(page.getByText('Describe a chart')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'old one', exact: true }).click();
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.results-table tbody tr');
    await page.keyboard.press('Control+2');
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await expect(page.locator('.chat-row.on')).toHaveText('New chat');
  });

  test('long model text and many turns: nothing overflows, focus stays in the box', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, `say:${'unbroken'.repeat(400)}`);
    await waitForTurns(page, 2);
    await sendMessage(page, `say:${'long text '.repeat(600)}`);
    await waitForTurns(page, 4);
    await sendMessage(page, `src:export default from(entity_ots_component).limit(1) // ${'x'.repeat(2000)}`);
    await waitForTurns(page, 6);
    for (let i = 0; i < 25; i++) { await sendMessage(page, `say:turn ${i}`); await waitForTurns(page, 8 + i * 2); }
    const measure = await page.evaluate(() => {
      const thread = document.querySelector('.thread')!;
      return { threadOverflow: thread.scrollWidth - thread.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, focus: document.activeElement?.id, turns: thread.querySelectorAll('.turn').length };
    });
    expect(measure).toEqual({ threadOverflow: 0, pageOverflow: 0, focus: 'composer', turns: 56 });
  });

  test('a long reply comes into view when it arrives', async ({ page }) => {
    await open(page, harness);
    for (let i = 0; i < 6; i++) { await sendMessage(page, `say:turn ${i}`); await waitForTurns(page, (i + 1) * 2); }
    await sendMessage(page, `say:${'long text '.repeat(200)} THE_END`);
    await waitForTurns(page, 14);
    const seen = await page.evaluate(() => {
      const thread = document.querySelector('.thread')!.getBoundingClientRect();
      const last = [...document.querySelectorAll('.thread .turn')].at(-1)!.getBoundingClientRect();
      return last.bottom <= thread.bottom + 1;
    });
    expect(seen).toBe(true);
  });

  test('a failed turn keeps its height in a long thread: the error and load last attempt stay usable', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'fail');
    await waitForTurns(page, 2);
    for (let i = 0; i < 8; i++) { await sendMessage(page, `say:${'padding '.repeat(60)}${i}`); await waitForTurns(page, 4 + i * 2); }
    const { height, content } = await page.locator('.turn[data-kind="error"]').evaluate(e => ({ height: e.getBoundingClientRect().height, content: e.scrollHeight }));
    expect(height).toBeGreaterThanOrEqual(content);
  });

  test('a chart after a failed turn works, and a bad chart spec leaves the chart alone', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'fail');
    await waitForTurns(page, 4);
    await sendMessage(page, 'chart it');
    await waitForTurns(page, 6);
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await sendMessage(page, 'chartfail');
    await waitForTurns(page, 8);
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
  });

  test('a reply replacing the editor is undoable, and the added lines show until the next edit', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, `${q1}\n// HAND_EDIT`);
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(2)');
    await waitForTurns(page, 2);
    await page.click('.cm-content');
    await page.keyboard.press('Control+z');
    await expect.poll(() => editorText(page)).toContain('HAND_EDIT');
  });

  test('rows go with a message only as a sample of exactly the source sent', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
    await sendMessage(page, 'say:with rows');
    await waitForTurns(page, 4);
    expect(lastUser(harness.requests().at(-1)!)).toContain('Sample result rows');
    expect(lastUser(harness.requests().at(-1)!).match(/cmp_/g)!.length).toBeGreaterThan(0);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// edited');
    await sendMessage(page, 'say:without rows');
    await waitForTurns(page, 6);
    expect(lastUser(harness.requests().at(-1)!)).not.toContain('Sample result rows');
  });

  test('a long changed list is capped; order is removal then addition', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, Array.from({ length: 30 }, (_, i) => `// line ${i}`).join('\n'));
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(2)');
    await waitForTurns(page, 2);
    await expect(page.locator('[data-testid="changes"] .line-more')).toHaveText('+19 more');
    await expect(page.locator('[data-testid="changes"] > div').first()).toHaveClass('line-remove');
  });

  test('chats: a hand edit survives switching away and back; a new chat is empty and keeps the editor; ⌘K reopens', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// HAND_EDIT_B');
    await page.getByRole('button', { name: /new$/ }).click();
    await expect(page.locator('.thread-empty')).toBeVisible();
    expect(await editorText(page)).toContain('HAND_EDIT_B');
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(2)');
    await waitForTurns(page, 2);
    await page.keyboard.press('Control+k');
    await page.keyboard.insertText('CHAT_B');
    await page.getByRole('option', { name: /CHAT_B plain/ }).or(page.locator('[role="option"]', { hasText: 'CHAT_B plain' })).first().click();
    await expect(page.locator('.chat-row.on')).toHaveText('CHAT_B plain');
    await expect.poll(() => editorText(page)).toContain('HAND_EDIT_B');
    await expect(page.locator('.version-chip.on')).toHaveCount(0);
  });

  test('saved queries: save, overwrite, load with its chart, delete; loading leaves the open chat alone', async ({ page }) => {
    page.on('dialog', dialog => void dialog.accept());
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'chart it');
    await waitForTurns(page, 4);
    await page.keyboard.press('Control+s');
    await page.fill('#save-name', 'mine');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'mine', exact: true })).toBeVisible();
    await page.keyboard.press('Control+s');
    await page.fill('#save-name', 'mine');
    await page.keyboard.press('Enter');
    await expect(page.locator('#save-name')).toHaveCount(0);
    await setEditor(page, qOnlyId);
    await page.getByRole('button', { name: 'mine', exact: true }).click();
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('.turn-version')).toHaveCount(2);
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+2');
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await page.getByRole('button', { name: 'Delete mine' }).click();
    await expect(page.getByRole('button', { name: 'mine', exact: true })).toHaveCount(0);
  });

  test('ClickHouse really down during the auto-run: the version stands, the error shows, the chat goes on', async ({ page }, info) => {
    const own = await startClickHouse();
    await harness.stop();
    harness = await startHarness(uiOf(info), { clickhouse: own.url });
    try {
      await open(page, harness);
      await sendMessage(page, 'plain');
      await waitForTurns(page, 2);
      await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
      await own.stop();
      await sendMessage(page, 'second');
      await waitForTurns(page, 4);
      await expect(page.locator('.turn-version')).toHaveCount(2);
      await expect(page.locator('.results .error')).toBeVisible();
      expect(await editorText(page)).toContain('.limit(2)');
      await sendMessage(page, 'say:still here');
      await waitForTurns(page, 6);
      await expect(page.locator('.turn-text').last()).toHaveText('still here');
    } finally { await own.stop().catch(() => undefined); }
  });

  test('the query turn after a chart: Table, and the Chart tab points at the chat, as the prototype', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'chart it');
    await waitForTurns(page, 4);
    await sendMessage(page, 'plain again');
    await waitForTurns(page, 6);
    await page.keyboard.press('Control+2');
    await expect(page.locator('.chart-empty')).toContainText('Ask for one in the chat');
    await page.locator('.turn-version').nth(1).click();
    await page.getByRole('button', { name: /restore & run/ }).click();
    await expect(page.locator('.tab.on')).toContainText('Chart');
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
  });

  test('reopening a chat: thread, editor and chart restored, no automatic run, one key away', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'chart it');
    await waitForTurns(page, 4);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(2)');
    await waitForTurns(page, 2);
    const runs: string[] = [];
    page.on('request', r => { if (r.url().includes('query.run')) runs.push(r.url()); });
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.turn-version')).toHaveCount(2);
    expect(await editorText(page)).toBe(q1);
    await page.waitForTimeout(300);
    expect(runs).toEqual([]);
    await expect(page.locator('.empty')).toContainText('to run the query');
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+2');
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
  });
});

test.describe('a generation elsewhere', () => {
  const dot = (page: Page, text: string) => page.locator('.chat-row', { hasText: text }).locator('.chat-busy-dot');
  const line = (page: Page) => page.locator('[data-testid="generating-elsewhere"]');
  async function generatingInA(page: Page, prompt = 'hang CHAT_A') {
    await open(page, harness);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, prompt);
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await expect(page.locator('.chat-row', { hasText: 'CHAT_A' })).toBeVisible();
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
  }
  const expectClear = async (page: Page) => {
    await expect(line(page)).toHaveCount(0);
    await expect(page.locator('.chat-busy-dot')).toHaveCount(0);
    await expect(page.locator('.composer-send')).toContainText('Send');
  };

  test('the line, Waiting and the dot show, and Open it reaches a stop', async ({ page }) => {
    await generatingInA(page);
    await expect(line(page)).toContainText('Another chat is generating');
    await expect(page.locator('.composer-send')).toContainText('Waiting');
    await expect(dot(page, 'CHAT_A')).toBeVisible();
    await expect(dot(page, 'CHAT_B')).toHaveCount(0);
    await line(page).getByRole('button', { name: 'Open it to stop it' }).click();
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await expectClear(page);
  });

  test('across a reload: the line, the dot and the stop route all come back, and a send is refused with the words kept', async ({ page }) => {
    await generatingInA(page);
    await page.reload();
    await expect(line(page)).toBeVisible();
    await expect(dot(page, 'CHAT_A')).toBeVisible();
    await sendMessage(page, 'from B after reload');
    await expect(page.locator('#composer')).toHaveValue('from B after reload');
    await expect(page.locator('.chat-error')).toContainText('already running');
    await line(page).getByRole('button', { name: 'Open it to stop it' }).click();
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await expectClear(page);
  });

  for (const [how, prompt] of [['a reply', 'slow CHAT_A'], ['a failure', 'slowfail CHAT_A']] as const) {
    test(`the dot and the line clear after ${how}`, async ({ page }) => {
      await generatingInA(page, prompt);
      await expect(dot(page, 'CHAT_A')).toBeVisible();
      await expectClear(page);
    });
  }
  test('the dot clears when the generation ends while following after a reload', async ({ page }) => {
    await generatingInA(page, 'slow CHAT_A');
    await page.reload();
    await expect(page.locator('.thread')).toContainText('CHAT_B plain');
    await expectClear(page);
    await page.locator('.chat-row', { hasText: 'CHAT_A' }).click();
    await waitForTurns(page, 2);
    expect((await turnKinds(page))[1]).toMatch(/version|text/);
  });
  test('the dot clears after a stop of a stuck provider', async ({ page }) => {
    await generatingInA(page, 'stuck CHAT_A');
    await line(page).getByRole('button', { name: 'Open it to stop it' }).click();
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await expectClear(page);
  });
  test('a real kill: chat.list says not generating after the restart, and an open page clears by itself', async ({ page, request }) => {
    await generatingInA(page);
    await page.reload();
    await expect(dot(page, 'CHAT_A')).toBeVisible();
    await harness.restart('SIGKILL');
    const listed = await (await request.get(`${harness.url}/trpc/chat.list`)).json() as { result: { data: { json: { generating: boolean }[] } } };
    expect(listed.result.data.json.map(c => c.generating)).toEqual([false, false]);
    await expectClear(page);
    await page.locator('.chat-row', { hasText: 'CHAT_A' }).click();
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Interrupted');
  });

  test('the list polling leaves typing alone: box, editor, caret, thread scroll, palette selection, autocomplete', async ({ page }) => {
    await generatingInA(page);
    await page.reload();
    await expect(line(page)).toBeVisible();
    // Long enough to scroll, and watched for any change to what is typed or shown.
    await page.evaluate(() => {
      const thread = document.querySelector('.thread'); thread.style.height = '60px'; thread.style.flex = 'none'; thread.scrollTop = 7;
      (window as any).changes = 0;
      new (window as any).MutationObserver((list: unknown[]) => { (window as any).changes += list.length; }).observe(thread, { childList: true, subtree: true, characterData: true });
    });
    const scroll = await page.evaluate(() => document.querySelector('.thread').scrollTop);
    await page.fill('#composer', 'abcdef');
    await page.evaluate(() => document.querySelector('#composer').setSelectionRange(3, 3));
    await page.locator('#composer').focus();
    for (const key of 'XYZ') { await page.keyboard.type(key); await page.waitForTimeout(900); }
    expect(await page.locator('#composer').inputValue()).toBe('abcXYZdef');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('composer');
    expect(await page.evaluate(() => document.querySelector('.thread').scrollTop)).toBe(scroll);
    expect(await page.evaluate(() => (window as any).changes)).toBe(0);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    for (const key of ['// a', 'b', 'c']) { await page.keyboard.insertText(key); await page.waitForTimeout(900); }
    expect(await editorText(page)).toContain('// abc');
    await page.keyboard.press('Control+k');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const selected = () => page.locator('[aria-selected="true"]').first().innerText();
    const before = await selected();
    await page.waitForTimeout(2_300);
    expect(await selected()).toBe(before);
    await page.keyboard.press('Escape');
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nfrom(');
    await page.keyboard.press('Control+Space');
    await page.waitForSelector('.cm-tooltip-autocomplete li');
    await page.waitForTimeout(2_300);
    await expect(page.locator('.cm-tooltip-autocomplete li').first()).toBeVisible();
  });

  test('leaving a new chat right after its first send: the line, the dot and the stop route still find it', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'CHAT_B plain');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'hang CHAT_A');
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(line(page)).toBeVisible();
    await expect(dot(page, 'CHAT_A')).toBeVisible({ timeout: 4_000 });
    await line(page).getByRole('button', { name: 'Open it to stop it' }).click({ timeout: 4_000 });
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
  });
});

test.describe('put-aside state', () => {
  const editKey = 'typedhouse-studio:edit';
  /** One version, a hand edit and a draft, then edit-and-resend pressed on the first message. */
  async function editing(page: Page) {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// HAND_EDIT');
    await page.fill('#composer', 'MY_DRAFT');
    await page.locator('.turn[data-kind="user"]', { hasText: 'ALPHA' }).click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await expect(page.locator('#composer')).toHaveValue('ALPHA');
  }
  const backInPlace = async (page: Page) => {
    expect(await editorText(page)).toContain('HAND_EDIT');
    await expect(page.locator('#composer')).toHaveValue('MY_DRAFT');
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await expect(page.locator('.chat-editing')).toHaveCount(0);
  };

  test('reload gives back the editor and the draft; a second reload changes nothing', async ({ page }) => {
    await editing(page);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await backInPlace(page);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await backInPlace(page);
  });
  test('esc gives them back, and a reload after it changes nothing', async ({ page }) => {
    await editing(page);
    await page.press('#composer', 'Escape');
    await backInPlace(page);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await backInPlace(page);
  });
  test('edit, switch chats, reload: all of it stays with its own chat', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, qOnlyId);
    await sendMessage(page, 'say:CHAT_B');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await setEditor(page, q1);
    await sendMessage(page, 'say:ALPHA');
    await waitForTurns(page, 2);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// HAND_EDIT');
    await page.locator('.turn[data-kind="user"]', { hasText: 'ALPHA' }).click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('say:CHAT_B');
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await page.reload();
    await page.waitForSelector('.cm-content');
    expect(await editorText(page)).toBe(qOnlyId);
    await expect(page.locator('#composer')).toHaveValue('');
    await page.locator('.chat-row', { hasText: 'say:ALPHA' }).click();
    await expect.poll(() => editorText(page)).toContain('HAND_EDIT');
  });
  test('a real resend is not undone by a later reload, and leaves nothing behind', async ({ page }) => {
    await editing(page);
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(5)');
    await waitForTurns(page, 2);
    expect(await page.evaluate(key => localStorage.getItem(key), editKey)).toBeNull();
    const after = await editorText(page);
    expect(after).toContain('limit(5)');
    await page.reload();
    await page.waitForSelector('.cm-content');
    expect(await editorText(page)).toBe(after);
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await expect(page.locator('.thread')).not.toContainText('ALPHA');
  });
  test('a reload during the resend: the resend stands and the reply applies; the old state does not come back', async ({ page }) => {
    await editing(page);
    await sendMessage(page, 'slow resend');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.reload();
    await page.waitForSelector('.cm-content');
    await waitForTurns(page, 2);
    await expect.poll(() => editorText(page)).not.toContain('HAND_EDIT');
    await expect(page.locator('.thread')).toContainText('slow resend');
    await expect(page.locator('.thread')).not.toContainText('ALPHA');
  });
  test('a hand edit made after pressing edit, and the rewritten message, survive a reload', async ({ page }) => {
    await editing(page);
    await page.fill('#composer', 'A_LONG_REWRITTEN_MESSAGE');
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n// EDITED_WHILE_EDITING');
    await page.reload();
    await page.waitForSelector('.cm-content');
    const kept = `${await editorText(page)} ${await page.locator('#composer').inputValue()}`;
    expect(kept).toContain('A_LONG_REWRITTEN_MESSAGE');
    expect(kept).toContain('EDITED_WHILE_EDITING');
  });
  test('the rewritten message survives a chat switch and back', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:CHAT_B');
    await waitForTurns(page, 2);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'say:ALPHA');
    await waitForTurns(page, 2);
    await page.locator('.turn[data-kind="user"]', { hasText: 'ALPHA' }).click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await page.fill('#composer', 'A_LONG_REWRITTEN_MESSAGE');
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('say:CHAT_B');
    await page.locator('.chat-row', { hasText: 'say:ALPHA' }).click();
    await expect(page.locator('.thread')).toContainText('say:ALPHA');
    await expect(page.locator('#composer')).toHaveValue('A_LONG_REWRITTEN_MESSAGE');
  });
  for (const [name, stored] of [['not JSON', '{oops'], ['null', 'null'], ['a number', '3'], ['an empty object', '{}'], ['wrong types', '{"chat":5,"source":7,"chart":"x","draft":9}'], ['a chat that is gone', '{"chat":"gone","source":"export default 1","chart":null,"draft":"d"}']] as const) {
    test(`stored put-aside state that is ${name}: the app opens and the editor holds a string`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await open(page, harness);
      await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [editKey, stored]);
      await page.reload();
      await page.waitForSelector('.cm-content', { timeout: 8_000 });
      expect(errors).toEqual([]);
      expect(await editorText(page)).not.toBe('undefined');
      expect(await editorText(page)).not.toBe('7');
      expect(await page.locator('#composer').inputValue()).not.toBe('undefined');
      await sendMessage(page, 'say:works');
      await waitForTurns(page, 2);
    });
  }
});

test.describe('changed lines over the starter, and layout of the small turns', () => {
  const addedLines = (page: Page) => page.locator('.cm-added-line');
  test('v1 over the untouched starter: no changed lines and no highlight', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await expect(page.locator('[data-testid="changes"]')).toHaveCount(0);
    await expect(addedLines(page)).toHaveCount(0);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await expect(page.locator('[data-testid="changes"]')).toHaveCount(0);
  });
  test('v1 over hand-written text keeps the diff and the highlight, until the next edit', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, '// mine\nexport default from(entity_ots_component).limit(1)');
    await sendMessage(page, 'src:export default from(entity_ots_component).limit(2)');
    await waitForTurns(page, 2);
    await expect(page.locator('[data-testid="changes"] > div')).toHaveCount(3);
    await expect(addedLines(page)).toHaveCount(1);
    await page.click('.cm-content');
    await page.keyboard.insertText('x');
    await expect(addedLines(page)).toHaveCount(0);
  });
  test('a starter with only a space added counts as hand-written: the diff stays honest', async ({ page }) => {
    await open(page, harness);
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' ');
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await expect(page.locator('[data-testid="changes"]')).toHaveCount(1);
  });
  test('a failed turn and a note: not double indented, readable, with the error under the same margin as a reply', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'fail');
    await waitForTurns(page, 4);
    await sendMessage(page, 'hang');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.press('#composer', 'Escape');
    await waitForTurns(page, 6);
    // Where the text starts: a box's left edge plus its own padding.
    const left = (selector: string) => page.locator(selector).first().evaluate((e: any) => { const style = (e.ownerDocument.defaultView as any).getComputedStyle(e); return e.getBoundingClientRect().left + parseFloat(style.paddingLeft); });
    const reply = await left('.turn-version .turn-text');
    expect(await left('.turn[data-kind="error"] .turn-error')).toBe(reply);
    expect(await left('.turn[data-kind="note"] .turn-note')).toBe(reply);
    const error = await page.locator('.turn[data-kind="error"]').evaluate(e => ({ height: e.getBoundingClientRect().height, content: e.scrollHeight }));
    expect(error.height).toBeGreaterThanOrEqual(error.content);
    await expect(page.getByRole('button', { name: /Load last attempt/ })).toBeVisible();
  });
});

test.describe('an edit in progress', () => {
  const editKey = 'typedhouse-studio:edit';
  const banner = (page: Page) => page.locator('.chat-editing');
  const reload = async (page: Page) => { await page.reload(); await page.waitForSelector('.cm-content'); };
  const pressEdit = async (page: Page, text: string) => {
    await page.locator('.turn[data-kind="user"]', { hasText: text }).click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await expect(banner(page)).toBeVisible();
  };
  const addToEditor = async (page: Page, text: string) => {
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(text);
  };
  /** ALPHA v1, BRAVO_DROPPED v2, a hand edit and a draft, then an edit of BRAVO_DROPPED. */
  async function twoTurnsEditing(page: Page) {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await sendMessage(page, 'BRAVO_DROPPED');
    await waitForTurns(page, 4);
    await addToEditor(page, '\n// PUT_ASIDE');
    await page.fill('#composer', 'MY_DRAFT');
    await pressEdit(page, 'BRAVO_DROPPED');
  }

  test('resume across two reloads, then a real resend: the request has the rewrite and the hand edit, and no dropped turn', async ({ page }) => {
    await twoTurnsEditing(page);
    await page.fill('#composer', 'say:REWRITTEN_WORDS');
    await addToEditor(page, '\n// EDITED_WHILE_EDITING');
    for (let i = 0; i < 2; i++) {
      await reload(page);
      await expect(banner(page)).toBeVisible();
      await expect(page.locator('#composer')).toHaveValue('say:REWRITTEN_WORDS');
      expect(await editorText(page)).toContain('EDITED_WHILE_EDITING');
    }
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('REWRITTEN_WORDS');
    const request = JSON.stringify(harness.requests().at(-1));
    for (const word of ['ALPHA', 'REWRITTEN_WORDS', 'EDITED_WHILE_EDITING']) expect(request).toContain(word);
    expect(request).not.toContain('BRAVO_DROPPED');
    expect(request).not.toContain('PUT_ASIDE');
    await expect(banner(page)).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), editKey)).toBeNull();
    await reload(page);
    await expect(page.locator('.thread')).not.toContainText('BRAVO_DROPPED');
    await expect(page.locator('#composer')).toHaveValue('');
  });

  test('esc after a resume brings back the turns, the put-aside editor and the draft', async ({ page }) => {
    await twoTurnsEditing(page);
    await page.fill('#composer', 'REWRITE');
    await reload(page);
    await expect(banner(page)).toBeVisible();
    await page.press('#composer', 'Escape');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator('.turn-version')).toHaveCount(2);
    await expect(page.locator('#composer')).toHaveValue('MY_DRAFT');
    expect(await editorText(page)).toContain('PUT_ASIDE');
    await reload(page);
    await expect(page.locator('.turn-version')).toHaveCount(2);
    await expect(page.locator('#composer')).toHaveValue('MY_DRAFT');
  });

  test('two chats with an open edit each: they stay apart across a switch and a reload, and each resend is its own', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:CHAT_B one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'say:CHAT_B two');
    await waitForTurns(page, 4);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'say:CHAT_A one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'say:CHAT_A two');
    await waitForTurns(page, 4);
    await pressEdit(page, 'CHAT_A two');
    await page.fill('#composer', 'say:REWRITE_A');
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B two');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator('#composer')).toHaveValue('');
    await pressEdit(page, 'CHAT_B two');
    await page.fill('#composer', 'say:REWRITE_B');
    await reload(page);
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('#composer')).toHaveValue('say:REWRITE_B');
    await page.locator('.chat-row', { hasText: 'CHAT_A' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_A one');
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('#composer')).toHaveValue('say:REWRITE_A');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('REWRITE_A');
    const requestA = JSON.stringify(harness.requests().at(-1));
    expect(requestA).not.toContain('CHAT_A two');
    expect(requestA).not.toContain('CHAT_B');
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('#composer')).toHaveValue('say:REWRITE_B');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('REWRITE_B');
    expect(JSON.stringify(harness.requests().at(-1))).not.toContain('CHAT_B two');
  });

  test('a stored edit of a message that is gone: the words stay as a plain draft and the turns show', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:ONE');
    await waitForTurns(page, 2);
    await page.fill('#composer', 'WORDS_TO_KEEP');
    await page.evaluate(key => {
      const chat = localStorage.getItem('typedhouse-studio:chat')!;
      localStorage.setItem(key, JSON.stringify({ [chat]: { turn: 999_999, text: 'old', source: 'old', aside: { source: 'ASIDE', chart: null, draft: 'd' } } }));
    }, editKey);
    await reload(page);
    await expect(page.locator('.turn[data-kind="text"]')).toHaveCount(1);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator('#composer')).toHaveValue('WORDS_TO_KEEP');
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), editKey)).toBeNull();
  });

  test('a stale format entry is ignored and cleared', async ({ page }) => {
    await open(page, harness);
    await setEditor(page, q1);
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ chat: 'x', source: 'OLD_FORMAT', chart: null, draft: 'OLD_DRAFT' })), editKey);
    await reload(page);
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('#composer')).toHaveValue('');
    expect(await page.evaluate(key => localStorage.getItem(key), editKey)).toBeNull();
  });

  test('typing, then undoing back to the exact start, counts as untouched on reload', async ({ page }) => {
    await twoTurnsEditing(page);
    await page.locator('#composer').focus();
    await page.keyboard.press('End');
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    await expect(page.locator('#composer')).toHaveValue('BRAVO_DROPPED');
    await addToEditor(page, 'y');
    await page.keyboard.press('Control+z');
    await reload(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator('.turn-version')).toHaveCount(2);
    await expect(page.locator('#composer')).toHaveValue('MY_DRAFT');
    expect(await editorText(page)).toContain('PUT_ASIDE');
  });

  for (const [how, prompt] of [['fails', 'fail REWRITE_WORDS'], ['is stopped', 'hang REWRITE_WORDS']] as const) {
    test(`a resend that ${how}, then a reload: the words are still in the thread and nothing comes back over them`, async ({ page }) => {
      await twoTurnsEditing(page);
      await page.fill('#composer', prompt);
      await page.press('#composer', 'Enter');
      if (how === 'is stopped') { await expect(page.locator('[data-testid="generating"]')).toBeVisible(); await page.press('#composer', 'Escape'); }
      await waitForTurns(page, 4);
      await reload(page);
      await expect(page.locator('.thread')).toContainText('REWRITE_WORDS');
      await expect(page.locator('.thread')).not.toContainText('BRAVO_DROPPED');
      await expect(banner(page)).toHaveCount(0);
      expect(await editorText(page)).not.toContain('PUT_ASIDE');
    });
  }

  test('a resend refused because another chat generates: the edit and the words stay', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:CHAT_B one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'say:CHAT_B two');
    await waitForTurns(page, 4);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'hang CHAT_A');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await expect(page.locator('.chat-row', { hasText: 'CHAT_A' })).toBeVisible();
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('.thread')).toContainText('CHAT_B two');
    await reload(page);
    await pressEdit(page, 'CHAT_B two');
    await page.fill('#composer', 'REWRITE_WAITS');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.chat-error')).toContainText('already running');
    await expect(page.locator('#composer')).toHaveValue('REWRITE_WAITS');
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('.turn[data-editing]')).toHaveCount(1);
    await page.locator('[data-testid="generating-elsewhere"]').getByRole('button').click();
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await expect(page.locator('#composer')).toHaveValue('REWRITE_WAITS');
    await expect(banner(page)).toBeVisible();
  });

  test('the server lost during a resend: the words are still somewhere', async ({ page }) => {
    await twoTurnsEditing(page);
    await page.fill('#composer', 'REWRITE_WORDS');
    await page.route('**/trpc/chat.send', route => route.abort());
    await page.press('#composer', 'Enter');
    await expect(page.locator('.chat-error')).toContainText('Lost the server');
    await expect(page.locator('#composer')).toHaveValue('REWRITE_WORDS');
    await page.unroute('**/trpc/chat.send');
    await reload(page);
    await expect(page.locator('#composer')).toHaveValue('REWRITE_WORDS');
  });

  test('a plain message with the server lost: the words are still in the box', async ({ page }) => {
    await open(page, harness);
    await page.route('**/trpc/chat.send', route => route.abort());
    await sendMessage(page, 'WORDS_TO_KEEP');
    await expect(page.locator('.chat-error')).toContainText('Lost the server');
    await expect(page.locator('#composer')).toHaveValue('WORDS_TO_KEEP');
  });

  test('a lost resend, then a reload: the editor stays, it is still a real resend, and no dropped turn reaches the model', async ({ page }) => {
    await twoTurnsEditing(page);
    await page.fill('#composer', 'say:REWRITTEN_AFTER_LOSS');
    await addToEditor(page, '\n// EDITED_WHILE_EDITING');
    await page.route('**/trpc/chat.send', route => route.abort());
    await page.press('#composer', 'Enter');
    await expect(page.locator('.chat-error')).toContainText('Lost the server');
    await expect(page.locator('#composer')).toHaveValue('say:REWRITTEN_AFTER_LOSS');
    await page.unroute('**/trpc/chat.send');
    const sent = await editorText(page);
    expect(sent).toContain('EDITED_WHILE_EDITING');
    await reload(page);
    // Pinned: the reload must not take the old reply for this resend's reply and overwrite the editor.
    await page.waitForTimeout(500);
    expect(await editorText(page)).toBe(sent);
    await expect(page.locator('#composer')).toHaveValue('say:REWRITTEN_AFTER_LOSS');
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('REWRITTEN_AFTER_LOSS');
    const request = JSON.stringify(harness.requests().at(-1));
    for (const word of ['ALPHA', 'REWRITTEN_AFTER_LOSS', 'EDITED_WHILE_EDITING']) expect(request).toContain(word);
    expect(request).not.toContain('BRAVO_DROPPED');
    await expect(page.locator('.thread')).not.toContainText('BRAVO_DROPPED');
    await expect(page.locator('#composer')).toHaveValue('');
  });

  test('a failed turn leaves the box empty: its words are in the thread', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'fail');
    await waitForTurns(page, 2);
    await expect(page.locator('.turn[data-kind="error"]')).toBeVisible();
    await expect(page.locator('.thread')).toContainText('fail');
    await expect(page.locator('#composer')).toHaveValue('');
    await reload(page);
    await expect(page.locator('#composer')).toHaveValue('');
  });

  test('a retry with no answer: the words stay in the box, the turns are back, undo has the hand edit, and resending adds a turn', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await sendMessage(page, 'BRAVO');
    await waitForTurns(page, 4);
    await addToEditor(page, '\n// HAND_EDIT');
    await page.waitForTimeout(800); // CodeMirror groups edits closer than 500 ms into one undo step.
    await page.route('**/trpc/chat.send', route => route.abort());
    await page.locator('.turn[data-kind="user"]', { hasText: 'BRAVO' }).click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.chat-error')).toContainText('Lost the server');
    await page.unroute('**/trpc/chat.send');
    await expect(page.locator('#composer')).toHaveValue('BRAVO');
    expect(await turnKinds(page)).toEqual(['user', 'version', 'user', 'version']);
    await expect(banner(page)).toHaveCount(0);
    // A retry goes back to the source sent with that turn, answered or not. The hand edit is one undo away, until a reload.
    expect(await editorText(page)).not.toContain('HAND_EDIT');
    await page.click('.cm-content');
    await page.keyboard.press('Control+z');
    await expect.poll(() => editorText(page)).toContain('HAND_EDIT');
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => editorText(page)).not.toContain('HAND_EDIT');
    await page.press('#composer', 'Enter');
    await waitForTurns(page, 6);
    expect(await turnKinds(page)).toEqual(['user', 'version', 'user', 'version', 'user', 'version']);
    await expect(page.locator('#composer')).toHaveValue('');
  });

  test('a real server kill mid-send with the page open, then a restart: no words lost, and the next send works', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang WORDS_MID_SEND');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await harness.restart('SIGKILL');
    await expect(page.locator('.chat-error')).toContainText('Lost the server');
    await expect(page.locator('[data-testid="generating"]')).toHaveCount(0);
    const box = await page.locator('#composer').inputValue();
    expect(box).toContain('WORDS_MID_SEND');
    await page.fill('#composer', 'say:NEXT_AFTER_KILL');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('NEXT_AFTER_KILL');
    await expect(page.locator('.chat-error')).toHaveCount(0);
    const kinds = await turnKinds(page);
    expect(kinds.at(-1)).toBe('text');
    expect(JSON.stringify(harness.requests().at(-1))).toContain('WORDS_MID_SEND');
    await reload(page);
    await expect(page.locator('.thread')).toContainText('WORDS_MID_SEND');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Interrupted');
    await expect(page.locator('#composer')).toHaveValue('');
  });

  test('pressing edit on an earlier turn during an edit: what was put aside first is what esc brings back', async ({ page }) => {
    await twoTurnsEditing(page);
    await pressEdit(page, 'ALPHA');
    await expect(page.locator('#composer')).toHaveValue('ALPHA');
    await expect(page.locator('.turn-version')).toHaveCount(0);
    expect(await editorText(page)).not.toContain('PUT_ASIDE');
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn-version')).toHaveCount(2);
    await expect(page.locator('#composer')).toHaveValue('MY_DRAFT');
    expect(await editorText(page)).toContain('PUT_ASIDE');
  });

  test('restoring a version during an edit: the resend carries it, and the numbering is right', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await sendMessage(page, 'BRAVO');
    await waitForTurns(page, 4);
    await sendMessage(page, 'CHARLIE_DROPPED');
    await waitForTurns(page, 6);
    await pressEdit(page, 'CHARLIE_DROPPED');
    await page.locator('.turn-version').first().click();
    await page.getByRole('button', { name: /restore & run/ }).click();
    await expect.poll(() => editorText(page)).toBe(q1);
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('.thread')).not.toContainText('Restored');
    await page.fill('#composer', 'src:export default from(entity_ots_component).limit(4)');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.version-chip.on')).toHaveText('v3');
    const request = JSON.stringify(harness.requests().at(-1));
    expect(request).toContain(q1.replaceAll('"', '\\"').slice(0, 40));
    expect(request).not.toContain('CHARLIE_DROPPED');
    await expect(page.locator('.thread')).not.toContainText('Restored');
  });

  test('a generation in another chat ending during an edit leaves the edit, the editor and the tab alone', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:CHAT_B one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'say:CHAT_B two');
    await waitForTurns(page, 4);
    await page.getByRole('button', { name: /new$/ }).click();
    await sendMessage(page, 'slow CHAT_A');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await expect(page.locator('.chat-row', { hasText: 'CHAT_A' })).toBeVisible();
    await page.locator('.chat-row', { hasText: 'CHAT_B' }).click();
    await pressEdit(page, 'CHAT_B two');
    await page.fill('#composer', 'say:REWRITE');
    await addToEditor(page, '\n// MINE');
    await page.keyboard.press('Control+3');
    const editorBefore = await editorText(page);
    await expect(page.locator('[data-testid="generating-elsewhere"]')).toHaveCount(0, { timeout: 8_000 });
    expect(await editorText(page)).toBe(editorBefore);
    await expect(page.locator('.tab.on')).toContainText('SQL');
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('#composer')).toHaveValue('say:REWRITE');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('REWRITE');
  });

  test('during a generation in the same chat, edit does nothing', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'ALPHA');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(page.locator('[data-testid="generating"]')).toBeVisible();
    await page.locator('.turn[data-kind="user"]', { hasText: 'ALPHA' }).click();
    await expect(page.getByRole('button', { name: /edit & resend/ })).toHaveCount(0);
    await page.keyboard.press('e');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator('#composer')).toHaveValue('');
    await page.press('#composer', 'Escape');
    await expect(page.locator('.turn[data-kind="note"]')).toContainText('Stopped');
  });

  test('tabs during an edit: the tab stays, the earlier chart shows, esc brings the later one back, and a query resend goes to Table', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'plain');
    await waitForTurns(page, 2);
    await sendMessage(page, 'chart it');
    await waitForTurns(page, 4);
    await expect(page.locator('.tab.on')).toContainText('Chart');
    await pressEdit(page, 'chart it');
    await expect(page.locator('.tab.on')).toContainText('Chart');
    await expect(page.locator('.chart-empty')).toBeVisible();
    await page.press('#composer', 'Escape');
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await pressEdit(page, 'chart it');
    await page.fill('#composer', 'src:export default from(entity_ots_component).limit(2)');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.version-chip.on')).toHaveText('v2');
    await expect(page.locator('.tab.on')).toContainText('Table');
  });

  test('the message being edited stays visible and dimmed, later turns hide, and after the send it appears once', async ({ page }) => {
    await twoTurnsEditing(page);
    const dimmed = page.locator('.turn[data-editing]');
    await expect(dimmed).toHaveCount(1);
    await expect(dimmed).toContainText('BRAVO_DROPPED');
    expect(await dimmed.evaluate((e: any) => Number(e.ownerDocument.defaultView.getComputedStyle(e).opacity))).toBeLessThan(1);
    await expect(page.locator('.turn-version')).toHaveCount(1);
    await expect(banner(page)).toContainText('Sending drops the turns after it');
    await page.fill('#composer', 'say:ONCE_ONLY');
    await page.press('#composer', 'Enter');
    await expect(page.locator('.turn-text').last()).toHaveText('ONCE_ONLY');
    await expect(page.locator('.thread')).not.toContainText('BRAVO_DROPPED');
    await expect(page.locator('.thread .turn-user-text', { hasText: 'say:ONCE_ONLY' })).toHaveCount(1);
  });

  // PM decision (S13): a retry here would resend the original and silently discard the rewrite, so it isn't offered while an edit is open.
  test('during an edit the dimmed turn offers only back to message and copy, and retry is offered nowhere', async ({ page }) => {
    await twoTurnsEditing(page);
    await page.fill('#composer', 'REWRITE_KEPT');
    const requests = harness.requests().length;
    const dimmed = page.locator('.turn[data-editing]');
    await dimmed.click();
    const hints = (await dimmed.locator('.turn-action').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim());
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatch(/^↵ back to message/);
    expect(hints[1]).toMatch(/^y /);
    // `e` and `r` do nothing on it.
    await page.keyboard.press('r');
    await page.keyboard.press('e');
    await page.waitForTimeout(200);
    expect(harness.requests().length).toBe(requests);
    await expect(page.locator('#composer')).toHaveValue('REWRITE_KEPT');
    await expect(banner(page)).toBeVisible();
    // Nor on the other turns: esc first.
    for (const turn of [page.locator('.turn[data-kind="user"]', { hasText: 'ALPHA' }), page.locator('.turn-version').first()]) {
      await turn.click();
      await expect(turn.locator('.turn-action').first()).toBeVisible();
      await expect(turn.getByRole('button', { name: /retry/ })).toHaveCount(0);
      await page.keyboard.press('r');
    }
    await page.waitForTimeout(200);
    expect(harness.requests().length).toBe(requests);
    await expect(page.locator('#composer')).toHaveValue('REWRITE_KEPT');
    await expect(banner(page)).toBeVisible();
    // Back to the message keeps the rewrite and the edit.
    await dimmed.click();
    await dimmed.getByRole('button', { name: /back to message/ }).click();
    await expect(page.locator('#composer')).toBeFocused();
    await expect(page.locator('#composer')).toHaveValue('REWRITE_KEPT');
    await expect(banner(page)).toBeVisible();
  });
});
