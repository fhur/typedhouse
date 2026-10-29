import type { APIRoute } from 'astro';
import { markdown, publishedPages } from '../lib/markdown';
export const GET: APIRoute = async ({ site }) => new Response(
  (await publishedPages()).map(page => markdown(page, site)).join('\n---\n\n'),
  { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
);
