// Independent tester's fourth round: what the browser keeps, startup follow-ups, a refused retry.
import { expect, test, type Page } from '@playwright/test';
import { editorText, open, q1, qOnlyId, sendMessage, setEditor, startHarness, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page; the root TypeScript program has no DOM lib, on purpose.
declare const localStorage: any;

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const openChatId = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chat') as string | null);
const storedChart = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chart-spec'));
const copyOf = (page: Page, id: string) => page.evaluate(k => localStorage.getItem(`typedhouse-studio:editor:${k}`), id);
const forget = (page: Page, id: string) => page.evaluate(k => { localStorage.removeItem(`typedhouse-studio:editor:${k}`); localStorage.removeItem(`typedhouse-studio:chart:${k}`); }, id);
const gen = (page: Page) => page.getByTestId('generating');
const stopButton = (page: Page) => gen(page).getByRole('button', { name: /stop/ });
const newChat = async (page: Page) => { await page.keyboard.press('ControlOrMeta+Shift+l'); await expect.poll(() => openChatId(page)).toBeNull(); };
const row = (page: Page, text: string) => page.locator('.chat-row').filter({ hasText: text });
const alert = (page: Page) => page.locator('.chat-error');
const turns = (page: Page) => page.locator('.turn[data-turn]');
const sendBodies = (page: Page) => { const bodies: any[] = []; page.on('request', r => { if (/chat\.send/.test(r.url())) bodies.push(r.postDataJSON()); }); return bodies; };
const reload = async (page: Page) => { await page.reload(); await page.waitForSelector('.cm-content'); };
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

test.describe('what the browser keeps', () => {
  test('open restores the hand edit at once, with the read out; typing then keeps it, and the landing changes nothing', async ({ page }) => {
    const { a } = await twoChats(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await setEditor(page, `${q1} // HAND`);
    await expect.poll(() => editorText(page)).toContain('HAND');
    await row(page, 'src:').click();
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await page.route(/chat\.get/, async route => { await sleep(1_500); await route.continue().catch(() => undefined); });
    await row(page, 'alphachat').click();
    await expect.poll(() => editorText(page), { timeout: 500 }).toContain('HAND');
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' // AND MORE');
    await expect(turns(page)).toHaveCount(2);
    await sleep(200);
    expect(await editorText(page)).toContain('HAND');
    expect(await editorText(page)).toContain('AND MORE');
    expect(await copyOf(page, a)).toContain('AND MORE');
  });

  test('a newer version from another browser: a real hand edit is kept, the thread shows the new one, and it is one key away', async ({ page, browser }) => {
    const { a } = await twoChats(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await setEditor(page, `${q1} // HAND`);
    await expect.poll(() => editorText(page)).toContain('HAND');
    await row(page, 'src:').click();
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    const elsewhere = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await elsewhere.newPage();
      await open(other, harness);
      await row(other, 'alphachat').click();
      await expect(turns(other)).toHaveCount(2);
      await sendMessage(other, 'second');
      await waitForTurns(other, 4);
    } finally { await elsewhere.close(); }
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(4);
    await expect(page.locator('.version-chip')).toHaveText(['v1', 'v2']);
    expect(await editorText(page), 'the hand edit').toContain('HAND');
    await expect(page.locator('.version-chip.on')).toHaveCount(0);
    expect(await copyOf(page, a)).toContain('HAND');
    await page.locator('.turn-version').last().click();
    await page.getByRole('button', { name: /restore & run/ }).click();
    await expect.poll(() => editorText(page)).toContain('.limit(');
  });

  test('a chat with no browser copy takes its newest version when the read lands', async ({ page }) => {
    const { a } = await twoChats(page);
    await forget(page, a);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await expect.poll(() => editorText(page)).toBe(q1);
  });

  test('a reply that arrived while away, from before a reload: it is applied on return', async ({ page }) => {
    await twoChats(page);
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(2);
    await sendMessage(page, 'slow second');
    await expect(gen(page)).toBeVisible();
    await reload(page);
    await row(page, 'src:').click();
    await expect.poll(() => editorText(page)).toBe(qOnlyId);
    await expect(page.locator('.chat-row[data-generating="true"]')).toHaveCount(0, { timeout: 10_000 });
    await row(page, 'alphachat').click();
    await expect(turns(page)).toHaveCount(4);
    await expect.poll(() => editorText(page)).toContain('.limit(2)');
  });

  // Pinned, reported as non-blocking: it takes no copy in this browser AND reads that fail.
  test('the Worker’s limit: no browser copy and failing reads: the last chat’s query shows, beside the error; typing keeps it over the read', async ({ page }) => {
    const { a } = await twoChats(page);
    await forget(page, a);
    await failReads(page);
    const bodies = sendBodies(page);
    await row(page, 'alphachat').click();
    await expect.poll(() => openChatId(page)).toBe(a);
    await expect(alert(page)).toContainText('Could not load this chat');
    expect(await editorText(page)).toBe(qOnlyId);
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' // typed');
    await sleep(200);
    expect(await copyOf(page, a)).toContain('only_id');
    await sendMessage(page, 'say:with what source');
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].json?.source ?? bodies[0].source).toContain('only_id');
    await allowReads(page);
    await expect(page.locator('.turn-text').filter({ hasText: 'with what source' })).toHaveCount(1, { timeout: 15_000 });
    expect(await editorText(page)).toContain('only_id');
  });
});

