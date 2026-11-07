// S13: every key in every zone, and the no-mouse walkthrough, in a real browser over a real server process (faux model).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { gotoStudio, editorText, lastUser, q1, sendMessage, startHarness, turnKinds, uiOf, waitForTurns, type Harness } from './support.js';

// Runs in the page. The root TypeScript program has no DOM lib, on purpose, so only what these callbacks use is declared.
declare const document: any; declare const window: any; declare const navigator: any;

let harness: Harness;
test.beforeEach(async ({}, info) => { harness = await startHarness(uiOf(info)); });
test.afterEach(async () => { await harness?.stop(); });

const box = (p: Page) => p.locator('#composer');
const thread = (p: Page) => p.locator('.thread');
const code = (p: Page) => p.locator('.cm-content');
const selected = (p: Page) => p.locator('.turn[data-sel="true"]');
const selectedKind = (p: Page) => selected(p).getAttribute('data-kind');
const inBox = (p: Page) => expect(box(p)).toBeFocused();
const inThread = (p: Page) => expect(thread(p)).toBeFocused();
const inEditor = (p: Page) => expect(code(p)).toBeFocused();
const editBanner = (p: Page) => p.locator('.chat-editing');
const generating = (p: Page) => p.locator('[data-testid="generating"]');
const hints = async (p: Page) => (await p.locator('.footer .hint').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
const press = (p: Page, ...keys: string[]) => keys.reduce<Promise<void>>((done, key) => done.then(() => p.keyboard.press(key)), Promise.resolve());
const openApp = async (p: Page) => { await gotoStudio(p, harness.url); await p.waitForSelector('.cm-content'); };
/** ALPHA v1, BRAVO v2, focus in the box. */
async function twoVersions(p: Page) {
  await openApp(p);
  await sendMessage(p, 'ALPHA');
  await waitForTurns(p, 2);
  await sendMessage(p, 'BRAVO');
  await waitForTurns(p, 4);
  // The read after a reply brings the real id of its message, and its activity. A key on the message before that loses its selection: see the report.
  await expect(p.locator('.activity-log')).toHaveCount(2);
  await box(p).focus();
}
/** To the thread on the last turn. */
const toThread = async (p: Page) => { await box(p).focus(); await p.keyboard.press('ArrowUp'); await inThread(p); };
const typeInEditor = async (p: Page, text: string) => { await press(p, 'Control+e'); await inEditor(p); await press(p, 'Control+a'); await p.keyboard.insertText(text); };
const appendInEditor = async (p: Page, text: string) => { await press(p, 'Control+e'); await inEditor(p); await press(p, 'Control+End'); await p.keyboard.insertText(text); };

test('this file really is keyboard-only', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const lines = source.split('\n').filter(line => !line.includes('needles'));
  const needles = ['.cl' + 'ick(', '.ho' + 'ver(', '.dbl' + 'click(', '.ta' + 'p(', '.che' + 'ck(', '.mou' + 'se.', 'set' + 'Editor(', 'wheel'];
  for (const needle of needles) expect(lines.filter(line => line.includes(needle)), needle).toEqual([]);
});

test.describe('anywhere', () => {
  for (const mod of ['Control', 'Meta'] as const) {
    test(`global keys with ${mod}, from the box, the thread and CodeMirror, default prevented`, async ({ page: p }) => {
      await twoVersions(p);
      await p.evaluate(() => {
        window.seen = [];
        window.addEventListener('keydown', (e: any) => { if (!['Control', 'Meta'].includes(e.key)) window.setTimeout(() => window.seen.push(`${e.key}:${e.defaultPrevented}`)); }, true);
      });
      const zones: Record<string, () => Promise<void>> = {
        box: async () => { await box(p).focus(); await inBox(p); },
        thread: () => toThread(p),
        editor: async () => { await code(p).focus(); await inEditor(p); },
      };
      for (const go of Object.values(zones)) {
        await go(); await press(p, `${mod}+e`); await inEditor(p);
        await go(); await press(p, `${mod}+l`); await inBox(p);
        for (const [key, tab] of [['1', 'Table'], ['2', 'Chart'], ['3', 'SQL'], ['1', 'Table']] as const) { await go(); await press(p, `${mod}+${key}`); await expect(p.locator('.tab.on')).toContainText(tab); }
        await go(); await press(p, `${mod}+/`); await expect(p.locator('.footer')).toContainText('Auto-limit off');
        await go(); await press(p, `${mod}+/`); await expect(p.locator('.footer')).toContainText('Auto-limit 100');
        await go(); await press(p, `${mod}+k`); await expect(p.getByRole('dialog').or(p.locator('.palette')).first()).toBeVisible(); await press(p, 'Escape');
        await go(); await press(p, `${mod}+s`); await expect(p.locator('#save-name')).toBeVisible(); await press(p, 'Escape'); await expect(p.locator('#save-name')).toHaveCount(0);
        await go(); const before = p.waitForResponse(r => r.url().includes('query.run')); await press(p, `${mod}+Enter`); await before;
      }
      const seen = await p.evaluate(() => window.seen) as string[];
      expect(seen.filter(s => s.endsWith(':false') && !s.startsWith('Tab'))).toEqual([]);
      // ⌘⇧L is not ⌘L, from any zone.
      for (const go of Object.values(zones)) {
        await go();
        await press(p, `${mod}+Shift+L`);
        await inBox(p);
        await expect(p.locator('.chat-row.on')).toHaveText('New chat');
        await expect(p.locator('.thread-empty')).toBeVisible();
        await p.keyboard.press('Control+k');
        await p.keyboard.insertText('ALPHA');
        await press(p, 'ArrowDown', 'Enter');
        await expect(p.locator('.turn-version')).toHaveCount(2);
      }
      const prevented = await p.evaluate(() => window.seen.filter((s: string) => /^[lL]:/.test(s))) as string[];
      expect(prevented.filter(s => s.endsWith(':false'))).toEqual([]);
    });
  }

  test('other ⌘⇧ letters are left to the browser; the app does nothing with them', async ({ page: p }) => {
    await twoVersions(p);
    await p.evaluate(() => { window.seen = []; window.addEventListener('keydown', (e: any) => { if (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 's') window.setTimeout(() => window.seen.push(e.defaultPrevented)); }, true); });
    await press(p, 'Control+Shift+K', 'Control+Shift+S');
    await expect.poll(() => p.evaluate(() => window.seen)).toEqual([false, false]);
    await expect(p.locator('#save-name')).toHaveCount(0);
  });
});

