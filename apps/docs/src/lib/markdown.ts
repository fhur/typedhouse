import { getCollection } from 'astro:content';
import { withBase } from './urls';

export async function publishedPages() {
  const docs = await getCollection('docs');
  const blog = await getCollection('blog', ({ data }) => !data.draft);
  return [
    ...docs.filter(e => !e.data.draft && e.id.startsWith('docs/')).map(e => ({ path: e.id, title: e.data.title, description: e.data.description ?? '', body: e.body ?? '' })),
    ...blog.map(e => ({ path: `blog/${e.id}`, title: e.data.title, description: e.data.description, body: e.body ?? '' })),
  ].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function markdown(page: Awaited<ReturnType<typeof publishedPages>>[number], site: URL | undefined) {
  // Only Markdown is supported. Fail closed rather than silently losing component content.
  const prose = page.body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  if (/^\s*(?:import|export)\s|<[A-Z][A-Za-z]*(?:\s|\/?>)/m.test(prose)) {
    throw new Error(`Unsupported MDX in ${page.path}; author plain Markdown instead.`);
  }
  const base = site ?? new URL('https://fhur.github.io');
  const canonical = new URL(withBase(`/${page.path}/`), base).href;
  const body = page.body.replace(/\]\((\/(?:docs|blog)\/[^)\s#]+?)(?:\/)?(#[^)\s]*)?\)/g,
    (_, path: string, hash: string = '') => `](${new URL(withBase(`${path.replace(/\/$/, '')}.md${hash}`), base).href})`)
    .replace(/\]\((\/[^)\s]+)\)/g, (_, path: string) => `](${new URL(withBase(path), base).href})`);
  return `# ${page.title}\n\nCanonical: ${canonical}\n\nVersion: current workspace preview (not complete v1).\n\n${body.trim()}\n`;
}
