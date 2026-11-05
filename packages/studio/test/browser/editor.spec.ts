// S12's open items: the editor's language features and auto-limit, in a real browser.
import { expect, test } from '@playwright/test';
import { q1, setEditor, startHarness, uiOf, type Harness } from './support.js';

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

test('squiggles and the badge follow the type check, and they clear', async ({ page }) => {
  await page.goto(harness.url);
  await page.waitForSelector('.cm-content');
  await setEditor(page, q1);
  await expect(page.locator('.typechecks')).toContainText('Typechecks');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
  await setEditor(page, 'export default from(entity_ots_component).map(c => ({ id: c.nope }))');
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  await expect(page.locator('.type-errors')).toContainText('1 type error');
  await expect(page.locator('.typechecks')).toHaveCount(0);
  await page.locator('.cm-lintRange-error').first().hover();
  await expect(page.locator('.cm-tooltip').first()).toContainText('nope');
  await setEditor(page, q1);
  await expect(page.locator('.typechecks')).toContainText('Typechecks');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
});

test('hover shows types, and completions list columns with their types', async ({ page }) => {
  await page.goto(harness.url);
  await page.waitForSelector('.cm-content');
  await setEditor(page, q1);
  await page.locator('.cm-line span', { hasText: 'countOfParts' }).first().hover().catch(async () => { await page.locator('.cm-content').getByText('countOfParts').first().hover(); });
  await expect(page.locator('.cm-type-hover')).toContainText('countOfParts: UInt64');
  await page.mouse.move(0, 0);
  await setEditor(page, 'export default from(entity_ots_component).map(c => ({ id: c.');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('countOfParts');
  await page.keyboard.press('Escape');
});

test('⌘/ turns the 100-row auto-limit off and on, and the run follows, and it survives a reload', async ({ page }) => {
  await page.goto(harness.url);
  await page.waitForSelector('.cm-content');
  await setEditor(page, 'export default from(metric_group_ots_component_indices).limit(1)');
  await setEditor(page, q1);
  const sent: boolean[] = [];
  page.on('request', r => { if (r.url().includes('query.run')) sent.push((JSON.parse(r.postData() ?? '{}') as { json: { autoLimit: boolean } }).json.autoLimit); });
  await expect(page.locator('.footer')).toContainText('Auto-limit 100 rows');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(8);
  await page.keyboard.press('Control+/');
  await expect(page.locator('.footer')).toContainText('Auto-limit off');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => sent).toEqual([true, false]);
  await page.reload();
  await page.waitForSelector('.cm-content');
  await expect(page.locator('.footer')).toContainText('Auto-limit off');
});
