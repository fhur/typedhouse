// Independent tester's attacks on #5-#8 and the F53 regression.
import { expect, test, type Page, type Route } from '@playwright/test';
import { editorText, open, sendMessage, startHarness, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page; the root TypeScript program has no DOM lib, on purpose.
declare const document: any;
declare const localStorage: any;

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const openChatId = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chat') as string | null);
const gets = (page: Page) => { const seen = { count: 0 }; page.on('request', r => { if (/chat\.get/.test(r.url())) seen.count++; }); return seen; };
const stopButton = (page: Page) => page.getByTestId('generating').getByRole('button', { name: /stop/ });
const turnIds = (page: Page) => page.locator('.turn[data-turn]').evaluateAll(all => all.map(e => Number(e.getAttribute('data-turn'))));

test.describe('#5 reads', () => {
  test('one read that never returns doesn’t stop polling for good', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'hang');
    await expect(page.getByTestId('generating')).toBeVisible();
    // One tick's read gets lost on its way (a socket gone quiet): it neither answers nor fails.
    let lost = 0;
    const held: Route[] = [];
    await page.route(/chat\.get/, async route => { if (lost++ === 0) held.push(route); else await route.continue().catch(() => undefined); });
    await expect.poll(() => held.length).toBe(1);
    const seen = gets(page);
    await sleep(8_000);
    expect.soft(seen.count, 'reads in the 8 s after one was lost').toBeGreaterThan(0);
    await stopButton(page).click();
    await expect(page.getByTestId('generating')).toHaveCount(0);
    // The next generation in this page, long after: it follows again.
    await sendMessage(page, 'hang');
    await expect(page.getByTestId('generating')).toBeVisible();
    const next = gets(page);
    await sleep(3_000);
    expect(next.count, 'reads during the next generation').toBeGreaterThan(0);
    await stopButton(page).click();
    await expect(page.getByTestId('generating')).toHaveCount(0);
  });

  test('a generation recovered by a reload keeps following while a read is slow, and finishes', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'slow');
    await expect(page.getByTestId('generating')).toBeVisible();
    await page.route(/chat\.get/, async route => { await sleep(1_300); await route.continue().catch(() => undefined); });
    await page.reload();
    await page.waitForSelector('.cm-content');
    await waitForTurns(page, 4);
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
  });

  for (const delay of [150, 400]) test(`switching there and back during ${delay} ms reads doesn’t leave reads chasing each other`, async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:alpha chat');
    await waitForTurns(page, 2);
    await page.keyboard.press('ControlOrMeta+Shift+l');
    await expect.poll(() => openChatId(page)).toBeNull();
    await sendMessage(page, 'say:bravo chat');
    await waitForTurns(page, 2);
    await page.route(/chat\.get/, async route => { await sleep(delay); await route.continue().catch(() => undefined); });
    const rows = page.locator('.chat-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(1).click();
    await rows.nth(0).click();
    await rows.nth(1).click();
    await rows.nth(0).click();
    await sleep(2_000);
    const seen = gets(page);
    await sleep(3_000);
    expect.soft(await page.locator('.turn[data-turn]').count(), 'turns on screen, 5 s after the last click').toBe(2);
    expect(seen.count, 'reads of a chat that isn’t generating, 2 s after the last click').toBe(0);
  });

  test('reload then an immediate send of a first-message chat keeps the chat, with a lost server read', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    const id = await openChatId(page);
    await page.route(/chat\.get/, async route => { await sleep(1_200); await route.abort().catch(() => undefined); }, { times: 1 });
    await page.reload();
    await page.waitForSelector('.cm-content');
    await sendMessage(page, 'second');
    await sleep(1_600);
    expect(await openChatId(page)).toBe(id);
    await waitForTurns(page, 4);
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
  });
});

