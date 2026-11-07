// Independent tester's third round: reads with their own abort, timeout and overlap.
import { createServer, request, type Server } from 'node:http';
import { expect, test, type Page, type Route } from '@playwright/test';
import { editorText, open, q1, qOnlyId, sendMessage, setEditor, startHarness, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page; the root TypeScript program has no DOM lib, on purpose.
declare const document: any;
declare const localStorage: any;

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const openChatId = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chat') as string | null);
const gen = (page: Page) => page.getByTestId('generating');
const stopButton = (page: Page) => gen(page).getByRole('button', { name: /stop/ });
const newChat = async (page: Page) => { await page.keyboard.press('ControlOrMeta+Shift+l'); await expect.poll(() => openChatId(page)).toBeNull(); };
const row = (page: Page, text: string) => page.locator('.chat-row').filter({ hasText: text });
const alert = (page: Page) => page.locator('.chat-error');
const turns = (page: Page) => page.locator('.turn[data-turn]');
const countGets = (page: Page) => { const seen = { count: 0 }; page.on('request', r => { if (/chat\.get/.test(r.url())) seen.count++; }); return seen; };
const sendBodies = (page: Page) => { const bodies: any[] = []; page.on('request', r => { if (/chat\.send/.test(r.url())) bodies.push(r.postDataJSON()); }); return bodies; };
/** chat.get answers nothing, or fails at once. */
const loseReads = (page: Page) => page.route(/chat\.get/, () => undefined);
const failReads = (page: Page) => page.route(/chat\.get/, route => route.abort());
const allowReads = (page: Page) => page.unroute(/chat\.get/);

async function twoChats(page: Page) {
  await open(page, harness);
  await sendMessage(page, 'first alphachat');
  await waitForTurns(page, 2);
  const a = (await openChatId(page))!;
  await newChat(page);
  await sendMessage(page, `src:${qOnlyId}`);
  await waitForTurns(page, 2);
  return { a, b: (await openChatId(page))! };
}

test.describe('the guessed user turn in the page', () => {
  test('reads lost during a send: retry on the guessed turn is refused, nothing is lost, and the read puts it right', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await loseReads(page);
    const bodies = sendBodies(page);
    await sendMessage(page, 'second');
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
    await expect(gen(page)).toHaveCount(0);
    const before = await editorText(page);
    const guess = page.locator('.turn[data-kind="user"]').last();
    await expect(guess).toContainText('second');
    await guess.click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(alert(page)).toContainText(/is not a message of this chat|not a message/);
    expect(bodies.at(-1).json?.replaceFrom ?? bodies.at(-1).replaceFrom).toEqual(expect.any(Number));
    await allowReads(page);
    await expect(turns(page)).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.version-chip')).toHaveText(['v1', 'v2']);
    process.stdout.write(`refused retry: box=${JSON.stringify(await page.locator('#composer').inputValue())} editorSame=${(await editorText(page)) === before}\n`);
  });

  test('reads lost during a send: edit and resend of the guessed turn is refused, and the words stay', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await loseReads(page);
    await sendMessage(page, 'second');
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
    await expect(gen(page)).toHaveCount(0);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await expect(page.locator('#composer')).toHaveValue('second');
    await page.fill('#composer', 'rewritten words');
    await page.press('#composer', 'Enter');
    await expect(alert(page)).toContainText(/not a message/);
    await expect(page.locator('#composer')).toHaveValue(/rewritten words/);
    await allowReads(page);
    await expect(turns(page)).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.turn-user-text').filter({ hasText: /^second$/ })).toHaveCount(1);
  });

  test('a placeholder reply with reads lost: version applies, generating ends, and the read brings the turn', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await loseReads(page);
    await page.route(/chat\.send/, async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.result.data.json.turn.id = 0;
      body.result.data.json.turn.n = 1;
      await route.fulfill({ response, json: body });
    });
    await sendMessage(page, 'second');
    await expect.poll(() => editorText(page)).toContain('.limit(2)');
    await expect(gen(page)).toHaveCount(0);
    await expect(page.locator('[data-turn="0"]')).toHaveCount(0);
    await page.unroute(/chat\.send/);
    await allowReads(page);
    await expect(turns(page)).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('.version-chip')).toHaveText(['v1', 'v2']);
  });
});