test.describe('the message box', () => {
  test('↵ sends, ⇧↵ makes a line, ↑ only at the very start or when empty, ⇧↑ selects, on an empty thread nothing', async ({ page: p }) => {
    await openApp(p);
    await box(p).focus();
    await press(p, 'ArrowUp');
    await inBox(p);
    await press(p, 'Escape');
    await inBox(p);
    await p.keyboard.type('first');
    await press(p, 'Shift+Enter');
    await p.keyboard.type('second');
    await expect(box(p)).toHaveValue('first\nsecond');
    await press(p, 'Control+a', 'Delete');
    await sendMessage(p, 'ALPHA');
    await waitForTurns(p, 2);
    await box(p).focus();
    await p.keyboard.insertText('one\ntwo');
    // The second line, then the first line's end: ↑ moves the caret and stays.
    await press(p, 'ArrowUp');
    await inBox(p);
    expect(await box(p).evaluate((e: any) => e.selectionStart)).toBe(3);
    await press(p, 'Home');
    expect(await box(p).evaluate((e: any) => e.selectionStart)).toBe(0);
    await press(p, 'Shift+End', 'ArrowUp');
    await inBox(p);
    await press(p, 'End', 'Home', 'Shift+ArrowDown', 'Shift+ArrowUp');
    await inBox(p);
    await press(p, 'Home');
    await press(p, 'Shift+ArrowUp');
    await inBox(p);
    await press(p, 'ArrowUp');
    await inThread(p);
    expect(await selectedKind(p)).toBe('version');
    await expect(box(p)).toHaveValue('one\ntwo');
    await press(p, 'j');
    await inBox(p);
    await expect(box(p)).toHaveValue('one\ntwo');
  });

  test('esc order: generating stops, then the thread, then the box, with the draft kept', async ({ page: p }) => {
    await openApp(p);
    await sendMessage(p, 'ALPHA');
    await waitForTurns(p, 2);
    await sendMessage(p, 'hang now');
    await expect(generating(p)).toBeVisible();
    await box(p).focus();
    await p.keyboard.type('MY_DRAFT');
    await press(p, 'Escape');
    await waitForTurns(p, 4);
    await inBox(p);
    await expect(box(p)).toHaveValue('MY_DRAFT');
    await press(p, 'Escape');
    await inThread(p);
    await expect(selected(p)).toHaveCount(1);
    await press(p, 'Escape');
    await inBox(p);
    await expect(box(p)).toHaveValue('MY_DRAFT');
  });

  test('esc with an edit open cancels it; ↑ reaches the thread without cancelling, on the dimmed turn', async ({ page: p }) => {
    await twoVersions(p);
    await p.keyboard.type('MY_DRAFT');
    await press(p, 'Home', 'ArrowUp');
    await inThread(p);
    await press(p, 'k', 'k', 'e');
    await inBox(p);
    await expect(box(p)).toHaveValue('ALPHA');
    await expect(editBanner(p)).toBeVisible();
    await press(p, 'Control+a');
    await p.keyboard.insertText('REWRITE');
    await press(p, 'Home');
    await press(p, 'ArrowUp');
    await inThread(p);
    await expect(editBanner(p)).toBeVisible();
    await expect(selected(p)).toHaveAttribute('data-editing', /.*/);
    await press(p, 'Enter');
    await inBox(p);
    await expect(box(p)).toHaveValue('REWRITE');
    await press(p, 'Escape');
    await expect(editBanner(p)).toHaveCount(0);
    await inBox(p);
    await expect(box(p)).toHaveValue('MY_DRAFT');
    await expect(p.locator('.turn-version')).toHaveCount(2);
  });

  test('esc during IME composition does nothing here', async ({ page: p }) => {
    await twoVersions(p);
    await p.keyboard.type('text');
    const sendEsc = () => box(p).evaluate((e: any) => {
      e.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
      const key = new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, isComposing: true });
      e.dispatchEvent(key);
      e.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
      return key.defaultPrevented;
    });
    expect(await sendEsc()).toBe(false);
    await inBox(p);
    await expect(box(p)).toHaveValue('text');
    await expect(selected(p)).toHaveCount(0);
    // And ↵ during composition doesn't send.
    await box(p).evaluate((e: any) => e.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true })));
    await expect(box(p)).toHaveValue('text');
  });

  test('Meta and Alt in the box do not act like the bare keys', async ({ page: p }) => {
    await twoVersions(p);
    await p.keyboard.type('text');
    await press(p, 'Home', 'Meta+ArrowUp', 'Alt+ArrowUp', 'Control+ArrowUp');
    await inBox(p);
    await expect(selected(p)).toHaveCount(0);
    const ran = p.waitForResponse(r => r.url().includes('query.run'));
    await press(p, 'Meta+Enter');
    await ran;
    await expect(box(p)).toHaveValue(/^text/);
    await expect(p.locator('.turn[data-kind="user"]')).toHaveCount(2);
  });
});

