import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
let links = 0;
for (const entry of await readdir(dist, { recursive: true })) {
  if (!entry.endsWith('.html')) continue;
  const html = await readFile(join(dist, entry), 'utf8');
  assert.match(html, /<title>[^<]*TypedHouse[^<]*<\/title>/, `${entry}: missing TypedHouse page title`);
  assert.ok(!/<strong>typedhouse<\/strong>|>typedhouse<\/a>|typedhouse TypeScript source|Interactive typedhouse playground/.test(html), `${entry}: stale public branding`);
  assert.equal(html.split('https://www.googletagmanager.com/gtag/js?id=G-DNEY4MRCR4').length - 1, 1, `${entry}: expected one Google tag loader`);
  assert.equal(html.split("gtag('config', 'G-DNEY4MRCR4')").length - 1, 1, `${entry}: expected one GA configuration`);
  for (const match of html.matchAll(/href="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
    if (match[1].startsWith('//')) continue;
    assert.ok(!base || match[1] === base || match[1].startsWith(`${base}/`), `${entry}: link omits base: ${match[1]}`);
    const path = resolve(dist, '.' + decodeURIComponent(match[1].slice(base.length) || '/'));
    assert.ok(path === dist || path.startsWith(dist + '/'), `Link escapes output directory: ${match[1]}`);
    assert.ok(await exists(path) || await exists(join(path, 'index.html')) || await exists(path + '.html'), `${entry}: broken link ${match[1]}`);
    links++;
  }
  if (entry.startsWith('docs/')) assert.ok(!html.includes('/Playground.'), `Editor assets on static docs: ${entry}`);
}
for (const route of ['docs/getting-started.md', 'docs/tutorials/composition.md', 'docs/tutorials/advanced-example.md', 'docs/reference/queries.md', 'blog/composition-without-hiding-sql.md', 'llms.txt', 'llms-full.txt', 'blog/rss.xml', 'pagefind/pagefind.js']) {
  assert.ok(await exists(join(dist, route)), `Missing static output: ${route}`);
}
const home = await readFile(join(dist, 'index.html'), 'utf8');
assert.equal((home.match(/<section\b/g) ?? []).length, 3, 'Homepage should have exactly three sections');
assert.ok(!home.includes('<astro-island') && !home.includes('/Playground.'), 'Homepage must not load the editor');
assert.ok(!home.includes('pagefind-ui'), 'Homepage must not load a search widget');
assert.match(home, /Generated SQL/);
assert.match(home, /Learn TypedHouse/);
assert.match(home, /Type-safe ClickHouse query builder for TypeScript/);
assert.match(home, /property="og:site_name" content="TypedHouse"/);
assert.match(home, /https:\/\/github\.com\/fhur\/typedhouse/);
assert.match(await readFile(join(dist, 'llms.txt'), 'utf8'), /^# TypedHouse\n/);
assert.match(await readFile(join(dist, 'blog/rss.xml'), 'utf8'), /<title>TypedHouse engineering notes<\/title>/);
assert.match(await readFile(join(dist, 'docs/getting-started.md'), 'utf8'), /@typedhouse\/core/);
const share = home.match(/#v1=([A-Za-z0-9_-]+)/);
assert.ok(share, 'Homepage example needs an editable playground link');
const sharedSource = gunzipSync(Buffer.from(share[1], 'base64url')).toString('utf8');
assert.equal(sharedSource, await readFile(new URL('../src/examples/homepage.ts', import.meta.url), 'utf8'), 'Playground must receive the exact homepage example');
const markdown = await readFile(join(dist, 'docs/getting-started.md'), 'utf8');
assert.match(markdown, /import\s*\{\s*col,\s*table,\s*from,?\s*\}/);
assert.match(markdown, /SELECT/);
assert.match(markdown, /tutorials\/composition\.md/);
assert.match(markdown, /tutorials\/advanced-example\.md/);
const guideHtml = await readFile(join(dist, 'docs/getting-started/index.html'), 'utf8');
assert.match(guideHtml, />Guides</);
assert.ok(!/>Start here<|>Tutorials</.test(guideHtml), 'Old navigation sections must not remain');
assert.ok(!markdown.includes('<astro-island'));
console.log(`Static outputs and ${links} internal links verified; docs pages have no playground assets.`);