test.describe('#6 trimming stops when the server has the branch', () => {
  /** Holds chat.send until told, while polling goes on. */
  test('retry of a later message: the new turn and live activity show during the generation', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'slow one');
    await waitForTurns(page, 4);
    const old = await turnIds(page);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.getByTestId('generating')).toBeVisible();
    await expect(page.locator('.turn[data-kind="user"][data-turn]').filter({ hasText: 'slow one' })).toHaveCount(1, { timeout: 1_500 });
    await waitForTurns(page, 4);
    expect((await turnIds(page)).length).toBe(old.length);
  });

  test('retry of the first message: its new turn shows during the generation', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'slow one');
    await waitForTurns(page, 2);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.getByTestId('generating')).toBeVisible();
    await expect(page.locator('.turn-user-pending, .turn[data-kind="user"][data-turn]')).toHaveCount(1);
    await sleep(1_000);
    // By now the poll has read the branch: nothing but this turn, one message, whichever way it is shown.
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(0);
    await expect(page.locator('.turn-user-pending, .turn[data-kind="user"][data-turn]')).toHaveCount(1);
    await waitForTurns(page, 2);
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(1);
  });

  test('the first message’s retry shows live activity from the new run', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'transparent multicall');
    await waitForTurns(page, 2);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    const live = page.getByTestId('generating');
    await expect(live).toBeVisible();
    await expect(live.locator('.activity-log > summary')).toContainText(/Searching docs|Writing query/, { timeout: 4_000 });
    await waitForTurns(page, 2);
  });

  test('another chat opened during a resend is shown whole', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'say:other one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'say:other two');
    await waitForTurns(page, 4);
    const other = await openChatId(page);
    const otherTurns = await turnIds(page);
    await page.keyboard.press('ControlOrMeta+Shift+l');
    await expect.poll(() => openChatId(page)).toBeNull();
    await sendMessage(page, 'say:resent one');
    await waitForTurns(page, 2);
    await sendMessage(page, 'say:resent two');
    await waitForTurns(page, 4);
    const mine = await turnIds(page);
    await page.route(/chat\.send/, async route => { await sleep(3_000); await route.continue().catch(() => undefined); });
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.turn[data-turn]')).toHaveCount(mine.length - 2);
    await page.locator(`.chat-row:has-text("other one")`).click();
    await expect.poll(() => openChatId(page)).toBe(other);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(otherTurns.length);
    await sleep(1_500);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(otherTurns.length);
  });

  test('a resend refused because a generation is running elsewhere: the old turns come back, and stay', async ({ page, context }) => {
    await open(page, harness);
    await sendMessage(page, 'say:one');
    await waitForTurns(page, 2);
    const second = await context.newPage();
    await second.goto(harness.url);
    await second.waitForSelector('.cm-content');
    await second.keyboard.press('ControlOrMeta+Shift+l');
    await sendMessage(second, 'hang');
    await expect(second.getByTestId('generating')).toBeVisible();
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    await expect(page.locator('.turn-user-pending')).toHaveCount(0);
    await sleep(1_000);
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    await stopButton(second).click();
    await second.close();
  });

  test('a lost server during a resend stops trimming: the next read shows what is stored', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    await page.route(/chat\.send/, route => route.abort(), { times: 1 });
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.chat-error, [role="alert"]').first()).toContainText(/Lost the server/);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await expect(page.locator('.turn[data-turn]')).toHaveCount(4);
  });
});