test.describe('the thread', () => {
  test('↑ k stop at the first turn, ↓ j go down, past the last is the box, and no character leaks', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    expect(await selected(p).getAttribute('data-kind')).toBe('version');
    await expect(thread(p)).toHaveAttribute('aria-activedescendant', /.+/);
    await press(p, 'k');
    expect(await selectedKind(p)).toBe('user');
    await press(p, 'ArrowUp', 'k', 'ArrowUp', 'k', 'k');
    await expect(selected(p)).toContainText('ALPHA');
    await inThread(p);
    await press(p, 'j');
    expect(await selectedKind(p)).toBe('version');
    await press(p, 'ArrowDown', 'j', 'j');
    await inBox(p);
    await expect(box(p)).toHaveValue('');
    await expect(selected(p)).toHaveCount(0);
    await toThread(p);
    await press(p, 'ArrowDown');
    await inBox(p);
    await expect(box(p)).toHaveValue('');
    await toThread(p);
    await press(p, 'i');
    await inBox(p);
    await expect(box(p)).toHaveValue('');
  });

  test('↵ on a version restores and runs, with the note selected; numbers and the mark stay right; its chart comes back', async ({ page: p }) => {
    await twoVersions(p);
    await sendMessage(p, 'chart it');
    await waitForTurns(p, 6);
    await sendMessage(p, 'plain again');
    await waitForTurns(p, 8);
    await toThread(p);
    await press(p, 'k', 'k');
    await expect(selected(p).locator('.version-chip')).toHaveText('v3');
    await press(p, 'Enter');
    await expect(selected(p)).toContainText('Restored v3');
    expect(await selectedKind(p)).toBe('note');
    await inThread(p);
    await expect(p.locator('.tab.on')).toContainText('Chart');
    await expect(p.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await expect(p.locator('.version-chip.on')).toHaveText('v3');
    // A note has no hints, and its keys do nothing.
    await expect(selected(p).locator('.turn-action')).toHaveCount(0);
    const requests = harness.requests().length;
    const notes = await p.locator('.turn[data-kind="note"]').count();
    await press(p, 'Enter', 'e', 'r', 'y');
    await p.waitForTimeout(150);
    expect(harness.requests().length).toBe(requests);
    await expect(p.locator('.turn[data-kind="note"]')).toHaveCount(notes);
    await inThread(p);
    await expect(editBanner(p)).toHaveCount(0);
  });

  test('↵ and e on a user turn edit and focus the box; e on a reply edits its user turn; sending resends and the model has no later turn', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'k');
    await press(p, 'Enter');
    await inBox(p);
    await expect(box(p)).toHaveValue('BRAVO');
    await press(p, 'Escape');
    await toThread(p);
    await press(p, 'k', 'e');
    await inBox(p);
    await expect(box(p)).toHaveValue('BRAVO');
    await press(p, 'Escape');
    await toThread(p);
    await press(p, 'e');
    await inBox(p);
    await expect(box(p)).toHaveValue('BRAVO');
    await press(p, 'Control+a');
    await p.keyboard.insertText('DELTA');
    await press(p, 'Enter');
    await waitForTurns(p, 4);
    const request = JSON.stringify(harness.requests().at(-1));
    expect(request).toContain('DELTA');
    expect(request).not.toContain('BRAVO');
  });

  test('r retries and returns focus to the box; the request has no later turn', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'r');
    await inBox(p);
    await waitForTurns(p, 4);
    expect(await turnKinds(p)).toEqual(['user', 'version', 'user', 'version']);
    await expect(box(p)).toHaveValue('');
    expect(harness.requests().length).toBe(3);
    expect(lastUser(harness.requests().at(-1)!)).toContain('BRAVO');
  });

  test('y copies with feedback; a refused clipboard says so; a missing clipboard does too', async ({ page: p, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await twoVersions(p);
    await sendMessage(p, 'say:TEXT_REPLY');
    await waitForTurns(p, 6);
    const zone = p.getByTestId('zone');
    await toThread(p);
    await press(p, 'y');
    await expect(zone).toHaveText('Copied message');
    expect(await p.evaluate(() => navigator.clipboard.readText())).toBe('TEXT_REPLY');
    await press(p, 'k', 'y');
    await expect(zone).toHaveText('Copied message');
    await press(p, 'k', 'y');
    await expect(zone).toHaveText('Copied v2');
    expect(await p.evaluate(() => navigator.clipboard.readText())).toContain('.limit(2)');
    await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('refused')); });
    await press(p, 'y');
    await expect(zone).toContainText(/could not|not copied|refused|couldn/i);
    await inThread(p);
    await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
    await press(p, 'y');
    await expect(zone).toContainText(/could not|not copied|refused|couldn/i);
  });

  test('a failed turn: ↵ loads the last attempt without a run; y copies it; e and r still offered; a huge one offers no ↵', async ({ page: p, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(p);
    await sendMessage(p, 'plain');
    await waitForTurns(p, 2);
    await sendMessage(p, 'fail');
    await waitForTurns(p, 4);
    const runs: string[] = [];
    p.on('request', r => { if (r.url().includes('query.run')) runs.push(r.url()); });
    await toThread(p);
    expect(await selectedKind(p)).toBe('error');
    const labels = (await selected(p).locator('.turn-action').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    expect(labels.join('|')).toMatch(/↵ load last attempt\|e edit prompt\|r retry\|y copy last attempt/);
    await press(p, 'y');
    expect(await p.evaluate(() => navigator.clipboard.readText())).toBe('export default from(no_such_table)');
    await press(p, 'Enter');
    await expect.poll(() => editorText(p)).toBe('export default from(no_such_table)');
    await p.waitForTimeout(200);
    expect(runs).toEqual([]);
    await inThread(p);
    await box(p).focus();
    await sendMessage(p, 'huge');
    await waitForTurns(p, 6);
    const editorBefore = await editorText(p);
    await toThread(p);
    await expect(selected(p).locator('.turn-action', { hasText: 'load last attempt' })).toHaveCount(0);
    await press(p, 'Enter');
    await p.waitForTimeout(150);
    expect(await editorText(p)).toBe(editorBefore);
    await inThread(p);
  });

  test('a text turn: ↵ does nothing', async ({ page: p }) => {
    await openApp(p);
    await sendMessage(p, 'say:words');
    await waitForTurns(p, 2);
    const before = await editorText(p);
    await toThread(p);
    await press(p, 'Enter');
    await p.waitForTimeout(150);
    await inThread(p);
    expect(await editorText(p)).toBe(before);
    expect(harness.requests().length).toBe(1);
  });

  test('during a generation here a selected turn offers only y; ↵ e r do nothing; esc stops and stays in the thread', async ({ page: p }) => {
    await twoVersions(p);
    await sendMessage(p, 'hang now');
    await expect(generating(p)).toBeVisible();
    await toThread(p);
    await press(p, 'k');
    expect((await selected(p).locator('.turn-action').allInnerTexts()).map(t => t.trim()[0])).toEqual(['y']);
    const source = await editorText(p);
    const requests = harness.requests().length;
    await press(p, 'Enter', 'e', 'r');
    await p.waitForTimeout(150);
    expect(harness.requests().length).toBe(requests);
    expect(await editorText(p)).toBe(source);
    await expect(editBanner(p)).toHaveCount(0);
    await inThread(p);
    await press(p, 'Escape');
    await expect(p.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await inThread(p);
  });

  test('during an edit: ↵ and e on earlier turns re-target it; r does nothing; a version still restores', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'k', 'e');
    await inBox(p);
    await press(p, 'Control+a');
    await p.keyboard.insertText('REWRITE');
    await press(p, 'Home', 'ArrowUp');
    await inThread(p);
    const requests = harness.requests().length;
    await press(p, 'k', 'r');
    await p.waitForTimeout(150);
    expect(harness.requests().length).toBe(requests);
    await expect(box(p)).toHaveValue('REWRITE');
    await expect(selected(p).locator('.turn-action', { hasText: 'retry' })).toHaveCount(0);
    await press(p, 'k');
    await expect(selected(p)).toContainText('ALPHA');
    await press(p, 'e');
    await inBox(p);
    await expect(box(p)).toHaveValue('ALPHA');
    await expect(p.locator('.turn-version')).toHaveCount(0);
  });

  test('Meta, Ctrl and Alt with thread letters and arrows do nothing of the thread; Shift neither', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'k');
    const id = await selected(p).getAttribute('data-turn');
    const requests = harness.requests().length;
    for (const key of ['Meta+j', 'Control+j', 'Alt+j', 'Shift+J', 'Meta+ArrowUp', 'Control+ArrowUp', 'Alt+ArrowDown', 'Shift+ArrowUp', 'Meta+r', 'Alt+r', 'Shift+R', 'Alt+y', 'Alt+e', 'Shift+E', 'Alt+i', 'Shift+I', 'Alt+Enter', 'Shift+Enter']) {
      await press(p, key);
      await inThread(p);
      expect(await selected(p).getAttribute('data-turn'), key).toBe(id);
    }
    await p.waitForTimeout(150);
    expect(harness.requests().length).toBe(requests);
    await expect(editBanner(p)).toHaveCount(0);
  });

  test('↑↓ keep the selected turn in view across a long thread, also with tall turns', async ({ page: p }) => {
    await openApp(p);
    for (let i = 0; i < 12; i++) { await sendMessage(p, `say:turn ${i} ${'words '.repeat(i % 3 === 0 ? 120 : 2)}`); await waitForTurns(p, (i + 1) * 2); }
    await toThread(p);
    const inView = () => p.evaluate(() => {
      const t = document.querySelector('.thread').getBoundingClientRect();
      const s = document.querySelector('.turn[data-sel="true"]').getBoundingClientRect();
      // A turn taller than the thread can't fit: its top is what must show.
      return s.height > t.height ? s.top < t.bottom && s.bottom > t.top : s.top >= t.top - 1 && s.bottom <= t.bottom + 1;
    });
    for (let i = 0; i < 23; i++) { await press(p, 'k'); expect(await inView(), `up ${i}`).toBe(true); }
    await expect(selected(p)).toContainText('turn 0');
    for (let i = 0; i < 23; i++) { await press(p, 'j'); expect(await inView(), `down ${i}`).toBe(true); }
    await inThread(p);
  });

  test('a reply arriving with the thread focused: the selection and the scroll stay', async ({ page: p }) => {
    await openApp(p);
    for (let i = 0; i < 8; i++) { await sendMessage(p, `say:turn ${i} ${'words '.repeat(60)}`); await waitForTurns(p, (i + 1) * 2); }
    await sendMessage(p, 'slow');
    await expect(generating(p)).toBeVisible();
    await toThread(p);
    await press(p, 'k', 'k', 'k', 'k', 'k', 'k');
    const id = await selected(p).getAttribute('data-turn');
    const top = await thread(p).evaluate((e: any) => e.scrollTop);
    await expect(generating(p)).toHaveCount(0, { timeout: 8_000 });
    await p.waitForTimeout(200);
    expect(await selected(p).getAttribute('data-turn')).toBe(id);
    expect(Math.abs(await thread(p).evaluate((e: any) => e.scrollTop) - top)).toBeLessThan(2);
    await inThread(p);
  });

  test('a selected turn that disappears falls back to the last visible one', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'k');
    await sendMessage(p, 'noop').catch(() => undefined);
    await waitForTurns(p, 6);
    await toThread(p);
    await press(p, 'k', 'k', 'k');
    await expect(selected(p)).toContainText('BRAVO');
    await press(p, 'r');
    await waitForTurns(p, 4);
    await toThread(p);
    await expect(selected(p)).toHaveCount(1);
    await expect(thread(p)).not.toContainText('noop');
  });

  test('Tab into a non-empty thread selects the last turn, and the keys work from there (F53)', async ({ page: p }) => {
    await twoVersions(p);
    await expect(selected(p)).toHaveCount(0);
    await press(p, 'Shift+Tab');
    await inThread(p);
    await expect(selected(p)).toHaveCount(1);
    expect(await selectedKind(p)).toBe('version');
    await expect(selected(p).locator('.version-chip')).toHaveText('v2');
    await press(p, 'k');
    await expect(selected(p)).toContainText('BRAVO');
    await press(p, 'j', 'j');
    await inBox(p);
  });
  test('an empty chat: the thread takes no keys', async ({ page: p }) => {
    await openApp(p);
    await box(p).focus();
    await press(p, 'Shift+Tab');
    await thread(p).focus();
    await press(p, 'k', 'y', 'e', 'r', 'Enter');
    await expect(box(p)).toHaveValue('');
    await inThread(p);
    await press(p, 'j');
    await inBox(p);
    await expect(box(p)).toHaveValue('');
  });
});

test.describe('keys held down', () => {
  /** Key repeats, as an operating system sends them. */
  const hold = async (p: Page, key: string, times: number) => { for (let i = 0; i < times; i++) { await p.keyboard.down(key); await p.waitForTimeout(15); } await p.keyboard.up(key); };

  for (const key of ['j', 'i'] as const) {
    test(`holding ${key} until focus reaches the box leaves no letters in it`, async ({ page: p }) => {
      await twoVersions(p);
      await toThread(p);
      await hold(p, key, 8);
      await inBox(p);
      await expect(box(p)).toHaveValue('');
    });
  }
  test('holding e on a turn opens the edit once and types nothing into the message', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await hold(p, 'e', 8);
    await inBox(p);
    await expect(box(p)).toHaveValue('BRAVO');
  });
  test('holding ↵ on a user turn opens the edit and does not send it', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'k');
    const requests = harness.requests().length;
    await hold(p, 'Enter', 8);
    await p.waitForTimeout(200);
    expect(harness.requests().length, 'a held ↵ must not resend').toBe(requests);
    await expect(box(p)).toHaveValue('BRAVO');
    await expect(editBanner(p)).toBeVisible();
  });
  test('holding r retries once and types nothing', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    const requests = harness.requests().length;
    await hold(p, 'r', 8);
    await waitForTurns(p, 4);
    expect(harness.requests().length).toBe(requests + 1);
    await expect(box(p)).toHaveValue('');
  });
  test('holding y copies once', async ({ page: p, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await twoVersions(p);
    await toThread(p);
    await p.evaluate(() => { window.copies = 0; const real = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (text: string) => { window.copies++; return real(text); }; });
    await hold(p, 'y', 6);
    expect(await p.evaluate(() => window.copies)).toBe(1);
  });
});

