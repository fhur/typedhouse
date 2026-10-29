import assert from 'node:assert/strict';
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
for (const route of ['docs/getting-started.md', 'docs/tutorials/composition.md', 'docs/reference/queries.md', 'blog/composition-without-hiding-sql.md', 'llms.txt', 'llms-full.txt', 'blog/rss.xml', 'pagefind/pagefind.js']) {
  assert.ok(await exists(join(dist, route)), `Missing static output: ${route}`);
}
const markdown = await readFile(join(dist, 'docs/getting-started.md'), 'utf8');
assert.match(markdown, /import\s*\{\s*col,\s*table,\s*from,\s*registerCompiler,?\s*\}/);
assert.match(markdown, /SELECT/);
assert.match(markdown, /tutorials\/composition\.md/);
assert.ok(!markdown.includes('<astro-island'));
console.log(`Static outputs and ${links} internal links verified; docs pages have no playground assets.`);
