// Regressions for the review of the agent exploration tools (bfaf90a): #5 stale reads, #6 resends, #7 activity keys, #8 scrolling.
import { expect, test, type Page } from '@playwright/test';
import { editorText, open, q1, sendMessage, setEditor, startHarness, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page; the root TypeScript program has no DOM lib, on purpose.
declare const document: any;
declare const localStorage: any;

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const slow = (page: Page, procedure: RegExp, ms: number) => page.route(procedure, async route => { await sleep(ms); await route.continue().catch(() => undefined); });
const openChatId = (page: Page) => page.evaluate(() => localStorage.getItem('typedhouse-studio:chat') as string | null);

test.describe('#5 a superseded read says nothing about the chat', () => {
  test('sending while the read after a reload is on its way keeps the chat', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    const id = await openChatId(page);
    await slow(page, /chat\.get/, 1_500);
    const read = page.waitForRequest(/chat\.get/);
    await page.reload();
    await page.waitForSelector('.cm-content');
    await read;
    await sendMessage(page, 'second');
    await sleep(2_000);
    expect(await openChatId(page)).toBe(id);
    await expect(page.locator('.turn[data-kind="user"][data-turn]')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
  });

  test('polling a generating chat doesn’t cost its slow first read: the editor still comes back', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await expect.poll(() => editorText(page)).toBe(q1);
    const id = (await openChatId(page))!;
    await sendMessage(page, 'hang');
    await expect(page.getByTestId('generating')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+l');
    await expect.poll(() => openChatId(page)).toBeNull();
    await setEditor(page, '// something else');
    await page.evaluate(key => localStorage.removeItem(key), `typedhouse-studio:editor:${id}`);
    await slow(page, /chat\.get/, 1_300);
    await page.locator('.chat-row[data-generating="true"]').click();
    await expect.poll(() => openChatId(page)).toBe(id);
    await expect.poll(() => editorText(page), { timeout: 8_000 }).toBe(q1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.getByTestId('generating').getByRole('button', { name: /stop/ }).click();
    await expect(page.getByTestId('generating')).toHaveCount(0);
  });
});

test.describe('#6 a resend stays optimistic until the server has the branch', () => {
  const watch = async (page: Page, ms: number, oldReply: string) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      expect(await page.locator(`.turn[data-kind="version"]:has-text("${oldReply}")`).count()).toBe(0);
      await expect(page.locator('.turn-user-pending')).toHaveCount(1);
      await sleep(100);
    }
  };

  test('retry doesn’t bring back the replaced turn, or lose the pending message', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    await slow(page, /chat\.send/, 1_800);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    await watch(page, 1_400, 'Step 2 of this chat.');
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    await waitForTurns(page, 4);
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(2);
    await expect(page.locator('.turn-user-pending')).toHaveCount(0);
  });

  test('retry of a chat’s first message, which starts a new conversation', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await slow(page, /chat\.send/, 1_800);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.turn[data-turn]')).toHaveCount(0);
    await watch(page, 1_400, 'Step 1 of this chat.');
    await waitForTurns(page, 2);
    await expect(page.locator('.turn[data-kind="version"]')).toHaveCount(1);
  });

  test('edit and resend shows the new words, not the old turn', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await sendMessage(page, 'second');
    await waitForTurns(page, 4);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await slow(page, /chat\.send/, 1_800);
    await sendMessage(page, 'rewritten');
    await expect(page.locator('.turn-user-pending')).toContainText('rewritten');
    await watch(page, 1_400, 'Step 2 of this chat.');
    await expect(page.locator('.turn-user-text').filter({ hasText: /^second$/ })).toHaveCount(0);
    await waitForTurns(page, 4);
    await expect(page.locator('.turn-user-text').filter({ hasText: /^rewritten$/ })).toHaveCount(1);
  });

  test('a resend the server refuses puts the old turns back', async ({ page }) => {
    await open(page, harness);
    await sendMessage(page, 'first');
    await waitForTurns(page, 2);
    await page.route(/chat\.send/, route => route.abort());
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /retry/ }).click();
    await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
    await expect(page.locator('.turn-user-pending')).toHaveCount(0);
  });
});