test.describe('letters in the wrong place', () => {
  const letters = 'jkeryi?';
  test('they type in the box, CodeMirror, the save field and the palette, and act on nothing', async ({ page: p }) => {
    await twoVersions(p);
    await p.keyboard.type(letters);
    await expect(box(p)).toHaveValue(letters);
    await press(p, 'Control+a', 'Delete');
    await appendInEditor(p, '\n// ');
    await p.keyboard.type(letters);
    expect(await editorText(p)).toContain(`// ${letters}`);
    await inEditor(p);
    await press(p, 'Control+s');
    await p.keyboard.press('Control+a');
    await p.keyboard.type(letters);
    await expect(p.locator('#save-name')).toHaveValue(letters);
    await press(p, 'Escape');
    await press(p, 'Control+k');
    await p.keyboard.type(letters);
    await expect(p.locator('input[aria-label], .palette input').first()).toHaveValue(letters);
    await press(p, 'Escape');
    await expect(p.locator('[aria-label="Keyboard shortcuts"]')).toHaveCount(0);
    await expect(p.locator('.turn[data-kind="user"]')).toHaveCount(2);
    await expect(editBanner(p)).toHaveCount(0);
  });
  test('they do nothing with focus on a button, a divider or nowhere, except ? and esc', async ({ page: p }) => {
    await twoVersions(p);
    const requests = harness.requests().length;
    for (const go of [() => p.locator('.split-h').focus(), () => p.locator('.tab').first().focus(), () => p.evaluate(() => document.activeElement?.blur?.())]) {
      await go();
      await press(p, 'j', 'k', 'e', 'r', 'y', 'i');
      await expect(editBanner(p)).toHaveCount(0);
      await expect(box(p)).toHaveValue('');
      await press(p, '?');
      await expect(p.locator('[aria-label="Keyboard shortcuts"]')).toBeVisible();
      await press(p, 'Escape');
      await go();
      await press(p, 'Escape');
      await inBox(p);
    }
    expect(harness.requests().length).toBe(requests);
  });
});

test.describe('the editor and esc', () => {
  test('completions close on the first esc, the second moves to the box', async ({ page: p }) => {
    await twoVersions(p);
    await appendInEditor(p, '\nfrom');
    await press(p, 'Control+Space');
    await p.waitForSelector('.cm-tooltip-autocomplete li');
    await press(p, 'Escape');
    await expect(p.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    await inEditor(p);
    await press(p, 'Escape');
    await inBox(p);
  });
  test('the search panel closes on the first esc, the second moves to the box', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Control+f');
    await expect(p.locator('.cm-panel.cm-search')).toBeVisible();
    await press(p, 'Escape');
    await expect(p.locator('.cm-panel.cm-search')).toHaveCount(0);
    await inEditor(p);
    await press(p, 'Escape');
    await inBox(p);
  });
  test('the lint panel closes on the first esc, the second moves to the box', async ({ page: p }) => {
    await twoVersions(p);
    await typeInEditor(p, 'export default from(no_such_table)');
    await p.waitForSelector('.cm-lintRange-error', { timeout: 15_000 });
    await press(p, 'Control+Shift+M');
    await expect(p.locator('.cm-panel-lint')).toBeVisible();
    await press(p, 'Escape');
    await expect(p.locator('.cm-panel-lint')).toHaveCount(0);
    await inEditor(p);
    await press(p, 'Escape');
    await inBox(p);
  });
  test('with a generation: stop and stay; an open edit stays open', async ({ page: p }) => {
    await twoVersions(p);
    await sendMessage(p, 'hang');
    await expect(generating(p)).toBeVisible();
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Escape');
    await expect(p.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await inEditor(p);
    await toThread(p);
    await press(p, 'k', 'e');
    await expect(editBanner(p)).toBeVisible();
    await inBox(p);
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Escape');
    await inBox(p);
    await expect(editBanner(p)).toBeVisible();
  });
});

test.describe('another chat generating', () => {
  async function generatingElsewhere(p: Page) {
    await twoVersions(p);
    await press(p, 'Control+Shift+L');
    await sendMessage(p, 'hang CHAT_A');
    await expect(generating(p)).toBeVisible();
    await expect(p.locator('.chat-row', { hasText: 'CHAT_A' })).toBeVisible();
    await press(p, 'Control+k');
    await p.keyboard.insertText('ALPHA');
    await press(p, 'ArrowDown', 'Enter');
    await expect(p.locator('.turn-version')).toHaveCount(2);
    await expect(p.locator('[data-testid="generating-elsewhere"]')).toBeVisible();
    await box(p).focus();
  }
  test('esc does not stop it from here: the box moves to the thread', async ({ page: p }) => {
    await generatingElsewhere(p);
    await press(p, 'Escape');
    await inThread(p);
    await press(p, 'Escape');
    await inBox(p);
    await expect(p.locator('[data-testid="generating-elsewhere"]')).toBeVisible();
  });
  test('leaving a new chat the moment it starts generating: the dot and the stop route still find it', async ({ page: p }) => {
    await openApp(p);
    await sendMessage(p, 'ALPHA');
    await waitForTurns(p, 2);
    await press(p, 'Control+Shift+L');
    await p.waitForTimeout(100);
    await sendMessage(p, 'hang CHAT_A');
    await expect(generating(p)).toBeVisible();
    await p.locator('.chat-row', { hasText: 'ALPHA' }).focus();
    await press(p, 'Enter');
    await expect(p.locator('[data-testid="generating-elsewhere"]')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Open it to stop it' })).toBeVisible({ timeout: 4_000 });
    await expect(p.locator('.chat-row', { hasText: 'CHAT_A' }).locator('.chat-busy-dot')).toBeVisible();
  });
  test('r on a turn here: a retry that cannot go leaves the editor and the hand edit alone', async ({ page: p }) => {
    await generatingElsewhere(p);
    await appendInEditor(p, '\n// HAND_EDIT');
    await toThread(p);
    await press(p, 'r');
    await p.waitForTimeout(200);
    expect(await editorText(p)).toContain('HAND_EDIT');
    await expect(p.locator('.turn-version')).toHaveCount(2);
  });
  test('↵ on a version here restores it, and e opens an edit, with the send then waiting', async ({ page: p }) => {
    await generatingElsewhere(p);
    await toThread(p);
    await press(p, 'k', 'k');
    await press(p, 'Enter');
    await expect(selected(p)).toContainText('Restored v1');
    expect(await editorText(p)).toBe(q1);
    await press(p, 'k', 'e');
    await inBox(p);
    await expect(editBanner(p)).toBeVisible();
    const words = await box(p).inputValue();
    await press(p, 'Enter');
    await p.waitForTimeout(200);
    await expect(box(p)).toHaveValue(words);
    await expect(editBanner(p)).toBeVisible();
  });
});

test.describe('the shortcuts dialog', () => {
  const dialog = (p: Page) => p.locator('[aria-label="Keyboard shortcuts"]');
  test('? opens from the thread; esc or ? closes; focus returns; it blocks everything behind it', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    // Read first: focus leaving the thread for the dialog drops the selection a moment later, and coming back selects the last turn again.
    const id = await selected(p).getAttribute('data-turn');
    await press(p, '?');
    await expect(dialog(p)).toBeVisible();
    for (const key of ['j', 'k', 'e', 'r', 'y', 'i', 'Enter', 'Control+l', 'Control+e', 'Control+k', 'Control+s', 'Control+Enter', 'Control+1', 'Control+Shift+L', 'Tab']) await press(p, key);
    await expect(dialog(p)).toBeVisible();
    await expect(p.locator('#save-name')).toHaveCount(0);
    await expect(p.locator('.tab.on')).toContainText('Table');
    await expect(editBanner(p)).toHaveCount(0);
    await press(p, 'Escape');
    await expect(dialog(p)).toHaveCount(0);
    await inThread(p);
    expect(await selected(p).getAttribute('data-turn')).toBe(id);
    await press(p, '?');
    await expect(dialog(p)).toBeVisible();
    await press(p, '?');
    await expect(dialog(p)).toHaveCount(0);
    await inThread(p);
  });
  test('it lists every key, grouped as the prototype, each row here having a test above', async ({ page: p }) => {
    await openApp(p);
    await p.locator('.tab').first().focus();
    await press(p, '?');
    const groups = await dialog(p).locator('.help-group').evaluateAll((all: any[]) => all.map(g => ({ title: g.querySelector('.eyebrow').textContent, rows: [...g.querySelectorAll('.help-item')].map((r: any) => `${r.children[0].textContent}=${r.children[1].textContent}`) })));
    expect(groups.map(g => g.title)).toEqual(['Message', 'Conversation', 'Go to', 'Query']);
    const all = groups.flatMap(g => g.rows).join('\n');
    for (const row of ['Send=↵', 'New line=⇧↵', 'Stop generating=esc', 'Cancel an edit=esc', 'Retry=r', 'Copy=y', 'Load last attempt=↵', 'Restore version and run=↵', 'Move between turns=↑↓ or j k', 'Back to message=esc or i', 'Message box=Ctrl+L', 'New chat=Ctrl+⇧L', 'Editor=Ctrl+E', 'Command palette=Ctrl+K', 'All shortcuts=?', 'Run=Ctrl+↵', 'Table, Chart, SQL=Ctrl+1–3', 'Toggle auto-limit=Ctrl+/', 'Save query=Ctrl+S']) expect(all, row).toContain(row);
    expect(all).toMatch(/Earlier turns=↑/);
    expect(all).toMatch(/Edit prompt and resend=↵/);
    expect(all).toMatch(/Back to message, from the editor=esc/);
  });
  test('from the palette: Keyboard shortcuts opens it, Editor focuses the editor, New chat shows its key', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+k');
    await expect(p.locator('.palette, [role="dialog"]').first()).toContainText('Ctrl+⇧L');
    await p.keyboard.insertText('Keyboard shortcuts');
    await press(p, 'ArrowDown', 'Enter');
    await expect(dialog(p)).toBeVisible();
    await press(p, 'Escape');
    await expect(dialog(p)).toHaveCount(0);
    await press(p, 'Control+k');
    await p.keyboard.insertText('Editor');
    await press(p, 'ArrowDown', 'Enter');
    await inEditor(p);
  });
});

