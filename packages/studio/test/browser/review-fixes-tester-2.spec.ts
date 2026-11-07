// Independent tester's second round: the restore step, polling patience, tab stops and the placeholder turn.
import { createServer, request, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { editorText, open, q1, qOnlyId, sendMessage, startHarness, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page; the root TypeScript program has no DOM lib, on purpose.
declare const document: any;
declare const localStorage: any;

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const openChatId = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chat') as string | null);
const storedChart = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chart-spec'));
const forgetBrowserCopy = (page: Page, id: string) => page.evaluate(k => { localStorage.removeItem(`typedhouse-studio:editor:${k}`); localStorage.removeItem(`typedhouse-studio:chart:${k}`); }, id);
const gen = (page: Page) => page.getByTestId('generating');
const stopButton = (page: Page) => gen(page).getByRole('button', { name: /stop/ });
const delayReads = (page: Page, ms: number) => page.route(/chat\.get/, async route => { await sleep(ms); await route.continue().catch(() => undefined); });
const newChat = async (page: Page) => { await page.keyboard.press('ControlOrMeta+Shift+l'); await expect.poll(() => openChatId(page)).toBeNull(); };
const row = (page: Page, text: string) => page.locator('.chat-row').filter({ hasText: text });
const focused = (page: Page) => page.evaluate(() => { const e = document.activeElement; return `${e.tagName}${e.id ? `#${e.id}` : ''}${e.className ? `.${String(e.className).split(' ')[0]}` : ''}${e.closest?.('.activity-tool') ? ' in-tool' : e.closest?.('.activity-log') ? ' in-log' : ''}`; });

/** Chat "alphachat": two versions, the last with a chart. Chat "bravochat": one version of another query. A is left open or not, as the test says. */
async function twoChats(page: Page) {
  await open(page, harness);
  await sendMessage(page, 'first alphachat');
  await waitForTurns(page, 2);
  await sendMessage(page, 'chart');
  await waitForTurns(page, 4);
  await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
  const a = (await openChatId(page))!;
  const aSource = (await editorText(page))!;
  const aChart = (await storedChart(page))!;
  expect(aChart).toBeTruthy();
  await newChat(page);
  await sendMessage(page, `src:${qOnlyId}`);
  await waitForTurns(page, 2);
  const b = (await openChatId(page))!;
  expect(await editorText(page)).toBe(qOnlyId);
  return { a, b, aSource, aChart };
}

test.describe('the restore step', () => {
  test('A→B→A with slow reads restores A: editor and chart, once, and later reads don’t redo it', async ({ page }) => {
    const { a, b, aSource, aChart } = await twoChats(page);
    await forgetBrowserCopy(page, a);
    await forgetBrowserCopy(page, b);
    await delayReads(page, 300);
    const rows = page.locator('.chat-row');
    await rows.nth(0).click();
    await rows.nth(1).click();
    await rows.nth(0).click();
    await rows.nth(1).click();
    await expect.poll(() => openChatId(page)).toBe(a);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(4);
    await expect.poll(() => editorText(page)).toBe(aSource);
    expect(await storedChart(page)).toBe(aChart);
    // Twice, and it stays.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await sleep(500);
    expect(await editorText(page)).toBe(aSource);
  });

  test('A→B with B’s read lost, then back to A: A restores, and B’s late read changes nothing', async ({ page }) => {
    const { a, b, aSource } = await twoChats(page);
    await forgetBrowserCopy(page, a);
    await forgetBrowserCopy(page, b);
    const held: Route[] = [];
    await page.route(/chat\.get/, route => { held.push(route); });
    await row(page, 'alphachat').click();
    await expect.poll(() => held.length).toBe(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await newChat(page);
    await row(page, 'alphachat').click();
    await expect.poll(() => editorText(page)).toBe(aSource);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(4);
  });

  test('a late read of a chat left behind doesn’t restore over the chat now open', async ({ page }) => {
    const { a, b, aSource } = await twoChats(page);
    await forgetBrowserCopy(page, a);
    const held: Route[] = [];
    await page.route(/chat\.get/, route => { held.push(route); });
    await row(page, 'alphachat').click();
    await expect.poll(() => held.length).toBe(1);
    expect(await openChatId(page)).toBe(a);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await row(page, 'src:').click();
    await expect.poll(() => openChatId(page)).toBe(b);
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await held[0]!.continue().catch(() => undefined);
    await sleep(800);
    expect(await editorText(page)).toBe(qOnlyId);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    expect(aSource).not.toBe(qOnlyId);
  });

  test('a chat the server no longer knows: no crash, the editor is left alone, the page works', async ({ page }) => {
    const { a } = await twoChats(page);
    await forgetBrowserCopy(page, a);
    const before = await editorText(page);
    await page.route(/chat\.get/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(/batch=1/.test(route.request().url()) ? [{ result: { data: { json: null } } }] : { result: { data: { json: null } } }) }), { times: 1 });
    await row(page, 'alphachat').click();
    await sleep(800);
    expect(await editorText(page)).toBe(before);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(0);
    await sendMessage(page, 'say:still here');
    await expect(page.locator('.turn-text, .turn-user-text').filter({ hasText: 'still here' }).first()).toBeVisible();
  });

  test('a send cancels the restore, and the late read doesn’t land over the reply', async ({ page }) => {
    const { a } = await twoChats(page);
    await forgetBrowserCopy(page, a);
    const held: Route[] = [];
    await page.route(/chat\.get/, route => { if (held.length === 0) held.push(route); else void route.continue(); });
    await row(page, 'alphachat').click();
    await expect.poll(() => held.length).toBe(1);
    await sendMessage(page, `src:${q1}`);
    await page.waitForFunction(() => document.querySelectorAll('.thread .turn[data-turn]').length >= 6 && !document.querySelector('[data-testid="generating"]'));
    await expect.poll(() => editorText(page)).toBe(q1);
    await held[0]!.continue().catch(() => undefined);
    await sleep(800);
    expect(await editorText(page)).toBe(q1);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(6);
  });

  test('a saved query loaded while the read is out: its source stays, and the chat’s chart comes back over it (pinned)', async ({ page }) => {
    writeFileSync(join(harness.dataDir, 'saved.json'), JSON.stringify({ version: 1, queries: [{ name: 'loaded', prompt: 'p', source: q1, chart: null, updatedAt: '2026-01-01T00:00:00.000Z' }] }));
    const { a } = await twoChats(page);
    await forgetBrowserCopy(page, a);
    await page.reload();
    await page.waitForSelector('.cm-content');
    const held: Route[] = [];
    await page.route(/chat\.get/, route => { if (held.length === 0) held.push(route); else void route.continue(); });
    await row(page, 'alphachat').click();
    await expect.poll(() => held.length).toBe(1);
    await page.locator('.saved-load').filter({ hasText: 'loaded' }).click();
    await expect.poll(() => editorText(page)).toBe(q1);
    expect(await storedChart(page)).toBeNull();
    await held[0]!.continue().catch(() => undefined);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(4);
    await sleep(300);
    expect(await editorText(page)).toBe(q1);
    // Pre-existing (fails the same at bfaf90a), reported as non-blocking: the restore's chart wins over the saved query's lack of one.
    expect(await storedChart(page)).toBeTruthy();
  });

  test('a superseded read’s failure shows no error, and the draft belongs to the right chat', async ({ page }) => {
    const { a, b, aSource } = await twoChats(page);
    await page.evaluate(k => localStorage.setItem(`typedhouse-studio:draft:${k}`, 'draft of A'), a);
    await page.fill('#composer', 'draft of B');
    await sleep(100);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let first = true;
    await page.route(/chat\.get/, async route => { if (first) { first = false; await sleep(500); await route.abort().catch(() => undefined); } else await route.continue(); });
    await row(page, 'alphachat').click();
    await expect(page.locator('#composer')).toHaveValue('draft of A');
    await row(page, 'src:').click();
    await expect(page.locator('#composer')).toHaveValue('draft of B');
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    await sleep(800);
    await expect(page.locator('.chat-error')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await openChatId(page)).toBe(b);
    expect(await editorText(page)).toBe(qOnlyId);
    expect(aSource).not.toBe(qOnlyId);
  });
});

test.describe('polling patience', () => {
  test('a send whose last read is lost still ends: no generating forever, the box takes the next message', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    const held: Route[] = [];
    let lose = false;
    await page.route(/chat\.get/, async route => { if (lose && held.length === 0) held.push(route); else await route.continue().catch(() => undefined); });
    await page.route(/chat\.send/, async route => { const response = await route.fetch(); lose = true; await route.fulfill({ response }); });
    await sendMessage(page, 'second');
    await expect.poll(() => held.length).toBe(1);
    await expect(page.locator('[data-testid="generating"]'), 'still generating, 10 s after the reply').toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await sendMessage(page, 'third');
    await waitForTurns(page, 6);
  });

  test('reads always slower than the patience: a followed generation that ends elsewhere still ends here', async ({ page, context }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    // Reloaded: only polling follows it now.
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(gen(page)).toBeVisible();
    await delayReads(page, 5_000);
    await sleep(1_000);
    const other = await context.newPage();
    await other.goto(harness.url);
    await expect(gen(other)).toBeVisible();
    await stopButton(other).click();
    await expect(gen(other)).toHaveCount(0);
    await other.close();
    await expect(gen(page), 'still generating 25 s after the run ended, reads taking 5 s').toHaveCount(0, { timeout: 25_000 });
    await expect(page.locator('.turn[data-kind="note"]')).toHaveCount(1);
  });

  test('control: reads just under the patience land', async ({ page, context }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(gen(page)).toBeVisible();
    await delayReads(page, 3_000);
    await sleep(1_000);
    const other = await context.newPage();
    await other.goto(harness.url);
    await stopButton(other).click();
    await expect(gen(other)).toHaveCount(0);
    await other.close();
    await expect(gen(page)).toHaveCount(0, { timeout: 25_000 });
  });

  test('reads always slower than the patience, own send: the reply still shows at the end; how much showed during it', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await delayReads(page, 5_000);
    await sendMessage(page, 'transparent');
    await expect(gen(page)).toBeVisible();
    let live = 0;
    const end = Date.now() + 9_000;
    while (Date.now() < end && await gen(page).count()) { if (await page.locator('.turn[data-kind="user"][data-turn]').count() === 2) live++; await sleep(250); }
    process.stdout.write(`samples with the new turn on screen during the generation: ${live}\n`);
    await waitForTurns(page, 4);
    await expect(gen(page)).toHaveCount(0);
  });

  /** Real connections, which page.route doesn't hold: a proxy that swallows chat.get on demand. */
  async function viaProxy(page: Page, work: (state: { swallow: boolean | 'once'; held: number; stops: number; served: number }) => Promise<void>) {
    const target = new URL(harness.url);
    const state = { swallow: false as boolean | 'once', held: 0, stops: 0, served: 0 };
    const sockets = new Set<any>();
    const proxy: Server = createServer((req, res) => {
      if (req.url?.includes('chat.stop')) state.stops++;
      if (state.swallow && req.url?.includes('chat.get')) { state.held++; if (state.swallow === 'once') state.swallow = false; req.resume(); return; }
      if (req.url?.includes('chat.get')) state.served++;
      const out = request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, upstream => { res.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(res); });
      out.on('error', () => res.destroy());
      req.pipe(out);
    });
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    try {
      await page.goto(`http://127.0.0.1:${(proxy.address() as { port: number }).port}/`);
      await page.waitForSelector('.cm-content');
      await sendMessage(page, 'first');
      await waitForTurns(page, 2);
      await sendMessage(page, 'hang');
      await expect(gen(page)).toBeVisible();
      await work(state);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => proxy.close(resolve));
    }
  }

  test('all reads lost over real sockets: stop still gets through, however many are held', async ({ page }) => {
    test.setTimeout(300_000);
    await viaProxy(page, async state => {
      const started = Date.now();
      state.swallow = true;
      let last = 0;
      while (Date.now() - started < 200_000) {
        if (state.held !== last) { last = state.held; process.stdout.write(`${((Date.now() - started) / 1000).toFixed(1)} s: ${last} reads held\n`); }
        if (last >= 7) break;
        await sleep(200);
      }
      process.stdout.write(`after ${((Date.now() - started) / 1000).toFixed(0)} s: ${state.held} reads held\n`);
      await stopButton(page).click();
      await sleep(5_000);
      process.stdout.write(`stop requests that reached the server in 5 s: ${state.stops}\n`);
      expect(state.stops, `chat.stop reached the server with ${state.held} reads held`).toBeGreaterThan(0);
    });
  });

  test('one read lost over a real socket, own send: stop still ends it, in how long', async ({ page }) => {
    test.setTimeout(150_000);
    await viaProxy(page, async state => {
      const started = Date.now();
      state.swallow = 'once';
      await expect.poll(() => state.held).toBe(1);
      const before = state.served;
      await expect.poll(() => state.served, { timeout: 60_000 }).toBeGreaterThan(before);
      process.stdout.write(`next read reached the server ${((Date.now() - started) / 1000).toFixed(1)} s after the lost one\n`);
      const stopping = Date.now();
      await stopButton(page).click();
      await expect(gen(page)).toHaveCount(0, { timeout: 60_000 });
      process.stdout.write(`generating gone ${((Date.now() - stopping) / 1000).toFixed(1)} s after stop\n`);
    });
  });

  test('one read lost over a real socket, following by polling alone: the page sees the run end', async ({ page }) => {
    test.setTimeout(150_000);
    await viaProxy(page, async state => {
      // Reloaded: only polling follows it now.
      await page.reload();
      await page.waitForSelector('.cm-content');
      await expect(gen(page)).toBeVisible();
      const id = await openChatId(page);
      await sleep(1_000);
      state.swallow = 'once';
      await expect.poll(() => state.held).toBe(1);
      await sleep(1_000);
      // Stopped from elsewhere, not through this browser.
      const response = await fetch(`${harness.url.replace(/\/$/, '')}/trpc/chat.stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: { id } }) });
      expect(response.status).toBe(200);
      const started = Date.now();
      await expect(gen(page), `reads reaching the server meanwhile: ${state.served}`).toHaveCount(0, { timeout: 60_000 });
      process.stdout.write(`generating gone ${((Date.now() - started) / 1000).toFixed(1)} s after the run ended\n`);
    });
  });
});

test.describe('tab stops', () => {
  const threadFocused = (page: Page) => expect(page.locator('.thread')).toBeFocused();
  const box = (page: Page) => page.locator('#composer');
  async function turns(page: Page, n: number) {
    await open(page, harness);
    for (let i = 1; i <= n; i++) { await sendMessage(page, `message ${i}`); await waitForTurns(page, i * 2); }
    // The read after a reply brings the real id of its message, and its activity: a selection made before it lands doesn't last.
    await expect(page.locator('.activity-log')).toHaveCount(n);
    await box(page).focus();
  }
  const walk = async (page: Page, key: string, until: (at: string) => boolean, limit = 25) => {
    const path: string[] = [];
    for (let i = 0; i < limit; i++) { await page.keyboard.press(key); const at = await focused(page); path.push(at); if (until(at)) break; }
    return path;
  };

  test('many turns with activity: Shift+Tab from the box is one stop, and only the selected turn’s summary is in the way forward', async ({ page }) => {
    await turns(page, 6);
    await page.keyboard.press('Shift+Tab');
    await threadFocused(page);
    await expect(page.locator('.turn[data-sel="true"]')).toHaveAttribute('data-kind', 'version');
    const forward = await walk(page, 'Tab', at => at.includes('composer'));
    process.stdout.write(`forward from the thread: ${forward.join(' > ')}\n`);
    // The selected turn's own row, and no other of the six.
    expect(forward.filter(at => at.startsWith('SUMMARY'))).toHaveLength(1);
    expect(forward.at(-1)).toContain('composer');
    expect(forward.length).toBeLessThan(8);
  });

  test('a selected message: Tab through its actions into its activity, nested tools, and out; Shift+Tab back the same way', async ({ page }) => {
    await turns(page, 3);
    await page.keyboard.press('ArrowUp');
    await threadFocused(page);
    await page.keyboard.press('k');
    await expect(page.locator('.turn[data-sel="true"]')).toHaveAttribute('data-kind', 'user');
    const rowLog = page.locator('.turn[data-sel="true"] + .activity-row .activity-log');
    await rowLog.locator('> summary').focus();
    await page.keyboard.press('Enter');
    await expect(rowLog).toHaveAttribute('open', '');
    const forward = await walk(page, 'Tab', at => at.includes('composer'));
    process.stdout.write(`forward from a selected message’s summary: ${forward.join(' > ')}\n`);
    expect(forward[0]).toContain('in-tool');
    expect(forward.at(-1)).toContain('composer');
    // Out of the thread and back in.
    const back = await walk(page, 'Shift+Tab', at => at.includes('thread'));
    process.stdout.write(`back from the box: ${back.join(' > ')}\n`);
    expect(back.at(-1)).toContain('thread');
  });

  test('tab can reach a selected message’s activity from the thread itself', async ({ page }) => {
    await turns(page, 2);
    await page.keyboard.press('ArrowUp');
    await threadFocused(page);
    await page.keyboard.press('k');
    await expect(page.locator('.turn[data-sel="true"]')).toHaveAttribute('data-kind', 'user');
    const path = await walk(page, 'Tab', at => at.includes('composer') || at.startsWith('SUMMARY'));
    process.stdout.write(`to the activity: ${path.join(' > ')}\n`);
    expect(path.at(-1)).toMatch(/^SUMMARY/);
  });

  test('a selection that moves while focus is on a summary doesn’t strand it: keys and Tab go on', async ({ page }) => {
    await turns(page, 2);
    await page.keyboard.press('ArrowUp');
    await threadFocused(page);
    await page.keyboard.press('k');
    await expect(page.locator('.turn[data-sel="true"]')).toHaveAttribute('data-kind', 'user');
    const summary = page.locator('.turn[data-sel="true"] + .activity-row .activity-log > summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    const held = summary.first();
    // Moves the selection without moving focus, as a script or a poll could.
    await page.locator('.turn[data-kind="user"]').first().evaluate((el: any) => el.click());
    await expect(page.locator('.turn[data-kind="user"]').first()).toHaveAttribute('data-sel', 'true');
    expect(await focused(page)).toMatch(/^SUMMARY/);
    await page.keyboard.press('Space');
    const after = await walk(page, 'Tab', at => at.includes('composer'));
    process.stdout.write(`from a summary that lost its selection: ${after.join(' > ')}\n`);
    expect(after.at(-1)).toContain('composer');
    // Having left, it isn't a stop any more: the next way back in is the thread, or the row of what is selected.
    const at = await focused(page);
    expect(at).toContain('composer');
    const back = await walk(page, 'Shift+Tab', stop => stop.includes('thread') || stop.startsWith('SUMMARY') || stop.includes('turn-action'), 3);
    process.stdout.write(`then back from the box: ${back.join(' > ')}\n`);
    expect(back.at(-1)).toMatch(/thread|^SUMMARY|turn-action/);
    expect(await held.count()).toBeGreaterThanOrEqual(0);
  });

  test('esc in the box, after a selection moved under a summary, goes to the thread as ever, and on from there', async ({ page }) => {
    await turns(page, 2);
    await page.keyboard.press('ArrowUp');
    await threadFocused(page);
    await page.keyboard.press('k');
    const summary = page.locator('.turn[data-sel="true"] + .activity-row .activity-log > summary');
    await summary.focus();
    await page.locator('.turn[data-kind="user"]').first().evaluate((el: any) => el.click());
    await box(page).focus();
    await page.keyboard.press('Escape');
    await threadFocused(page);
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).not.toBe('BODY');
  });

  test('a mouse user’s click on a summary with no selection: focus works, keys toggle, Tab goes on', async ({ page }) => {
    await turns(page, 2);
    const summary = page.locator('.activity-log > summary').first();
    await expect(summary).toHaveAttribute('tabindex', '-1');
    await summary.click();
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Enter');
    await expect(page.locator('.activity-log').first()).not.toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    expect(await focused(page)).not.toBe('BODY');
    await box(page).focus();
    await expect(summary).toHaveAttribute('tabindex', '-1');
  });

  test('during a generation: Shift+Tab reaches the stop button and then the thread, and Enter there stops', async ({ page }) => {
    await turns(page, 1);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    await box(page).focus();
    const path = await walk(page, 'Shift+Tab', at => at.includes('thread'));
    process.stdout.write(`during a generation: ${path.join(' > ')}\n`);
    expect(path.at(-1)).toContain('thread');
    // The stop button's row then holds focus, which makes its summary a stop too.
    expect(path.length).toBeLessThanOrEqual(3);
    await box(page).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(gen(page)).toHaveCount(0);
  });

  test('no turns: the thread is no stop in either direction, and focus isn’t trapped', async ({ page }) => {
    await open(page, harness);
    await box(page).focus();
    await page.keyboard.press('Shift+Tab');
    const back = await focused(page);
    expect(back).not.toContain('thread');
    expect(back).not.toBe('BODY');
    await page.keyboard.press('Tab');
    await expect(box(page)).toBeFocused();
    await page.keyboard.press('Tab');
    const on = await focused(page);
    expect(on).not.toContain('composer');
    expect(on).not.toContain('thread');
  });
});

test.describe('the placeholder turn', () => {
  /** What the server answers when its last read hangs: the id and number are placeholders. */
  const placeholder = (page: Page, onAnswer: () => void = () => undefined) => page.route(/chat\.send/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    const data = body.result.data.json;
    data.turn.id = 0;
    if (data.turn.kind === 'version') data.turn.n = 1;
    onAnswer();
    await route.fulfill({ response, json: body });
  });
  const sends = (page: Page) => { const bodies: any[] = []; page.on('request', r => { if (/chat\.send/.test(r.url())) bodies.push(r.postDataJSON()); }); return bodies; };

  test('the source, chart and lines apply; nothing shows id 0 or v1 for a later version; the re-read’s numbers win; the next resend names a real turn', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await placeholder(page);
    const zeroes: string[] = [];
    await page.exposeFunction('sawZero', (what: string) => { zeroes.push(what); });
    await page.evaluate(() => { new (globalThis as any).MutationObserver(() => { if (document.querySelector('[data-turn="0"], #turn-0')) (globalThis as any).sawZero('turn 0 in the thread'); }).observe(document.body, { subtree: true, childList: true, attributes: true }); });
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    await expect(page.locator('.version-chip')).toHaveText(['v1', 'v2']);
    await expect(page.locator('.version-chip.on')).toHaveText('v2');
    expect(zeroes).toEqual([]);
    expect(await editorText(page)).toContain('.limit(2)');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const bodies = sends(page);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await waitForTurns(page, 4);
    expect(JSON.stringify(bodies)).toMatch(/"replaceFrom":[1-9]/);
  });

  test('its re-read held: no id 0, no v1, no keys acting on it, and generating ends when the re-read lands', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    const held: Route[] = [];
    let hold = false;
    await page.route(/chat\.get/, async route => { if (hold) held.push(route); else await route.continue().catch(() => undefined); });
    await placeholder(page, () => { hold = true; });
    await sendMessage(page, 'second');
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await expect(page.locator('[data-turn="0"]')).toHaveCount(0);
    await expect.poll(() => editorText(page)).toContain('.limit(2)');
    expect(await page.locator('.version-chip').allInnerTexts()).toEqual(['v1']);
    hold = false;
    for (const route of held) await route.continue().catch(() => undefined);
    await waitForTurns(page, 4);
    await expect(page.locator('.version-chip')).toHaveText(['v1', 'v2']);
  });

  test('its re-read fails too: the version stays, the words don’t come back as unsent, and the next read shows the turn', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    let fail = false;
    await page.route(/chat\.get/, async route => { if (fail) { fail = false; await route.abort().catch(() => undefined); } else await route.continue().catch(() => undefined); });
    await placeholder(page, () => { fail = true; });
    await sendMessage(page, 'second');
    await expect.poll(() => editorText(page)).toContain('.limit(2)');
    await expect(gen(page)).toHaveCount(0);
    await sleep(500);
    await expect(page.locator('[data-turn="0"]')).toHaveCount(0);
    const words = await page.locator('#composer').inputValue();
    const shown = await page.locator('.chat-error, [role="alert"]').allInnerTexts();
    process.stdout.write(`after the re-read failed: box=${JSON.stringify(words)} errors=${JSON.stringify(shown)} turns=${await page.locator('.turn[data-turn]').count()}\n`);
    expect(words, 'the message was recorded and answered').toBe('');
  });
});