test.describe('startup follow-ups', () => {
  test('reads failing at load: an unknown chat is still forgotten when one lands', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await failReads(page);
    await reload(page);
    await expect(alert(page)).toBeVisible();
    await allowReads(page);
    await page.route(/chat\.get/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { data: { json: null } } }) }));
    await expect.poll(() => openChatId(page), { timeout: 15_000 }).toBeNull();
    await expect(alert(page)).toHaveCount(0);
  });

  test('reads failing at load: a pending reply is applied when one lands', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'slow second');
    await expect(gen(page)).toBeVisible();
    await failReads(page);
    await reload(page);
    await expect(alert(page)).toBeVisible();
    await sleep(3_500); // the reply lands on the server meanwhile
    expect(await editorText(page)).not.toContain('.limit(2)');
    await allowReads(page);
    await expect(turns(page)).toHaveCount(4, { timeout: 15_000 });
    await expect.poll(() => editorText(page)).toContain('.limit(2)');
    await expect(alert(page)).toHaveCount(0);
  });

  test('reads failing at load: an edit of a message that is gone is dropped when one lands, and its words stay', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await expect(page.locator('.chat-editing')).toBeVisible();
    await page.fill('#composer', 'my rewritten words');
    await sleep(150);
    await page.evaluate(() => {
      const edits = JSON.parse(localStorage.getItem('typedhouse-studio:edit'));
      for (const key of Object.keys(edits)) edits[key].turn = 999_999;
      localStorage.setItem('typedhouse-studio:edit', JSON.stringify(edits));
    });
    await failReads(page);
    await reload(page);
    await expect(alert(page)).toBeVisible();
    await expect(page.locator('.chat-editing')).toBeVisible();
    await allowReads(page);
    await expect(turns(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('.chat-editing')).toHaveCount(0);
    await expect(page.locator('#composer')).toHaveValue('my rewritten words');
  });
});

test.describe('a retry that doesn’t go', () => {
  const withChart = async (page: Page) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'chart');
    await waitForTurns(page, 4);
    await setEditor(page, `${q1} // HAND`);
    await expect.poll(() => editorText(page)).toContain('HAND');
    return (await storedChart(page))!;
  };

  test('refused: the editor and chart go back, hand edit included, and the words are offered again', async ({ page, context }) => {
    const chart = await withChart(page);
    expect(chart).toBeTruthy();
    const second = await context.newPage();
    await second.goto(harness.url);
    await second.waitForSelector('.cm-content');
    await second.keyboard.press('ControlOrMeta+Shift+l');
    await sendMessage(second, 'hang');
    await expect(gen(second)).toBeVisible();
    await page.locator('.turn[data-kind="user"]').first().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(alert(page)).toContainText(/already running/);
    await expect.poll(() => editorText(page)).toContain('HAND');
    expect(await storedChart(page)).toBe(chart);
    await expect(turns(page)).toHaveCount(4);
    await stopButton(second).click();
    await second.close();
  });

  test('no answer: the editor keeps what the retry sent, since it may have gone through', async ({ page }) => {
    await withChart(page);
    const firstSource = q1;
    await page.route(/chat\.send/, route => route.abort(), { times: 1 });
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(alert(page)).toContainText('Lost the server');
    await sleep(200);
    expect(await editorText(page)).toBe(firstSource);
  });
});