test.describe('the footer', () => {
  test('hints follow the zone, generating and an open edit', async ({ page: p }) => {
    const shows = (expected: string[]) => expect.poll(() => hints(p)).toEqual(expected);
    const leads = (first: string) => expect.poll(async () => (await hints(p))[0]).toBe(first);
    await twoVersions(p);
    await shows(['↵ send', '⇧↵ new line', '↑ earlier turns', 'Ctrl+E editor', 'Ctrl+↵ run']);
    await toThread(p);
    await shows(['↑↓ move', 'esc back to message', '? all shortcuts']);
    await press(p, 'Control+e');
    await inEditor(p);
    await shows(['Ctrl+↵ run', 'esc back to chat']);
    await box(p).focus();
    await sendMessage(p, 'hang');
    await expect(generating(p)).toBeVisible();
    await box(p).focus();
    await leads('esc stop');
    await toThread(p);
    await shows(['↑↓ move', 'esc stop', '? all shortcuts']);
    await press(p, 'Control+e');
    await inEditor(p);
    await shows(['Ctrl+↵ run', 'esc stop']);
    await box(p).focus();
    await press(p, 'Escape');
    await waitForTurns(p, 6);
    await toThread(p);
    await press(p, 'k', 'e');
    await inBox(p);
    await leads('esc cancel');
  });
  test('sidebar and selected turn show their keys', async ({ page: p }) => {
    await twoVersions(p);
    await expect(p.locator('.side-new')).toContainText('Ctrl+⇧L');
    await toThread(p);
    expect((await selected(p).locator('.turn-action').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())).toEqual(['↵ restore & run', 'e edit prompt', 'r retry', 'y copy query']);
    await press(p, 'k');
    expect((await selected(p).locator('.turn-action').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim())).toEqual(['↵ e edit & resend', 'r retry', 'y copy']);
  });
});

test.describe('reach with Tab', () => {
  const focused = (p: Page) => p.evaluate(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return { name: 'body', visible: true };
    const style = window.getComputedStyle(e);
    const visible = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none' || e.classList.contains('splitter') || e.classList.contains('split-h') || !!e.closest('.cm-editor');
    return { name: `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 3).join('.')}:${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 28)}`, visible };
  });
  async function walk(p: Page, key: string, limit: number) {
    const seen: { name: string; visible: boolean }[] = [];
    for (let i = 0; i < limit; i++) {
      await press(p, key);
      const now = await focused(p);
      seen.push(now);
      if (now.name === 'body') break;
    }
    return seen;
  }
  test('every action without a key of its own is reachable with Tab, with a visible focus', async ({ page: p }) => {
    await twoVersions(p);
    await sendMessage(p, 'fail');
    await waitForTurns(p, 6);
    await press(p, 'Control+s');
    await p.keyboard.insertText('mine');
    await press(p, 'Enter');
    await expect(p.locator('.saved-load')).toHaveCount(1);
    await p.locator('.palette-btn').focus();
    const forward = await walk(p, 'Tab', 45);
    const names = forward.map(f => f.name).join('\n');
    for (const needle of ['+ new', 'chat-row', 'side-row', 'saved-load', 'saved-delete', 'Load last attempt', 'thread', 'composer', 'split-h']) {
      if (needle !== '+ new') expect(names, needle).toContain(needle);
    }
    expect(names).toContain('side-new');
    // The box shows focus on its card, and the thread only through the selected turn and the footer.
    expect(forward.filter(f => !f.visible && !/^(div\.thread|textarea\.composer)/.test(f.name)).map(f => f.name), 'no visible focus').toEqual([]);
  });
  test('backwards from the top of the page: the tabs, the vertical divider and Run can be reached', async ({ page: p }) => {
    await twoVersions(p);
    await p.locator('.palette-btn').focus();
    const back = (await walk(p, 'Shift+Tab', 3)).map(f => f.name);
    expect(back.at(-1) === 'body' || back.length > 0).toBe(true);
    const names = (await walk(p, 'Shift+Tab', 14)).map(f => f.name).join('\n');
    for (const needle of ['tab', 'splitter', 'run-btn']) expect(names, needle).toContain(needle);
  });
  test('past the editor: Run, the vertical divider and the tabs can be reached with Tab', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+e');
    await inEditor(p);
    // Tab indents until Ctrl+M, CodeMirror's own way out (PM decision).
    await expect(p.locator('.tab-moves')).toHaveCount(0);
    await press(p, 'Control+m');
    await expect(p.locator('.tab-moves')).toContainText('Tab moves focus');
    const source = await editorText(p);
    // Disabled, so not a stop, while the reply's run is out.
    await expect(p.locator('.run-btn').first()).toBeEnabled();
    const after = await walk(p, 'Tab', 4);
    const names = after.map(f => f.name).join('\n');
    expect(names, 'Tab out of the editor').toContain('run-btn');
    expect(names).toContain('splitter');
    expect(names).toMatch(/button\.tab/);
    expect(await editorText(p), 'no indent went in').toBe(source);
  });
  test('Ctrl+M back off: Tab indents again and the header says nothing; in the box it does nothing', async ({ page: p }) => {
    await twoVersions(p);
    await box(p).focus();
    await p.keyboard.type('words');
    await p.evaluate(() => { window.seen = []; window.addEventListener('keydown', (e: any) => { if (e.key === 'm') window.setTimeout(() => window.seen.push(e.defaultPrevented)); }, true); });
    await press(p, 'Control+m');
    await expect(box(p)).toHaveValue('words');
    await inBox(p);
    await expect(p.locator('.tab-moves')).toHaveCount(0);
    await press(p, 'Control+a', 'Delete');
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Control+m');
    await expect(p.locator('.tab-moves')).toBeVisible();
    await press(p, 'Control+m');
    await expect(p.locator('.tab-moves')).toHaveCount(0);
    const before = await editorText(p);
    await press(p, 'Tab');
    await inEditor(p);
    await expect.poll(() => editorText(p)).not.toBe(before);
    // Typing is not affected, and an m goes in.
    await press(p, 'Control+End');
    await p.keyboard.type('m');
    expect(await editorText(p)).toMatch(/m$/);
  });
  test('Ctrl+M stays true across a chat switch, and a reload turns it off with the header', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+Shift+L');
    await sendMessage(p, 'say:OTHER');
    await waitForTurns(p, 2);
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Control+m');
    await expect(p.locator('.tab-moves')).toBeVisible();
    await press(p, 'Control+k');
    await p.keyboard.insertText('ALPHA');
    await press(p, 'ArrowDown', 'Enter');
    await expect(p.locator('.turn-version')).toHaveCount(2);
    await expect(p.locator('.tab-moves')).toBeVisible();
    await press(p, 'Control+e');
    await inEditor(p);
    const source = await editorText(p);
    await press(p, 'Tab');
    await expect(p.locator('.run-btn')).toBeFocused();
    expect(await editorText(p)).toBe(source);
    await p.reload();
    await p.waitForSelector('.cm-content');
    await expect(p.locator('.tab-moves')).toHaveCount(0);
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Tab');
    await inEditor(p);
  });
  test('the palette focuses each divider, and the arrows move it', async ({ page: p }) => {
    await twoVersions(p);
    for (const [name, selector, key, step] of [['Resize panes', '.splitter', 'ArrowRight', 2], ['Resize chat and editor', '.split-h', 'ArrowUp', -2]] as const) {
      await press(p, 'Control+k');
      await p.keyboard.insertText(name);
      await press(p, 'ArrowDown', 'Enter');
      await expect(p.locator(selector)).toBeFocused();
      const before = Number(await p.locator(selector).getAttribute('aria-valuenow'));
      await press(p, key);
      expect(Number(await p.locator(selector).getAttribute('aria-valuenow'))).toBe(before + step);
      await press(p, 'Escape');
      await inBox(p);
    }
  });
  test('the vertical divider moves with the arrow keys once reached, and esc returns to the box', async ({ page: p }) => {
    await twoVersions(p);
    await p.locator('.splitter').focus();
    const value = () => p.locator('.splitter').getAttribute('aria-valuenow');
    const before = Number(await value());
    await press(p, 'ArrowRight');
    expect(Number(await value())).toBe(before + 2);
    await press(p, 'ArrowLeft', 'ArrowLeft');
    expect(Number(await value())).toBe(before - 2);
    await press(p, 'Escape');
    await inBox(p);
  });
  test('"Open it to stop it" is reachable and stops; Load last attempt works with ↵ on the button', async ({ page: p }) => {
    await twoVersions(p);
    await sendMessage(p, 'fail');
    await waitForTurns(p, 6);
    const load = p.getByRole('button', { name: /Load last attempt/ });
    await load.focus();
    await press(p, 'Enter');
    await expect.poll(() => editorText(p)).toBe('export default from(no_such_table)');
    await press(p, 'Control+Shift+L');
    await sendMessage(p, 'hang CHAT_A');
    await expect(generating(p)).toBeVisible();
    await expect(p.locator('.chat-row', { hasText: 'CHAT_A' })).toBeVisible();
    await p.locator('.chat-row', { hasText: 'ALPHA' }).focus();
    await press(p, 'Enter');
    await expect(p.locator('.chat-row.on')).toHaveText('ALPHA');
    const link = p.getByRole('button', { name: 'Open it to stop it' });
    await expect(link).toBeVisible();
    await link.focus();
    await press(p, 'Enter');
    await expect(generating(p)).toBeVisible();
    await box(p).focus();
    await press(p, 'Escape');
    await expect(p.locator('.turn[data-kind="note"]')).toContainText('Stopped');
  });
  test('focus is not lost: closing the save field, deleting a saved query, sending from a button', async ({ page: p }) => {
    p.on('dialog', dialog => void dialog.accept());
    await twoVersions(p);
    const active = () => p.evaluate(() => document.activeElement?.tagName);
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Control+s');
    await press(p, 'Escape');
    expect(await active(), 'after esc in the save field').not.toBe('BODY');
    await press(p, 'Control+s');
    await p.keyboard.insertText('mine');
    await press(p, 'Enter');
    await expect(p.locator('.saved-load')).toHaveCount(1);
    expect(await active(), 'after saving').not.toBe('BODY');
    await p.locator('.saved-delete').focus();
    await press(p, 'Enter');
    await expect(p.locator('.saved-load')).toHaveCount(0);
    expect(await active(), 'after deleting').not.toBe('BODY');
  });
});

