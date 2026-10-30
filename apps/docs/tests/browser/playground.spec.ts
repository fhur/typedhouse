import { expect, test } from '@playwright/test';

test('built-in example compiles without a database', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  await expect(page.getByLabel('Generated SQL', { exact: true })).toContainText('SELECT');
  const displayedSql = await page.getByLabel('Generated SQL', { exact: true }).textContent();
  expect(displayedSql).toMatch(/SELECT\n  /);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(displayedSql);
  await page.getByLabel('Example').selectOption('parameters');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  await expect(page.getByLabel('Generated SQL', { exact: true })).not.toContainText('OR 1=1');
  await page.locator('.pg-details summary').filter({ hasText: 'Parameters' }).click();
  await expect(page.locator('.pg-details details:not(.pg-help) pre')).toBeVisible();
  await expect(page.locator('.pg-details details:not(.pg-help)')).toContainText('OR 1=1');
});

test('shared code requires explicit compilation', async ({ page }) => {
  await page.goto('/playground/');
  const fragment = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module in the browser.
    const { encodeShare } = await import('/src/playground/sharing.ts');
    return encodeShare('throw new Error("shared source executed");');
  });
  await page.goto(`/playground/#${fragment}`);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Review it');
  await expect(page.locator('iframe[title="Isolated query compiler"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('shared source executed');
});

test('sandbox blocks storage, network and external scripts; loops time out', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  const failures: string[] = [];
  const responses: string[] = [];
  page.on('requestfailed', request => { if (request.url().includes('example.com/typedhouse-probe')) failures.push(request.failure()?.errorText ?? 'unknown'); });
  page.on('response', response => { if (response.url().includes('example.com/typedhouse-probe')) responses.push(response.url()); });
  const results = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module in the browser.
    const { compileIsolated } = await import('/src/playground/sandbox.ts');
    const probe = async (source: string) => {
      try { await compileIsolated(source, new AbortController().signal); return 'unexpected success'; }
      catch (error) { return (error as Error).message; }
    };
    return {
      storage: await probe('throw new Error(typeof localStorage)'),
      document: await probe('throw new Error(typeof document)'),
      network: await probe('const x = new XMLHttpRequest(); x.open("GET", "https://example.com/typedhouse-probe", false); x.send();'),
      script: await probe('importScripts("https://example.com/typedhouse-probe.js");'),
      timeout: await probe('while (true) {}'),
    };
  });
  expect(results.storage).toBe('undefined');
  expect(results.document).toBe('undefined');
  expect(results.network).toContain('Failed');
  expect(results.script).toContain('failed');
  expect(results.timeout).toContain('timed out');
  expect(responses).toEqual([]);
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatch(/csp/i);
  await expect(page.locator('iframe[title="Isolated query compiler"]')).toHaveCount(0);
});

test('mobile playground fits the viewport and editor supports keyboard escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/playground/');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const editor = page.getByRole('textbox', { name: 'TypedHouse TypeScript source' });
  await editor.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
});

test('dedicated playground fills the desktop viewport without a surrounding card', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  const geometry = await page.locator('.typedhouse-playground').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight,
      border: getComputedStyle(el).borderWidth, pageHeight: document.documentElement.scrollHeight };
  });
  expect(geometry.left).toBe(0);
  expect(geometry.right).toBe(geometry.width);
  expect(Math.abs(geometry.bottom - geometry.height)).toBeLessThanOrEqual(1);
  expect(geometry.pageHeight).toBeLessThanOrEqual(geometry.height);
  expect(geometry.border).toBe('0px');
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByText('Usage & safety', { exact: true })).toBeVisible();
});

test('desktop panes resize with keyboard controls', async ({ page }) => {
  await page.goto('/playground/');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  const divider = page.getByRole('separator', { name: 'Resize source and SQL panes' });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '30');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider).toBeHidden();
});

test('light and dark preferences update the site and editor', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/playground/');
  await expect(page.getByRole('status')).toContainText('Compiled locally');
  const theme = page.getByRole('combobox', { name: 'Color theme' });
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkToken = await page.locator('.cm-line span').first().evaluate(el => getComputedStyle(el).color);
  const dark = await page.locator('.typedhouse-playground').evaluate(el => getComputedStyle(el).backgroundColor);
  await theme.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.locator('.cm-line span').first().evaluate(el => getComputedStyle(el).color)).not.toBe(darkToken);
  const light = await page.locator('.typedhouse-playground').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(light).not.toBe(dark);
  await page.reload();
  await expect(theme).toHaveValue('light');
  await theme.selectOption('auto');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('share encoding round-trips and rejects malformed or oversized input', async ({ page }) => {
  await page.goto('/playground/');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this source module in the browser.
    const { encodeShare, decodeShare } = await import('/src/playground/sharing.ts');
    const source = 'const label = "日本語 🚀";';
    const roundtrip = await decodeShare('#' + await encodeShare(source));
    const rejected: string[] = [];
    for (const fragment of ['#v2=abc', '#v1=!!!', '#v1=' + 'a'.repeat(12_001)]) {
      try { await decodeShare(fragment); } catch { rejected.push(fragment.slice(0, 8)); }
    }
    return { source, roundtrip, rejected };
  });
  expect(result.roundtrip).toBe(result.source);
  expect(result.rejected).toHaveLength(3);
});