test('#7 keys on an activity summary only toggle it', async ({ page }) => {
  await open(page, harness);
  await sendMessage(page, 'first');
  await waitForTurns(page, 2);
  const before = await editorText(page);
  await page.locator('.turn[data-kind="version"]').click();
  await expect(page.locator('.turn[data-kind="version"]')).toHaveAttribute('data-sel', 'true');
  const log = page.locator('.activity-log');
  const summary = log.locator('> summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(log).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(log).not.toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(log).toHaveAttribute('open', '');
  for (const key of ['j', 'k', 'e', 'r', 'y', 'i']) {
    await page.keyboard.press(key);
    await expect(summary).toBeFocused();
  }
  await expect(page.locator('.turn[data-kind="version"]')).toHaveAttribute('data-sel', 'true');
  // No restore note, no edit under way, no resend, nothing copied.
  await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
  await expect(page.locator('.turn[data-editing]')).toHaveCount(0);
  await expect(page.locator('#composer')).toHaveValue('');
  expect(await editorText(page)).toBe(before);
  // The same on a tool inside it.
  const tool = log.locator('details.activity-tool').first();
  await tool.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(tool).toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(tool).not.toHaveAttribute('open', '');
  await expect(page.locator('.turn[data-turn]')).toHaveCount(2);
});

test.describe('#8 sending brings the reply into view', () => {
  const words = `say:${'lots of words to scroll past '.repeat(400)}`;
  // Waits for the browser's own scroll event: a send right after it would otherwise see it arrive late.
  const scrolledUp = async (page: Page) => {
    await page.locator('.thread').evaluate(el => { el.scrollTop = 0; });
    await sleep(200);
  };
  const atBottom = (page: Page) => page.locator('.thread').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  const longThread = async (page: Page) => {
    await open(page, harness);
    await sendMessage(page, words);
    await waitForTurns(page, 2);
  };

  test('a new message, after scrolling up, including while it generates', async ({ page }) => {
    await longThread(page);
    await scrolledUp(page);
    expect(await atBottom(page)).toBe(false);
    await sendMessage(page, 'hang');
    await expect(page.getByTestId('generating')).toBeInViewport();
    await expect(page.getByTestId('generating').getByRole('button', { name: /stop/ })).toBeInViewport();
    await page.getByTestId('generating').getByRole('button', { name: /stop/ }).click();
    await expect(page.getByTestId('generating')).toHaveCount(0);
  });

  test('scrolling up during a generation is still respected', async ({ page }) => {
    await longThread(page);
    await sendMessage(page, 'slow');
    await expect(page.getByTestId('generating')).toBeVisible();
    await scrolledUp(page);
    await waitForTurns(page, 4);
    expect(await page.locator('.thread').evaluate(el => el.scrollTop)).toBeLessThan(100);
  });

  test('retry', async ({ page }) => {
    await longThread(page);
    await sendMessage(page, 'say:short');
    await waitForTurns(page, 4);
    await page.locator('.turn[data-kind="user"]').last().click();
    await expect(page.getByRole('button', { name: /retry/ })).toBeVisible();
    await scrolledUp(page);
    await page.keyboard.press('r');
    await expect.poll(() => page.locator('.turn[data-turn]').count()).toBe(4);
    await waitForTurns(page, 4);
    await expect.poll(() => atBottom(page)).toBe(true);
  });

  test('edit and resend', async ({ page }) => {
    await longThread(page);
    await sendMessage(page, 'say:short');
    await waitForTurns(page, 4);
    await page.locator('.turn[data-kind="user"]').last().click();
    await page.getByRole('button', { name: /edit & resend/ }).click();
    await scrolledUp(page);
    await page.locator('#composer').focus();
    await page.press('#composer', 'Enter');
    await waitForTurns(page, 4);
    await expect.poll(() => atBottom(page)).toBe(true);
  });
});