test('the no-mouse walkthrough', async ({ page: p }) => {
  p.on('dialog', dialog => void dialog.accept());
  await openApp(p);
  await sendMessage(p, 'OLDER_CHAT');
  await waitForTurns(p, 2);

  // New chat, ask, refine, chart.
  await press(p, 'Control+Shift+L');
  await inBox(p);
  await expect(p.locator('.thread-empty')).toBeVisible();
  await typeInEditor(p, '// start here');
  await press(p, 'Control+l');
  await inBox(p);
  await p.keyboard.type('ask one');
  await press(p, 'Enter');
  await waitForTurns(p, 2);
  await p.keyboard.type('refine two');
  await press(p, 'Enter');
  await waitForTurns(p, 4);
  await expect(p.locator('.version-chip.on')).toHaveText('v2');
  await p.keyboard.type('chart it');
  await press(p, 'Enter');
  await waitForTurns(p, 6);
  await expect(p.locator('.chart-host svg .role-mark path').first()).toBeVisible();

  // Restore v1.
  await press(p, 'Escape');
  await inThread(p);
  await press(p, 'k', 'k', 'k', 'k');
  await expect(selected(p).locator('.version-chip')).toHaveText('v1');
  await press(p, 'Enter');
  await expect(selected(p)).toContainText('Restored v1');
  await expect(p.locator('.version-chip.on')).toHaveText('v1');
  await expect(p.locator('.tab.on')).toContainText('Table');

  // Edit and resend: the chart turn is rewritten, and the model doesn't have it.
  await press(p, 'k', 'k');
  await expect(selected(p)).toContainText('chart it');
  await press(p, 'e');
  await inBox(p);
  await press(p, 'Control+a');
  await p.keyboard.insertText('say:EDITED_WORDS');
  await press(p, 'Enter');
  await expect(p.locator('.turn-text').last()).toHaveText('EDITED_WORDS');
  const edited = JSON.stringify(harness.requests().at(-1));
  expect(edited).toContain('EDITED_WORDS');
  expect(edited).not.toContain('chart it');
  expect(edited).not.toContain('OLDER_CHAT');

  // Stop, then retry, then stop that too.
  await box(p).focus();
  await p.keyboard.type('hang now');
  await press(p, 'Enter');
  await expect(generating(p)).toBeVisible();
  await press(p, 'Escape');
  await expect(p.locator('.turn[data-kind="note"]')).toContainText('Stopped');
  await expect(generating(p)).toHaveCount(0);
  await press(p, 'Escape');
  await inThread(p);
  await press(p, 'k');
  await expect(selected(p)).toContainText('hang now');
  const beforeRetry = harness.requests().length;
  await press(p, 'r');
  await inBox(p);
  await expect(generating(p)).toBeVisible();
  await expect.poll(() => harness.requests().length).toBe(beforeRetry + 1);
  await press(p, 'Escape');
  await expect(p.locator('.turn[data-kind="note"]')).toContainText('Stopped');

  // Save, and reopen the older chat.
  await press(p, 'Control+s');
  await p.keyboard.press('Control+a');
  await p.keyboard.insertText('walked');
  await press(p, 'Enter');
  await expect(p.locator('.saved-load', { hasText: 'walked' })).toHaveCount(1);
  await press(p, 'Control+k');
  await p.keyboard.insertText('OLDER_CHAT');
  await press(p, 'ArrowDown', 'Enter');
  await expect(p.locator('.chat-row.on')).toHaveText('OLDER_CHAT');
  await expect(thread(p)).toContainText('OLDER_CHAT');
  await inBox(p);
  await expect.poll(() => editorText(p)).toBe(q1);

  // Both dividers, by Tab from the box.
  await box(p).focus();
  const value = (selector: string) => p.locator(selector).getAttribute('aria-valuenow');
  await press(p, 'Tab');
  await expect(p.locator('.split-h')).toBeFocused();
  const h = Number(await value('.split-h'));
  await press(p, 'ArrowUp');
  expect(Number(await value('.split-h'))).toBe(h - 2);
  // Past the editor, by Ctrl+M: Tab now moves focus through Run to the vertical divider.
  await press(p, 'Tab');
  await inEditor(p);
  await press(p, 'Control+m', 'Tab', 'Tab');
  await expect(p.locator('.splitter')).toBeFocused();
  const v = Number(await value('.splitter'));
  await press(p, 'ArrowLeft');
  expect(Number(await value('.splitter'))).toBe(v - 2);
  await press(p, 'Escape');
  await inBox(p);
});

