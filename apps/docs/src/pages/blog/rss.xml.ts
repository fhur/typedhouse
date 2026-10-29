import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { withBase } from '../../lib/urls';
const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export const GET: APIRoute = async ({ site }) => {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort((a,b) => b.data.date.getTime() - a.data.date.getTime());
  const items = posts.map(post => {
    const url = new URL(withBase(`/blog/${post.id}/`), site).href;
    return `<item><title>${escape(post.data.title)}</title><description>${escape(post.data.description)}</description><link>${escape(url)}</link><guid>${escape(url)}</guid><pubDate>${post.data.date.toUTCString()}</pubDate></item>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>chql engineering notes</title><link>${escape(new URL(withBase('/'), site).href)}</link><description>Typed, composable ClickHouse queries</description>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
