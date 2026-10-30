import type { APIRoute } from 'astro';
import { withBase } from '../lib/urls';
import { publishedPages } from '../lib/markdown';
export const GET: APIRoute = async ({ site }) => {
  const pages = await publishedPages();
  const lines = pages.map(page => `- [${page.title}](${new URL(withBase(`/${page.path}.md`), site)}): ${page.description}`);
  return new Response(`# TypedHouse\n\n> Type-safe ClickHouse query builder for TypeScript. Current workspace preview, not complete v1. Formerly typedhouse; package imports remain @typedhouse/*.\n\nStart with Getting started for the canonical fixture and exact SQL. Reference pages state supported inputs and corrections. Browser transpilation is not typechecking; compile and typecheck generated code.\n\n## Documentation and articles\n\n${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