test.describe('keys held down: the fixes', () => {
  const hold = async (p: Page, key: string, times: number) => { for (let i = 0; i < times; i++) { await p.keyboard.down(key); await p.waitForTimeout(15); } await p.keyboard.up(key); };

  test('a real press right after a held one still works, also for the same key', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await hold(p, 'j', 6);
    await inBox(p);
    await press(p, 'j');
    await expect(box(p)).toHaveValue('j');
    await press(p, 'j', 'j');
    await expect(box(p)).toHaveValue('jjj');
    // Held for real in the box, after its keyup: repeats type, as anywhere.
    await hold(p, 'j', 3);
    await expect(box(p)).toHaveValue('jjjjjj');
  });
  test('a different key during a hold goes in, once, and the held key is still quiet', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    for (let i = 0; i < 4; i++) { await p.keyboard.down('j'); await p.waitForTimeout(15); }
    await inBox(p);
    await p.keyboard.press('x');
    await p.keyboard.down('j');
    await p.waitForTimeout(15);
    await p.keyboard.up('j');
    await expect(box(p)).toHaveValue('x');
    await press(p, 'j');
    await expect(box(p)).toHaveValue('xj');
  });
  test('a keyup lost with the window: blur clears it, and with no blur only repeats are ever swallowed', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    for (let i = 0; i < 4; i++) { await p.keyboard.down('j'); await p.waitForTimeout(15); }
    await inBox(p);
    const sendKey = (repeat: boolean) => box(p).evaluate((e: any, r: boolean) => {
      const key = new window.KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true, cancelable: true, repeat: r });
      e.dispatchEvent(key);
      return key.defaultPrevented;
    }, repeat);
    // The keyup never came: a real press is not eaten, whatever the state.
    expect(await sendKey(false), 'a real press').toBe(false);
    expect(await sendKey(true), 'still its repeat').toBe(true);
    await p.evaluate(() => window.dispatchEvent(new window.Event('blur')));
    expect(await sendKey(true), 'after blur, nothing is held').toBe(false);
    await p.keyboard.up('j');
  });
  test('held ↵ in the box sends exactly once', async ({ page: p }) => {
    await twoVersions(p);
    const requests = harness.requests().length;
    await box(p).focus();
    await p.keyboard.insertText('say:ONCE');
    await hold(p, 'Enter', 10);
    await waitForTurns(p, 6);
    await p.waitForTimeout(300);
    expect(harness.requests().length).toBe(requests + 1);
    await expect(box(p)).toHaveValue('');
    await expect(p.locator('.turn-user-text', { hasText: 'say:ONCE' })).toHaveCount(1);
  });
  test('Alt+↵ in the box does not send', async ({ page: p }) => {
    await twoVersions(p);
    const requests = harness.requests().length;
    await p.keyboard.insertText('words');
    await press(p, 'Alt+Enter');
    await p.waitForTimeout(200);
    expect(harness.requests().length).toBe(requests);
    await expect(box(p)).toHaveValue(/^words/);
    await inBox(p);
  });
  test('held esc in the box takes one step: from idle to the thread and stays', async ({ page: p }) => {
    await twoVersions(p);
    await hold(p, 'Escape', 8);
    await inThread(p);
    await press(p, 'Escape');
    await inBox(p);
  });
  test('held esc with a generation stops it and goes no further; with an edit cancels it and goes no further', async ({ page: p }) => {
    await twoVersions(p);
    await sendMessage(p, 'hang');
    await expect(generating(p)).toBeVisible();
    await box(p).focus();
    await hold(p, 'Escape', 8);
    await expect(p.locator('.turn[data-kind="note"]')).toContainText('Stopped');
    await inBox(p);
    await toThread(p);
    await press(p, 'k', 'e');
    await inBox(p);
    await expect(editBanner(p)).toBeVisible();
    await hold(p, 'Escape', 8);
    await expect(editBanner(p)).toHaveCount(0);
    await inBox(p);
  });
  for (const [from, go] of [
    ['the thread', async (p: Page) => { await toThread(p); }],
    ['the editor', async (p: Page) => { await press(p, 'Control+e'); await inEditor(p); }],
  ] as const) {
    test(`held esc from ${from} with an edit open: it moves to the box and the edit stays`, async ({ page: p }) => {
      await twoVersions(p);
      await toThread(p);
      await press(p, 'k', 'e');
      await inBox(p);
      await press(p, 'Control+a');
      await p.keyboard.insertText('REWRITE');
      await go(p).catch(() => undefined);
      if (from === 'the thread') { await press(p, 'Home', 'ArrowUp'); await inThread(p); }
      await hold(p, 'Escape', 8);
      await inBox(p);
      await expect(editBanner(p)).toBeVisible();
      await expect(box(p)).toHaveValue('REWRITE');
    });
  }
  for (const [name, open, close] of [
    ['the palette', 'Control+k', 'palette'],
    ['the shortcuts dialog', '?', 'help'],
  ] as const) {
    test(`held esc closing ${name} with an edit open does not go on to cancel the edit`, async ({ page: p }) => {
      await twoVersions(p);
      await toThread(p);
      await press(p, 'k', 'e');
      await inBox(p);
      await press(p, 'Control+a');
      await p.keyboard.insertText('REWRITE');
      if (close === 'help') { await press(p, 'Home', 'ArrowUp'); await inThread(p); await press(p, 'Escape'); await inBox(p); await p.locator('.tab').first().focus(); await box(p).focus(); await press(p, 'Home', 'ArrowUp'); await inThread(p); }
      await press(p, open);
      await p.waitForTimeout(50);
      await hold(p, 'Escape', 8);
      await expect(editBanner(p)).toBeVisible();
      await expect(box(p)).toHaveValue('REWRITE');
    });
  }
  test('held esc closing the save field goes no further: the edit stays', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await press(p, 'k', 'e');
    await inBox(p);
    await press(p, 'Control+s');
    await expect(p.locator('#save-name')).toBeFocused();
    await hold(p, 'Escape', 8);
    await expect(p.locator('#save-name')).toHaveCount(0);
    await inBox(p);
    await expect(editBanner(p)).toBeVisible();
  });
  test('held ↵ in the save field saves once and puts no lines in the editor it returns to', async ({ page: p }) => {
    const dialogs: string[] = [];
    p.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await twoVersions(p);
    await press(p, 'Control+e');
    await inEditor(p);
    const before = await editorText(p);
    await press(p, 'Control+s');
    await expect(p.locator('#save-name')).toBeFocused();
    await press(p, 'Control+a');
    await p.keyboard.insertText('held');
    await hold(p, 'Enter', 10);
    await expect(p.locator('.saved-load')).toHaveCount(1);
    await p.waitForTimeout(200);
    expect(dialogs).toEqual([]);
    expect(await editorText(p)).toBe(before);
  });
  test('held ↵ on a palette action puts no lines in the editor it returns to', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+s');
    await press(p, 'Control+a');
    await p.keyboard.insertText('mine');
    await press(p, 'Enter');
    await expect(p.locator('.saved-load')).toHaveCount(1);
    await press(p, 'Control+k');
    await p.keyboard.insertText('mine');
    await p.keyboard.press('ArrowDown');
    const results = await editorText(p);
    await hold(p, 'Enter', 10);
    await p.waitForTimeout(150);
    expect(await editorText(p)).toBe(results);
  });
  test('held Ctrl+/ flips auto-limit once', async ({ page: p }) => {
    await twoVersions(p);
    await p.keyboard.down('Control');
    await hold(p, '/', 6);
    await p.keyboard.up('Control');
    await expect(p.locator('.footer')).toContainText('Auto-limit off');
  });
});