test.describe('opening a chat while reads fail', () => {
  test('a hand edit kept in the browser survives typing while the server is away', async ({ page }) => {
    const { a } = await twoChats(page);
    await row(page, 'alphachat').click();
    await expect.poll(() => openChatId(page)).toBe(a);
    await expect(turns(page)).toHaveCount(2);
    await setEditor(page, `${q1} // MY HAND EDIT`);
    await expect.poll(() => editorText(page)).toContain('MY HAND EDIT');
    await row(page, 'src:').click();
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await failReads(page);
    await row(page, 'alphachat').click();
    await expect.poll(() => openChatId(page)).toBe(a);
    await sleep(600);
    // The server is away, and this chat shows nothing yet. The browser has its text: it needs no server.
    expect(await editorText(page), 'the editor shows the open chat’s own copy').toContain('MY HAND EDIT');
    await setEditor(page, 'typed while the server is away');
    await allowReads(page);
    await expect(turns(page)).toHaveCount(2, { timeout: 15_000 });
  });

  test('typing in the editor there must not cost the chat its kept text', async ({ page }) => {
    const { a } = await twoChats(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await setEditor(page, `${q1} // MY HAND EDIT`);
    await expect.poll(() => editorText(page)).toContain('MY HAND EDIT');
    await row(page, 'src:').click();
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await failReads(page);
    await row(page, 'alphachat').click();
    await expect.poll(() => openChatId(page)).toBe(a);
    await sleep(600);
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' // more');
    await sleep(200);
    const kept = await page.evaluate(k => localStorage.getItem(`typedhouse-studio:editor:${k}`), a);
    await allowReads(page);
    await expect(turns(page)).toHaveCount(2, { timeout: 15_000 });
    expect(kept, 'the chat’s kept text after typing').toContain('MY HAND EDIT');
    expect(await editorText(page)).toContain('MY HAND EDIT');
  });

  test('a send in that state carries the open chat’s source, not the last chat’s', async ({ page }) => {
    const { a } = await twoChats(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await setEditor(page, `${q1} // MY HAND EDIT`);
    await expect.poll(() => editorText(page)).toContain('MY HAND EDIT');
    await row(page, 'src:').click();
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await failReads(page);
    const bodies = sendBodies(page);
    await row(page, 'alphachat').click();
    await expect.poll(() => openChatId(page)).toBe(a);
    await sleep(600);
    await sendMessage(page, 'say:with what source');
    await expect.poll(() => bodies.length).toBe(1);
    const source = bodies[0].json?.source ?? bodies[0].source;
    expect(source).toContain('MY HAND EDIT');
  });
});

test.describe('a lost startup read', () => {
  const reload = async (page: Page) => { await page.reload(); await page.waitForSelector('.cm-content'); };

  test('reads failing at load: the page comes back by itself once they answer', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await failReads(page);
    await reload(page);
    await expect(alert(page)).toBeVisible();
    await sleep(500);
    await allowReads(page);
    await expect(turns(page), 'R13: chats survive a reload').toHaveCount(2, { timeout: 15_000 });
    await expect(alert(page)).toHaveCount(0);
  });

  test('a read lost at load: after the timeout the page comes back by itself', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await loseReads(page);
    await reload(page);
    await expect(alert(page)).toBeVisible({ timeout: 16_000 });
    await allowReads(page);
    await expect(turns(page), 'R13: chats survive a reload').toHaveCount(2, { timeout: 15_000 });
  });

  test('after one, the page is usable: another chat opens, and a send works', async ({ page }) => {
    const { b } = await twoChats(page);
    await failReads(page);
    await reload(page);
    await expect(alert(page)).toBeVisible();
    expect(await openChatId(page)).toBe(b);
    await allowReads(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await expect(alert(page)).toHaveCount(0);
    await sendMessage(page, 'say:still works');
    await expect(turns(page)).toHaveCount(4);
  });
});