test.describe('#7 keys on summaries', () => {
  const log = (page: Page) => page.locator('.activity-log').last();
  const summary = (page: Page) => log(page).locator('> summary');

  test('during a generation: Enter, Space, letters and arrows only toggle or do nothing; esc still stops; keys work again on the turn', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await page.locator('.turn[data-kind="version"]').click();
    await sendMessage(page, 'hang');
    await expect(page.getByTestId('generating')).toBeVisible();
    await summary(page).focus();
    await page.keyboard.press('Enter');
    await expect(log(page)).toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(log(page)).not.toHaveAttribute('open', '');
    for (const key of ['j', 'k', 'e', 'r', 'y', 'i', 'ArrowUp', 'ArrowDown']) { await page.keyboard.press(key); await expect(summary(page)).toBeFocused(); }
    await expect(page.getByTestId('generating')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('generating')).toHaveCount(0);
  });

  test('with a turn selected and no generation: arrows leave the selection, esc gets back to the box, and from the box the thread keys work', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    await expect(page.locator('.activity-log')).toHaveCount(2);
    const version = page.locator('.turn[data-kind="version"]').last();
    await version.click();
    await expect(version).toHaveAttribute('data-sel', 'true');
    const before = await editorText(page);
    await summary(page).focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(version).toHaveAttribute('data-sel', 'true');
    await expect(summary(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#composer')).toBeFocused();
    // Leaving the thread clears its selection a moment later. A key inside that moment is lost: see the report.
    await expect(page.locator('.turn[data-sel="true"]')).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.thread')).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.locator('.turn[data-sel="true"]')).toHaveAttribute('data-kind', 'user');
    expect(await editorText(page)).toBe(before);
  });

  test('tab goes on from a summary, into the next and out to the box', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await summary(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(log(page).locator('details.activity-tool > summary').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#composer')).toBeFocused();
  });

  test('a click on a tool input’s text inside an open log doesn’t select or run anything', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await summary(page).click();
    await log(page).locator('details.activity-tool > summary').first().click();
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
  });
});

test.describe('F53 reaching the turns by keyboard', () => {
  const twoVersions = async (page: Page) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    await expect(page.locator('.activity-log')).toHaveCount(2);
    await page.locator('#composer').focus();
  };
  const focused = (page: Page) => page.evaluate(() => { const e = document.activeElement; return `${e.tagName}.${e.className}${e.closest?.('.activity-log') ? ' in-log' : ''}`; });

  test('ArrowUp from the box reaches the last turn, whatever activity there is', async ({ page }) => {
    await twoVersions(page);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.thread')).toBeFocused();
    await expect(page.locator('.turn[data-sel="true"]')).toHaveCount(1);
  });

  test('Shift+Tab from the box reaches the thread and selects the last turn, in a few stops', async ({ page }) => {
    await twoVersions(page);
    const path: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      path.push(await focused(page));
      if (await page.locator('.thread').evaluate(el => document.activeElement === el)) break;
    }
    test.info().annotations.push({ type: 'path', description: path.join(' > ') });
    process.stdout.write(`F53 path: ${path.join(' > ')}\n`);
    await expect(page.locator('.thread')).toBeFocused();
    await expect(page.locator('.turn[data-sel="true"]')).toHaveCount(1);
  });
});

test.describe('#8 more ways to send', () => {
  const words = `say:${'lots of words to scroll past '.repeat(400)}`;
  const scrolledUp = async (page: Page) => { await page.locator('.thread').evaluate(el => { el.scrollTop = 0; }); await sleep(200); };
  const atBottom = (page: Page) => page.locator('.thread').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  const longThread = async (page: Page) => { await open(page, harness); await sendMessage(page, words); await waitForTurns(page, 2); };

  test('a retry by its button, with focus left in the thread, comes back into view', async ({ page }) => {
    await longThread(page);
    await sendMessage(page, 'say:short');
    await waitForTurns(page, 4);
    await page.locator('.turn[data-kind="user"]').last().click();
    const retry = page.getByRole('button', { name: /retry/ });
    await expect(retry).toBeVisible();
    await scrolledUp(page);
    await retry.evaluate((el: any) => el.click());
    await waitForTurns(page, 4);
    await expect.poll(() => atBottom(page)).toBe(true);
  });

  test('sending by the keyboard from the box, scrolled up, in the same tick as the scroll', async ({ page }) => {
    await longThread(page);
    await page.locator('.thread').evaluate(el => { el.scrollTop = 0; });
    await sendMessage(page, 'say:short');
    await waitForTurns(page, 4);
    await expect.poll(() => atBottom(page)).toBe(true);
  });

  test('after a send, scrolling up mid-generation stays up through activity and the reply', async ({ page }) => {
    await longThread(page);
    await scrolledUp(page);
    await sendMessage(page, 'transparent multicall');
    await expect(page.getByTestId('generating')).toBeVisible();
    await sleep(300);
    await scrolledUp(page);
    await waitForTurns(page, 4);
    expect(await page.locator('.thread').evaluate(el => el.scrollTop)).toBeLessThan(100);
  });
});