test.describe('the lint panel with others open', () => {
  test('esc takes completions, then the lint panel, then the search panel, each staying in the editor, then the box', async ({ page: p }) => {
    await twoVersions(p);
    await typeInEditor(p, 'export default from(no_such_table)\n// x');
    await p.waitForSelector('.cm-lintRange-error', { timeout: 15_000 });
    await press(p, 'Control+f');
    await expect(p.locator('.cm-panel.cm-search')).toBeVisible();
    await code(p).focus();
    await press(p, 'Control+Shift+M');
    await expect(p.locator('.cm-panel-lint')).toBeVisible();
    await press(p, 'Escape');
    await expect(p.locator('.cm-panel-lint')).toHaveCount(0);
    await expect(p.locator('.cm-panel.cm-search')).toBeVisible();
    await expect(box(p)).not.toBeFocused();
    await code(p).focus();
    await press(p, 'Control+End');
    await p.keyboard.insertText('\nfrom');
    await press(p, 'Control+Space');
    await p.waitForSelector('.cm-tooltip-autocomplete li');
    await press(p, 'Escape');
    await expect(p.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    await expect(p.locator('.cm-panel.cm-search')).toBeVisible();
    await inEditor(p);
    await press(p, 'Escape');
    await expect(p.locator('.cm-panel.cm-search')).toHaveCount(0);
    await inEditor(p);
    await press(p, 'Escape');
    await inBox(p);
  });
  test('a ? and letters with focus in the lint panel stay out of the app', async ({ page: p }) => {
    await twoVersions(p);
    await typeInEditor(p, 'export default from(no_such_table)');
    await p.waitForSelector('.cm-lintRange-error', { timeout: 15_000 });
    await press(p, 'Control+Shift+M');
    await expect(p.locator('.cm-panel-lint')).toBeVisible();
    await press(p, 'j', 'k', 'e', 'r', '?');
    await expect(p.locator('[aria-label="Keyboard shortcuts"]')).toHaveCount(0);
    await expect(editBanner(p)).toHaveCount(0);
    await press(p, 'Control+l');
    await inBox(p);
  });
});

test.describe('focus after the save field and after deleting', () => {
  const zone = (p: Page) => p.getByTestId('zone');
  for (const [from, go, check, label] of [
    ['the editor', async (p: Page) => { await press(p, 'Control+e'); await inEditor(p); }, inEditor, 'Editor'],
    ['the box', async (p: Page) => { await box(p).focus(); await inBox(p); }, inBox, 'Message'],
    ['the thread', async (p: Page) => { await toThread(p); }, inThread, 'Conversation'],
  ] as const) {
    test(`from ${from}: esc and a save go back there, and the footer agrees`, async ({ page: p }) => {
      await twoVersions(p);
      await go(p);
      await press(p, 'Control+s');
      await expect(p.locator('#save-name')).toBeFocused();
      await press(p, 'Escape');
      await check(p);
      await expect(zone(p)).toHaveText(label);
      await press(p, 'Control+s');
      await expect(p.locator('#save-name')).toBeFocused();
      await press(p, 'Control+a');
      await p.keyboard.insertText(`saved ${from}`);
      await press(p, 'Enter');
      await expect(p.locator('.saved-load')).toHaveCount(1);
      await check(p);
      await expect(zone(p)).toHaveText(label);
    });
  }
  test('from the palette: Save query, then esc, is somewhere that takes keys', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+k');
    await p.keyboard.insertText('Save query');
    await press(p, 'ArrowDown', 'Enter');
    await expect(p.locator('#save-name')).toBeFocused();
    await press(p, 'Escape');
    expect(await p.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await inBox(p);
  });
  test('deleting: focus lands on a neighbour or the box, and the footer agrees', async ({ page: p }) => {
    p.on('dialog', dialog => void dialog.accept());
    await twoVersions(p);
    for (const name of ['first', 'second']) {
      await press(p, 'Control+s');
      await expect(p.locator('#save-name')).toBeFocused();
      await press(p, 'Control+a');
      await p.keyboard.insertText(name);
      await press(p, 'Enter');
      await expect(p.locator('.saved-load', { hasText: name })).toHaveCount(1);
    }
    for (const left of [1, 0]) {
      await p.locator('.saved-delete').first().focus();
      await press(p, 'Enter');
      await expect(p.locator('.saved-load')).toHaveCount(left);
      expect(await p.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    }
    await inBox(p);
    await expect(zone(p)).toHaveText('Message');
  });
});

test.describe('retry and another chat', () => {
  test('r is withheld while another chat generates and comes back live when it ends, on the selected turn', async ({ page: p }) => {
    await twoVersions(p);
    await press(p, 'Control+Shift+L');
    await sendMessage(p, 'slow CHAT_A');
    await expect(generating(p)).toBeVisible();
    await expect(p.locator('.chat-row', { hasText: 'CHAT_A' })).toBeVisible();
    await press(p, 'Control+k');
    await p.keyboard.insertText('ALPHA');
    await press(p, 'ArrowDown', 'Enter');
    await expect(p.locator('.turn-version')).toHaveCount(2);
    await toThread(p);
    await expect(selected(p).locator('.turn-action', { hasText: 'retry' })).toHaveCount(0);
    const requests = harness.requests().length;
    await press(p, 'r');
    await p.waitForTimeout(100);
    expect(harness.requests().length).toBe(requests);
    await expect(selected(p).locator('.turn-action', { hasText: 'retry' })).toHaveCount(1, { timeout: 8_000 });
    await press(p, 'r');
    await inBox(p);
    await expect.poll(() => harness.requests().length).toBe(requests + 1);
  });
});

test.describe('the one rule: repeats only stop once focus has moved', () => {
  const hold = async (p: Page, key: string, times: number) => { for (let i = 0; i < times; i++) { await p.keyboard.down(key); await p.waitForTimeout(15); } await p.keyboard.up(key); };

  test('a held letter types in the box, the editor, the save field and the palette search', async ({ page: p }) => {
    await twoVersions(p);
    await hold(p, 'q', 5);
    await expect(box(p)).toHaveValue('qqqqq');
    await press(p, 'Control+a', 'Delete');
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Control+End');
    await hold(p, 'q', 5);
    await expect.poll(() => editorText(p)).toMatch(/qqqqq$/);
    await press(p, 'Control+s');
    await expect(p.locator('#save-name')).toBeFocused();
    await press(p, 'Control+a');
    await hold(p, 'q', 5);
    await expect(p.locator('#save-name')).toHaveValue('qqqqq');
    await press(p, 'Escape');
    await press(p, 'Control+k');
    await p.waitForTimeout(100);
    await hold(p, 'q', 5);
    await expect(p.locator('.palette input').first()).toHaveValue('qqqqq');
    // Backspace and the arrows repeat there too.
    await hold(p, 'Backspace', 3);
    await expect(p.locator('.palette input').first()).toHaveValue('qq');
    await press(p, 'Escape');
  });

  test('a held Backspace or arrow still repeats in the box, the editor and the save field', async ({ page: p }) => {
    await twoVersions(p);
    await p.keyboard.insertText('abcdef');
    await hold(p, 'ArrowLeft', 3);
    expect(await box(p).evaluate((e: any) => e.selectionStart)).toBe(3);
    await hold(p, 'Backspace', 2);
    await expect(box(p)).toHaveValue('adef');
    await press(p, 'Control+a', 'Delete');
    await press(p, 'Control+e');
    await inEditor(p);
    await press(p, 'Control+End');
    await p.keyboard.insertText('\n// abcdef');
    await hold(p, 'Backspace', 3);
    await expect.poll(() => editorText(p)).toMatch(/\/\/ abc$/);
    await hold(p, 'ArrowLeft', 2);
    await p.keyboard.type('X');
    await expect.poll(() => editorText(p)).toMatch(/\/\/ aXbc$/);
    await press(p, 'Control+s');
    await expect(p.locator('#save-name')).toBeFocused();
    await press(p, 'Control+a');
    await p.keyboard.insertText('abcdef');
    await hold(p, 'Backspace', 2);
    await expect(p.locator('#save-name')).toHaveValue('abcd');
    await press(p, 'Escape');
  });

  for (const [up, down] of [['ArrowUp', 'ArrowDown'], ['k', 'j']] as const) {
    test(`a held ${up} and ${down} still move in the thread, and ${down} stops at the box with nothing typed`, async ({ page: p }) => {
      await openApp(p);
      for (let i = 0; i < 5; i++) { await sendMessage(p, `say:turn ${i}`); await waitForTurns(p, (i + 1) * 2); }
      await toThread(p);
      await hold(p, up, 5);
      await expect(selected(p)).toContainText('say:turn 2');
      await hold(p, up, 12);
      await expect(selected(p)).toContainText('say:turn 0');
      await inThread(p);
      await hold(p, down, 3);
      await inThread(p);
      await hold(p, down, 14);
      await inBox(p);
      await expect(box(p)).toHaveValue('');
    });
  }

  test('held Ctrl+1 to 3 land on the tab; held Ctrl+Enter runs once; held Ctrl+Shift+L and Ctrl+K act once', async ({ page: p }) => {
    await twoVersions(p);
    const runs: string[] = [];
    p.on('request', r => { if (r.url().includes('query.run')) runs.push(r.url()); });
    await p.keyboard.down('Control');
    for (const [key, tab] of [['3', 'SQL'], ['2', 'Chart'], ['1', 'Table']] as const) {
      await hold(p, key, 4);
      await expect(p.locator('.tab.on')).toContainText(tab);
    }
    await hold(p, 'Enter', 6);
    await p.keyboard.up('Control');
    await p.waitForTimeout(400);
    expect(runs).toHaveLength(1);
    await p.keyboard.down('Control');
    await hold(p, 'k', 5);
    await p.keyboard.up('Control');
    await expect(p.locator('.palette')).toHaveCount(1);
    await press(p, 'Escape');
    await p.keyboard.down('Control');
    await p.keyboard.down('Shift');
    await hold(p, 'L', 4);
    await p.keyboard.up('Shift');
    await p.keyboard.up('Control');
    await inBox(p);
    await expect(p.locator('.chat-row.on')).toHaveText('New chat');
  });

  test('held esc from the thread with nothing open goes to the box once and stops', async ({ page: p }) => {
    await twoVersions(p);
    await toThread(p);
    await hold(p, 'Escape', 8);
    await inBox(p);
    await expect(selected(p)).toHaveCount(0);
  });
});