test.describe('“Could not load this chat”', () => {
  test('a read that fails says so, and it clears when one lands', async ({ page }) => {
    await twoChats(page);
    await failReads(page);
    await row(page, 'alphachat').click();
    await expect(alert(page)).toContainText('Could not load this chat, trying again:');
    await allowReads(page);
    await expect(turns(page)).toHaveCount(2, { timeout: 10_000 });
    await expect(alert(page)).toHaveCount(0);
  });

  test('another error isn’t cleared by a landing', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await page.route(/chat\.send/, route => route.abort(), { times: 1 });
    await sendMessage(page, 'second');
    await expect(alert(page)).toContainText('Lost the server');
    await sleep(800);
    await expect(alert(page)).toContainText('Lost the server');
  });

  test('reads that never answer say so, and it clears when they do', async ({ page }) => {
    test.setTimeout(60_000);
    await twoChats(page);
    await loseReads(page);
    await row(page, 'alphachat').click();
    await expect(alert(page), 'with every read lost, 20 s after opening').toContainText('Could not load this chat', { timeout: 20_000 });
    await expect(turns(page)).toHaveCount(0);
    await allowReads(page);
    await expect(turns(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(alert(page)).toHaveCount(0);
  });

  test('reads slower than the timeout say so too, and never land', async ({ page }) => {
    test.setTimeout(60_000);
    await twoChats(page);
    await page.route(/chat\.get/, async route => { await sleep(14_000); await route.continue().catch(() => undefined); });
    await row(page, 'alphachat').click();
    await expect(alert(page), 'reads taking 14 s, 22 s after opening').toContainText('Could not load this chat', { timeout: 22_000 });
    await expect(turns(page)).toHaveCount(0);
  });
});

test.describe('overlapping reads', () => {
  test('an older response arriving after a newer one doesn’t overwrite it', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(gen(page)).toBeVisible();
    // The first tick's answer is taken now, and delivered long after the rest: it still says "generating".
    let first = true;
    const late: (() => Promise<void>)[] = [];
    await page.route(/chat\.get/, async route => {
      if (first) { first = false; const response = await route.fetch(); late.push(() => route.fulfill({ response }).catch(() => undefined)); return; }
      await route.continue().catch(() => undefined);
    });
    await expect.poll(() => late.length).toBe(1);
    await sleep(4_500); // a second read goes out beside it, and generating still shows
    await stopButton(page).click();
    await expect(gen(page)).toHaveCount(0);
    await expect(page.locator('.turn[data-kind="note"]')).toHaveCount(1);
    await late[0]!();
    await sleep(800);
    await expect(gen(page)).toHaveCount(0);
    await expect(page.locator('.turn[data-kind="note"]')).toHaveCount(1);
  });

  test('a slow read beside a newer one may land first, and the newer still lands after', async ({ page, context }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(gen(page)).toBeVisible();
    await page.route(/chat\.get/, async route => { await sleep(6_000); await route.continue().catch(() => undefined); });
    await sleep(500);
    const other = await context.newPage();
    await other.goto(harness.url);
    await stopButton(other).click();
    await expect(gen(other)).toHaveCount(0);
    await other.close();
    await expect(gen(page), 'reads of 6 s, beside each other').toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.turn[data-kind="note"]')).toHaveCount(1);
  });

  test('a read out before a resend can’t bring the replaced turn back (#6)', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    // A slow answer taken before the resend, with the old turns in it, arriving during it.
    const late: (() => Promise<void>)[] = [];
    await page.route(/chat\.get/, async route => {
      const response = await route.fetch();
      late.push(() => route.fulfill({ response }).catch(() => undefined));
    });
    await page.route(/chat\.send/, async route => { await sleep(2_000); await route.continue().catch(() => undefined); });
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(turns(page)).toHaveCount(2);
    for (const deliver of late.splice(0)) await deliver();
    await sleep(700);
    await expect(page.locator('.turn[data-kind="version"]:has-text("Step 2 of this chat.")')).toHaveCount(0);
    await page.unroute(/chat\.get/);
    await waitForTurns(page, 4);
    for (const deliver of late.splice(0)) await deliver();
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
  });

  test('aborts never surface: quick switching, sends and stops show no error and throw nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await twoChats(page);
    await page.route(/chat\.get/, async route => { await sleep(300); await route.continue().catch(() => undefined); });
    for (let i = 0; i < 4; i++) { await row(page, 'alphachat').click(); await row(page, 'src:').click(); }
    await expect(turns(page)).toHaveCount(2);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    await row(page, 'alphachat').click();
    await row(page, 'src:').click();
    await expect(gen(page)).toBeVisible();
    await stopButton(page).click();
    await expect(gen(page)).toHaveCount(0);
    await sleep(700);
    await expect(alert(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('polling', () => {
  test('it stops once idle, after a send and after opening a chat', async ({ page }) => {
    await twoChats(page);
    const seen = countGets(page);
    await sleep(1_500);
    expect(seen.count, 'after a send').toBe(0);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await sleep(300);
    const after = seen.count;
    await sleep(2_000);
    expect(seen.count, 'after opening').toBe(after);
  });

  test('a generation in another chat: the open idle chat isn’t polled, the reply is there on return', async ({ page }) => {
    await twoChats(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await sendMessage(page, 'slow second');
    await expect(gen(page)).toBeVisible();
    await row(page, 'src:').click();
    await expect(turns(page)).toHaveCount(2);
    await sleep(300);
    const seen = countGets(page);
    await sleep(1_200);
    expect(seen.count, 'reads of the idle chat').toBe(0);
    await expect(page.locator('.chat-row[data-generating="true"]')).toHaveCount(0, { timeout: 10_000 });
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(4);
    await expect.poll(() => editorText(page)).toContain('.limit(2)');
  });

  test('type checks keep answering during a generation with its reads lost', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(gen(page)).toBeVisible();
    await loseReads(page);
    await sleep(4_500);
    const checked = page.waitForResponse(/types\./, { timeout: 8_000 });
    await setEditor(page, 'export default from(no_such_table)');
    expect((await checked).ok()).toBe(true);
    await stopButton(page).click();
    await expect(gen(page)).toHaveCount(0);
  });

  /** Real connections: a proxy that swallows chat.get. */
  async function viaProxy(page: Page, work: (state: { swallow: boolean; open: number; max: number; stops: number; base: string }) => Promise<void>) {
    const target = new URL(harness.url);
    const state = { swallow: false, open: 0, max: 0, stops: 0, base: '' };
    const sockets = new Set<any>();
    const proxy: Server = createServer((req, res) => {
      if (req.url?.includes('chat.stop')) state.stops++;
      if (state.swallow && req.url?.includes('chat.get')) {
        state.open++;
        state.max = Math.max(state.max, state.open);
        res.on('close', () => { state.open--; });
        req.resume();
        return;
      }
      const out = request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, upstream => { res.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(res); });
      out.on('error', () => res.destroy());
      req.pipe(out);
    });
    proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(proxy.address() as { port: number }).port}/`;
    try { await work(state); } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => proxy.close(resolve));
    }
  }

  test('sustained loss over real sockets: a few reads held, Stop gets through, and the page follows again after', async ({ page }) => {
    test.setTimeout(120_000);
    await viaProxy(page, async state => {
      await page.goto(state.base);
      await page.waitForSelector('.cm-content');
      await sendMessage(page, 'first');
      await waitForTurns(page, 2);
      await sendMessage(page, 'hang');
      await expect(gen(page)).toBeVisible();
      state.swallow = true;
      await sleep(40_000);
      process.stdout.write(`after 40 s of loss: ${state.open} open, at most ${state.max}\n`);
      expect(state.max).toBeLessThanOrEqual(4);
      await stopButton(page).click();
      await expect.poll(() => state.stops, { timeout: 5_000 }).toBeGreaterThan(0);
      await expect(gen(page)).toHaveCount(0, { timeout: 5_000 });
      state.swallow = false;
      await expect(page.locator('.turn[data-kind="note"]')).toHaveCount(1, { timeout: 15_000 });
    });
  });

  test('one read lost over a real socket, following by polling alone: the page sees the run end quickly', async ({ page }) => {
    test.setTimeout(90_000);
    await viaProxy(page, async state => {
      await page.goto(state.base);
      await page.waitForSelector('.cm-content');
      await sendMessage(page, 'first');
      await waitForTurns(page, 2);
      await sendMessage(page, 'hang');
      await expect(gen(page)).toBeVisible();
      await page.reload();
      await page.waitForSelector('.cm-content');
      await expect(gen(page)).toBeVisible();
      const id = await openChatId(page);
      state.swallow = true;
      await expect.poll(() => state.max).toBeGreaterThan(0);
      state.swallow = false;
      const response = await fetch(`${harness.url.replace(/\/$/, '')}/trpc/chat.stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: { id } }) });
      expect(response.status).toBe(200);
      await expect(gen(page)).toHaveCount(0, { timeout: 12_000 });
    });
  });

  test('two tabs following under loss: Stop still gets through', async ({ page, context }) => {
    test.setTimeout(120_000);
    await viaProxy(page, async state => {
      await page.goto(state.base);
      await page.waitForSelector('.cm-content');
      await sendMessage(page, 'first');
      await waitForTurns(page, 2);
      await sendMessage(page, 'hang');
      await expect(gen(page)).toBeVisible();
      const second = await context.newPage();
      await second.goto(state.base);
      await expect(gen(second)).toBeVisible();
      state.swallow = true;
      await sleep(30_000);
      process.stdout.write(`two tabs, after 30 s of loss: ${state.open} open, at most ${state.max}\n`);
      const clicked = Date.now();
      await stopButton(second).click();
      await expect.poll(() => state.stops, { timeout: 20_000 }).toBeGreaterThan(0);
      process.stdout.write(`stop reached the server ${((Date.now() - clicked) / 1000).toFixed(1)} s after the click\n`);
      state.swallow = false;
      await second.close();
    });
  });
});
