// The chat layout at real widths, in light and dark. Measures what can be measured; SHOTS_DIR also keeps screenshots to compare with Chat.dc.html.
import { expect, test, type Page } from '@playwright/test';
import { open, sendMessage, startHarness, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page. The root TypeScript program has no DOM lib, on purpose, so only what these callbacks use is declared.
declare const document: any; declare const innerWidth: number; declare const innerHeight: number;
let harness: Harness;
test.beforeAll(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterAll(async () => { await harness?.stop(); });
const longName = `A very long chat name about revenue by country and everything else that a person might type here ${'x'.repeat(60)}`;

async function fill(page: Page) {
  await open(page, harness);
  if (await page.locator('.chat-row', { hasText: 'A very long' }).count()) {
    await page.locator('.chat-row', { hasText: 'A very long' }).click();
    // The chat's source is in place only once its thread is: a run before that runs what was there before.
    await expect(page.locator('.turn-version').first()).toBeVisible();
    await page.waitForTimeout(100);
    return;
  }
  await sendMessage(page, longName);
  await waitForTurns(page, 2);
  await sendMessage(page, 'retry please');
  await waitForTurns(page, 4);
  await sendMessage(page, 'say:A question back: which table do you mean?');
  await waitForTurns(page, 6);
  await sendMessage(page, 'fail');
  await waitForTurns(page, 8);
  await sendMessage(page, 'src:export default from(entity_ots_component).map(c => ({ a_very_long_column_name_number_one: c.entityId, a_very_long_column_name_number_two: c.state, a_very_long_column_name_number_three: c.updatedAt, a_very_long_column_name_number_four: c.countOfParts }))');
  await waitForTurns(page, 10);
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, 1000, 900, 700]) {
    test(`${width} px ${scheme}: nothing is cut off the page`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: width === 700 ? 800 : 900 });
      await fill(page);
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(400);
      // SHOTS_DIR keeps pictures of every zone and the ? dialog, to compare by eye with Chat.dc.html.
      const shots = process.env['SHOTS_DIR'];
      if (shots) {
        const shot = (zone: string) => page.screenshot({ path: `${shots}/${width}-${scheme}-${zone}.png` });
        await page.locator('#composer').focus();
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(100);
        await shot('box');
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        await page.keyboard.press('k');
        await page.waitForTimeout(100);
        await shot('thread');
        await page.keyboard.press('?');
        await page.waitForTimeout(100);
        await shot('help');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+e');
        await page.waitForTimeout(100);
        await shot('editor');
        await page.locator('#composer').focus();
      }
      // Below 1000 px the panes stack and scroll, as they did before the chat: the results are there, one scroll down.
      await page.locator('.results').scrollIntoViewIfNeeded();
      const results = await page.locator('.results').boundingBox();
      expect(results!.height).toBeGreaterThan(100);
      expect(results!.x + results!.width).toBeLessThanOrEqual(width + 1);
      await page.locator('.composer').scrollIntoViewIfNeeded();
      const measure = await page.evaluate(() => {
        const within = (selector: string) => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.top >= -1 : false; };
        const composer = document.querySelector('.composer')!.getBoundingClientRect();
        return { pageOverflow: document.documentElement.scrollWidth - innerWidth, pageScrollY: document.documentElement.scrollHeight - innerHeight, composer: within('.composer'), composerHeight: composer.height, threadHeight: document.querySelector('.thread')!.getBoundingClientRect().height, sideRowOverflow: [...document.querySelectorAll('.chat-row')].filter(e => e.getBoundingClientRect().right > (document.querySelector('.shell-side')?.getBoundingClientRect().right ?? 0) + 1).length, rowTypeInside: (() => { const head = document.querySelector('.editor-head')!.getBoundingClientRect(); const row = document.querySelector('.row-type')?.getBoundingClientRect(); return !row || row.right <= head.right + 1; })() };
      });
      expect(measure, JSON.stringify(measure)).toMatchObject({ pageOverflow: 0, composer: true, sideRowOverflow: 0, rowTypeInside: true });
      expect(measure.threadHeight).toBeGreaterThan(60);
    });
  }
}

test('the horizontal divider drags, clamps at 30 and 75 %, and moves with the arrow keys', async ({ page }) => {
  await open(page, harness);
  const divider = page.locator('.split-h');
  const box = await divider.boundingBox();
  const value = async () => Number(await divider.getAttribute('aria-valuenow'));
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, 0, { steps: 4 });
  await page.mouse.up();
  expect(await value()).toBe(30);
  const after = await divider.boundingBox();
  await page.mouse.move(after!.x + after!.width / 2, after!.y + 2);
  await page.mouse.down();
  await page.mouse.move(after!.x + after!.width / 2, 2000, { steps: 4 });
  await page.mouse.up();
  expect(await value()).toBe(75);
  await divider.focus();
  await page.keyboard.press('ArrowUp');
  expect(await value()).toBe(73);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect(await value()).toBe(75);
  // The editor and the box stay usable at the limits.
  const editor = await page.locator('.editor-card').boundingBox();
  expect(editor!.height).toBeGreaterThan(80);
});
